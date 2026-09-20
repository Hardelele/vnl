"""Сборка страницы прогона.

Здесь только схема и склейка блоков. Оформление живёт в theme, активность
сети -- в timeline, графики -- в traces; раскладку схемы считает layout.
"""

from __future__ import annotations

import math

from . import ir, protocols, theme, timeline, traces
from .layout import SOMA_R, LayoutResult, layout
from .render_util import esc
from .sim import SimResult


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
            f"<title>{esc(tooltip)}</title></path>"
        )
        if not on_soma:
            end = route.end
            parts.append(
                f'<circle class="bouton {klass}-fill" cx="{end[0]:.1f}" '
                f'cy="{end[1]:.1f}" r="4.5"><title>{esc(tooltip)}</title></circle>'
            )

    for modulator in model.modulators.values():
        for route_id, route in placement.routes.items():
            if not route_id.startswith(f"mod:{modulator.id}:"):
                continue
            _, _, source, contact_id = route_id.split(":", 3)
            parts.append(
                f'<path class="edge mod" d="{_rounded_path(route.points)}">'
                f"<title>{esc(modulator.transmitter)} от {esc(source)} "
                f"управляет контактом {esc(contact_id)}</title></path>"
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
            f'<g><title>{esc(name)} — {esc(geometry.cell_type)}</title>{shape}'
            f'<text class="cell-name" x="{x:.1f}" y="{y + 5:.1f}">{esc(name)}</text>'
            f'<text class="cell-type" x="{x + SOMA_R + 6:.1f}" '
            f'y="{y + SOMA_R + 14:.1f}">{esc(geometry.cell_type)}</text></g>'
        )

    parts.append("</svg>")
    return "".join(parts)

CIRCUIT_STYLE = """
.dend { stroke: var(--muted); stroke-width: 2.4; stroke-linecap: round; opacity: .55; }
.axon { stroke: var(--muted); stroke-width: 1.6; stroke-dasharray: 3 3; opacity: .7; }
.edge { fill: none; stroke-width: 1.9; opacity: .9; }
.edge.exc { stroke: var(--exc); }
.edge.inh { stroke: var(--inh); }
.edge.mod { stroke: var(--mod); stroke-dasharray: 6 4; opacity: .85; }
.exc-fill { fill: var(--exc); }
.inh-stroke { stroke: var(--inh); stroke-width: 2.4; }
.bouton.exc-fill { fill: var(--exc); }
.bouton.inh-fill { fill: var(--inh); }
.soma { fill: var(--panel); stroke-width: 2; }
.exc-cell { stroke: var(--exc); }
.inh-cell { stroke: var(--inh); }
.cell-name { text-anchor: middle; font-size: 12px; font-weight: 600; fill: var(--ink); }
.cell-type { font-size: 10px; fill: var(--muted); }
"""


def border_html(model: ir.Model, result: SimResult) -> str:
    """Блок «Граница с миром»: сенсоры и моторы словами и числами.

    Отдельной секцией, а не строкой под схемой: сенсор на схеме не нарисован --
    он не клетка, и рисовать его пришлось бы новым видом фигуры, который в
    раскладке ELK ничему не соответствует. Но промолчать о нём нельзя: по
    схеме видно, что клетку кто-то гонит, и непонятно, кто именно.

    Пусто -- секции нет вовсе. Отчёт схемы без границы обязан остаться ровно
    таким, каким был: библиотека считается прежними числами и печатается
    прежними страницами.
    """
    if not model.sensors and not model.motors:
        return ""

    items: list[str] = []
    for sensor in model.sensors.values():
        where = (
            ", ".join(
                f"{link.target} через {link.receptor}, {link.weight:g} нСм, "
                f"{link.delay:g} мс"
                for link in sensor.targets
            )
            or "ни к чему не подключён"
        )
        items.append(
            f"<li><b>сенсор {esc(sensor.id)}</b> — "
            f"{esc(protocols.describe_sensor(sensor))}; вход идёт в "
            f"{esc(where)}</li>"
        )
    for motor in model.motors.values():
        value = result.motors.get(motor.id)
        # Число -- на конец прогона, и сказано это прямо: величина мотора
        # меряется окном, а не всем прогоном, и «20 Гц» без «на 300-й
        # миллисекунде» читалось бы как средняя частота за весь опыт.
        tail = (
            f"; на {model.run.duration:g} мс — {value:g} "
            f"{esc(protocols.motor_unit(motor))}"
            if value is not None
            else ""
        )
        items.append(
            f"<li><b>мотор {esc(motor.id)}</b> — "
            f"{esc(protocols.describe_motor(motor))}, смотрит на "
            f"{esc(str(motor.source))}{tail}</li>"
        )

    return (
        "<h2>Граница с миром</h2><section><ul class='notes'>"
        + "".join(items)
        + "</ul><p class='sub note'>Сенсор ждёт величину снаружи: без неё он "
        "молчит, а не выдумывает себе вход. Мотор отдаёт наружу число, а не "
        "список спайков.</p></section>"
    )


def render(
    model: ir.Model,
    result: SimResult,
    placement: LayoutResult | None = None,
) -> str:
    placement = placement or layout(model)

    layout_note = "".join(
        f"<p class='sub note'>{esc(note)}</p>" for note in placement.notes
    )
    degradation = (
        "<h2>Деградация L2 → L1</h2><section><ul class='notes'>"
        + "".join(f"<li>{esc(note)}</li>" for note in result.degradation)
        + "</ul></section>"
        if result.degradation
        else ""
    )

    body = f"""<main>
<h1>{esc(model.name)}</h1>
<p class="sub">{esc(model.source or "модель VNL")} · уровень {model.run.level} ·
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

{border_html(model, result)}

{timeline.render(model, result)}

{traces.render(model, result)}

{degradation}
</main>"""

    style = theme.BASE_CSS + CIRCUIT_STYLE + timeline.STYLE + traces.STYLE
    return theme.document(f"{esc(model.name)} — прогон VNL", style, body)
