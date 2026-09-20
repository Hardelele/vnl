"""Песочница -> исполняемая сеть.

Чёрный ящик -- способ показать блок, а не способ его посчитать. При запуске
внутренние нейроны каждого экземпляра участвуют в общей симуляции наравне со
всем остальным: никакой подмены блока одним условным нейроном и никакого
воспроизведения заранее записанной демонстрации.

Отсюда два следствия, которые здесь и реализованы:

- имена внутри экземпляра разводятся префиксом (`ffi/E`, `ffi2/E`), иначе два
  экземпляра одного паттерна слиплись бы в один набор состояний и весов;
- сборка возвращает не только модель, но и карту соответствия: интерфейсу надо
  знать, какой объект на холсте каким нейроном стал, иначе подсветка и графики
  не к чему будет привязать.

Расстановка блоков на холсте на физику не влияет и сюда не попадает.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field, replace

from . import ir, protocols
from .patterns import (
    NESTED,
    Endpoint,
    Link,
    PatternError,
    PatternInstance,
    Sandbox,
    resolve_endpoint,
)

#: Приставка блока в именах собранной сети. Значение одно на весь проект и
#: живёт в `patterns.NESTED`: из него же собираются имена портов, и две копии
#: разошлись бы на первой правке.
SEPARATOR = NESTED


@dataclass
class CompositionMap:
    """Соответствие между объектами проекта и объектами сети."""

    #: id блока -> имена его нейронов в собранной сети
    block_neurons: dict[str, list[str]] = field(default_factory=dict)
    #: имя нейрона в сети -> id блока, которому он принадлежит (или None)
    owner: dict[str, str | None] = field(default_factory=dict)
    #: id связи в песочнице -> id контакта в сети
    link_contacts: dict[str, str] = field(default_factory=dict)
    #: имя трассы -> id записи песочницы
    recording_keys: dict[str, str] = field(default_factory=dict)

    def neurons_of(self, object_id: str) -> list[str]:
        """Какие нейроны сети стоят за объектом холста."""
        if object_id in self.block_neurons:
            return list(self.block_neurons[object_id])
        return [object_id] if object_id in self.owner else []


@dataclass
class Composition:
    model: ir.Model
    map: CompositionMap
    problems: list[str] = field(default_factory=list)
    #: Что запуску не мешает, но сделает его результат пустым (#506).
    #:
    #: Отдельный список, а не ещё несколько строк в `problems`: `problems` --
    #: это отказ, по нему `Project.run` не считает вовсе и `as_pattern` не
    #: сохраняет. Схема без драйва считается законно -- её, например, ещё
    #: собирают, -- и запрещать ей запуск было бы неверно: молчащая сеть тут
    #: правильный ответ модели, непонятен он только человеку.
    #:
    #: Считается здесь, а не в интерфейсе, по той же причине, что и догадка о
    #: портах: тот же вопрос задаёт CLI и Claude через MCP, а вторая
    #: реализация слова «нечем спайкать» на клиенте разошлась бы с этой
    #: незаметно -- и разошлась бы молча, потому что это предупреждение, а не
    #: отказ, и на тестах прогона не всплыло бы.
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


def compose(sandbox: Sandbox) -> Composition:
    """Собрать из песочницы модель, которую можно считать.

    Ошибки не бросаются, а копятся: интерфейсу нужно показать их рядом с
    объектами, а не падать на первой.
    """
    model = ir.Model(name=sandbox.name, source=f"sandbox:{sandbox.id}")
    mapping = CompositionMap()
    problems: list[str] = []

    for block in sandbox.instances:
        _unfold(block, model, mapping, problems)

    for neuron_id, neuron in sandbox.neurons.items():
        if neuron_id in model.instances:
            problems.append(f"имя {neuron_id!r} занято блоком")
            continue
        type_id = _adopt_cell_type(
            model, sandbox.cell_types.get(neuron.cell_type), neuron.cell_type, problems
        )
        # Имя без приставки: отдельная клетка и есть объект схемы, а приставка
        # разводит нейроны разных экземпляров одного паттерна.
        model.instances[neuron_id] = replace(neuron.instance(), cell_type=type_id)
        mapping.owner[neuron_id] = None

    for name, modulator in sandbox.modulators.items():
        model.modulators[name] = copy.deepcopy(modulator)

    # Граница с миром -- до связей: связь от сенсора выглядит как обычная, и
    # отличить её можно, только зная список сенсоров целиком. Тот же порядок,
    # что и в резолвере текста схемы: два разных ответа на вопрос «что значит
    # эта стрелка» дали бы две разные сети из одного и того же проекта.
    for sensor in sandbox.sensors:
        if sensor.id in model.instances:
            problems.append(f"имя {sensor.id!r} занято клеткой или блоком")
            continue
        model.sensors[sensor.id] = ir.Sensor(
            id=sensor.id, kind=sensor.kind, to=sensor.to
        )

    for motor in sandbox.motors:
        site = _site_or_problem(sandbox, motor.source, f"мотор {motor.id}", problems)
        if site is None:
            continue
        model.motors[motor.id] = ir.Motor(
            id=motor.id, source=site, kind=motor.kind, window=motor.window
        )

    for link in sandbox.links:
        sensor = model.sensors.get(link.source.instance)
        if sensor is not None:
            site = _site_or_problem(
                sandbox, link.target, f"вход сенсора {link.id}", problems
            )
            if site is None:
                continue
            if site.instance not in model.instances:
                problems.append(
                    f"вход сенсора {link.id}: цель {site.instance!r} в сети "
                    "отсутствует"
                )
                continue
            sensor.targets.append(
                ir.SensorLink(
                    target=site,
                    receptor=link.receptor,
                    weight=link.weight,
                    delay=link.delay,
                    reversal_override=link.reversal,
                )
            )
            continue
        if link.target.instance in model.sensors:
            problems.append(
                f"связь {link.id}: в сенсор ничего не входит — он дверь "
                "снаружи внутрь, а не клетка"
            )
            continue
        contact = _link_contact(sandbox, link, model, problems)
        if contact is not None:
            model.contacts.append(contact)
            mapping.link_contacts[link.id] = contact.id

    for stim in sandbox.stimuli:
        site = _site_or_problem(sandbox, stim.target, f"стимул {stim.id}", problems)
        if site is None:
            continue
        model.stimuli.append(
            ir.Stimulus(
                id=stim.id,
                target=site,
                kind=stim.kind,
                receptor=stim.receptor,
                reversal_override=stim.reversal,
                amplitude=stim.amplitude,
                rate=stim.rate,
                times=tuple(stim.times),
                start=stim.start,
                stop=stim.stop,
                # Числа шаблона переносятся как есть, не разворачиваясь:
                # собранная модель обязана уметь сказать «поезд, 8 импульсов,
                # 20 Гц» так же, как проект, -- и отчёт прогона берёт слова
                # оттуда же (#508). Список времён из них посчитает солвер.
                n=stim.n,
                freq=stim.freq,
                isi=stim.isi,
                duration=stim.duration,
                bursts=stim.bursts,
                burst_period=stim.burst_period,
                repeats=stim.repeats,
                period=stim.period,
                recovery=stim.recovery,
            )
        )

    for recording in sandbox.recordings:
        site = _site_or_problem(
            sandbox, recording.target, f"запись {recording.id}", problems
        )
        if site is None:
            continue
        model.recordings.append(
            ir.Recording(id=recording.id, target=site, var=recording.var)
        )
        mapping.recording_keys[
            ir.trace_key(site.instance, site.section, recording.var)
        ] = recording.id

    model.run = copy.deepcopy(sandbox.run)
    if not model.instances:
        problems.append("в песочнице нечего считать: нет ни блоков, ни нейронов")

    return Composition(
        model=model, map=mapping, problems=problems, warnings=_warnings(model)
    )


def _warnings(model: ir.Model) -> list[str]:
    """Чем прогон окажется пустым, хотя считать его никто не мешает (#506).

    Пустая песочница сюда не попадает: про неё уже сказано в `problems`, и
    второе слово о том же заставило бы читать две строки вместо одной.

    Первый пункт -- тот, который нельзя не заметить: без стимулов LIF стоит на
    `v_rest` и все дорожки таймлайна нули. Второй -- рецептор, спорящий с
    медиатором источника (#540): схема считается, но делает обратное тому, что
    нарисовано. Сюда же по-хорошему встанут «порог недостижим» и «веса не
    хватит» (#506), но они требуют считать заряд по связям, а это отдельный
    разговор.
    """
    out: list[str] = []
    if model.instances and not model.stimuli:
        if model.sensors:
            # Сенсор -- тоже вход, но входа без поданной величины не бывает:
            # молчащая сеть здесь правильный ответ, а не поломка. Сказать об
            # этом надо ровно потому, что сеть выглядит собранной.
            out.append(
                "драйва в схеме нет, а сенсор молчит, пока снаружи не подали "
                "величину: нажмите кнопку или подайте значение в сессию — "
                "выдумывать себе вход сенсор не станет."
            )
        else:
            out.append(
                "нечем спайкать: в схеме нет ни одного стимула — сеть досчитает "
                "до конца и промолчит. Повесьте драйв на вход блока или на клетку."
            )
    for sensor in model.sensors.values():
        if not sensor.targets:
            out.append(
                f"сенсор {sensor.id} ни к чему не подключён: величина войдёт и "
                "никуда не пойдёт — проведите от него связь к клетке."
            )
    out.extend(_receptor_notes(model))
    # Третий -- протокол, на котором движку верить нельзя (#508): пары чаще
    # 25 Гц меряют у нас не то, что мерили бы в опыте. Условие знает
    # `protocols`, а не эта функция: оно про правило пластичности, а не про
    # сборку схемы, и вторая его копия разошлась бы с первой.
    out.extend(protocols.cautions(model))
    # Четвёртый -- драйв, который не дойдёт до клетки (#512): времена вне окна
    # или за концом прогона, слипшиеся в один шаг импульсы, пуассоновский
    # стимул у потолка рода. В песочнице это нужнее, чем где-либо: длительность
    # прогона и моменты здесь правят руками и врозь, и «схема не спайкает»
    # после сдвига `duration` -- обычное дело.
    out.extend(
        f"стимул {stim_id}: {message}"
        for _, stim_id, message in protocols.delivery_problems(model)
    )
    return out


def _polarity(inhibitory: bool) -> str:
    return "тормозный" if inhibitory else "возбуждающий"


def _receptor_notes(model: ir.Model) -> list[str]:
    """Связи, у которых рецептор спорит с медиатором источника (#540).

    Не отказ: нарочные сочетания бывают, и запрещать их -- значит запрещать
    ставить опыт. Но и не молчание: без этой строки тормозная клетка через
    `ampa` подстёгивает цель, а панель свойств показывает `ampa` ровно так же
    спокойно, как показала бы `gaba_a`.

    Считается по собранной модели, а не по списку связей песочницы, и это не
    лишний шаг: контакты внутри блока правятся теми же тремя полями (#531),
    спорить умеют так же, а в собранной сети они уже сведены со своими типами
    клеток. Строит модель `compose` -- значит, и спрашивать надо её.

    Источник называется именем собранной сети (`sst`, `ffi/I`): это то, чем он
    зовётся и на холсте, и в замечаниях `problems`, -- а не именем типа
    клетки, которое у трёх одинаковых нейронов одно на всех.
    """
    out: list[str] = []
    for contact in model.contacts:
        instance = model.instances.get(contact.pre.instance)
        if instance is None:
            continue
        cell_type = model.cell_types.get(instance.cell_type)
        if cell_type is None or not ir.receptor_disagrees(cell_type, contact.receptor):
            continue
        out.append(
            f"связь {contact.id}: источник {instance.id} "
            f"{_polarity(ir.is_inhibitory_cell(cell_type))}, "
            f"а рецептор {contact.receptor} "
            f"{_polarity(ir.is_inhibitory_receptor(contact.receptor))}"
        )
    return out


def _unfold(
    block: PatternInstance,
    model: ir.Model,
    mapping: CompositionMap,
    problems: list[str],
) -> None:
    """Развернуть экземпляр внутрь общей сети."""
    prefix = block.id + SEPARATOR
    inner = block.snapshot.body
    names: list[str] = []

    types: dict[str, str] = {}
    for type_id, cell_type in inner.cell_types.items():
        types[type_id] = _adopt_cell_type(model, cell_type, type_id, problems, prefix)

    for neuron_id, neuron in inner.instances.items():
        flat = prefix + neuron_id
        if flat in model.instances:
            problems.append(f"имя {flat!r} встречается дважды")
            continue
        model.instances[flat] = replace(
            copy.deepcopy(neuron),
            id=flat,
            cell_type=types.get(neuron.cell_type, neuron.cell_type),
        )
        names.append(flat)
        mapping.owner[flat] = block.id

    for contact in inner.contacts:
        model.contacts.append(
            replace(
                copy.deepcopy(contact),
                id=prefix + contact.id,
                pre=replace(contact.pre, instance=prefix + contact.pre.instance),
                post=replace(contact.post, instance=prefix + contact.post.instance),
            )
        )

    for name, modulator in inner.modulators.items():
        model.modulators[prefix + name] = replace(
            copy.deepcopy(modulator),
            id=prefix + name,
            sources=tuple(prefix + source for source in modulator.sources),
        )
        # Пластичность внутри блока ссылалась на модулятор по старому имени.
        for contact in model.contacts:
            if contact.id.startswith(prefix) and contact.plasticity.modulator == name:
                contact.plasticity.modulator = prefix + name

    # Граница с миром -- часть схемы, а не витрины: паттерн, у которого
    # объявлен сенсор, честно сообщает, что ему нужно снаружи, и молча терять
    # эту дверь при вставке блока нельзя. Имена разводятся той же приставкой,
    # что у нейронов: две копии одного паттерна -- это два разных входа, и
    # подача величины в один не должна дёргать другой.
    for name, sensor in inner.sensors.items():
        model.sensors[prefix + name] = replace(
            copy.deepcopy(sensor),
            id=prefix + name,
            targets=[
                replace(link, target=replace(link.target, instance=prefix + link.target.instance))
                for link in sensor.targets
            ],
        )
    for name, motor in inner.motors.items():
        model.motors[prefix + name] = replace(
            copy.deepcopy(motor),
            id=prefix + name,
            source=replace(motor.source, instance=prefix + motor.source.instance),
        )

    # Витрина карточки (`snapshot.demo`) сюда намеренно не переносится: её
    # стимулы принадлежат демонстрации паттерна, а не этой сети.
    mapping.block_neurons[block.id] = names


def _adopt_cell_type(
    model: ir.Model,
    cell_type: ir.CellType | None,
    type_id: str,
    problems: list[str],
    prefix: str = "",
) -> str:
    """Положить тип клетки в общую модель, разведя одноимённые разные типы."""
    if cell_type is None:
        problems.append(f"неизвестный тип клетки {type_id!r}")
        return type_id

    existing = model.cell_types.get(type_id)
    if existing is None:
        model.cell_types[type_id] = copy.deepcopy(cell_type)
        return type_id
    if existing == cell_type:
        return type_id

    # Два паттерна принесли разные типы под одним именем -- развести, иначе
    # один молча подменил бы другой.
    unique = f"{prefix}{type_id}" if prefix else f"{type_id}_2"
    counter = 2
    while unique in model.cell_types and model.cell_types[unique] != cell_type:
        unique = f"{prefix}{type_id}_{counter}"
        counter += 1
    model.cell_types.setdefault(unique, copy.deepcopy(cell_type))
    return unique


def _link_contact(
    sandbox: Sandbox, link: Link, model: ir.Model, problems: list[str]
) -> ir.Contact | None:
    pre = _site_or_problem(sandbox, link.source, f"связь {link.id}", problems)
    post = _site_or_problem(sandbox, link.target, f"связь {link.id}", problems)
    if pre is None or post is None:
        return None
    for site, side in ((pre, "источник"), (post, "цель")):
        if site.instance not in model.instances:
            problems.append(
                f"связь {link.id}: {side} {site.instance!r} в сети отсутствует"
            )
            return None
    return ir.Contact(
        id=link.id,
        pre=pre,
        post=post,
        receptor=link.receptor,
        weight=link.weight,
        delay=link.delay,
        reversal_override=link.reversal,
        dynamics=copy.deepcopy(link.dynamics),
        plasticity=copy.deepcopy(link.plasticity),
    )


def _site_or_problem(
    sandbox: Sandbox, endpoint: Endpoint, where: str, problems: list[str]
) -> ir.Site | None:
    try:
        return resolve_endpoint(sandbox, endpoint)
    except PatternError as exc:
        problems.append(f"{where}: {exc}")
        return None
