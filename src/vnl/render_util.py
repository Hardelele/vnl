"""Общие мелочи отрисовки: экранирование и признак тормозной клетки."""

from __future__ import annotations

import html

from . import ir


def esc(text: str) -> str:
    return html.escape(str(text), quote=True)


def is_inhibitory(model: ir.Model, instance_id: str) -> bool:
    return ir.is_inhibitory_cell(model.cell_type_of(instance_id))


def nice_step(span: float, target_ticks: int = 6) -> float:
    """Шаг сетки из ряда 1-2-5, чтобы подписи были круглыми."""
    import math

    raw = span / max(target_ticks, 1)
    magnitude = 10.0 ** math.floor(math.log10(raw)) if raw > 0 else 1.0
    for factor in (1.0, 2.0, 5.0, 10.0):
        if raw <= factor * magnitude:
            return factor * magnitude
    return 10.0 * magnitude
