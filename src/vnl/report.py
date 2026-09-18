"""Отрисовка модели и результата прогона в самодостаточный HTML.

Весь вывод -- статический SVG, собранный на Python: ни внешних библиотек, ни
graphviz, ни скриптов в странице. Схема рисует морфологию как она есть, потому
что главное в языке -- куда именно сел контакт, а не просто «A соединён с B».
"""

from __future__ import annotations

import html
import math
from dataclasses import dataclass

from . import ir
from .sim import SimResult

CELL_GAP_Y = 190
COMPACT_GAP_Y = 124
COLUMN_GAP_X = 230
MARGIN = 70
SOMA_R = 15
AXON_LEN = 52
DEND_BASE = 34
DEND_SCALE = 70.0


def _esc(text: str) -> str:
    return html.escape(str(text), quote=True)


def _is_inhibitory(model: ir.Model, instance_id: str) -> bool:
    cell_type = model.cell_type_of(instance_id)
    return "inhibitory" in cell_type.tags or cell_type.transmitter == "gaba"


@dataclass
class _Placed:
    """Клетка на холсте: центр сомы и геометрия отростков."""

    instance: str
    x: float
    y: float
    inhibitory: bool
    dendrites: dict[str, tuple[float, float, float, float]]  # id -> x1,y1,x2,y2
    axon_tip: tuple[float, float]

    def point_on(self, section: str, fraction: float) -> tuple[float, float]:
        if section not in self.dendrites:
            return self.x, self.y
        x1, y1, x2, y2 = self.dendrites[section]
        return x1 + (x2 - x1) * fraction, y1 + (y2 - y1) * fraction


def _levels(model: ir.Model) -> dict[str, int]:
    """Грубая раскладка по слоям: от входов вглубь, по прямым связям."""
    targets = {contact.post.instance for contact in model.contacts}
    roots = [name for name in model.instances if name not in targets]
    if not roots:
        roots = list(model.instances)[:1]

    level = {name: 0 for name in roots}
    changed = True
    guard = 0
    while changed and guard < len(model.instances) + 2:
        changed = False
        guard += 1
        for contact in model.contacts:
            pre, post = contact.pre.instance, contact.post.instance
            if pre not in level:
                continue
            candidate = level[pre] + 1
            if level.get(post, -1) < candidate:
                level[post] = candidate
                changed = True
    for name in model.instances:
        level.setdefault(name, 0)
    return level


def _place(model: ir.Model) -> tuple[dict[str, _Placed], float, float]:
    """Сигнал течёт слева направо: дендриты веером влево, аксон вправо.

    При такой раскладке связь «аксон одной клетки -- дендрит следующей» не
    пересекает сомы, а место контакта видно там, где оно и объявлено.
    """
    level = _levels(model)
    columns: dict[int, list[str]] = {}
    for name in model.instances:
        columns.setdefault(level[name], []).append(name)

    has_morphology = any(
        not model.cell_type_of(name).is_point for name in model.instances
    )
    gap_y = CELL_GAP_Y if has_morphology else COMPACT_GAP_Y
    tallest = max(len(names) for names in columns.values())
    placed: dict[str, _Placed] = {}
    for column, names in columns.items():
        centering = (tallest - len(names)) / 2 * gap_y
        for row, name in enumerate(names):
            x = column * COLUMN_GAP_X
            y = row * gap_y + centering
            morph = model.morphology_of(name)
            branches = [
                section
                for section in morph.sections.values()
                if section.kind == "dend"
            ]
            dendrites: dict[str, tuple[float, float, float, float]] = {}
            count = max(len(branches), 1)
            for index, section in enumerate(branches):
                # веер уводится вверх, чтобы ни одна ветвь не ложилась
                # на горизонталь и не путалась с линией связи
                spread = (
                    0.0 if count == 1 else (index / (count - 1) - 0.5) * 1.4
                ) - 0.3
                angle = math.pi + spread
                length = DEND_BASE + DEND_SCALE * min(section.length / 200.0, 2.0)
                dendrites[section.id] = (
                    x,
                    y,
                    x + math.cos(angle) * length,
                    y + math.sin(angle) * length,
                )
            placed[name] = _Placed(
                instance=name,
                x=x,
                y=y,
                inhibitory=_is_inhibitory(model, name),
                dendrites=dendrites,
                axon_tip=(x + AXON_LEN, y),
            )

    xs: list[float] = []
    ys: list[float] = []
    for cell in placed.values():
        xs += [cell.x - SOMA_R, cell.axon_tip[0]]
        ys += [cell.y - SOMA_R - 16, cell.y + SOMA_R + 20]
        for x1, y1, x2, y2 in cell.dendrites.values():
            xs += [x1, x2]
            ys += [y1, y2]

    offset_x, offset_y = MARGIN - min(xs), MARGIN - min(ys)
    for name, cell in placed.items():
        placed[name] = _Placed(
            instance=cell.instance,
            x=cell.x + offset_x,
            y=cell.y + offset_y,
            inhibitory=cell.inhibitory,
            dendrites={
                key: (x1 + offset_x, y1 + offset_y, x2 + offset_x, y2 + offset_y)
                for key, (x1, y1, x2, y2) in cell.dendrites.items()
            },
            axon_tip=(cell.axon_tip[0] + offset_x, cell.axon_tip[1] + offset_y),
        )

    width = max(xs) - min(xs) + MARGIN * 2
    height = max(ys) - min(ys) + MARGIN * 2
    return placed, width, height


def circuit_svg(model: ir.Model) -> str:
    placed, width, height = _place(model)
    parts: list[str] = [
        f'<svg class="circuit" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'role="img" aria-label="Схема микросхемы">',
        '<defs>'
        '<marker id="exc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
        'markerHeight="6" orient="auto-start-reverse">'
        '<path d="M0,0 L10,5 L0,10 z" class="exc-fill"/></marker>'
        '<marker id="inh" viewBox="0 0 10 10" refX="4" refY="5" markerWidth="7" '
        'markerHeight="7" orient="auto-start-reverse">'
        '<path d="M2,0 L2,10" class="inh-stroke"/></marker>'
        '</defs>',
    ]

    for name, cell in placed.items():
        for x1, y1, x2, y2 in cell.dendrites.values():
            parts.append(
                f'<line class="dend" x1="{x1:.1f}" y1="{y1:.1f}" '
                f'x2="{x2:.1f}" y2="{y2:.1f}"/>'
            )
        parts.append(
            f'<line class="axon" x1="{cell.x:.1f}" y1="{cell.y:.1f}" '
            f'x2="{cell.axon_tip[0]:.1f}" y2="{cell.axon_tip[1]:.1f}"/>'
        )

    for contact in model.contacts:
        pre = placed[contact.pre.instance]
        post = placed[contact.post.instance]
        start = pre.axon_tip
        end = post.point_on(contact.post.section, contact.post.fraction)
        forward = end[0] > start[0]
        bow = 26.0 if forward else 0.55 * CELL_GAP_Y  # обратная связь обходит снизу
        control = (
            (start[0] + end[0]) / 2,
            (start[1] + end[1]) / 2 + (bow if not forward else -bow),
        )
        klass = "inh" if contact.receptor.startswith("gaba") else "exc"
        marker = "inh" if klass == "inh" else "exc"
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
        parts.append(
            f'<path class="edge {klass}" marker-end="url(#{marker})" '
            f'd="M{start[0]:.1f},{start[1]:.1f} Q{control[0]:.1f},{control[1]:.1f} '
            f'{end[0]:.1f},{end[1]:.1f}"><title>{_esc(tooltip)}</title></path>'
        )
        if contact.post.section != "soma":
            parts.append(
                f'<circle class="bouton {klass}-fill" cx="{end[0]:.1f}" '
                f'cy="{end[1]:.1f}" r="4.5"><title>{_esc(tooltip)}</title></circle>'
            )

    for modulator in model.modulators.values():
        governed = [
            contact
            for contact in model.contacts
            if contact.plasticity.modulator == modulator.id
        ]
        for source in modulator.sources:
            for contact in governed:
                start = placed[source].axon_tip
                end = placed[contact.post.instance].point_on(
                    contact.post.section, contact.post.fraction
                )
                control = ((start[0] + end[0]) / 2 + 40, (start[1] + end[1]) / 2)
                parts.append(
                    f'<path class="edge mod" d="M{start[0]:.1f},{start[1]:.1f} '
                    f'Q{control[0]:.1f},{control[1]:.1f} {end[0]:.1f},{end[1]:.1f}">'
                    f"<title>{_esc(modulator.transmitter)} от {_esc(source)} "
                    f"управляет контактом {_esc(contact.id)}</title></path>"
                )

    for name, cell in placed.items():
        cell_type = model.cell_type_of(name)
        shape = (
            f'<rect class="soma inh-cell" x="{cell.x - SOMA_R:.1f}" '
            f'y="{cell.y - SOMA_R:.1f}" width="{SOMA_R * 2}" height="{SOMA_R * 2}" '
            f'rx="4"/>'
            if cell.inhibitory
            else f'<circle class="soma exc-cell" cx="{cell.x:.1f}" '
            f'cy="{cell.y:.1f}" r="{SOMA_R}"/>'
        )
        parts.append(
            f'<g><title>{_esc(name)} — {_esc(cell_type.id)}</title>{shape}'
            f'<text class="cell-name" x="{cell.x:.1f}" y="{cell.y + 5:.1f}">'
            f'{_esc(name)}</text>'
            f'<text class="cell-type" x="{cell.x + SOMA_R + 6:.1f}" '
            f'y="{cell.y + SOMA_R + 14:.1f}">'
            f'{_esc(cell_type.id)}</text></g>'
        )

    parts.append("</svg>")
    return "".join(parts)


def raster_svg(model: ir.Model, result: SimResult) -> str:
    names = list(model.instances)
    row_height = 26
    width, left = 760, 54
    height = row_height * len(names) + 34
    duration = model.run.duration
    parts = [
        f'<svg class="raster" viewBox="0 0 {width} {height}" role="img" '
        f'aria-label="Растр спайков">'
    ]
    for index, name in enumerate(names):
        y = 14 + index * row_height
        parts.append(
            f'<text class="row-label" x="{left - 10}" y="{y + 12}">{_esc(name)}</text>'
        )
        parts.append(
            f'<line class="row-base" x1="{left}" y1="{y + 9}" '
            f'x2="{width - 16}" y2="{y + 9}"/>'
        )
        klass = "inh" if _is_inhibitory(model, name) else "exc"
        for time in result.spikes.get(name, []):
            x = left + (time / duration) * (width - left - 16)
            parts.append(
                f'<line class="spike {klass}-stroke" x1="{x:.1f}" y1="{y}" '
                f'x2="{x:.1f}" y2="{y + 18}"/>'
            )
    parts.append(
        f'<text class="axis" x="{left}" y="{height - 6}">0</text>'
        f'<text class="axis end" x="{width - 16}" y="{height - 6}">{duration:g} мс</text>'
        "</svg>"
    )
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
        f'<text class="axis" x="6" y="20">{high:.3g}</text>'
        f'<text class="axis" x="6" y="{height - bottom + 4}">{low:.3g}</text>'
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
.row-label { text-anchor: end; font-size: 12px; fill: var(--muted); }
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


def render(model: ir.Model, result: SimResult) -> str:
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
<section>{circuit_svg(model)}
<div class="legend"><span class="e">возбуждающий контакт</span>
<span class="i">тормозный контакт</span>
<span class="m">нейромодулятор</span>
<span>круг — возбуждающая клетка, квадрат — тормозная</span>
<span>серое: дендриты слева веером, аксон справа пунктиром</span>
<span>точка на ветви — место контакта</span></div>
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
