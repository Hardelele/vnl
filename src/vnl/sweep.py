"""Развёртка параметра: несколько прогонов одной модели.

Вопрос «а что будет, если подвинуть задержку» нельзя ответить одним
прогоном: другая задержка -- другая симуляция. Здесь модель клонируется,
в копии меняется один параметр, и каждая копия считается отдельно.

Синтаксис спецификации:

    c1.delay=0.5,1,2,4          параметр контакта
    c1.dynamics.tau_rec=50,200  вложенный параметр
    pyr_l5.tau_m=8ms,15ms,25ms  параметр типа клетки

Единицы такие же, как в языке; без единицы значение берётся как есть.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from typing import Any

from . import ir
from .resolve import Diagnostic
from .sim import SimResult, simulate
from .units import UnitError, parse_quantity

_SPEC = re.compile(r"^(?P<path>[A-Za-z_][A-Za-z_0-9.\[\]]*)=(?P<values>.+)$")

# Поля, которые осмысленно крутить. Список явный, чтобы опечатка в пути
# ловилась сразу, а не превращалась в новый атрибут на объекте.
CONTACT_FIELDS = {"weight", "delay"}
CONTACT_GROUPS = {"dynamics", "plasticity"}
CELL_FIELDS = {
    "tau_m",
    "v_rest",
    "v_reset",
    "v_threshold",
    "threshold",
    "refractory",
    "r_in",
    "adaptation",
    "tau_adaptation",
}
_CELL_ALIASES = {"threshold": "v_threshold"}


class SweepError(ValueError):
    pass


@dataclass
class Variant:
    """Один прогон развёртки."""

    label: str
    value: float
    result: SimResult
    diagnostics: list[Diagnostic] = field(default_factory=list)


@dataclass
class Sweep:
    spec: str
    path: str
    values: list[float]
    variants: list[Variant]


def parse_spec(spec: str) -> tuple[str, list[float]]:
    """'c1.delay=0.5,1,2' -> ('c1.delay', [0.5, 1.0, 2.0])."""
    match = _SPEC.match(spec.strip())
    if not match:
        raise SweepError(
            f"не разобрать развёртку {spec!r}; ожидается вид "
            f"c1.delay=0.5,1,2,4"
        )
    path = match.group("path")
    values: list[float] = []
    for chunk in match.group("values").split(","):
        text = chunk.strip()
        if not text:
            continue
        try:
            values.append(parse_quantity(text)[0])
        except UnitError as exc:
            raise SweepError(f"значение {text!r} в развёртке: {exc}") from exc
    if len(values) < 2:
        raise SweepError(
            f"в развёртке {spec!r} меньше двух значений: сравнивать нечего"
        )
    return path, values


def _apply(model: ir.Model, path: str, value: float) -> None:
    """Поставить значение по пути внутри клона модели."""
    head, _, rest = path.partition(".")
    if not rest:
        raise SweepError(f"в пути {path!r} не указано поле")

    contact = next((c for c in model.contacts if c.id == head), None)
    if contact is not None:
        _apply_to_contact(contact, rest, path, value)
        return

    cell_type = model.cell_types.get(head)
    if cell_type is not None:
        _apply_to_cell(cell_type, rest, path, value)
        return

    known_contacts = ", ".join(c.id for c in model.contacts) or "нет"
    known_cells = ", ".join(model.cell_types) or "нет"
    raise SweepError(
        f"в модели нет ни контакта, ни типа клетки с именем {head!r} "
        f"(контакты: {known_contacts}; типы: {known_cells})"
    )


def _apply_to_contact(
    contact: ir.Contact, rest: str, path: str, value: float
) -> None:
    group, _, nested = rest.partition(".")
    if nested:
        if group not in CONTACT_GROUPS:
            raise SweepError(
                f"у контакта нет группы параметров {group!r} "
                f"(есть: {', '.join(sorted(CONTACT_GROUPS))})"
            )
        target = getattr(contact, group)
        if not hasattr(target, nested):
            raise SweepError(f"у {group} нет параметра {nested!r}")
        setattr(target, nested, value)
        return

    if group not in CONTACT_FIELDS:
        raise SweepError(
            f"параметр контакта {group!r} крутить нельзя "
            f"(можно: {', '.join(sorted(CONTACT_FIELDS))}, "
            f"а также dynamics.* и plasticity.*); путь {path!r}"
        )
    setattr(contact, group, value)


def _apply_to_cell(
    cell_type: ir.CellType, rest: str, path: str, value: float
) -> None:
    if rest not in CELL_FIELDS:
        raise SweepError(
            f"параметр клетки {rest!r} крутить нельзя "
            f"(можно: {', '.join(sorted(CELL_FIELDS))}); путь {path!r}"
        )
    setattr(cell_type.point_model, _CELL_ALIASES.get(rest, rest), value)


def _label(value: float) -> str:
    return f"{value:g}"


def run_sweep(model: ir.Model, spec: str) -> Sweep:
    """Посчитать все варианты. Исходная модель не трогается."""
    path, values = parse_spec(spec)

    variants: list[Variant] = []
    for value in values:
        # Клонируем целиком: параметры контактов и клеток связаны ссылками,
        # и правка «на месте» протекла бы в соседний вариант.
        clone = copy.deepcopy(model)
        _apply(clone, path, value)

        # Значение может увести модель за границы допустимого -- например,
        # задержка меньше шага интегрирования. Это не повод останавливать
        # развёртку, но и молчать нельзя.
        problems: list[Diagnostic] = []
        for contact in clone.contacts:
            if contact.delay < clone.run.dt:
                problems.append(
                    Diagnostic(
                        "warning",
                        f"вариант {_label(value)}",
                        f"задержка контакта {contact.id} ({contact.delay} мс) "
                        f"меньше шага {clone.run.dt} мс: событие придёт "
                        f"на следующем шаге",
                    )
                )
        variants.append(
            Variant(
                label=_label(value),
                value=value,
                result=simulate(clone),
                diagnostics=problems,
            )
        )

    return Sweep(spec=spec, path=path, values=values, variants=variants)


def summarise(sweep: Sweep, model: ir.Model) -> list[dict[str, Any]]:
    """Короткая сводка по вариантам: глазами четыре набора кривых не сравнить."""
    rows: list[dict[str, Any]] = []
    duration = model.run.duration
    for variant in sweep.variants:
        counts = variant.result.spike_count()
        rows.append(
            {
                "label": variant.label,
                "value": variant.value,
                "rates": {
                    name: round(count / duration * 1000.0, 1)
                    for name, count in counts.items()
                },
                "spikes": counts,
            }
        )
    return rows
