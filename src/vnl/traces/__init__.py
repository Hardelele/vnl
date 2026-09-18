"""Блок «Трассы»: подробные записи величин по общей оси времени.

Четыре вида записей -- разной природы, поэтому и подача разная: потенциал
читают относительно порога, проводимость -- относительно нуля, вес -- по
разнице начала и конца, спайки -- это вообще не кривая, а моменты времени.
Рисовать их одинаковой ломаной значит прятать смысл.

Геометрия собрана из двух слоёв: SVG тянется по ширине (preserveAspectRatio
"none", штрихи non-scaling), а все подписи -- обычный HTML поверх него.
Так текст не уезжает в нечитаемый размер на узком экране, а кривая всё
равно занимает всю доступную ширину.

Здесь только сборка блока. Арифметика шкал -- в scales, прореживание -- в
sampling, рамка и ось -- в geometry, фигуры -- в figures, курсор -- в
scrub, оформление -- в style.
"""

from __future__ import annotations

from .. import ir
from ..render_util import is_inhibitory
from ..sim import SimResult
from .figures import (
    conductance_figure,
    spikes_figure,
    threshold_on_scale,
    voltage_figure,
    weight_figure,
)
from .geometry import Frame, time_axis
from .sampling import COLUMNS, downsample_minmax, spike_times
from .scales import value_scale
from .scrub import SCRUB_ZONES, scrub
from .style import STYLE

__all__ = [
    "COLUMNS",
    "SCRUB_ZONES",
    "STYLE",
    "downsample_minmax",
    "render",
    "spike_times",
    "value_scale",
]


def threshold_of(model: ir.Model, instance: str) -> float | None:
    try:
        return model.cell_type_of(instance).point_model.v_threshold
    except KeyError:
        return None


def shared_voltage_scale(
    prepared: list[tuple[str, str, list[tuple[float, float]], float | None]]
) -> tuple[float, float, list[float]] | None:
    """Одна шкала мВ на все потенциалы, если это никого не расплющит.

    Трассы читают друг под другом, и разные шкалы у соседних клеток врут
    глазу: одинаковая рябь выглядит разной. Но общая шкала полезна лишь
    пока размах клеток сопоставим -- иначе тихая клетка превратится в
    прямую линию, и мы отказываемся от общей шкалы.
    """
    spans, lows, highs = [], [], []
    for _, kind, points, threshold in prepared:
        if kind not in ("v", ""):
            continue
        raw = [value for _, value in points]
        lo, hi = min(raw), max(raw)
        spans.append(hi - lo)
        if threshold_on_scale(points, threshold) and threshold is not None:
            lo, hi = min(lo, threshold), max(hi, threshold)
        lows.append(lo)
        highs.append(hi)
    if len(spans) < 2:
        return None
    union = max(highs) - min(lows)
    if union > 2.0 * max(max(spans), 1e-9):
        return None
    return value_scale(min(lows), max(highs), target_ticks=3)


def render(model: ir.Model, result: SimResult) -> str:
    """Блок целиком: заголовок, фигуры по записям и общая ось времени."""
    frame = Frame(model.run.duration)
    figures: list[str] = []

    prepared: list[tuple[str, str, list[tuple[float, float]], float | None]] = []
    for key, values in result.traces.items():
        if not values:
            continue
        head, _, kind = key.partition(":")
        if kind in ("v", ""):
            points = downsample_minmax(result.times[: len(values)], values)
            prepared.append(
                (head, kind, points, threshold_of(model, head.split(".")[0]))
            )
    voltage_scale = shared_voltage_scale(prepared)

    # Ряды для скраббера: строка курсора должна перечислять все записи в
    # том же порядке, в каком они нарисованы.
    series: list[tuple[str, str, list[float]]] = []

    for key, values in result.traces.items():
        if not values:
            continue
        times = result.times[: len(values)]
        head, _, kind = key.partition(":")
        instance = head.split(".")[0]
        series.append((instance + _SCRUB_MARK.get(kind, " " + kind), kind, values))

        if kind == "spikes":
            figures.append(
                spikes_figure(
                    frame,
                    head,
                    spike_times(times, values),
                    is_inhibitory(model, instance),
                )
            )
            continue

        points = downsample_minmax(times, values)
        if kind in ("g", "g_exc", "g_inh"):
            figures.append(conductance_figure(frame, head, points, kind))
        elif kind == "w":
            figures.append(weight_figure(frame, head, points, values[0], values[-1]))
        else:
            figures.append(
                voltage_figure(
                    frame,
                    head,
                    points,
                    threshold_of(model, instance),
                    voltage_scale,
                )
            )

    if not figures:
        return (
            "<h2>Трассы</h2>"
            "<section><p class='sub'>записей нет</p></section>"
        )

    return (
        "<h2>Трассы</h2>"
        '<section class="tr-card"><div class="tr-block">'
        '<div class="tr-bar"></div>'
        + "".join(figures)
        + time_axis(frame)
        + scrub(frame, series)
        + "</div></section>"
    )
