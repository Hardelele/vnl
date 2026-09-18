"""Отрисовка модели и результата прогона в самодостаточный HTML.

Только рисование: где стоят клетки и как идут связи, решает vnl.layout.
Весь вывод -- статический SVG, собранный на Python: ни внешних библиотек, ни
скриптов в самой странице. Схема показывает морфологию, потому что главное
в языке -- куда именно сел контакт, а не просто «A соединён с B».
"""

from __future__ import annotations

import html
import math

from . import ir
from .layout import SOMA_R, LayoutResult, layout
from .sim import SimResult


def _esc(text: str) -> str:
    return html.escape(str(text), quote=True)


def _is_inhibitory(model: ir.Model, instance_id: str) -> bool:
    cell_type = model.cell_type_of(instance_id)
    return "inhibitory" in cell_type.tags or cell_type.transmitter == "gaba"


def _rounded_path(points: list[tuple[float, float]], radius: float = 14.0) -> str:
    """Ломаная со скруглёнными углами: маршруты ELK иначе выглядят рублеными."""
    if len(points) < 3:
        return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in points)

    out = [f"M{points[0][0]:.1f},{points[0][1]:.1f}"]
    for index in range(1, len(points) - 1):
        before, corner, after = points[index - 1], points[index], points[index + 1]
        entry = _step_towards(corner, before, radius)
        exit_ = _step_towards(corner, after, radius)
        out.append(f"L{entry[0]:.1f},{entry[1]:.1f}")
        out.append(
            f"Q{corner[0]:.1f},{corner[1]:.1f} {exit_[0]:.1f},{exit_[1]:.1f}"
        )
    out.append(f"L{points[-1][0]:.1f},{points[-1][1]:.1f}")
    return " ".join(out)


def _step_towards(
    origin: tuple[float, float], target: tuple[float, float], distance: float
) -> tuple[float, float]:
    dx, dy = target[0] - origin[0], target[1] - origin[1]
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return origin
    step = min(distance, length / 2)
    return origin[0] + dx / length * step, origin[1] + dy / length * step


def _trim_end(points: list[tuple[float, float]], distance: float) -> list[tuple[float, float]]:
    """Отвести конец маршрута от центра сомы, иначе стрелка прячется под ней."""
    trimmed = list(points)
    while len(trimmed) > 2:
        last, previous = trimmed[-1], trimmed[-2]
        if math.hypot(last[0] - previous[0], last[1] - previous[1]) > distance:
            break
        trimmed.pop()
    last, previous = trimmed[-1], trimmed[-2]
    trimmed[-1] = _step_towards(last, previous, distance)
    return trimmed


def circuit_svg(model: ir.Model, placement: LayoutResult | None = None) -> str:
    placement = placement or layout(model)
    parts: list[str] = [
        f'<svg class="circuit" viewBox="0 0 {placement.width:.0f} '
        f'{placement.height:.0f}" role="img" aria-label="Схема микросхемы">',
        "<defs>"
        '<marker id="exc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
        'markerHeight="6" orient="auto-start-reverse">'
        '<path d="M0,0 L10,5 L0,10 z" class="exc-fill"/></marker>'
        '<marker id="inh" viewBox="0 0 10 10" refX="4" refY="5" markerWidth="7" '
        'markerHeight="7" orient="auto-start-reverse">'
        '<path d="M2,0 L2,10" class="inh-stroke"/></marker>'
        "</defs>",
    ]

    for cell in placement.cells.values():
        for x1, y1, x2, y2 in cell.dendrites():
            parts.append(
                f'<line class="dend" x1="{x1:.1f}" y1="{y1:.1f}" '
                f'x2="{x2:.1f}" y2="{y2:.1f}"/>'
            )
        soma, tip = cell.soma, cell.axon_tip
        parts.append(
            f'<line class="axon" x1="{soma[0]:.1f}" y1="{soma[1]:.1f}" '
            f'x2="{tip[0]:.1f}" y2="{tip[1]:.1f}"/>'
        )

    for contact in model.contacts:
        route = placement.routes.get(contact.id)
        if route is None:
            continue
        klass = "inh" if contact.receptor.startswith("gaba") else "exc"
        where = (
            f"{contact.post.section}@{contact.post.fraction:g}"
            if contact.post.section != "soma"
            else "сома"
        )
        tooltip = (
            f"{contact.pre.instance} → {contact.post.instance} · "
            f"{contact.receptor} · {contact.weight:g} нСм · "
            f"{contact.delay:g} мс · {where}"
        )
        if contact.dynamics.enabled:
            tooltip += " · динамический"
        if contact.plasticity.enabled:
            tooltip += f" · {contact.plasticity.rule}"
        on_soma = contact.post.section == "soma"
        points = _trim_end(route.points, SOMA_R + 4) if on_soma else route.points
        parts.append(
            f'<path class="edge {klass}" marker-end="url(#{klass})" '
            f'd="{_rounded_path(points)}">'
            f"<title>{_esc(tooltip)}</title></path>"
        )
        if not on_soma:
            end = route.end
            parts.append(
                f'<circle class="bouton {klass}-fill" cx="{end[0]:.1f}" '
                f'cy="{end[1]:.1f}" r="4.5"><title>{_esc(tooltip)}</title></circle>'
            )

    for modulator in model.modulators.values():
        for route_id, route in placement.routes.items():
            if not route_id.startswith(f"mod:{modulator.id}:"):
                continue
            _, _, source, contact_id = route_id.split(":", 3)
            parts.append(
                f'<path class="edge mod" d="{_rounded_path(route.points)}">'
                f"<title>{_esc(modulator.transmitter)} от {_esc(source)} "
                f"управляет контактом {_esc(contact_id)}</title></path>"
            )

    for name, cell in placement.cells.items():
        geometry = cell.geometry
        x, y = cell.soma
        shape = (
            f'<rect class="soma inh-cell" x="{x - SOMA_R:.1f}" '
            f'y="{y - SOMA_R:.1f}" width="{SOMA_R * 2:.0f}" '
            f'height="{SOMA_R * 2:.0f}" rx="4"/>'
            if geometry.inhibitory
            else f'<circle class="soma exc-cell" cx="{x:.1f}" cy="{y:.1f}" '
            f'r="{SOMA_R:.0f}"/>'
        )
        parts.append(
            f'<g><title>{_esc(name)} — {_esc(geometry.cell_type)}</title>{shape}'
            f'<text class="cell-name" x="{x:.1f}" y="{y + 5:.1f}">{_esc(name)}</text>'
            f'<text class="cell-type" x="{x + SOMA_R + 6:.1f}" '
            f'y="{y + SOMA_R + 14:.1f}">{_esc(geometry.cell_type)}</text></g>'
        )

    parts.append("</svg>")
    return "".join(parts)


def _nice_step(span: float, target_ticks: int = 6) -> float:
    """Шаг сетки из ряда 1-2-5, чтобы подписи были круглыми."""
    raw = span / max(target_ticks, 1)
    magnitude = 10.0 ** math.floor(math.log10(raw)) if raw > 0 else 1.0
    for factor in (1.0, 2.0, 5.0, 10.0):
        if raw <= factor * magnitude:
            return factor * magnitude
    return 10.0 * magnitude


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
            f"<title>{_esc(stim.id)}: {_esc(stim.kind)}, {_esc(detail)}, "
            f"{stim.start:g}–{min(stim.stop, duration):g} мс</title></rect>"
        )

    step = _nice_step(duration)
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
        klass = "inh" if _is_inhibitory(model, name) else "exc"
        count = len(result.spikes.get(name, []))
        parts.append(
            f'<text class="row-label" x="8" y="{y + 12}">{_esc(name)}</text>'
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
        f'aria-label="Трасса {_esc(name)}">'
        f'<polyline class="trace-line" points="{points}"/>'
        f'<text class="axis value" x="{left - 8}" y="20">{high:.3g}</text>'
        f'<text class="axis value" x="{left - 8}" y="{height - bottom + 4}">'
        f'{low:.3g}</text>'
        f'<text class="trace-name" x="{left}" y="14">{_esc(name)}</text>'
        f"</svg>"
    )


_STYLE = """
:root {
  color-scheme: light dark;
  --bg: #fbfaf8;
  --panel: #ffffff;
  --ink: #1d1c1a;
  --muted: #6d6a64;
  --line: #ddd9d2;
  --exc: #1f6f5c;
  --inh: #a33b32;
  --trace: #3d5a9e;
  --mod: #8a6d2f;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #17181a; --panel: #1f2124; --ink: #ecebe8; --muted: #9a968f;
    --line: #34373c; --exc: #57bfa2; --inh: #e0796c; --trace: #8aa8e8; --mod: #d3ab5c;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 28px 20px 60px;
  background: var(--bg); color: var(--ink);
  font: 15px/1.55 "Segoe UI", system-ui, sans-serif;
}
main { max-width: 900px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 0 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.09em;
     color: var(--muted); margin: 34px 0 10px; font-weight: 600; }
.sub { color: var(--muted); margin: 0 0 8px; font-size: 0.92rem; }
section { background: var(--panel); border: 1px solid var(--line);
          border-radius: 10px; padding: 16px; overflow-x: auto; }
svg { display: block; width: 100%; height: auto; min-width: 460px; }
.dend { stroke: var(--muted); stroke-width: 2.4; stroke-linecap: round; opacity: .55; }
.axon { stroke: var(--muted); stroke-width: 1.6; stroke-dasharray: 3 3; opacity: .7; }
.edge { fill: none; stroke-width: 1.9; opacity: .9; }
.edge.exc { stroke: var(--exc); }
.edge.inh { stroke: var(--inh); }
.edge.mod { stroke: var(--mod); stroke-dasharray: 6 4; opacity: .85; }
.exc-fill { fill: var(--exc); } .inh-stroke { stroke: var(--inh); stroke-width: 2.4; }
.bouton.exc-fill { fill: var(--exc); } .bouton.inh-fill { fill: var(--inh); }
.soma { fill: var(--panel); stroke-width: 2; }
.exc-cell { stroke: var(--exc); } .inh-cell { stroke: var(--inh); }
.cell-name { text-anchor: middle; font-size: 12px; font-weight: 600; fill: var(--ink); }
.cell-type { font-size: 10px; fill: var(--muted); }
.row-label { font-size: 12px; fill: var(--muted); }
.row-count { text-anchor: end; font-size: 11px; fill: var(--muted);
             font-variant-numeric: tabular-nums; }
.grid { stroke: var(--line); stroke-width: 1; }
.stim-band { fill: var(--ink); opacity: .055; }
.axis.tick { text-anchor: middle; font-variant-numeric: tabular-nums; }
.axis.value { text-anchor: end; font-variant-numeric: tabular-nums; }
.row-base { stroke: var(--line); stroke-width: 1; }
.spike { stroke-width: 1.6; }
.exc-stroke { stroke: var(--exc); } .inh-stroke { stroke: var(--inh); }
.axis { font-size: 11px; fill: var(--muted); }
.axis.end { text-anchor: end; }
.trace-line { fill: none; stroke: var(--trace); stroke-width: 1.4; }
.trace-name { font-size: 11px; fill: var(--muted); }
.trace + .trace { margin-top: 6px; border-top: 1px solid var(--line); padding-top: 6px; }
table { border-collapse: collapse; width: auto; min-width: 280px;
         font-size: 0.9rem; }
th, td { text-align: left; padding: 6px 14px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; font-size: 0.8rem; }
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums;
                 white-space: nowrap; }
td:first-child { padding-right: 32px; }
ul.notes { margin: 0; padding-left: 20px; color: var(--muted); font-size: 0.9rem; }
ul.notes li { margin: 3px 0; }
.legend { display: flex; gap: 18px; flex-wrap: wrap; color: var(--muted);
          font-size: 0.85rem; margin-top: 10px; }
.legend .e::before, .legend .i::before, .legend .m::before {
  content: "—"; margin-right: 6px; font-weight: 700;
}
.legend .e::before { color: var(--exc); }
.legend .i::before { color: var(--inh); }
.legend .m::before { color: var(--mod); }
"""


def render(
    model: ir.Model,
    result: SimResult,
    placement: LayoutResult | None = None,
) -> str:
    placement = placement or layout(model)
    rows = "".join(
        f"<tr><td>{_esc(name)}</td><td class='num'>{count}</td>"
        f"<td class='num'>{count / model.run.duration * 1000:.1f}</td></tr>"
        for name, count in result.spike_count().items()
    )
    traces = "".join(
        trace_svg(key, result.times, values)
        for key, values in result.traces.items()
        if values
    )
    layout_note = "".join(
        f"<p class='sub note'>{_esc(note)}</p>" for note in placement.notes
    )
    degradation = (
        "<h2>Деградация L2 → L1</h2><section><ul class='notes'>"
        + "".join(f"<li>{_esc(note)}</li>" for note in result.degradation)
        + "</ul></section>"
        if result.degradation
        else ""
    )

    return f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_esc(model.name)} — прогон VNL</title>
<style>{_STYLE}</style>
</head>
<body>
<main>
<h1>{_esc(model.name)}</h1>
<p class="sub">{_esc(model.source or "модель VNL")} · уровень {model.run.level} ·
{model.run.duration:g} мс · шаг {model.run.dt:g} мс · seed {model.run.seed}</p>

<h2>Схема</h2>
<section>{circuit_svg(model, placement)}
<div class="legend"><span class="e">возбуждающий контакт</span>
<span class="i">тормозный контакт</span>
<span class="m">нейромодулятор</span>
<span>круг — возбуждающая клетка, квадрат — тормозная</span>
<span>серое: дендриты слева веером, аксон справа пунктиром</span>
<span>точка на ветви — место контакта</span></div>
{layout_note}
</section>

<h2>Растр спайков</h2>
<section>{raster_svg(model, result)}</section>

<h2>Трассы</h2>
<section>{traces or "<p class='sub'>записей нет</p>"}</section>

<h2>Итог</h2>
<section><table><thead><tr><th>нейрон</th><th class="num">спайков</th>
<th class="num">Гц</th></tr></thead><tbody>{rows}</tbody></table></section>
{degradation}
</main>
</body>
</html>
"""
