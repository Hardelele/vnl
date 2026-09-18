"""Блок «Активность сети»: по дорожке на нейрон на общей временной оси.

Основной экран: он масштабируется по числу клеток — новая клетка добавляет
строку, а не борется за то же место. Подробная физиология одного нейрона
живёт не здесь.
"""

from __future__ import annotations

from . import ir
from .render_util import esc, is_inhibitory, nice_step
from .sim import SimResult

def raster_svg(model: ir.Model, result: SimResult) -> str:
    names = list(model.instances)
    row_height = 26
    width, left, right = 760, 54, 78
    top = 14
    height = row_height * len(names) + top + 26
    duration = model.run.duration
    span = width - left - right

    def at(time: float) -> float:
        return left + min(max(time, 0.0), duration) / duration * span

    parts = [
        f'<svg class="raster" viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="Растр спайков">'
    ]

    # Окна работы стимулов -- полосой в строке той клетки, куда они приходят.
    rows = {name: top + index * row_height for index, name in enumerate(names)}
    for stim in model.stimuli:
        target = stim.target.instance
        if target not in rows:
            continue
        start, stop = at(stim.start), at(min(stim.stop, duration))
        if stop - start < 0.5:
            continue
        detail = (
            f"{stim.rate:g} Гц"
            if stim.kind == "poisson"
            else f"{len(stim.times)} импульсов"
            if stim.kind == "spikes"
            else f"{stim.amplitude:g} нА"
        )
        parts.append(
            f'<rect class="stim-band" x="{start:.1f}" y="{rows[target] - 2}" '
            f'width="{stop - start:.1f}" height="{row_height - 4}" rx="2">'
            f"<title>{esc(stim.id)}: {esc(stim.kind)}, {esc(detail)}, "
            f"{stim.start:g}–{min(stim.stop, duration):g} мс</title></rect>"
        )

    step = nice_step(duration)
    tick = 0.0
    while tick <= duration + 1e-9:
        x = at(tick)
        parts.append(
            f'<line class="grid" x1="{x:.1f}" y1="{top - 6}" '
            f'x2="{x:.1f}" y2="{height - 22}"/>'
            f'<text class="axis tick" x="{x:.1f}" y="{height - 8}">{tick:g}</text>'
        )
        tick += step
    parts.append(
        f'<text class="axis unit" x="{left + span + 10}" y="{height - 8}">мс</text>'
    )

    for name in names:
        y = rows[name]
        klass = "inh" if is_inhibitory(model, name) else "exc"
        count = len(result.spikes.get(name, []))
        parts.append(
            f'<text class="row-label" x="8" y="{y + 12}">{esc(name)}</text>'
            f'<line class="row-base" x1="{left}" y1="{y + 9}" '
            f'x2="{left + span}" y2="{y + 9}"/>'
            f'<text class="row-count" x="{left + span + 62}" y="{y + 12}">'
            f"{count}</text>"
        )
        for time in result.spikes.get(name, []):
            x = at(time)
            parts.append(
                f'<line class="spike {klass}-stroke" x1="{x:.1f}" y1="{y}" '
                f'x2="{x:.1f}" y2="{y + 18}"/>'
            )

    parts.append("</svg>")
    return "".join(parts)


STYLE = """
"""


def render(model: ir.Model, result: SimResult) -> str:
    """Блок целиком, вместе с заголовком секции."""
    return (
        "<h2>Активность сети</h2><section>"
        + raster_svg(model, result)
        + "</section>"
    )
