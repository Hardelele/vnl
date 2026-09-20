"""Паттерны, песочницы и прогоны.

Слой над IR. IR описывает плоскую сеть: нейроны и контакты между точками.
Здесь появляется то, чего в нём нет, -- составные блоки и проекты, в которых
они собираются.

Три вещи, которые важно не перепутать:

Паттерн -- сохранённая микросхема с портами. Внутренности (`body`) -- обычная
модель IR; порт -- именованная точка подключения, привязанная к конкретному
внутреннему участку. Демонстрационный запуск живёт отдельным полем и никогда
не попадает внутрь чужой сети: иначе вставленный паттерн тащил бы за собой
свои стимулы.

Песочница -- проект. В нём стоят экземпляры паттернов, отдельные нейроны и
связи между ними. Экземпляр хранит снимок определения на момент вставки: правка
библиотеки не должна незаметно менять уже собранный проект.

Прогон -- результат запуска конкретного состояния. Спайки и потенциалы
принадлежат прогону, а не паттерну.

Уровень каталога -- про ступень разбора: с чего начинают читать библиотеку и
куда идут дальше (`LEVEL_NAMES`). Уровень детализации симулятора в
`RunSpec.level` -- про физику. Совпадение обозначений случайно, и смешивать их
нельзя.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Iterable, Literal

from . import ir

CatalogLevel = Literal["L0", "L1", "L2", "L3", "L4", "L5"]
PatternStatus = Literal["draft", "ready"]
PortDirection = Literal["in", "out", "mod"]

#: Направления порта списком, а не только типом: `Literal` живёт в проверке
#: типов, а запрос из интерфейса приходит строкой, и сверять её надо в рантайме.
PORT_DIRECTIONS: tuple[PortDirection, ...] = ("in", "out", "mod")

#: Направления порта человеческими словами (#541).
#:
#: `in`, `out` и `mod` в панели свойств стоят машинными именами -- теми же, что
#: в тексте схемы, и это правильно: человек их там и пишет. Но что за ними,
#: нигде не сказано, а разница между `in` и `mod` не декоративная: драйв на
#: модуляторный порт делает не то же самое, что драйв на вход.
#:
#: Рядом со списком направлений, а не в интерфейсе, по той же причине, что и
#: имена ступеней библиотеки: вторая таблица в браузере разошлась бы с этой
#: молча, потому что подсказка ни на один прогон не влияет.
PORT_NOTES: dict[PortDirection, str] = {
    "in": "Вход: сюда подают сигнал — связь снаружи или драйв.",
    "out": "Выход: отсюда снимают результат — связь дальше или запись.",
    "mod": "Модуляция: этим блок переключают, а не гонят через него сигнал. "
    "Драйв на такой порт меняет режим схемы.",
}

#: Чем разделены имя блока и имя нейрона внутри него в собранной сети
#: (`ffi/E`). То же значение у `compose.SEPARATOR`; здесь оно нужно, чтобы
#: сделать из имени нейрона имя порта, а импортировать сборку отсюда нельзя --
#: она сама импортирует этот модуль.
NESTED = "/"

#: Ступени разбора библиотеки, в том порядке, в котором их читают.
#:
#: Это не масштаб конструкции («сколько клеток»), а ступень: что нужно понять
#: раньше, чтобы понять следующее. Порядок словаря и есть порядок групп в
#: каталоге -- интерфейс берёт список отсюда через /api/catalog, своего у него
#: нет, иначе две нумерации разошлись бы на первой же правке.
#:
#: Ступени начинаются с работающей схемы, и отдельной ступени для механизмов
#: здесь нет намеренно. Свойство одного контакта или одной клетки (синапс,
#: депрессия, задержка, правило пластичности) -- не схема: его предмет виден из
#: определения одного контакта, а библиотека про то, что несколько клеток делают
#: вместе. У механизмов другое место -- палитра примитивов, как уже случилось с
#: одиночными клетками (`cells.py`).
LEVEL_NAMES: dict[str, str] = {
    "L0": "Простейшие схемы",
    "L1": "Взаимодействие сигналов",
    "L2": "Вычислительные примитивы",
    "L3": "Сети",
    "L4": "Обучение и память",
    "L5": "Reference circuits",
}

#: Ступень нового черновика.
#:
#: Первая ступень, а не что-то выше: пустой черновик -- ещё не схема, и обещать
#: ему ступень, до которой он не дорос, нельзя. Автор поднимет её сам, когда
#: схема того заслужит; молча подставленный L2 («вычислительный примитив»)
#: пришлось бы опровергать у каждого черновика.
DRAFT_LEVEL: CatalogLevel = "L0"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class PatternError(ValueError):
    pass


@dataclass(frozen=True)
class Port:
    """Именованная точка подключения паттерна.

    Порт не абстрактный вход блока, а ссылка на конкретный внутренний участок:
    соединение двух блоков создаёт настоящий контакт между настоящими точками.
    """

    name: str
    direction: PortDirection
    site: ir.Site
    #: Чем порт объявлен наружу -- подпись для интерфейса, не семантика.
    note: str = ""


@dataclass
class DemoRun:
    """Пример запуска для карточки паттерна.

    Хранится отдельно от `body` намеренно: это витрина, а не часть
    конструкции. При вставке паттерна в чужую сеть стимулы не переезжают.
    """

    stimuli: list[ir.Stimulus] = field(default_factory=list)
    recordings: list[ir.Recording] = field(default_factory=list)
    run: ir.RunSpec = field(default_factory=ir.RunSpec)


@dataclass
class Pattern:
    id: str
    name: str
    level: CatalogLevel = DRAFT_LEVEL
    status: PatternStatus = "draft"
    body: ir.Model = field(default_factory=ir.Model)
    ports: list[Port] = field(default_factory=list)
    demo: DemoRun | None = None
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)

    @staticmethod
    def from_model(
        model: ir.Model,
        id: str,
        name: str,
        ports: list[Port] | None = None,
        level: CatalogLevel = DRAFT_LEVEL,
        status: PatternStatus = "draft",
    ) -> "Pattern":
        """Собрать паттерн из готовой модели, отделив витрину от конструкции.

        Стимулы и записи из `.vnl` -- это пример запуска, а не часть схемы.
        Оставить их в теле значило бы, что вставленный в чужую сеть блок
        притащит с собой свой драйв. Поэтому они уезжают в `demo`.
        """
        body = copy.deepcopy(model)
        demo = DemoRun(
            stimuli=body.stimuli,
            recordings=body.recordings,
            run=copy.deepcopy(body.run),
        )
        body.stimuli = []
        body.recordings = []
        return Pattern(
            id=id,
            name=name,
            level=level,
            status=status,
            body=body,
            ports=list(ports or []),
            demo=demo if (demo.stimuli or demo.recordings) else None,
        )

    @staticmethod
    def empty(
        name: str,
        level: CatalogLevel = DRAFT_LEVEL,
        taken: Iterable[str] = (),
    ) -> "Pattern":
        """Паттерн без начинки. Нужен ради имени и свободного идентификатора.

        В библиотеку такой больше не кладут. Пустой черновик заводила кнопка
        «Добавить», и наполнить его было нечем: редактора тела схемы нет и не
        будет -- схему собирают в песочнице и оттуда сохраняют паттерном
        (`Project.as_pattern`). Второй редактор означал бы две разные правды о
        том, как рисуют схему.

        Остаётся здесь как способ получить свободный идентификатор из имени:
        так его берут `vnl add` и сохранение из песочницы.
        """
        return Pattern(
            id=_unique(_slug(name), taken),
            name=name,
            level=level,
            status="draft",
            body=ir.Model(name=name),
        )

    def demo_model(self) -> ir.Model:
        """Модель для демонстрационного запуска: тело плюс витрина.

        Обратная сборка к `from_model`. Стимулы и записи хранятся отдельно
        именно ради этого: в чужую сеть они не едут, а показать паттерн в
        одиночку без них нельзя -- сеть без драйва молчит.
        """
        model = copy.deepcopy(self.body)
        if self.demo is not None:
            model.stimuli = copy.deepcopy(self.demo.stimuli)
            model.recordings = copy.deepcopy(self.demo.recordings)
            model.run = copy.deepcopy(self.demo.run)
        return model

    @property
    def level_name(self) -> str:
        return LEVEL_NAMES.get(self.level, self.level)

    def port(self, name: str) -> Port:
        for port in self.ports:
            if port.name == name:
                return port
        known = ", ".join(p.name for p in self.ports) or "портов нет"
        raise PatternError(f"у паттерна {self.name!r} нет порта {name!r} ({known})")

    def validate(self) -> list[str]:
        """Что мешает считать паттерн готовым. Пустой список -- всё в порядке."""
        problems: list[str] = []
        if not self.body.instances:
            problems.append("в паттерне нет ни одного нейрона")
        if not self.ports:
            problems.append("нет ни одного порта: блок нельзя будет подключить")

        if self.body.stimuli or self.body.recordings:
            problems.append(
                "в теле паттерна остались стимулы или записи: это витрина "
                "карточки, её место в demo, иначе они переедут в чужую сеть"
            )

        seen: set[str] = set()
        for port in self.ports:
            if port.name in seen:
                problems.append(f"порт {port.name!r} объявлен дважды")
            seen.add(port.name)
            if port.site.instance not in self.body.instances:
                problems.append(
                    f"порт {port.name!r} смотрит на нейрон "
                    f"{port.site.instance!r}, которого нет внутри"
                )
        return problems


@dataclass
class PatternInstance:
    """Экземпляр паттерна в песочнице.

    `snapshot` -- копия определения на момент вставки. Библиотечный оригинал
    может меняться сколько угодно: собранный проект от этого не поедет.
    """

    id: str
    pattern_id: str
    label: str
    snapshot: Pattern
    position: tuple[float, float] = (0.0, 0.0)

    def site_of(self, port_name: str) -> ir.Site:
        return self.snapshot.port(port_name).site


@dataclass
class SandboxNeuron:
    """Отдельная клетка на холсте: нейрон IR плюс место, где он лежит.

    Координаты живут здесь, а не в `ir.Instance`, потому что расстановка --
    свойство холста, а не сети: `compose` её не переносит, а `fingerprint`
    считается по модели, иначе сдвиг клетки объявлял бы прежний прогон
    устаревшим.

    Поля нарочно плоские, а не `{instance, position}`: `from_plain` заполняет
    только объявленные поля, и уже сохранённые песочницы держат нейрон как
    `{"id", "cell_type", "tags"}`. Плоская запись читает их как есть и
    подставляет место по умолчанию; обёртка на таком файле упала бы.
    """

    id: str
    cell_type: str
    tags: tuple[str, ...] = ()
    position: tuple[float, float] = (0.0, 0.0)

    def instance(self) -> ir.Instance:
        """Тот же нейрон для сети. Места на холсте в модели нет."""
        return ir.Instance(id=self.id, cell_type=self.cell_type, tags=self.tags)


@dataclass
class Endpoint:
    """Конец связи в песочнице. Три вида адреса, и все три -- один класс.

    - порт блока: ``Endpoint("ffi", "in")`` -- названная точка, объявленная
      автором паттерна;
    - отдельная клетка: ``Endpoint("X")`` -- портов у неё нет вовсе;
    - узел внутри блока: ``Endpoint("ffi/I")`` -- имя из собранной сети.

    Третий вид не новый род адреса, а тот же второй: в собранной сети нейрон
    блока и зовётся `ffi/I`, и `resolve_endpoint` отдаёт это имя как есть.
    Порт остаётся удобным ярлыком частой точки, а не единственной дверью:
    автор паттерна выбирает порты один раз, а схему потом используют
    по-разному -- от feed-forward inhibition берут тормозный нейрон, а входной
    релей не нужен вовсе.
    """

    instance: str
    port: str | None = None
    section: str = "soma"
    fraction: float = 0.5

    @property
    def is_port(self) -> bool:
        return self.port is not None


@dataclass
class Link:
    """Связь в песочнице. Параметры те же, что у контакта IR."""

    id: str
    source: Endpoint
    target: Endpoint
    receptor: str = "ampa"
    weight: float = 1.0
    delay: float = 1.0
    dynamics: ir.ShortTermDynamics = field(default_factory=ir.ShortTermDynamics)
    plasticity: ir.Plasticity = field(default_factory=ir.Plasticity)


@dataclass
class SandboxStimulus:
    """Стимул проекта. Целью может быть и порт блока, и отдельный нейрон."""

    id: str
    target: Endpoint
    kind: str = "poisson"
    receptor: str = "ampa"
    amplitude: float = 0.0
    rate: float = 0.0
    times: tuple[float, ...] = ()
    start: float = 0.0
    stop: float = float("inf")


@dataclass
class SandboxRecording:
    """Запись проекта.

    У блока из нескольких нейронов нет собственного потенциала, поэтому
    записать «блок» нельзя: цель всегда конкретная точка -- порт или нейрон.
    """

    id: str
    target: Endpoint
    var: str = "v"


@dataclass
class Sandbox:
    """Проект: экземпляры паттернов, отдельные нейроны, связи и эксперимент."""

    id: str
    name: str
    instances: list[PatternInstance] = field(default_factory=list)
    cell_types: dict[str, ir.CellType] = field(default_factory=dict)
    neurons: dict[str, SandboxNeuron] = field(default_factory=dict)
    links: list[Link] = field(default_factory=list)
    modulators: dict[str, ir.Modulator] = field(default_factory=dict)
    stimuli: list[SandboxStimulus] = field(default_factory=list)
    recordings: list[SandboxRecording] = field(default_factory=list)
    run: ir.RunSpec = field(default_factory=ir.RunSpec)
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)

    @staticmethod
    def empty(name: str, taken: Iterable[str] = ()) -> "Sandbox":
        """Новый проект. Идентификатор -- из имени, чтобы файл читался глазами."""
        return Sandbox(id=_unique(_slug(name), taken), name=name)

    def instance(self, instance_id: str) -> PatternInstance:
        for item in self.instances:
            if item.id == instance_id:
                return item
        known = ", ".join(i.id for i in self.instances) or "блоков нет"
        raise PatternError(f"в песочнице нет блока {instance_id!r} ({known})")

    def taken_ids(self) -> set[str]:
        """Имена, занятые объектами холста: блоки и отдельные клетки вместе.

        Вместе, потому что в собранной сети они живут в одном пространстве
        имён: клетка с именем блока столкнулась бы с его нейронами уже в
        `compose`, то есть на запуске. Отказывать надо при добавлении.
        """
        return {item.id for item in self.instances} | set(self.neurons)

    def free_id(self, base: str) -> str:
        """Свободное имя объекта холста, начиная с предложенного."""
        used = self.taken_ids()
        chosen = base
        counter = 2
        while chosen in used:
            chosen = f"{base}{counter}"
            counter += 1
        return chosen

    def add_neuron(
        self,
        neuron_id: str | None,
        cell_type: ir.CellType,
        position: tuple[float, float] = (0.0, 0.0),
    ) -> SandboxNeuron:
        """Положить на холст отдельную клетку.

        В песочницу кладётся копия типа, а не запись каталога: правка порога в
        панели свойств идёт через `set_cell` прямо по этому объекту, и общая с
        каталогом ссылка означала бы, что следующая положенная клетка приедет
        уже с чужим порогом. По той же причине экземпляр паттерна хранит
        снимок, а не ссылку на библиотеку.
        """
        chosen = neuron_id or self.free_id(cell_type.id)
        if chosen in self.taken_ids():
            raise PatternError(f"имя {chosen!r} на холсте уже занято")
        self.cell_types.setdefault(cell_type.id, copy.deepcopy(cell_type))
        neuron = SandboxNeuron(
            id=chosen, cell_type=cell_type.id, position=position
        )
        self.neurons[chosen] = neuron
        self.updated_at = _now()
        return neuron

    def add_instance(
        self,
        pattern: Pattern,
        label: str | None = None,
        instance_id: str | None = None,
        position: tuple[float, float] = (0.0, 0.0),
    ) -> PatternInstance:
        """Вставить паттерн. Кладётся снимок, а не ссылка на библиотеку.

        Идентификатор берётся от `pattern.id`, а не от имени. Имя человеческое
        и длинное («Торможение с опережением (feedforward inhibition, FFI)»), а
        из него получался адрес
        `торможение_с_опережением_feedforward_inhibition_ffi`, которым потом
        подписаны связи и, с адресацией внутренних узлов, каждый нейрон блока
        (`..._ffi/I`). Идентификатор паттерна для этого и существует: он
        короткий и уже уникален в библиотеке, а разводит одноимённые экземпляры
        `free_id` -- `ffi`, `ffi2`.

        Уже сохранённые песочницы это не трогает: в них id -- адрес, за который
        держатся связи, стимулы и записи, и переименование сломало бы их молча.
        """
        chosen = self.free_id(instance_id or _slug(pattern.id))

        item = PatternInstance(
            id=chosen,
            pattern_id=pattern.id,
            label=label or pattern.name,
            snapshot=copy.deepcopy(pattern),
            position=position,
        )
        self.instances.append(item)
        self.updated_at = _now()
        return item

    def fork(self, item: PatternInstance, name: str | None = None) -> Pattern:
        """Независимая правимая копия паттерна.

        Оригинал и другие проекты, где он стоит, не меняются -- потому и
        копируется снимок экземпляра, а не библиотечная запись.
        """
        source = item.snapshot
        forked = copy.deepcopy(source)
        forked.id = f"{source.id}-fork"
        forked.name = name or f"{source.name} (fork)"
        forked.status = "draft"
        forked.created_at = forked.updated_at = _now()
        return forked


def _unique(base: str, taken: Iterable[str]) -> str:
    """Свободный идентификатор: одноимённый паттерн не должен затирать чужой."""
    used = set(taken)
    if base not in used:
        return base
    counter = 2
    while f"{base}-{counter}" in used:
        counter += 1
    return f"{base}-{counter}"


def _slug(name: str) -> str:
    out = []
    for char in name.lower():
        if char.isalnum():
            out.append(char)
        elif out and out[-1] != "_":
            out.append("_")
    return "".join(out).strip("_") or "block"


#: Шаг запасной сетки, которой клетки разобранного блока раскладываются вокруг
#: его места, когда мест не прислали. Те же числа, которыми их считает
#: интерфейс (`UNGROUP_STEP` в `ui/src/state/sandbox.ts`).
UNGROUP_STEP = (120.0, 90.0)

#: Сколько клеток в ряду запасной сетки. Три -- чтобы блок из трёх лёг строкой,
#: а блок из шести не вытянулся в ленту через весь холст.
UNGROUP_COLUMNS = 3


def ungroup_block(
    sandbox: Sandbox,
    block_id: str,
    places: dict[str, tuple[float, float]] | None = None,
) -> list[str]:
    """Блок -> его клетки, контакты и типы обычными объектами песочницы.

    Операция обратная сборке, и половина её давно написана: `compose`
    разворачивает блок в общую сеть на каждом запуске, а `extract_pattern`
    собирает паттерн из выбранных объектов. Здесь то же разворачивание, только
    насовсем и именами холста вместо имён собранной сети.

    Чем это не `fork`: fork кладёт правимую копию в библиотеку, то есть
    отвечает на вопрос «нужен такой же паттерн, но другой». Здесь вопрос
    другой -- «от этого блока нужна половина, и прямо в этом проекте», -- и
    библиотека к нему отношения не имеет.

    Три вещи, которые нельзя сделать иначе:

    - имена раздаёт общий `free_id`, тот же, которым заводят блок и клетку.
      Коллизии решаются здесь, при разборе, а не в `compose` на запуске: там
      они всплыли бы жалобой «имя занято блоком», а чинить их было бы уже
      нечем -- в песочнице к тому времени два объекта с одним именем;
    - типы клеток копируются глубоко. Ссылка, общая с чужим снимком, означала
      бы, что правка порога после разбора молча меняет соседний блок того же
      паттерна, -- ровно то, ради чего экземпляр и хранит снимок;
    - связи, стимулы и записи, смотревшие в порт блока, переписываются на
      точку соответствующей клетки. Потерять драйв при разборе нельзя: сеть
      после него обязана считать то же самое, а порта, на котором висел
      стимул, больше не существует.

    Места клеток приходят готовыми -- как и у `arrange` (#543, #554). Считает
    их тот, кто блок нарисовал: внутри коробки схема разложена слоями, и после
    разбора клетки обязаны встать так же. Сетка `_around` осталась запасной --
    для вызова без мест (командная строка, старый клиент, тесты): она про связи
    не знает вовсе и умеет только не свалить клетки в кучу.

    Ключи в `places` -- имена клеток внутри паттерна (`E1`, `GI`): клиент
    других не знает, а имена холста раздаются здесь же, строкой ниже.

    Возвращает имена, которые получили клетки блока, -- в том порядке, в каком
    они лежали внутри.
    """
    block = sandbox.instance(block_id)  # проверка до первой правки
    inner = block.snapshot.body

    # Блок убирается сразу: его имя освобождается, и клетка, названная как он,
    # может его занять. Порт после этого разобрать уже нечем, поэтому ниже
    # спрашивается сам снимок (`block.site_of`), а не `resolve_endpoint`.
    sandbox.instances = [item for item in sandbox.instances if item.id != block_id]

    types = {
        type_id: _adopt_type(sandbox, type_id, cell_type)
        for type_id, cell_type in inner.cell_types.items()
    }

    names: dict[str, str] = {}
    asked = places or {}
    grid = _around(block.position, len(inner.instances))
    for (neuron_id, neuron), spare in zip(inner.instances.items(), grid):
        chosen = sandbox.free_id(neuron_id)
        names[neuron_id] = chosen
        given = asked.get(neuron_id)
        sandbox.neurons[chosen] = SandboxNeuron(
            id=chosen,
            cell_type=types.get(neuron.cell_type, neuron.cell_type),
            tags=tuple(neuron.tags),
            # Место клетки, не названной в `places`, берётся из запасной сетки:
            # половина схемы, легшая слоями, а половина в кучу -- хуже обеих.
            position=(float(given[0]), float(given[1])) if given else spare,
        )

    modulators: dict[str, str] = {}
    for mod_id, modulator in inner.modulators.items():
        chosen = _unique(mod_id, sandbox.modulators)
        modulators[mod_id] = chosen
        sandbox.modulators[chosen] = replace(
            copy.deepcopy(modulator),
            id=chosen,
            sources=tuple(names.get(name, name) for name in modulator.sources),
        )

    # Сначала переписываются те концы, что смотрели в блок, и только потом
    # добавляются новые связи: иначе клетка, занявшая освободившееся имя
    # блока, попала бы под ту же перепись во второй раз.
    for link in sandbox.links:
        link.source = _rewired(link.source, block, names)
        link.target = _rewired(link.target, block, names)
    for stimulus in sandbox.stimuli:
        stimulus.target = _rewired(stimulus.target, block, names)
    for recording in sandbox.recordings:
        recording.target = _rewired(recording.target, block, names)

    taken = {link.id for link in sandbox.links}
    for contact in inner.contacts:
        link_id = _unique(contact.id, taken)
        taken.add(link_id)
        plasticity = copy.deepcopy(contact.plasticity)
        if plasticity.modulator in modulators:
            plasticity.modulator = modulators[plasticity.modulator]
        sandbox.links.append(
            Link(
                id=link_id,
                source=_point(contact.pre, names),
                target=_point(contact.post, names),
                receptor=contact.receptor,
                weight=contact.weight,
                delay=contact.delay,
                dynamics=copy.deepcopy(contact.dynamics),
                plasticity=plasticity,
            )
        )

    sandbox.updated_at = _now()
    return [names[neuron_id] for neuron_id in inner.instances]


def _adopt_type(sandbox: Sandbox, type_id: str, cell_type: ir.CellType) -> str:
    """Тип клетки из снимка -- в словарь песочницы. Копией, а не ссылкой.

    Одноимённый, но другой тип разводится новым именем -- тем же правилом, что
    и в `compose._adopt_cell_type`: молча подменить чужую мембрану своей хуже,
    чем получить в проекте `pyr_l5_2`. Одноимённый и такой же переиспользуется:
    два одинаковых типа под разными именами -- это две правды об одной клетке.
    """
    existing = sandbox.cell_types.get(type_id)
    if existing is None:
        sandbox.cell_types[type_id] = copy.deepcopy(cell_type)
        return type_id
    if existing == cell_type:
        return type_id
    counter = 2
    while True:
        unique = f"{type_id}_{counter}"
        taken = sandbox.cell_types.get(unique)
        if taken is None:
            sandbox.cell_types[unique] = copy.deepcopy(cell_type)
            return unique
        if taken == cell_type:
            return unique
        counter += 1


def _around(centre: tuple[float, float], count: int) -> list[tuple[float, float]]:
    """Запасные места клеток разобранного блока -- сеткой вокруг места блока.

    Запасные: обычно места приходят от того, кто блок нарисовал, и повторяют
    раскладку его начинки (#554). Сетка остаётся для вызова без мест -- из
    командной строки, из тестов, от старого клиента.

    Вокруг, а не в одну точку: стопка из трёх клеток на месте коробки выглядит
    как одна клетка, и, прежде чем станет видно, что получилось, её пришлось бы
    растаскивать мышью.

    Сетка, а не кольцо: у блока из двух клеток кольцо вырождается в отрезок, а
    у блока из восьми превращается в хоровод, по которому не прочесть, кто с
    кем связан. Про связи эта сетка не знает ничего и знать не может: здесь
    известно только число клеток.
    """
    step_x, step_y = UNGROUP_STEP
    columns = min(UNGROUP_COLUMNS, max(count, 1))
    rows = -(-count // columns) if count else 1
    places: list[tuple[float, float]] = []
    for index in range(count):
        column, row = index % columns, index // columns
        places.append(
            (
                centre[0] + (column - (columns - 1) / 2) * step_x,
                centre[1] + (row - (rows - 1) / 2) * step_y,
            )
        )
    return places


def _point(site: ir.Site, names: dict[str, str]) -> Endpoint:
    """Точка внутри снимка -> конец связи песочницы. Порта у неё нет.

    Портов не заводится намеренно: порт -- объявленная автором паттерна дверь
    наружу, а разобранный блок наружу больше ничем не смотрит -- у него нет
    ни внутри, ни снаружи.
    """
    return Endpoint(
        instance=names.get(site.instance, site.instance),
        section=site.section,
        fraction=site.fraction,
    )


def _rewired(
    endpoint: Endpoint, block: PatternInstance, names: dict[str, str]
) -> Endpoint:
    """Конец связи, смотревший в блок, -> тот же конец на его клетке.

    Оба вида адреса ведут в одну точку: порт (`ffi.in`) спрашивается у снимка,
    внутренний узел (`ffi/I`) уже назван именем нейрона. Чужие концы
    возвращаются как есть -- сравнивать имена напрямую нельзя, `ffi/I` не равно
    `ffi`, поэтому спрашивается владелец (`owner_of`).

    Блок без порта (`Endpoint("ffi")`) сюда попадает адресом, которого и до
    разбора не существовало: `compose` жаловался на него «источник в сети
    отсутствует». Он и остаётся прежним -- чинить чужую поломку разбором
    значило бы угадывать, какую из клеток блока имели в виду.
    """
    if owner_of(endpoint.instance) != block.id:
        return endpoint
    if endpoint.is_port:
        site = block.site_of(endpoint.port or "")
        return Endpoint(
            instance=names.get(site.instance, site.instance),
            section=site.section,
            fraction=site.fraction,
        )
    _, _, inner_id = endpoint.instance.partition(NESTED)
    if not inner_id:
        return endpoint
    return Endpoint(
        instance=names.get(inner_id, inner_id),
        section=endpoint.section,
        fraction=endpoint.fraction,
    )


def adopt_demo(
    sandbox: Sandbox, block_id: str
) -> tuple[list[SandboxStimulus], list[SandboxRecording]]:
    """Витрина паттерна -> настоящие объекты проекта (#526).

    Правило «стимулы не переезжают при вставке блока» (`Pattern.from_model`,
    `DemoRun`) этим не отменяется, а уточняется по дороге, которой человек
    пришёл. Вставка из панели «Библиотека» -- это «дай кусок схемы в мою сеть»,
    и чужой драйв в ней лишний: он спорил бы с тем входом, ради которого блок
    и ставят. Переход с карточки -- другая просьба: «дай мне то же самое, но
    чтобы покрутить». Там витрина и есть предмет просьбы, и без неё блок
    приезжает молчащим -- чтобы увидеть ровно то, что было на карточке,
    человеку пришлось бы заводить драйв и подбирать числа заново.

    Едет витрина не частью схемы, а экспериментом проекта: `SandboxStimulus` и
    `SandboxRecording` лежат рядом с проектными, правятся той же панелью
    свойств и снимаются как любые другие. В `body` снимка блока не попадает
    ничего -- сохрани человек проект паттерном, витрина снова отделится
    (`Project.as_pattern`).

    Цель -- внутренний узел (`ffi/IN`), а не порт блока (`ffi.in`), даже когда
    порт смотрит ровно туда же. Физически это одна точка (`resolve_endpoint`
    разворачивает порт в неё же), но витрина нацелена на клетки, а порт --
    удобный ярлык частой точки, выбранный автором паттерна: драйв на `I.soma`
    ярлыка не имеет вовсе, и половина витрины адресовалась бы портами, а
    половина узлами. Один род адреса на всю витрину честнее.

    Параметры прогона тоже переезжают: витрина без них -- набор чисел про
    другое время. Драйв ffi идёт с 20-й по 380-ю мс, и в проекте с прогоном по
    умолчанию (500 мс, зерно 1) он дал бы не ту картину, что на карточке, --
    а сверить её с карточкой и есть смысл перехода. Разобранная альтернатива --
    оставить прогон проекта нетронутым: отвергнута потому, что тогда «то же
    самое, но чтобы покрутить» получалось бы только после ручной подгонки трёх
    чисел, то есть ровно той работы, от которой переход и избавляет. Цена --
    прогон проекта, куда блок кладут вторым, меняется молча; она уплачена тем,
    что вся операция -- один шаг истории и отменяется целиком.
    """
    block = sandbox.instance(block_id)
    demo = block.snapshot.demo
    if demo is None:
        return [], []

    def inside(site: ir.Site) -> Endpoint:
        return Endpoint(
            instance=f"{block_id}{NESTED}{site.instance}",
            section=site.section,
            fraction=site.fraction,
        )

    # Имя с приставкой блока: в дереве объектов стимулы проекта лежат общим
    # списком, и два блока с витриной дали бы два «drive», про которые не
    # видно, чей какой. Приставка -- тот же адрес, которым зовётся цель
    # (`ffi/IN`), так что читается сразу. `_unique` поверх -- на случай, если
    # такое имя человек уже занял руками.
    taken_stimuli = {item.id for item in sandbox.stimuli}
    taken_recordings = {item.id for item in sandbox.recordings}
    stimuli: list[SandboxStimulus] = []
    for stim in demo.stimuli:
        chosen = _unique(f"{block_id}.{stim.id}", taken_stimuli)
        taken_stimuli.add(chosen)
        stimuli.append(
            SandboxStimulus(
                id=chosen,
                target=inside(stim.target),
                kind=stim.kind,
                receptor=stim.receptor,
                amplitude=stim.amplitude,
                rate=stim.rate,
                times=tuple(stim.times),
                start=stim.start,
                stop=stim.stop,
            )
        )

    recordings: list[SandboxRecording] = []
    for rec in demo.recordings:
        chosen = _unique(f"{block_id}.{rec.id}", taken_recordings)
        taken_recordings.add(chosen)
        recordings.append(
            SandboxRecording(id=chosen, target=inside(rec.target), var=rec.var)
        )

    sandbox.stimuli.extend(stimuli)
    sandbox.recordings.extend(recordings)
    sandbox.run = copy.deepcopy(demo.run)
    sandbox.updated_at = _now()
    return stimuli, recordings


def extract_pattern(
    sandbox: Sandbox,
    selection: list[str],
    name: str,
    level: CatalogLevel = DRAFT_LEVEL,
    pattern_id: str | None = None,
) -> tuple[Pattern, list[str]]:
    """Выделение -> паттерн.

    Внутрь попадают выбранные объекты и связи между ними. Связь, уходящая
    наружу, не тащит за собой соседа: её внутренняя точка становится портом.
    Песочница при этом не меняется -- сохранение паттерна не должно
    неожиданно подменять выделение блоком.

    Возвращает паттерн и список замечаний для интерфейса.
    """
    chosen = set(selection)
    if not chosen:
        raise PatternError("выделение пусто")

    unknown = [
        item
        for item in chosen
        if item not in sandbox.neurons
        and not any(block.id == item for block in sandbox.instances)
    ]
    if unknown:
        raise PatternError(f"в выделении нет таких объектов: {', '.join(unknown)}")

    notes: list[str] = []
    body = ir.Model(name=name)

    # Отдельные нейроны переносятся как есть -- без места на холсте: в теле
    # паттерна его негде держать, да и раскладку карточка считает сама.
    for neuron_id in sorted(chosen & set(sandbox.neurons)):
        neuron = sandbox.neurons[neuron_id]
        body.instances[neuron_id] = neuron.instance()
        cell_type = sandbox.cell_types.get(neuron.cell_type)
        if cell_type is None:
            # Потерянный тип -- замечание, а не отказ: паттерн уже собран,
            # и человеку надо сказать, чего в нём не хватает, а не уронить
            # сохранение обвалом.
            notes.append(
                f"у клетки {neuron_id} неизвестен тип {neuron.cell_type!r} — "
                "в паттерне её нечем считать"
            )
            continue
        body.cell_types.setdefault(neuron.cell_type, copy.deepcopy(cell_type))

    # Выбранные блоки разворачиваются внутрь нового паттерна: вложенных
    # блоков в первой версии нет, поэтому содержимое переносится плоско.
    for block in sandbox.instances:
        if block.id not in chosen:
            continue
        prefix = f"{block.id}/"
        inner = block.snapshot.body
        for type_id, cell_type in inner.cell_types.items():
            body.cell_types.setdefault(type_id, copy.deepcopy(cell_type))
        for neuron_id, neuron in inner.instances.items():
            body.instances[prefix + neuron_id] = replace(
                copy.deepcopy(neuron), id=prefix + neuron_id
            )
        for contact in inner.contacts:
            body.contacts.append(_prefixed_contact(contact, prefix))

    ports: list[Port] = []
    for link in sandbox.links:
        # Выделяют объекты холста, а конец связи бывает внутренним узлом блока
        # (`ffi/I`). Спрашиваем про владельца: выделен блок -- выделена и его
        # начинка, иначе связь внутрь блока стала бы портом в паттерне, где
        # этот блок уже развёрнут, то есть портом внутрь самого себя.
        inside_source = owner_of(link.source.instance) in chosen
        inside_target = owner_of(link.target.instance) in chosen

        if inside_source and inside_target:
            body.contacts.append(
                ir.Contact(
                    id=link.id,
                    pre=resolve_endpoint(sandbox, link.source),
                    post=resolve_endpoint(sandbox, link.target),
                    receptor=link.receptor,
                    weight=link.weight,
                    delay=link.delay,
                    dynamics=copy.deepcopy(link.dynamics),
                    plasticity=copy.deepcopy(link.plasticity),
                )
            )
        elif inside_target:
            ports.append(
                Port(
                    name=_port_name(link.target, "in"),
                    direction="in",
                    site=resolve_endpoint(sandbox, link.target),
                    note=f"сюда приходила связь {link.id}",
                )
            )
            notes.append(
                f"связь {link.id} шла снаружи — её точка стала входом "
                f"{ports[-1].name!r}"
            )
        elif inside_source:
            ports.append(
                Port(
                    name=_port_name(link.source, "out"),
                    direction="out",
                    site=resolve_endpoint(sandbox, link.source),
                    note=f"отсюда уходила связь {link.id}",
                )
            )
            notes.append(
                f"связь {link.id} уходила наружу — её точка стала выходом "
                f"{ports[-1].name!r}"
            )

    if not ports:
        notes.append(
            "портов не получилось: выделение ни с чем не связано, "
            "входы и выходы придётся указать вручную"
        )

    pattern = Pattern(
        id=pattern_id or _slug(name),
        name=name,
        level=level,
        status="draft",
        body=body,
        ports=_dedupe_ports(ports),
    )
    return pattern, notes


def _dedupe_ports(ports: list[Port]) -> list[Port]:
    seen: dict[str, Port] = {}
    for port in ports:
        name = port.name
        counter = 2
        while name in seen and seen[name].site != port.site:
            name = f"{port.name}{counter}"
            counter += 1
        if name not in seen:
            seen[name] = replace(port, name=name)
    return list(seen.values())


def suggest_ports(model: ir.Model) -> list[Port]:
    """Что предложить в форме «Сохранить как паттерн».

    Предложить, а не решить. Имя порта увидит каждый, кто вставит блок, и
    подставить его молча значило бы назвать чужую точку подключения за автора.
    Догадка простая и проверяемая глазами: клетка, в которую никто не стреляет,
    похожа на вход; клетка, которая никуда не стреляет, -- на выход. Одинокая
    клетка получает и то и другое: она и вход, и выход.

    Считается в Python, а не в интерфейсе: тот же вопрос задаст Claude через
    MCP, и вторая реализация слова «похоже на вход» разошлась бы с первой
    незаметно.
    """
    incoming = {contact.post.instance for contact in model.contacts}
    outgoing = {contact.pre.instance for contact in model.contacts}
    ports: list[Port] = []
    for neuron_id in model.instances:
        if neuron_id not in incoming:
            ports.append(
                Port(
                    name=_port_label("in", neuron_id),
                    direction="in",
                    site=ir.Site(instance=neuron_id, section="soma", fraction=0.5),
                    note="входящих связей нет — похоже на вход",
                )
            )
        if neuron_id not in outgoing:
            ports.append(
                Port(
                    name=_port_label("out", neuron_id),
                    direction="out",
                    site=ir.Site(instance=neuron_id, section="soma", fraction=0.5),
                    note="исходящих связей нет — похоже на выход",
                )
            )
    return _dedupe_ports(ports)


def _port_label(prefix: str, instance: str) -> str:
    """Имя порта из имени нейрона собранной сети.

    В собранной сети нейрон внутри блока называется `ffi/E`, а в имени порта
    косой черте не место: порт пишут руками и в адресе контакта
    (`IN.soma`).
    """
    return f"{prefix}_{instance.replace(NESTED, '_')}"


def _port_name(endpoint: Endpoint, direction: str) -> str:
    if endpoint.is_port:
        return f"{endpoint.instance}.{endpoint.port}"
    prefix = "in" if direction == "in" else "out"
    # Через `_port_label`, а не строкой: конец связи бывает внутренним узлом
    # блока (`ffi/I`), а косой черте в имени порта не место -- его пишут руками
    # и в адресе контакта.
    return _port_label(prefix, endpoint.instance)


def owner_of(instance: str) -> str:
    """Какой объект холста стоит за именем собранной сети.

    `ffi/I` принадлежит блоку `ffi`, `X` -- сам себе. Нужно везде, где вопрос
    про холст, а не про сеть: кого убирает «Убрать блок», что попало в
    выделение. Разбор один на весь проект: два места, считающие приставку
    по-своему, разошлись бы на первом же блоке с вложенным именем.
    """
    return instance.split(NESTED, 1)[0]


def touches(endpoint: Endpoint, object_id: str) -> bool:
    """Висит ли конец связи на этом объекте холста -- снаружи или внутри него."""
    return owner_of(endpoint.instance) == object_id


def resolve_endpoint(sandbox: Sandbox, endpoint: Endpoint) -> ir.Site:
    """Конец связи -> точка внутри развёрнутой сети.

    Порт разворачивается в свою внутреннюю точку с приставкой блока; всё
    остальное -- имя собранной сети как есть, потому что `ffi/I` и есть имя
    нейрона в ней. Отдельной ветки для внутреннего узла тут нет намеренно:
    завести её значило бы объявить внутренность блока особым родом адреса,
    хотя в модели она ничем не отличается от любой другой клетки.
    """
    if endpoint.is_port:
        block = sandbox.instance(endpoint.instance)
        inner = block.site_of(endpoint.port or "")
        return ir.Site(
            instance=f"{block.id}/{inner.instance}",
            section=inner.section,
            fraction=inner.fraction,
        )
    return ir.Site(
        instance=endpoint.instance,
        section=endpoint.section,
        fraction=endpoint.fraction,
    )


def cell_type_at(sandbox: Sandbox, endpoint: Endpoint) -> ir.CellType | None:
    """Тип клетки, на которой стоит этот конец связи (#540).

    Нужен затем, чтобы рецептор новой связи выбирался по медиатору источника:
    вопрос «чем эта клетка говорит» задаётся до сборки сети, в момент
    соединения, когда собранной модели ещё нет.

    Адреса все три (порт блока, отдельная клетка, узел внутри блока) сводятся
    к имени собранной сети через `resolve_endpoint` -- разбирать их здесь
    заново значило бы завести второе понимание того, что такое конец связи.
    Дальше имя либо содержит приставку блока, и тип берётся из его снимка,
    либо не содержит, и тип берётся из словаря песочницы.

    `None` -- честный ответ, а не сбой: конец связи может указывать на
    несуществующий блок или на клетку с потерянным типом. Отказываться здесь
    нельзя -- про сломанный адрес скажет `compose`, рядом с остальными
    замечаниями по схеме, а не исключением из-под создания связи.
    """
    try:
        site = resolve_endpoint(sandbox, endpoint)
    except PatternError:
        return None

    owner, _, inner = site.instance.partition(NESTED)
    if inner:
        try:
            body = sandbox.instance(owner).snapshot.body
        except PatternError:
            return None
        neuron = body.instances.get(inner)
        return body.cell_types.get(neuron.cell_type) if neuron else None

    own = sandbox.neurons.get(site.instance)
    return sandbox.cell_types.get(own.cell_type) if own else None


def _prefixed_contact(contact: ir.Contact, prefix: str) -> ir.Contact:
    return replace(
        copy.deepcopy(contact),
        id=prefix + contact.id,
        pre=replace(contact.pre, instance=prefix + contact.pre.instance),
        post=replace(contact.post, instance=prefix + contact.post.instance),
    )
