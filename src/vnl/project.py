"""Операции над проектом.

Единственная точка входа для всего, что меняет песочницу. Интерфейс, Claude
через MCP и тесты вызывают одни и те же методы: расходиться им нельзя, иначе
у Claude окажется своя копия правды, а у холста своя.

Отмена сделана снимками состояния, а не обратными операциями. Обратные
операции точнее по памяти, но каждая новая операция требует писать к ней пару,
и однажды пара окажется неверной -- а молча испорченный проект хуже, чем
лишние мегабайты. Песочница маленькая, глубина истории ограничена.

Пакет изменений (`batch`) снимает один снимок на весь блок, поэтому пачка
правок от Claude отменяется одним шагом, а не по одному нейрону.
"""

from __future__ import annotations

import copy
import hashlib
import json
from contextlib import contextmanager
from dataclasses import dataclass, field, fields, replace
from datetime import datetime, timezone
from typing import Any, Iterable, Iterator

from . import ir, protocols
from .compose import Composition, compose
from .patterns import (
    CatalogLevel,
    DRAFT_LEVEL,
    PORT_DIRECTIONS,
    DemoRun,
    Endpoint,
    Link,
    Pattern,
    PatternError,
    PatternInstance,
    Port,
    Sandbox,
    SandboxMotor,
    SandboxNeuron,
    SandboxRecording,
    SandboxSensor,
    SandboxStimulus,
    adopt_demo,
    cell_type_at,
    duplicate_object,
    extract_pattern,
    rename_neuron,
    suggest_ports,
    touches,
    ungroup_block,
)
from .sim import SimResult, simulate
from .store import Store, to_plain

HISTORY_LIMIT = 50

#: Сколько отсчётов позволено одному прогону. Ограничение не физическое, а
#: житейское: `duration/dt` -- это длина каждой трассы, и опечатка в нуле
#: превращает песочницу в зависший браузер вместо сообщения об ошибке.
SAMPLE_LIMIT = 1_000_000

#: Род стимула. Реестр один на проект (`protocols.DRIVE_KINDS`): он же решает,
#: какими числами задан протокол, он же разворачивает шаблон в список времён и
#: он же объясняет род человеку. Свой список здесь был бы вторым -- и разошёлся
#: бы с солвером на первом же новом протоколе.
STIMULUS_KINDS = protocols.KINDS

#: Параметры мембраны, у которых ноль или минус не значат ничего при любом
#: виде модели: на них делят. Проверяются здесь, а не в симуляторе, чтобы
#: отказ пришёл в панель свойств, а не обвалил прогон.
#:
#: `tau_w` сюда не попал, хотя на него тоже делят, и это не забывчивость
#: (#527): делят на него только у `adex`, а у `lif` он не читается вовсе. Этот
#: список безусловный, и `tau_w` в нём отбивал бы ноль там, где язык его
#: принимает, -- то есть ровно та же болезнь, только с другой стороны.
#: Условные правила живут одним списком в `ir.point_model_problems`, и
#: `set_cell` спрашивает их там же, где их спрашивает разбор файла.
CELL_POSITIVE = ("tau_m", "tau_adaptation", "r_in")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _check_contact_params(params: dict[str, Any]) -> None:
    """Рецептор, вес и задержка -- проверка одна на связь холста и на контакт.

    Общая нарочно. Связь песочницы и контакт внутри блока -- одна вещь с двумя
    адресами (`patterns.Link` и есть `ir.Contact`, адресованный объектами
    холста), и две таблицы допустимого разошлись бы на первой же правке: то,
    что не примут у связи, молча проехало бы внутрь блока.

    Задержка отрицательной не бывает: симулятор сдвигает приход события на
    `delay` вперёд, и минус означал бы, что проводимость открылась раньше
    спайка. Отрицательный вес -- не торможение: знак задаёт реверсал (свой у
    контакта или реестровый, `ir.RECEPTORS`), а вес меньше нуля дал бы
    синапс, у которого ток течёт против собственного реверсала, -- ровно то,
    чего в модели нет.
    """
    if "receptor" in params and params["receptor"] not in ir.RECEPTORS:
        raise PatternError(
            f"рецептор {params['receptor']!r} неизвестен: "
            f"{', '.join(ir.RECEPTORS)}"
        )
    if "delay" in params and float(params["delay"]) < 0:
        raise PatternError("задержка не бывает отрицательной")
    if "weight" in params and float(params["weight"]) < 0:
        raise PatternError("вес не бывает отрицательным: знак задаёт реверсал")


@dataclass
class Run:
    """Результат запуска конкретного состояния схемы.

    Спайки и потенциалы принадлежат прогону, а не паттерну: стоит поменять
    схему -- и этот результат уже про другую сеть.
    """

    id: str
    at: str
    fingerprint: str
    result: SimResult
    composition: Composition

    def is_stale(self, current: str) -> bool:
        return self.fingerprint != current


@dataclass
class Step:
    """Шаг истории: подпись и состояние до него."""

    label: str
    before: Sandbox
    at: str = field(default_factory=_now)


class Project:
    """Песочница вместе с историей, прогоном и признаком несохранённого."""

    def __init__(self, sandbox: Sandbox, store: Store | None = None) -> None:
        self.sandbox = sandbox
        self.store = store
        self.history: list[Step] = []
        self.last_run: Run | None = None
        self._saved = to_plain(sandbox)
        self._batch: str | None = None

    # --- состояние --------------------------------------------------------

    @property
    def dirty(self) -> bool:
        """Есть ли несохранённые изменения. Это факт, а не подпись в макете."""
        return to_plain(self.sandbox) != self._saved

    @property
    def can_undo(self) -> bool:
        return bool(self.history)

    def fingerprint(self) -> str:
        """Отпечаток собираемой сети.

        Считается по модели, а не по песочнице: сдвиг блока на холсте физику
        не меняет и результат устаревшим не делает.

        Имя и происхождение модели из подсчёта выброшены (#563). `compose`
        переносит в них имя песочницы и её идентификатор -- это подписи на
        результате, а не сеть: переименовав проект, человек получил бы «схема
        изменилась, прогон прежней» на той же самой схеме с теми же самыми
        числами. Выкидывать их именно здесь, а не в `compose`: имя нужно
        отчёту и экспорту, и отнимать его у модели ради отпечатка значило бы
        чинить не там, где сломано.
        """
        model = to_plain(compose(self.sandbox).model)
        for label in ("name", "source"):
            model.pop(label, None)
        payload = json.dumps(model, ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    @property
    def run_is_stale(self) -> bool:
        if self.last_run is None:
            return False
        return self.last_run.is_stale(self.fingerprint())

    # --- история ----------------------------------------------------------

    def _remember(self, label: str) -> None:
        self._keep(label, copy.deepcopy(self.sandbox))

    def _keep(self, label: str, before: Sandbox) -> None:
        """Готовый снимок -- в историю.

        Отдельно от `_remember` ради операций, которые сперва делают, а потом
        отчитываются: `rename_neuron` и `duplicate` проверяют всё до первой
        правки и при отказе не трогают проект вовсе, поэтому снимок им удобно
        снять заранее, а положить в историю -- только на удаче. Иначе отказ
        оставлял бы за собой шаг отмены, который ничего не отменяет, а
        повторять их проверки здесь значило бы завести вторую копию правил
        именования.
        """
        if self._batch is not None:
            return  # внутри пакета снимок уже сделан
        self.history.append(Step(label=label, before=before))
        del self.history[:-HISTORY_LIMIT]

    @contextmanager
    def batch(self, label: str) -> Iterator["Project"]:
        """Связанные правки -- один шаг отмены."""
        if self._batch is not None:
            yield self  # вложенный пакет входит в объемлющий
            return
        self.history.append(Step(label=label, before=copy.deepcopy(self.sandbox)))
        del self.history[:-HISTORY_LIMIT]
        self._batch = label
        try:
            yield self
        finally:
            self._batch = None

    def undo(self) -> str | None:
        """Отменить последний шаг. Возвращает его подпись."""
        if not self.history:
            return None
        step = self.history.pop()
        self.sandbox = step.before
        return step.label

    # --- операции ---------------------------------------------------------

    def insert_pattern(
        self,
        pattern: Pattern,
        label: str | None = None,
        instance_id: str | None = None,
        position: tuple[float, float] = (0.0, 0.0),
        demo: bool = False,
    ) -> PatternInstance:
        """Вставить паттерн блоком. Кладётся снимок, а не ссылка на библиотеку.

        `demo` -- переход с карточки паттерна (#526): вместе с блоком в проект
        ложится его витрина, настоящими стимулами и записями. Умолчание --
        «нет»: вставка из панели «Библиотека» кладёт молчащий блок, и это не
        недоделка, а правило (`adopt_demo` разбирает, почему у двух дорог
        разный ответ).

        Один шаг истории на всю вставку, а не два: снимок снят до блока, и
        «Отменить» возвращает проект к тому, что было до перехода, -- вместе с
        драйвом, записями и параметрами прогона. Разделять их значило бы, что
        первое «Отменить» оставляет драйв, целящийся в исчезнувший блок.
        """
        self._remember(f"вставлен паттерн «{pattern.name}»")
        item = self.sandbox.add_instance(pattern, label, instance_id, position)
        if demo:
            adopt_demo(self.sandbox, item.id)
        return item

    def add_neuron(
        self,
        neuron_id: str | None,
        cell_type: ir.CellType,
        position: tuple[float, float] = (0.0, 0.0),
    ) -> SandboxNeuron:
        """Положить на холст отдельную клетку.

        Имя, если его не назвали, подбирается свободное среди всех объектов
        холста -- блоков в том числе: столкновение имён иначе всплыло бы только
        на запуске, когда `compose` разворачивает блок в его нейроны.
        """
        label = neuron_id or self.sandbox.free_id(cell_type.id)
        if label in self.sandbox.taken_ids():
            # Проверка до снимка истории: отказ не должен оставлять за собой
            # шаг отмены, который ничего не отменяет.
            raise PatternError(f"имя {label!r} на холсте уже занято")
        self._remember(f"положена клетка {label}")
        return self.sandbox.add_neuron(label, cell_type, position)

    def connect(
        self,
        source: Endpoint,
        target: Endpoint,
        link_id: str | None = None,
        **params: Any,
    ) -> Link:
        """Связь между двумя точками холста.

        Рецептор, если его не назвали, берётся по медиатору источника (#540):
        `gaba` -> `gaba_a`, `glutamate` -> `ampa`, `acetylcholine` ->
        `nicotinic`. Раньше умолчание было одно на всех -- `ampa` из
        `Link`, -- и связь от тормозной клетки молча выходила быстрой
        возбуждающей: человек рисовал контакт от красной квадратной клетки и
        получал ровно обратное тому, что видел.

        Считается здесь, а не в интерфейсе: соответствие «медиатор ->
        рецептор» -- предметное знание (`ir.TRANSMITTER_RECEPTORS`), и его
        вторая копия в браузере разошлась бы с первой незаметно. Заодно то же
        умолчание достаётся CLI и Claude через MCP -- они тоже зовут `connect`.

        Умолчание, а не запрет: названный рецептор проходит как есть, а про
        спор рецептора с медиатором скажет предупреждение сборки.
        """
        chosen = link_id or self._free_link_id()
        if any(link.id == chosen for link in self.sandbox.links):
            raise PatternError(f"связь {chosen!r} уже есть")
        if "receptor" not in params:
            source_type = cell_type_at(self.sandbox, source)
            params["receptor"] = ir.default_receptor(
                source_type.transmitter if source_type else None
            )
        self._remember(f"связь {chosen}")
        link = Link(id=chosen, source=source, target=target, **params)
        self.sandbox.links.append(link)
        return link

    def set_parameters(self, link_id: str, **params: Any) -> Link:
        link = self._link(link_id)
        unknown = [key for key in params if not hasattr(link, key)]
        if unknown:
            raise PatternError(f"у связи нет параметров: {', '.join(unknown)}")
        _check_contact_params(params)
        self._remember(f"параметры связи {link_id}")
        link = self._link(link_id)  # после снимка объект тот же
        for key, value in params.items():
            setattr(link, key, value)
        return link

    def set_contact(self, block_id: str, contact_id: str, **params: Any) -> ir.Contact:
        """Параметры контакта внутри блока: рецептор, вес, задержка.

        Правится снимок экземпляра, а не библиотечный паттерн, -- ровно так
        же, как уже устроен порог (`set_cell`). Снимок у каждого блока свой,
        поэтому два экземпляра одного паттерна расходятся свободно, а
        библиотеку правка не задевает вовсе. Без этой операции в «задержке
        проведения» нельзя потрогать те самые `delay = 1 мс` и `delay = 10 мс`,
        в которых весь смысл паттерна: снимок правился только мембраной.

        Отдельного понятия «параметры контакта» здесь не заводится: проверки
        общие со связью холста (`_check_contact_params`) -- связь и контакт
        одна и та же вещь, у которой различается только адрес. Альтернатива --
        своя проверка на каждой стороне -- означала бы, что задержка, которую
        не примут у связи, спокойно проедет внутрь блока.
        """
        contact = self._contact(block_id, contact_id)
        unknown = [key for key in params if not hasattr(contact, key)]
        if unknown:
            raise PatternError(f"у контакта нет параметров: {', '.join(unknown)}")
        _check_contact_params(params)

        self._remember(f"контакт {contact_id} в {block_id}")
        contact = self._contact(block_id, contact_id)  # после снимка объект тот же
        for key, value in params.items():
            setattr(contact, key, value)
        return contact

    def rename(self, block_id: str, label: str) -> PatternInstance:
        """Подпись блока на холсте.

        Правится подпись экземпляра, а не имя паттерна: в библиотеке лежит
        один «FFI», а на холсте таких блоков бывает три, и различать их надо
        здесь. Имя паттерна трогать нельзя -- за него держится снимок.
        """
        chosen = label.strip()
        if not chosen:
            raise PatternError("подпись блока не может быть пустой")
        self.sandbox.instance(block_id)  # проверка до снимка истории
        self._remember(f"переименован {block_id}")
        block = self.sandbox.instance(block_id)
        block.label = chosen
        return block

    def rename_neuron(self, neuron_id: str, new_id: str) -> SandboxNeuron:
        """Имя отдельной клетки -- её же адрес (#563).

        Не то же, что `rename` выше, и не её обобщение. У блока правится
        подпись, которой в сети нет вовсе; здесь правится имя нейрона
        собранной сети -- то самое, за которое держатся связи, стимулы и
        записи, и которым подписан столбец растра. Одна операция на два этих
        случая означала бы, что «переименовать» иногда безобидно, а иногда
        переписывает пол-проекта, и по вызову не видно, что именно.

        Сама перепись ссылок живёт в `patterns.rename_neuron` -- там же, где
        `free_id` и `ungroup_block`: имена холста раздаются и меняются в одном
        месте, иначе второе решило бы «свободно ли имя» по-своему.
        """
        before = copy.deepcopy(self.sandbox)
        neuron = rename_neuron(self.sandbox, neuron_id, new_id)
        self._keep(f"переименована клетка {neuron_id}", before)
        return neuron

    def rename_project(self, name: str) -> Sandbox:
        """Имя проекта -- человеческое, идентификатор отдельный.

        Поэтому тут и нечего чинить: за `sandbox.id` держатся файл в
        хранилище и открытая сессия, а `name` не адресует ничего. Ради этого
        `Sandbox.empty` и разводит их с самого начала.

        Отпечаток собираемой сети от переименования не меняется -- за это
        отвечает `fingerprint`, который имени проекта не считает.
        """
        chosen = name.strip()
        if not chosen:
            raise PatternError("у проекта должно быть имя")
        self._remember(f"переименован проект «{self.sandbox.name}»")
        self.sandbox.name = chosen
        self.sandbox.updated_at = _now()
        return self.sandbox

    def duplicate(self, object_id: str) -> str:
        """Ещё один такой же объект холста: клетка или блок (#563).

        Один шаг отмены на всю копию -- и потому, что человек сделал одно
        действие, и потому, что копия блока это не только коробка, а ещё и её
        снимок с правлеными порогами.

        Что именно копируется и чего копия не получает, разбирает
        `patterns.duplicate_object`: там же лежит и раздача имён.
        """
        before = copy.deepcopy(self.sandbox)
        chosen = duplicate_object(self.sandbox, object_id)
        self._keep(f"дублирован {object_id}", before)
        return chosen

    def set_cell(
        self, target_id: str, type_id: str | None = None, **params: Any
    ) -> ir.CellType:
        """Параметры мембраны: порог, покой, постоянная времени, адаптация.

        В IR они живут на типе клетки, а не на нейроне, поэтому правка задевает
        все нейроны этого типа внутри блока. Расщеплять тип под каждый нейрон
        здесь нельзя: тогда `Instance` перестал бы описывать нейрон, а два
        одинаковых блока перестали бы сравниваться в `compose`. Зато снимок у
        каждого блока свой, и два экземпляра одного паттерна расходятся
        свободно -- за это и хранится снимок, а не ссылка на библиотеку.

        Среди параметров есть и `kind` -- вид точечной модели (#527). Это не
        число, а другой солвер, но правится он здесь же и тем же способом: в IR
        вид живёт полем `PointModel`, наравне с порогом, и отдельный маршрут
        под него означал бы, что это какая-то другая вещь.
        """
        types, chosen = self._cell_types(target_id, type_id)
        cell_type = types[chosen]
        unknown = [key for key in params if not hasattr(cell_type.point_model, key)]
        if unknown:
            raise PatternError(f"у клетки нет параметров: {', '.join(unknown)}")
        for key in CELL_POSITIVE:
            if key in params and float(params[key]) <= 0:
                raise PatternError(f"{key} должен быть больше нуля")
        if float(params.get("refractory", 0.0)) < 0:
            raise PatternError("рефрактерность не бывает отрицательной")

        # Правка примеряется на копии -- тем же приёмом, что у стимула, и по
        # той же причине: отказ обязан оставить проект таким, каким он был.
        #
        # Спрашивается при этом не «законно ли набранное число», а «законна ли
        # мембрана целиком»: правила `adex` связывают поля между собой
        # (`v_peak` выше `v_t`, `v_reset` ниже `v_peak`), и по одному полю их
        # не проверить. Отсюда же берётся то, ради чего всё затевалось:
        # переключение `lif -> adex` на клетке с неподходящими числами
        # отказывает сразу и теми же словами, какими откажет файл, -- а не
        # молча заводит на холсте схему, которую потом не сохранить.
        problems = ir.point_model_problems(replace(cell_type.point_model, **params))
        if problems:
            raise PatternError("; ".join(problems))

        self._remember(f"клетка {chosen} в {target_id}")
        types, chosen = self._cell_types(target_id, type_id)
        point = types[chosen].point_model
        for key, value in params.items():
            setattr(point, key, value)
        return types[chosen]

    def set_stimulus(self, stimulus_id: str, **params: Any) -> SandboxStimulus:
        """Параметры стимула. Без них драйв остаётся таким, каким его создали."""
        stimulus = self._stimulus(stimulus_id)
        unknown = [key for key in params if not hasattr(stimulus, key)]
        if unknown:
            raise PatternError(f"у стимула нет параметров: {', '.join(unknown)}")
        if "kind" in params and params["kind"] not in STIMULUS_KINDS:
            raise PatternError(
                f"род стимула {params['kind']!r} неизвестен: "
                f"{', '.join(STIMULUS_KINDS)}"
            )
        if "receptor" in params and params["receptor"] not in ir.RECEPTORS:
            raise PatternError(
                f"рецептор {params['receptor']!r} неизвестен: "
                f"{', '.join(ir.RECEPTORS)}"
            )
        if float(params.get("rate", stimulus.rate)) < 0:
            raise PatternError("частота не бывает отрицательной")
        start = float(params.get("start", stimulus.start))
        stop = float(params.get("stop", stimulus.stop))
        if stop <= start:
            raise PatternError("стимул кончается раньше, чем начинается")

        # Правка примеряется на копии и только потом ложится в проект: шаблон
        # протокола проверяется тем же разворачиванием, каким он поедет в
        # солвер, а отказ обязан оставить проект таким, каким он был. Иначе
        # «поезд на 0 Гц» успел бы попасть и в историю отмены, и в файл.
        candidate = replace(stimulus, **params)
        # Смена рода досыпает канонические числа нового протокола -- но только
        # туда, где ничего не набрано. Стирать набранное значило бы наказывать
        # за любопытство: заглянул в другой род и потерял свои 50 Гц.
        for key, value in protocols.defaults(candidate.kind).items():
            if key not in params and not getattr(candidate, key):
                setattr(candidate, key, value)
        problems = protocols.problems(candidate)
        if problems:
            raise PatternError("; ".join(problems))

        self._remember(f"стимул {stimulus_id}")
        stimulus = self._stimulus(stimulus_id)
        for slot in fields(SandboxStimulus):
            setattr(stimulus, slot.name, getattr(candidate, slot.name))
        return stimulus

    def set_recording(self, recording_id: str, var: str) -> SandboxRecording:
        """Что писать в этой записи. Реестр величин -- в `ir.RECORDED`."""
        if var not in ir.RECORDED:
            raise PatternError(
                f"записать {var!r} нельзя: {', '.join(ir.RECORDED)}"
            )
        self._recording(recording_id)  # проверка до снимка истории
        self._remember(f"запись {recording_id}")
        recording = self._recording(recording_id)
        recording.var = var
        return recording

    # --- граница с миром --------------------------------------------------
    #
    # Четыре операции вместо двух («завести» и «поправить» на каждую дверь) --
    # по той же причине, по которой они разведены у стимула: заводит объект
    # тот, кто кладёт его на холст, а правит тот, кто уже выбрал его в панели
    # свойств, и одна операция на оба случая требовала бы от второго присылать
    # всё заново.

    def _sense_numbers(
        self, where: str, target: Any, defaults: dict[str, Any], params: dict[str, Any]
    ) -> dict[str, float]:
        """Числа рода поверх канонических -- с отказом на чужое имя.

        Канонические берутся из реестра родов, а не из полей датакласса: у
        одного и того же поля они разные у разных родов, и «окно по умолчанию»
        -- предметное знание, второе место для которого разойдётся с первым.
        """
        unknown = sorted(
            key for key in params if key not in defaults or not hasattr(target, key)
        )
        if unknown:
            known = ", ".join(defaults) or "их нет вовсе"
            raise PatternError(
                f"у {where} нет параметров: {', '.join(unknown)} (есть: {known})"
            )
        return {
            name: float(params.get(name, canonical))
            for name, canonical in defaults.items()
        }

    def add_sensor(
        self,
        sensor_id: str | None = None,
        kind: str = "rate",
        position: tuple[float, float] = (0.0, 0.0),
        **params: Any,
    ) -> SandboxSensor:
        """Завести сенсор. Подключается он потом -- обычной связью."""
        if kind not in protocols.SENSOR_KINDS:
            raise PatternError(
                f"род сенсора {kind!r} неизвестен: "
                f"{', '.join(protocols.SENSOR_KIND_IDS)}"
            )
        chosen = sensor_id or self.sandbox.free_id("sensor")
        if chosen in self.sandbox.taken_ids():
            raise PatternError(f"имя {chosen!r} на холсте уже занято")
        sensor = SandboxSensor(id=chosen, kind=kind, position=position)
        numbers = self._sense_numbers(
            "сенсора", sensor, protocols.sensor_defaults(kind), params
        )
        for key, value in numbers.items():
            setattr(sensor, key, value)
        problems = protocols.sensor_problems(sensor)
        if problems:
            raise PatternError("; ".join(problems))

        self._remember(f"сенсор {chosen}")
        self.sandbox.sensors.append(sensor)
        return sensor

    def set_sensor(self, sensor_id: str, **params: Any) -> SandboxSensor:
        """Род и числа сенсора. Правка примеряется на копии -- как у стимула."""
        sensor = self._sensor(sensor_id)
        kind = str(params.pop("kind", sensor.kind))
        if kind not in protocols.SENSOR_KINDS:
            raise PatternError(
                f"род сенсора {kind!r} неизвестен: "
                f"{', '.join(protocols.SENSOR_KIND_IDS)}"
            )
        candidate = replace(sensor, kind=kind)
        # Смена рода досыпает канонические числа нового -- но только туда, где
        # ничего не набрано: заглянувший в соседний род не должен потерять свои.
        defaults = protocols.sensor_defaults(kind)
        numbers = self._sense_numbers("сенсора", candidate, defaults, params)
        for key, value in numbers.items():
            if key in params or not getattr(candidate, key, 0.0):
                setattr(candidate, key, value)
        problems = protocols.sensor_problems(candidate)
        if problems:
            raise PatternError("; ".join(problems))

        self._remember(f"сенсор {sensor_id}")
        sensor = self._sensor(sensor_id)
        for slot in fields(SandboxSensor):
            if slot.name not in ("id", "position"):
                setattr(sensor, slot.name, getattr(candidate, slot.name))
        return sensor

    def add_motor(
        self,
        source: Endpoint,
        motor_id: str | None = None,
        kind: str = "rate",
        position: tuple[float, float] = (0.0, 0.0),
        **params: Any,
    ) -> SandboxMotor:
        """Завести мотор: он смотрит на точку клетки, как запись."""
        if kind not in protocols.MOTOR_KINDS:
            raise PatternError(
                f"род мотора {kind!r} неизвестен: "
                f"{', '.join(protocols.MOTOR_KIND_IDS)}"
            )
        chosen = motor_id or self.sandbox.free_id("motor")
        if chosen in self.sandbox.taken_ids():
            raise PatternError(f"имя {chosen!r} на холсте уже занято")
        motor = SandboxMotor(id=chosen, source=source, kind=kind, position=position)
        numbers = self._sense_numbers(
            "мотора", motor, protocols.motor_defaults(kind), params
        )
        for key, value in numbers.items():
            setattr(motor, key, value)
        problems = protocols.motor_problems(motor)
        if problems:
            raise PatternError("; ".join(problems))

        self._remember(f"мотор {chosen}")
        self.sandbox.motors.append(motor)
        return motor

    def set_motor(self, motor_id: str, **params: Any) -> SandboxMotor:
        motor = self._motor(motor_id)
        kind = str(params.pop("kind", motor.kind))
        if kind not in protocols.MOTOR_KINDS:
            raise PatternError(
                f"род мотора {kind!r} неизвестен: "
                f"{', '.join(protocols.MOTOR_KIND_IDS)}"
            )
        source = params.pop("source", None)
        candidate = replace(motor, kind=kind)
        if source is not None:
            if not isinstance(source, Endpoint):
                raise PatternError("цель мотора -- точка холста, а не строка")
            candidate.source = source
        numbers = self._sense_numbers(
            "мотора", candidate, protocols.motor_defaults(kind), params
        )
        for key, value in numbers.items():
            if key in params or not getattr(candidate, key, 0.0):
                setattr(candidate, key, value)
        problems = protocols.motor_problems(candidate)
        if problems:
            raise PatternError("; ".join(problems))

        self._remember(f"мотор {motor_id}")
        motor = self._motor(motor_id)
        for slot in fields(SandboxMotor):
            if slot.name not in ("id", "position"):
                setattr(motor, slot.name, getattr(candidate, slot.name))
        return motor

    def set_run(self, **params: Any) -> ir.RunSpec:
        """Длительность, шаг, зерно и уровень детализации.

        Проверки здесь, а не в симуляторе: в песочнице это первое, что меняют,
        и отказ должен прийти в панель свойств, а не прогоном на десять минут.
        """
        run = self.sandbox.run
        unknown = [key for key in params if not hasattr(run, key)]
        if unknown:
            raise PatternError(f"у прогона нет параметров: {', '.join(unknown)}")
        dt = float(params.get("dt", run.dt))
        duration = float(params.get("duration", run.duration))
        if dt <= 0:
            raise PatternError("шаг должен быть больше нуля")
        if duration <= 0:
            raise PatternError("длительность должна быть больше нуля")
        if duration / dt > SAMPLE_LIMIT:
            raise PatternError(
                f"{duration} мс шагом {dt} мс -- это "
                f"{int(duration / dt)} отсчётов на трассу; предел {SAMPLE_LIMIT}"
            )
        if "level" in params and params["level"] not in ("L0", "L1", "L2"):
            raise PatternError(f"уровень {params['level']!r} не из L0, L1, L2")
        if "seed" in params:
            params["seed"] = int(params["seed"])

        self._remember("параметры прогона")
        for key, value in params.items():
            setattr(self.sandbox.run, key, value)
        return self.sandbox.run

    def move(self, object_id: str, position: tuple[float, float]) -> None:
        """Сдвиг по холсту. На физику не влияет и прогон не старит.

        Двигается любой объект холста: и блок, и отдельная клетка. Разводить
        это на две операции незачем -- место на холсте у них одного рода, а
        второй маршрут пришлось бы выбирать тому, кто тащит фигуру мышью.
        """
        target: Any = self.sandbox.neurons.get(object_id)
        if target is None:
            target = next(
                (
                    item
                    for item in (*self.sandbox.sensors, *self.sandbox.motors)
                    if item.id == object_id
                ),
                None,
            )
        if target is None:
            target = self.sandbox.instance(object_id)  # проверка до снимка
        self._remember(f"перемещён {object_id}")
        target.position = position

    def arrange(self, places: dict[str, tuple[float, float]]) -> None:
        """Расставить объекты холста по готовым местам -- один шаг отмены на всю
        раскладку.

        Раскладка -- это одно действие человека («Разложить»), а не двадцать
        сдвигов, и «Отменить» обязано возвращать прежние места целиком. Отсюда
        `batch`: двадцать вызовов `move` подряд сложили бы двадцать шагов
        истории, и откат пришлось бы жать по разу на узел.

        Сами места считает тот, кто знает размеры фигур, -- холст (ELK в
        браузере, `components/sandbox/arrange.ts`). Здесь их только применяют:
        место на холсте физику не меняет, поэтому отпечаток собранной сети
        остаётся прежним и прогон от раскладки не стареет.
        """
        if not places:
            raise PatternError("раскладывать нечего: не названо ни одного объекта")
        known = self.sandbox.taken_ids()
        # Проверка до снимка истории: отказ не должен оставлять за собой шаг
        # отмены, который ничего не отменяет.
        missing = [name for name in places if name not in known]
        if missing:
            raise PatternError(
                "на холсте нет объектов: " + ", ".join(sorted(missing))
            )
        with self.batch("разложены объекты"):
            for object_id, position in places.items():
                self.move(object_id, position)

    def remove(self, object_id: str) -> None:
        """Убрать объект песочницы вместе со всем, что на нём висело.

        Объект любой: блок, клетка, связь, стимул, запись. Один вход на все
        пять -- потому что так звучит просьба: «убрать выбранное». Что именно
        выбрано, человек в этот момент не формулирует, а `Delete` (#563) тем
        более не спрашивает; развести это на пять маршрутов значило бы
        заставить выбирать между ними того, кто нажал одну клавишу.

        «Вместе со всем» -- это и внутренние узлы блока: связь ведут прямо в
        `ffi/I`, и после удаления `ffi` она указывала бы в никуда. Сравнивать
        имена напрямую нельзя -- `ffi/I` не равно `ffi`, -- поэтому
        спрашивается владелец (`patterns.touches`). Иначе удалённый блок
        оставлял бы за собой висящие связи, а песочница переставала считаться
        с жалобой «источник в сети отсутствует» на объект, которого уже не
        видно.

        Стимул и запись убираются двумя способами сразу: по собственному
        имени (`drive1`) и вместе с целью. Первого раньше не было вовсе, и
        кнопка «Убрать стимул» в панели свойств молча не делала ничего --
        `touches` спрашивает про цель, а `drive1` ничьей целью не является.
        """
        self._remember(f"удалён {object_id}")
        sandbox = self.sandbox
        sandbox.instances = [i for i in sandbox.instances if i.id != object_id]
        sandbox.neurons.pop(object_id, None)
        sandbox.links = [
            link
            for link in sandbox.links
            if link.id != object_id
            and not touches(link.source, object_id)
            and not touches(link.target, object_id)
        ]
        sandbox.stimuli = [
            s
            for s in sandbox.stimuli
            if s.id != object_id and not touches(s.target, object_id)
        ]
        sandbox.recordings = [
            r
            for r in sandbox.recordings
            if r.id != object_id and not touches(r.target, object_id)
        ]
        # Двери с миром убираются по тому же правилу, что и всё остальное:
        # сам объект -- если убрали его, и мотор, смотревший на убранную
        # клетку, -- иначе он остался бы смотреть в никуда. Связи от сенсора
        # уже отсеяны выше: `touches` разбирает имя владельца одинаково и для
        # клетки, и для двери.
        sandbox.sensors = [s for s in sandbox.sensors if s.id != object_id]
        sandbox.motors = [
            m
            for m in sandbox.motors
            if m.id != object_id and not touches(m.source, object_id)
        ]

    def ungroup(
        self,
        block_id: str,
        places: dict[str, tuple[float, float]] | None = None,
    ) -> list[str]:
        """Разобрать блок: вместо коробки -- его клетки, связи и типы (#532).

        Операция обратная вставке паттерна и симметричная `extract`: та
        собирает паттерн из выбранного, эта раскладывает блок обратно. Нужна
        там, где от паттерна нужна половина или его надо переделать на месте:
        `fork` на этот вопрос не отвечает -- он кладёт правимую копию в
        библиотеку, а речь про этот проект.

        Шаг отмены один на всю операцию, поэтому «Отменить» возвращает блок
        целиком, а не оставляет рассыпанные клетки: история хранит снимок
        состояния, и снимается он здесь один раз -- до первой правки.

        Само разворачивание живёт в `patterns.ungroup_block` рядом с `free_id`
        и `extract_pattern`: имена холста раздаются там же, где раздаются имена
        блокам и клеткам, и второе место, решающее «свободно ли имя», разошлось
        бы с первым.

        `places` -- места клеток по именам внутри паттерна. Приходят готовыми,
        как и у `arrange`: раскладку считает тот, кто схему нарисовал, а место
        на холсте физику не меняет, и отпечаток собранной сети от него не
        зависит (#554).
        """
        self.sandbox.instance(block_id)  # проверка до снимка истории
        self._remember(f"разобран {block_id}")
        return ungroup_block(self.sandbox, block_id, places)

    def stimulate(self, stimulus: SandboxStimulus) -> SandboxStimulus:
        self._remember(f"стимул {stimulus.id}")
        self.sandbox.stimuli.append(stimulus)
        return stimulus

    def record(self, recording: SandboxRecording) -> SandboxRecording:
        self._remember(f"запись {recording.id}")
        self.sandbox.recordings.append(recording)
        return recording

    def fork(self, block_id: str, name: str | None = None) -> Pattern:
        """Независимая копия. Песочницу не трогает -- это новый паттерн."""
        return self.sandbox.fork(self.sandbox.instance(block_id), name)

    def extract(
        self, selection: list[str], name: str, level: CatalogLevel = DRAFT_LEVEL
    ) -> tuple[Pattern, list[str]]:
        """Выделение -> паттерн. Песочница остаётся как была."""
        return extract_pattern(self.sandbox, selection, name, level)

    # --- проект -> паттерн библиотеки -------------------------------------

    def port_hints(self) -> list[Port]:
        """Догадка о портах для формы сохранения. Считается по собранной сети.

        Имена в ней с приставкой блока (`ffi/E`), и это те же имена, которыми
        порт потом ссылается на свою точку, -- поэтому догадка и считается после
        сборки, а не по холсту.
        """
        return suggest_ports(compose(self.sandbox).model)

    def as_pattern(
        self,
        name: str,
        ports: list[Port],
        level: CatalogLevel = DRAFT_LEVEL,
        pattern_id: str | None = None,
        taken: Iterable[str] = (),
    ) -> Pattern:
        """Проект песочницы -> паттерн библиотеки. Песочницу не меняет.

        Тело паттерна -- собранная сеть, то есть ровно то, что считалось на
        холсте. Стимулы, записи и параметры прогона уезжают в витрину (`demo`):
        в чужую сеть они не поедут, а без них карточка откроется мёртвой --
        сеть без драйва молчит, и запускать в ней нечего. Это и есть причина,
        по которой сохранение идёт через сборку, а не через отдельный редактор.

        Порты обязательны и приходят снаружи: имя порта видно всем, кто вставит
        блок, и выбрать его должен человек. Разумное предложение считает
        `port_hints`, но подставить его молча нельзя.
        """
        chosen = name.strip()
        if not chosen:
            raise PatternError("у паттерна должно быть имя")

        built = compose(self.sandbox)
        if built.problems:
            # Сохранить несчитаемую схему -- значит положить в библиотеку то,
            # что не откроется и не запустится. Ровно на это и жалуются.
            raise PatternError(
                "схема не считается, сохранять нечего:\n  "
                + "\n  ".join(built.problems)
            )

        self._check_ports(ports, set(built.model.instances))

        pattern = Pattern.from_model(
            built.model,
            id=pattern_id or Pattern.empty(chosen, taken=taken).id,
            name=chosen,
            ports=list(ports),
            level=level,
        )
        if pattern.demo is None:
            # Прогон -- часть витрины даже там, где стимулов нет: без него
            # карточка покажет «прогон 0 мс», и время в ней никуда не пойдёт.
            pattern.demo = DemoRun(run=copy.deepcopy(built.model.run))
        # Готовность -- это факт, а не выбор в форме: паттерн с портами и
        # нейронами подключается, и объявлять его черновиком незачем.
        pattern.status = "draft" if pattern.validate() else "ready"
        return pattern

    @staticmethod
    def _check_ports(ports: list[Port], known: set[str]) -> None:
        """Порты до сохранения: названы, не повторяются и смотрят внутрь.

        Проверка здесь, а не в `Pattern.validate`: та говорит, чего паттерну не
        хватает, когда он уже лежит в библиотеке, а тут надо отказать до
        записи -- иначе сохранение молча даст черновик с портом в никуда.
        """
        if not ports:
            raise PatternError(
                "паттерн без портов не подключить: назовите хотя бы один вход "
                "или выход"
            )
        seen: set[str] = set()
        for port in ports:
            if not port.name.strip():
                raise PatternError("у порта должно быть имя: его увидит каждый, "
                                   "кто вставит блок")
            if port.name in seen:
                raise PatternError(f"порт {port.name!r} назван дважды")
            seen.add(port.name)
            if port.direction not in PORT_DIRECTIONS:
                raise PatternError(
                    f"у порта {port.name!r} направление {port.direction!r}, "
                    f"а бывают: {', '.join(PORT_DIRECTIONS)}"
                )
            if port.site.instance not in known:
                raise PatternError(
                    f"порт {port.name!r} смотрит на {port.site.instance!r}, "
                    f"которого в схеме нет; есть: {', '.join(sorted(known))}"
                )

    # --- запуск и сохранение ---------------------------------------------

    def check(self) -> list[str]:
        """Что мешает запуску. Пусто -- можно считать."""
        return compose(self.sandbox).problems

    def warnings(self) -> list[str]:
        """Что запуску не мешает, но сделает прогон пустым (#506).

        Отдельно от `check`, и это не дробление одного списка на два: на
        `check` стоит отказ -- `run` по нему не считает вовсе. Схема без драйва
        считается законно, поэтому её предупреждение обязано ехать другим
        полем, иначе «предупредить» и «запретить» окажутся одним и тем же.
        """
        return compose(self.sandbox).warnings

    def run(self) -> Run:
        built = compose(self.sandbox)
        if built.problems:
            raise PatternError(
                "схема не готова к запуску:\n  " + "\n  ".join(built.problems)
            )
        result = simulate(built.model)
        self.last_run = Run(
            id=f"run-{len(self.history)}-{_now()}",
            at=_now(),
            fingerprint=self.fingerprint(),
            result=result,
            composition=built,
        )
        return self.last_run

    def save(self) -> None:
        """Сохранить песочницу. Это не создание паттерна."""
        if self.store is None:
            raise PatternError("проект открыт без хранилища")
        self.sandbox.updated_at = _now()
        self.store.save_sandbox(self.sandbox)
        self._saved = to_plain(self.sandbox)

    def save_as_pattern(self, pattern: Pattern) -> Pattern:
        """Положить паттерн в библиотеку. Песочница при этом не меняется."""
        if self.store is None:
            raise PatternError("проект открыт без хранилища")
        self.store.save_pattern(pattern)
        return pattern

    # --- мелочи -----------------------------------------------------------

    def _link(self, link_id: str) -> Link:
        for link in self.sandbox.links:
            if link.id == link_id:
                return link
        raise PatternError(f"связи {link_id!r} нет")

    def _contact(self, block_id: str, contact_id: str) -> ir.Contact:
        """Контакт внутри снимка блока.

        Ищется в `snapshot.body`, а не в собранной сети: в ней у контакта уже
        приставка экземпляра (`ffi/c1`) и он копия -- правка такой копии
        пропала бы при следующей сборке.
        """
        block = self.sandbox.instance(block_id)
        for contact in block.snapshot.body.contacts:
            if contact.id == contact_id:
                return contact
        known = ", ".join(c.id for c in block.snapshot.body.contacts) or "контактов нет"
        raise PatternError(
            f"в блоке {block_id!r} нет контакта {contact_id!r} ({known})"
        )

    def _sensor(self, sensor_id: str) -> SandboxSensor:
        for sensor in self.sandbox.sensors:
            if sensor.id == sensor_id:
                return sensor
        raise PatternError(f"сенсора {sensor_id!r} нет")

    def _motor(self, motor_id: str) -> SandboxMotor:
        for motor in self.sandbox.motors:
            if motor.id == motor_id:
                return motor
        raise PatternError(f"мотора {motor_id!r} нет")

    def _stimulus(self, stimulus_id: str) -> SandboxStimulus:
        for stimulus in self.sandbox.stimuli:
            if stimulus.id == stimulus_id:
                return stimulus
        raise PatternError(f"стимула {stimulus_id!r} нет")

    def _recording(self, recording_id: str) -> SandboxRecording:
        for recording in self.sandbox.recordings:
            if recording.id == recording_id:
                return recording
        raise PatternError(f"записи {recording_id!r} нет")

    def _cell_types(
        self, target_id: str, type_id: str | None
    ) -> tuple[dict[str, ir.CellType], str]:
        """Где лежит тип клетки выбранного объекта и как он называется.

        У блока типы свои -- в снимке; у отдельного нейрона общие для
        песочницы. Возвращается сам словарь, потому что править надо тот
        объект, который потом посчитает `compose`, а не его копию.
        """
        block = next(
            (item for item in self.sandbox.instances if item.id == target_id), None
        )
        if block is not None:
            types = block.snapshot.body.cell_types
        elif target_id in self.sandbox.neurons:
            types = self.sandbox.cell_types
            type_id = type_id or self.sandbox.neurons[target_id].cell_type
        else:
            raise PatternError(f"в песочнице нет объекта {target_id!r}")

        if type_id is None:
            if len(types) != 1:
                known = ", ".join(types) or "типов нет"
                raise PatternError(
                    f"в {target_id!r} несколько типов клеток, нужно сказать какой "
                    f"({known})"
                )
            type_id = next(iter(types))
        if type_id not in types:
            known = ", ".join(types) or "типов нет"
            raise PatternError(f"в {target_id!r} нет типа клетки {type_id!r} ({known})")
        return types, type_id

    def _free_link_id(self) -> str:
        used = {link.id for link in self.sandbox.links}
        index = len(used) + 1
        while f"l{index}" in used:
            index += 1
        return f"l{index}"
