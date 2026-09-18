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
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterator

from . import ir
from .compose import Composition, compose
from .patterns import (
    CatalogLevel,
    Endpoint,
    Link,
    Pattern,
    PatternError,
    PatternInstance,
    Sandbox,
    SandboxRecording,
    SandboxStimulus,
    extract_pattern,
)
from .sim import SimResult, simulate
from .store import Store, to_plain

HISTORY_LIMIT = 50


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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
        """
        model = compose(self.sandbox).model
        payload = json.dumps(to_plain(model), ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    @property
    def run_is_stale(self) -> bool:
        if self.last_run is None:
            return False
        return self.last_run.is_stale(self.fingerprint())

    # --- история ----------------------------------------------------------

    def _remember(self, label: str) -> None:
        if self._batch is not None:
            return  # внутри пакета снимок уже сделан
        self.history.append(Step(label=label, before=copy.deepcopy(self.sandbox)))
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
    ) -> PatternInstance:
        self._remember(f"вставлен паттерн «{pattern.name}»")
        return self.sandbox.add_instance(pattern, label, instance_id, position)

    def add_neuron(
        self, neuron_id: str, cell_type: ir.CellType
    ) -> ir.Instance:
        if neuron_id in self.sandbox.neurons:
            raise PatternError(f"нейрон {neuron_id!r} уже есть")
        self._remember(f"добавлен нейрон {neuron_id}")
        self.sandbox.cell_types.setdefault(cell_type.id, cell_type)
        neuron = ir.Instance(id=neuron_id, cell_type=cell_type.id)
        self.sandbox.neurons[neuron_id] = neuron
        return neuron

    def connect(
        self,
        source: Endpoint,
        target: Endpoint,
        link_id: str | None = None,
        **params: Any,
    ) -> Link:
        chosen = link_id or self._free_link_id()
        if any(link.id == chosen for link in self.sandbox.links):
            raise PatternError(f"связь {chosen!r} уже есть")
        self._remember(f"связь {chosen}")
        link = Link(id=chosen, source=source, target=target, **params)
        self.sandbox.links.append(link)
        return link

    def set_parameters(self, link_id: str, **params: Any) -> Link:
        link = self._link(link_id)
        unknown = [key for key in params if not hasattr(link, key)]
        if unknown:
            raise PatternError(f"у связи нет параметров: {', '.join(unknown)}")
        self._remember(f"параметры связи {link_id}")
        link = self._link(link_id)  # после снимка объект тот же
        for key, value in params.items():
            setattr(link, key, value)
        return link

    def move(self, block_id: str, position: tuple[float, float]) -> None:
        """Сдвиг по холсту. На физику не влияет и прогон не старит."""
        self._remember(f"перемещён {block_id}")
        self.sandbox.instance(block_id).position = position

    def remove(self, object_id: str) -> None:
        """Убрать блок, нейрон или связь вместе со всем, что на них висело."""
        self._remember(f"удалён {object_id}")
        sandbox = self.sandbox
        sandbox.instances = [i for i in sandbox.instances if i.id != object_id]
        sandbox.neurons.pop(object_id, None)
        sandbox.links = [
            link
            for link in sandbox.links
            if link.id != object_id
            and link.source.instance != object_id
            and link.target.instance != object_id
        ]
        sandbox.stimuli = [s for s in sandbox.stimuli if s.target.instance != object_id]
        sandbox.recordings = [
            r for r in sandbox.recordings if r.target.instance != object_id
        ]

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
        self, selection: list[str], name: str, level: CatalogLevel = "L2"
    ) -> tuple[Pattern, list[str]]:
        """Выделение -> паттерн. Песочница остаётся как была."""
        return extract_pattern(self.sandbox, selection, name, level)

    # --- запуск и сохранение ---------------------------------------------

    def check(self) -> list[str]:
        """Что мешает запуску. Пусто -- можно считать."""
        return compose(self.sandbox).problems

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

    def _free_link_id(self) -> str:
        used = {link.id for link in self.sandbox.links}
        index = len(used) + 1
        while f"l{index}" in used:
            index += 1
        return f"l{index}"
