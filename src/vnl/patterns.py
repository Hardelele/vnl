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
        """Пустой черновик -- то, что открывает «Добавить» в библиотеке.

        Черновик кладётся в библиотеку сразу, а не после первой правки: иначе
        «продолжу позже» держалось бы только на незакрытой вкладке. Пустой он
        честно показывает, чего ему не хватает (`validate`), и удаляется одним
        действием, если передумали.
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
class Endpoint:
    """Конец связи в песочнице: либо порт блока, либо точка отдельного нейрона."""

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
    neurons: dict[str, ir.Instance] = field(default_factory=dict)
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

    def add_instance(
        self,
        pattern: Pattern,
        label: str | None = None,
        instance_id: str | None = None,
        position: tuple[float, float] = (0.0, 0.0),
    ) -> PatternInstance:
        """Вставить паттерн. Кладётся снимок, а не ссылка на библиотеку."""
        used = {item.id for item in self.instances} | set(self.neurons)
        base = instance_id or _slug(pattern.name)
        chosen = base
        counter = 2
        while chosen in used:
            chosen = f"{base}{counter}"
            counter += 1

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

    # Отдельные нейроны переносятся как есть.
    for neuron_id in sorted(chosen & set(sandbox.neurons)):
        neuron = sandbox.neurons[neuron_id]
        body.instances[neuron_id] = copy.deepcopy(neuron)
        body.cell_types.setdefault(
            neuron.cell_type, copy.deepcopy(sandbox.cell_types[neuron.cell_type])
        )

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
        inside_source = link.source.instance in chosen
        inside_target = link.target.instance in chosen

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


def _port_name(endpoint: Endpoint, direction: str) -> str:
    if endpoint.is_port:
        return f"{endpoint.instance}.{endpoint.port}"
    prefix = "in" if direction == "in" else "out"
    return f"{prefix}_{endpoint.instance}"


def resolve_endpoint(sandbox: Sandbox, endpoint: Endpoint) -> ir.Site:
    """Конец связи -> точка внутри развёрнутой сети."""
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


def _prefixed_contact(contact: ir.Contact, prefix: str) -> ir.Contact:
    return replace(
        copy.deepcopy(contact),
        id=prefix + contact.id,
        pre=replace(contact.pre, instance=prefix + contact.pre.instance),
        post=replace(contact.post, instance=prefix + contact.post.instance),
    )
