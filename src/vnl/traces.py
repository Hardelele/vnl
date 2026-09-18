"""Блок графиков: подробные трассы записанных величин."""

from __future__ import annotations

from . import ir
from .render_util import esc
from .sim import SimResult

def trace_svg(name: str, times: list[float], values: list[float]) -> str:
    width, height, left, bottom = 760, 150, 54, 24
    low, high = min(values), max(values)
    if high - low < 1e-9:
        high = low + 1.0
    span_x = width - left - 16
    span_y = height - bottom - 14

    step = max(1, len(times) // 1500)
    points = " ".join(
        f"{left + (times[i] / times[-1]) * span_x:.1f},"
        f"{14 + span_y - (values[i] - low) / (high - low) * span_y:.1f}"
        for i in range(0, len(times), step)
    )
    return (
        f'<svg class="trace" viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="Трасса {esc(name)}">'
        f'<polyline class="trace-line" points="{points}"/>'
        f'<text class="axis value" x="{left - 8}" y="20">{high:.3g}</text>'
        f'<text class="axis value" x="{left - 8}" y="{height - bottom + 4}">'
        f'{low:.3g}</text>'
        f'<text class="trace-name" x="{left}" y="14">{esc(name)}</text>'
        f"</svg>"
    )


STYLE = """
"""


def render(model: ir.Model, result: SimResult) -> str:
    body = "".join(
        trace_svg(key, result.times, values)
        for key, values in result.traces.items()
        if values
    )
    return "<h2>Трассы</h2><section>" + (
        body or "<p class='sub'>записей нет</p>"
    ) + "</section>"
