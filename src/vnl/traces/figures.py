"""Фигуры по видам записей: потенциал, проводимость, вес, спайки.

Каждый вид -- своя подача. Название и единицы берутся из реестра величин в
ядре (`ir.RECORDED`): это знание предметной области, и оно нужно не только
графику, но и выгрузке в JSON.
"""

from __future__ import annotations

from .. import ir
from ..render_util import esc
from .geometry import VB_H, VB_W, Frame, baseline, levels_html, path_d
from .scales import digits_for, fmt, value_scale


def figure(
    key: str,
    kind: str,
    stat: str,
    plot_class: str,
    svg_body: str,
    overlay: str,
    levels: str,
) -> str:
    variable = ir.RECORDED.get(kind)
    title = variable.name if variable else kind
    unit = variable.unit if variable else ""
    caption = f"{title}, {unit}" if unit else title
    return (
        '<figure class="tr-fig">'
        f'<figcaption class="tr-head">'
        f'<span class="tr-name">{esc(key)}</span>'
        f'<span class="tr-kind">{esc(caption)}</span>'
        f'<span class="tr-stat">{stat}</span>'
        "</figcaption>"
        '<div class="tr-row">'
        f'<div class="tr-ygut">{levels}</div>'
        f'<div class="tr-plot {plot_class}">'
        f'<svg class="tr-canvas" viewBox="0 0 {VB_W:.0f} {VB_H:.0f}" '
        f'preserveAspectRatio="none" role="img" '
        f'aria-label="Трасса {esc(key)}">{svg_body}</svg>'
        f"{overlay}</div></div></figure>"
    )


def threshold_on_scale(
    points: list[tuple[float, float]], threshold: float | None
) -> bool:
    """Порог берём в шкалу, только если клетка вообще ходила рядом с ним.

    Иначе (порог -20 мВ при трассе около -63) он расплющил бы кривую в
    прямую у нижнего края, и график перестал бы что-либо показывать.
    """
    if threshold is None:
        return False
    raw = [value for _, value in points]
    lo, hi = min(raw), max(raw)
    reach = max(hi - lo, 5.0)
    return lo - reach <= threshold <= hi + reach


def voltage_figure(
    frame: Frame,
    key: str,
    points: list[tuple[float, float]],
    threshold: float | None,
    scale: tuple[float, float, list[float]] | None = None,
) -> str:
    """Потенциал: шкала в мВ плюс тонкая линия порога -- без неё не видно,
    насколько близко клетка подходила к разряду."""
    raw = [value for _, value in points]
    lo, hi = min(raw), max(raw)
    on_scale = threshold_on_scale(points, threshold)
    if on_scale and threshold is not None:
        lo, hi = min(lo, threshold), max(hi, threshold)
    low, high, levels = scale or value_scale(lo, hi, target_ticks=3)
    digits = digits_for(levels[1] - levels[0]) if len(levels) > 1 else 1

    body = [frame.grid()]
    for level in levels:
        y = (high - level) / (high - low) * VB_H
        body.append(
            f'<line class="tr-gridy" x1="0" y1="{y:.2f}" '
            f'x2="{VB_W:.0f}" y2="{y:.2f}"/>'
        )
    overlay = ""
    if on_scale and threshold is not None:
        y = (high - threshold) / (high - low) * VB_H
        body.append(
            f'<line class="tr-threshold" x1="0" y1="{y:.2f}" '
            f'x2="{VB_W:.0f}" y2="{y:.2f}"/>'
        )
        # У самого верха шкалы подпись ушла бы в шапку графика -- в этом
        # случае кладём её под линию порога.
        where = "tr-thr-label tr-thr-under" if y < 18 else "tr-thr-label"
        overlay = (
            f'<span class="{where}" style="top:{y:.2f}%">'
            f"порог {fmt(threshold, 1)} мВ</span>"
        )
    line = path_d(frame, points, low, high)
    body.append(f'<path class="tr-line tr-line-v" d="{line}"/>')

    stat = (
        f'<span class="tr-num">{fmt(min(raw), 1)}</span>'
        f'<span class="tr-dim"> … </span>'
        f'<span class="tr-num">{fmt(max(raw), 1)}</span>'
        f'<span class="tr-dim"> мВ</span>'
    )
    if threshold is not None and not on_scale:
        stat += (
            f'<span class="tr-dim"> · порог </span>'
            f'<span class="tr-num">{fmt(threshold, 1)}</span>'
            f'<span class="tr-dim"> мВ вне шкалы</span>'
        )
    return figure(
        key,
        "v",
        stat,
        "tr-plot-v",
        "".join(body),
        overlay,
        levels_html(levels, low, high, digits),
    )


def conductance_figure(
    frame: Frame,
    key: str,
    points: list[tuple[float, float]],
    kind: str = "g",
) -> str:
    """Проводимость: всегда от нуля и с заливкой -- всплеск должен читаться
    как масса над нулём, а не как очередная ломаная."""
    raw = [value for _, value in points]
    low, high, levels = value_scale(min(raw), max(raw), include_zero=True)
    digits = digits_for(levels[1] - levels[0]) if len(levels) > 1 else 2

    line = path_d(frame, points, low, high)
    zero_y = (high - 0.0) / (high - low) * VB_H
    area = (
        f"{line} L{frame.x(points[-1][0]):.1f},{zero_y:.2f} "
        f"L{frame.x(points[0][0]):.1f},{zero_y:.2f} Z"
    )
    body = [frame.grid()]
    for level in levels:
        y = (high - level) / (high - low) * VB_H
        body.append(
            f'<line class="tr-gridy" x1="0" y1="{y:.2f}" '
            f'x2="{VB_W:.0f}" y2="{y:.2f}"/>'
        )
    # Возбуждение и торможение красим по смыслу: их и смотрят в паре,
    # а одинаковый цвет заставлял бы каждый раз перечитывать подпись.
    tone = {"g_exc": " tr-tone-exc", "g_inh": " tr-tone-inh"}.get(kind, "")
    body.append(f'<path class="tr-area{tone}" d="{area}"/>')
    body.append(f'<path class="tr-line tr-line-g{tone}" d="{line}"/>')
    body.append(baseline(low, high))

    stat = (
        f'<span class="tr-dim">макс </span>'
        f'<span class="tr-num">{fmt(max(raw), 2)}</span>'
        f'<span class="tr-dim"> нСм</span>'
    )
    return figure(
        key,
        kind,
        stat,
        "tr-plot-g",
        "".join(body),
        "",
        levels_html(levels, low, high, digits),
    )


def weight_figure(
    frame: Frame,
    key: str,
    points: list[tuple[float, float]],
    first: float,
    last: float,
) -> str:
    """Вес: медленный дрейф. Смысл -- насколько он уехал, поэтому уровень
    старта нарисован пунктиром, а разница подписана числом."""
    raw = [value for _, value in points]
    low, high, levels = value_scale(min(raw), max(raw), include_zero=True)
    digits = digits_for(levels[1] - levels[0]) if len(levels) > 1 else 2
    span = high - low

    body = [frame.grid()]
    for level in levels:
        y = (high - level) / span * VB_H
        body.append(
            f'<line class="tr-gridy" x1="0" y1="{y:.2f}" '
            f'x2="{VB_W:.0f}" y2="{y:.2f}"/>'
        )
    start_y = (high - first) / span * VB_H
    body.append(
        f'<line class="tr-start" x1="0" y1="{start_y:.2f}" '
        f'x2="{VB_W:.0f}" y2="{start_y:.2f}"/>'
    )
    curve = path_d(frame, points, low, high)
    body.append(f'<path class="tr-line tr-line-w" d="{curve}"/>')
    body.append(baseline(low, high))

    delta = last - first
    sign = "+" if delta >= 0 else "−"
    stat = (
        f'<span class="tr-dim">было </span>'
        f'<span class="tr-num">{fmt(first, 2)}</span>'
        f'<span class="tr-dim"> → стало </span>'
        f'<span class="tr-num">{fmt(last, 2)}</span>'
        f'<span class="tr-dim"> нСм · </span>'
        f'<span class="tr-num">{sign}{fmt(abs(delta), 2)}</span>'
    )
    return figure(
        key,
        "w",
        stat,
        "tr-plot-w",
        "".join(body),
        "",
        levels_html(levels, low, high, digits),
    )


def spikes_figure(
    frame: Frame, key: str, moments: list[float], inhibitory: bool
) -> str:
    """Спайки: бинарная величина. Ломаная тут врёт (рисует «полку» между
    событиями), поэтому рисуем штрихи -- по одному на разряд."""
    klass = "tr-spike-inh" if inhibitory else "tr-spike-exc"
    body = [frame.grid(), f'<line class="tr-zero" x1="0" y1="{VB_H:.0f}" '
            f'x2="{VB_W:.0f}" y2="{VB_H:.0f}"/>']
    body.extend(
        f'<line class="tr-spike {klass}" x1="{frame.x(moment):.1f}" y1="8" '
        f'x2="{frame.x(moment):.1f}" y2="{VB_H:.0f}"/>'
        for moment in moments
    )
    stat = (
        f'<span class="tr-num">{len(moments)}</span>'
        f'<span class="tr-dim"> разрядов</span>'
    )
    return figure(key, "spikes", stat, "tr-plot-spikes", "".join(body), "", "")
