"""Блок «Трассы»: подробные записи величин по общей оси времени.

Четыре вида записей -- разной природы, поэтому и подача разная: потенциал
читают относительно порога, проводимость -- относительно нуля, вес -- по
разнице начала и конца, спайки -- это вообще не кривая, а моменты времени.
Рисовать их одинаковой ломаной значит прятать смысл.

Геометрия собрана из двух слоёв: SVG тянется по ширине (preserveAspectRatio
"none", штрихи non-scaling), а все подписи -- обычный HTML поверх него.
Так текст не уезжает в нечитаемый размер на узком экране, а кривая всё
равно занимает всю доступную ширину.
"""

from __future__ import annotations

import math

from . import ir
from .render_util import esc, is_inhibitory, nice_step
from .sim import SimResult

# Внутренняя система координат SVG: ширина и высота условные, реальный
# размер задаёт CSS. Числа круглые, чтобы проценты подписей и координаты
# путей считались в одной шкале.
VB_W = 1000.0
VB_H = 100.0

# Сколько столбцов оставляем после прореживания. Это примерно ширина блока
# в пикселях: больше точек глаз всё равно не различит, а вес страницы растёт.
COLUMNS = 280

# Название и единицы каждого вида записи -- подпись обязана говорить, что
# это за величина, иначе график читается как абстрактная загогулина.
KINDS: dict[str, tuple[str, str]] = {
    "v": ("мембранный потенциал", "мВ"),
    "g": ("синаптическая проводимость", "нСм"),
    "g_exc": ("возбуждающая проводимость", "нСм"),
    "g_inh": ("тормозная проводимость", "нСм"),
    "w": ("суммарный вес пластичных входов", "нСм"),
    "spikes": ("спайки", ""),
}


# --- мелкая арифметика подписей ------------------------------------------


def _minus(text: str) -> str:
    """Типографский минус: в колонке цифр дефис выглядит как мусор."""
    return text.replace("-", "−")


def _fmt(value: float, digits: int) -> str:
    return _minus(f"{value:.{digits}f}")


def _digits_for(step: float) -> int:
    """Сколько знаков нужно, чтобы соседние уровни не слиплись в одно число."""
    if step >= 10:
        return 0
    if step >= 1:
        return 0 if abs(step - round(step)) < 1e-9 else 1
    return min(4, max(1, int(math.ceil(-math.log10(step))) + 1))


def value_scale(
    low: float,
    high: float,
    *,
    include_zero: bool = False,
    target_ticks: int = 3,
) -> tuple[float, float, list[float]]:
    """Круглые границы шкалы и подписанные уровни внутри неё.

    Край-край подписи (как было раньше) ничего не говорят: у каждой трассы
    свои «−69.7…−43.2», сравнить их между собой нельзя. Круглый шаг из
    nice_step даёт уровни, которые совпадают у соседних графиков.
    """
    if include_zero:
        low, high = min(low, 0.0), max(high, 0.0)
    if high - low < 1e-9:
        high = low + 1.0
    step = nice_step(high - low, target_ticks)
    bottom = math.floor(low / step + 1e-9) * step
    top = math.ceil(high / step - 1e-9) * step
    if top - bottom < step:
        top = bottom + step
    levels: list[float] = []
    index = 0
    while bottom + index * step <= top + 1e-9:
        levels.append(round(bottom + index * step, 10))
        index += 1
    return bottom, top, levels


# --- прореживание ---------------------------------------------------------


def downsample_minmax(
    times: list[float], values: list[float], columns: int = COLUMNS
) -> list[tuple[float, float]]:
    """Прореживание по столбцам с сохранением минимума и максимума.

    Обычное «брать каждую n-ю точку» съедает всплески: спайк живёт пару
    отсчётов и просто не попадает в выборку. Поэтому на каждый столбец по
    оси X берём и минимум, и максимум, и выдаём их в том порядке, в каком
    они встретились -- форма фронта сохраняется, экстремум не теряется.
    """
    count = len(values)
    if count == 0:
        return []
    if count <= columns * 2:
        return list(zip(times, values))

    out: list[tuple[float, float]] = []
    for column in range(columns):
        start = column * count // columns
        stop = max(start + 1, (column + 1) * count // columns)
        lo_index = hi_index = start
        for index in range(start, stop):
            if values[index] < values[lo_index]:
                lo_index = index
            if values[index] > values[hi_index]:
                hi_index = index
        first, second = sorted((lo_index, hi_index))
        out.append((times[first], values[first]))
        if second != first:
            out.append((times[second], values[second]))
    return out


def spike_times(times: list[float], values: list[float]) -> list[float]:
    """Моменты спайков: интересен фронт 0→1, а не то, сколько шагов держалась 1."""
    out: list[float] = []
    previous = 0.0
    for time, value in zip(times, values):
        if value >= 0.5 > previous:
            out.append(time)
        previous = value
    return out


# --- геометрия одного графика --------------------------------------------


class _Frame:
    """Общая рамка блока: одна ось времени на все графики.

    Графики читают друг под другом, поэтому сетка по X обязана совпадать
    до пикселя -- значит, считается один раз и раздаётся всем.
    """

    def __init__(self, duration: float) -> None:
        self.duration = duration if duration > 0 else 1.0
        self.ticks: list[float] = []
        step = nice_step(self.duration)
        tick = 0.0
        while tick <= self.duration + 1e-9:
            self.ticks.append(round(tick, 10))
            tick += step

    def x(self, time: float) -> float:
        share = min(max(time, 0.0), self.duration) / self.duration
        return share * VB_W

    def grid(self) -> str:
        return "".join(
            f'<line class="tr-gridx" x1="{self.x(tick):.1f}" y1="0" '
            f'x2="{self.x(tick):.1f}" y2="{VB_H:.0f}"/>'
            for tick in self.ticks
        )


def _path(
    frame: _Frame, points: list[tuple[float, float]], low: float, high: float
) -> str:
    span = high - low or 1.0

    # Точность обрезаем сознательно: 0.1 условной единицы -- это заметно
    # меньше пикселя на любой реальной ширине, а в байтах разница кратная.
    coords: list[str] = []
    for time, value in points:
        pair = f"{frame.x(time):.1f},{(high - value) / span * VB_H:.1f}"
        if not coords or coords[-1] != pair:
            coords.append(pair)
    return "M" + " L".join(coords)


def _levels_html(levels: list[float], low: float, high: float, digits: int) -> str:
    span = high - low or 1.0
    return "".join(
        f'<span class="tr-lvl" style="top:{(high - level) / span * 100:.2f}%">'
        f"{_fmt(level, digits)}</span>"
        for level in levels
    )


def _baseline(low: float, high: float) -> str:
    """Ноль отдельной линией: для проводимости и веса это опора отсчёта."""
    if not (low <= 0.0 <= high):
        return ""
    y = (high - 0.0) / (high - low or 1.0) * VB_H
    return f'<line class="tr-zero" x1="0" y1="{y:.2f}" x2="{VB_W:.0f}" y2="{y:.2f}"/>'


# --- фигуры по видам записей ---------------------------------------------


def _figure(
    key: str,
    kind: str,
    stat: str,
    plot_class: str,
    svg_body: str,
    overlay: str,
    levels: str,
) -> str:
    title, unit = KINDS.get(kind, (kind, ""))
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


def _threshold_on_scale(
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


def _voltage_figure(
    frame: _Frame,
    key: str,
    points: list[tuple[float, float]],
    threshold: float | None,
    scale: tuple[float, float, list[float]] | None = None,
) -> str:
    """Потенциал: шкала в мВ плюс тонкая линия порога -- без неё не видно,
    насколько близко клетка подходила к разряду."""
    raw = [value for _, value in points]
    lo, hi = min(raw), max(raw)
    on_scale = _threshold_on_scale(points, threshold)
    if on_scale and threshold is not None:
        lo, hi = min(lo, threshold), max(hi, threshold)
    low, high, levels = scale or value_scale(lo, hi, target_ticks=3)
    digits = _digits_for(levels[1] - levels[0]) if len(levels) > 1 else 1

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
            f"порог {_fmt(threshold, 1)} мВ</span>"
        )
    line = _path(frame, points, low, high)
    body.append(f'<path class="tr-line tr-line-v" d="{line}"/>')

    stat = (
        f'<span class="tr-num">{_fmt(min(raw), 1)}</span>'
        f'<span class="tr-dim"> … </span>'
        f'<span class="tr-num">{_fmt(max(raw), 1)}</span>'
        f'<span class="tr-dim"> мВ</span>'
    )
    if threshold is not None and not on_scale:
        stat += (
            f'<span class="tr-dim"> · порог </span>'
            f'<span class="tr-num">{_fmt(threshold, 1)}</span>'
            f'<span class="tr-dim"> мВ вне шкалы</span>'
        )
    return _figure(
        key,
        "v",
        stat,
        "tr-plot-v",
        "".join(body),
        overlay,
        _levels_html(levels, low, high, digits),
    )


def _conductance_figure(
    frame: _Frame,
    key: str,
    points: list[tuple[float, float]],
    kind: str = "g",
) -> str:
    """Проводимость: всегда от нуля и с заливкой -- всплеск должен читаться
    как масса над нулём, а не как очередная ломаная."""
    raw = [value for _, value in points]
    low, high, levels = value_scale(min(raw), max(raw), include_zero=True)
    digits = _digits_for(levels[1] - levels[0]) if len(levels) > 1 else 2

    line = _path(frame, points, low, high)
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
    body.append(_baseline(low, high))

    stat = (
        f'<span class="tr-dim">макс </span>'
        f'<span class="tr-num">{_fmt(max(raw), 2)}</span>'
        f'<span class="tr-dim"> нСм</span>'
    )
    return _figure(
        key,
        kind,
        stat,
        "tr-plot-g",
        "".join(body),
        "",
        _levels_html(levels, low, high, digits),
    )


def _weight_figure(
    frame: _Frame,
    key: str,
    points: list[tuple[float, float]],
    first: float,
    last: float,
) -> str:
    """Вес: медленный дрейф. Смысл -- насколько он уехал, поэтому уровень
    старта нарисован пунктиром, а разница подписана числом."""
    raw = [value for _, value in points]
    low, high, levels = value_scale(min(raw), max(raw), include_zero=True)
    digits = _digits_for(levels[1] - levels[0]) if len(levels) > 1 else 2
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
    curve = _path(frame, points, low, high)
    body.append(f'<path class="tr-line tr-line-w" d="{curve}"/>')
    body.append(_baseline(low, high))

    delta = last - first
    sign = "+" if delta >= 0 else "−"
    stat = (
        f'<span class="tr-dim">было </span>'
        f'<span class="tr-num">{_fmt(first, 2)}</span>'
        f'<span class="tr-dim"> → стало </span>'
        f'<span class="tr-num">{_fmt(last, 2)}</span>'
        f'<span class="tr-dim"> нСм · </span>'
        f'<span class="tr-num">{sign}{_fmt(abs(delta), 2)}</span>'
    )
    return _figure(
        key,
        "w",
        stat,
        "tr-plot-w",
        "".join(body),
        "",
        _levels_html(levels, low, high, digits),
    )


def _spikes_figure(
    frame: _Frame, key: str, moments: list[float], inhibitory: bool
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
    return _figure(key, "spikes", stat, "tr-plot-spikes", "".join(body), "", "")


# Сколько зон у скраббера. Каждая зона несёт заранее посчитанную строку
# значений, поэтому число -- компромисс между шагом курсора и весом страницы.
SCRUB_ZONES = 80

# Короткая пометка вида величины в строке курсора: без неё две записи с
# одной клетки (v и g) читаются как одно и то же число.
_SCRUB_MARK = {
    "v": "",
    "spikes": "",
    "g": " g",
    "g_exc": " g+",
    "g_inh": " g−",
    "w": " w",
}
_SCRUB_DIGITS = {"v": 1, "g": 2, "g_exc": 2, "g_inh": 2, "w": 2}


def _scrub_value(
    kind: str, values: list[float], start: int, stop: int
) -> str:
    """Что показать в точке курсора: число или факт разряда."""
    if kind == "spikes":
        fired = any(value >= 0.5 for value in values[start:stop])
        return "●" if fired else "○"
    index = min(len(values) - 1, start)
    return _fmt(values[index], _SCRUB_DIGITS.get(kind, 2))


def _scrub(
    frame: _Frame,
    series: list[tuple[str, str, list[float]]],
    zones: int = SCRUB_ZONES,
) -> str:
    """Курсор по времени: перемещение по таймлайну без единой строчки JS.

    Страница обязана оставаться статикой, поэтому «скраббер» -- это набор
    узких hover-зон поверх всех графиков: наведение зажигает сквозную
    вертикальную линию и печатает значения всех трасс в этой точке.
    Значения посчитаны заранее -- это и есть плата за отсутствие скрипта,
    поэтому зон сто, а не тысяча: шаг курсора мельче пикселя не нужен.
    """
    if not series:
        return ""

    parts = [
        '<div class="tr-scrub">'
        '<span class="tr-hint">наведите курсор: значения в этой точке</span>'
    ]
    for index in range(zones):
        middle = (index + 0.5) / zones * frame.duration
        chunks = [f"{middle:.0f} мс"]
        for label, kind, values in series:
            start = min(len(values) - 1, index * len(values) // zones)
            stop = max(start + 1, (index + 1) * len(values) // zones)
            chunks.append(f"{label} {_scrub_value(kind, values, start, stop)}")
        # У краёв подпись не центрируем, иначе она вылезет за блок.
        align = ""
        if index < zones * 0.12:
            align = " tr-read-l"
        elif index > zones * 0.88:
            align = " tr-read-r"
        # Подпись живёт в зоне, но позиционируется от слоя целиком: на
        # узком экране её проще развернуть на всю ширину, чем обрезать.
        parts.append(
            '<span class="tr-hit">'
            f'<span class="tr-read{align}" style="left:{index / zones * 100:.2f}%">'
            f'{esc(" · ".join(chunks))}</span></span>'
        )
    parts.append("</div>")
    return "".join(parts)


def _time_axis(frame: _Frame) -> str:
    """Одна ось времени под всем блоком: подписи круглые и общие для всех."""
    last = len(frame.ticks) - 1
    parts = []
    for index, tick in enumerate(frame.ticks):
        # Единицы вешаем на последнюю подпись: отдельное «мс» у правого
        # края налезало бы на неё.
        text = f"{tick:g} мс" if index == last else f"{tick:g}"
        klass = "tr-tick tr-tick-last" if index == last else "tr-tick"
        parts.append(
            f'<span class="{klass}" '
            f'style="left:{frame.x(tick) / VB_W * 100:.2f}%">{text}</span>'
        )
    return (
        '<div class="tr-row tr-timerow">'
        '<div class="tr-ygut"></div>'
        f'<div class="tr-ticks">{"".join(parts)}</div></div>'
    )


STYLE = """
/* Блок трасс. Все классы с префиксом tr-, цвета -- только токены темы. */
section.tr-card { padding: 0; overflow: hidden; }
.tr-block { display: flex; flex-direction: column; gap: var(--space-5);
  padding: var(--space-5) 0; }
.tr-fig { margin: 0; }
.tr-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  margin-bottom: var(--space-2);
  padding: 0 var(--space-3);
}
.tr-name {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--ink);
}
.tr-kind { font-size: var(--text-xs); color: var(--muted); }
.tr-stat {
  margin-left: auto;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-2xs);
  white-space: nowrap;
}
.tr-num { color: var(--ink); }
.tr-dim { color: var(--muted); }

/* Левый жёлоб под подписи уровней одинаков у всех графиков и совпадает с
   колонкой меток в активности сети: ось времени на странице одна, и её тики
   обязаны стоять на одной вертикали во всех блоках. */
.tr-row { display: grid;
  grid-template-columns: var(--track-label, 168px) 1fr; align-items: stretch; }
.tr-ygut { position: relative; }
.tr-lvl {
  position: absolute;
  right: var(--space-2);
  transform: translateY(-50%);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-2xs);
  line-height: 1;
  color: var(--muted);
}
.tr-plot {
  position: relative;
  border-left: 1px solid var(--line);
  background: var(--bg);
  border-radius: var(--radius-xs, 3px);
}
.tr-plot-v { height: 132px; }
.tr-plot-g, .tr-plot-w { height: 96px; }
.tr-plot-spikes { height: 34px; }
/* min-width сбрасываем: у этого SVG нет своего масштаба текста, поэтому он
   спокойно живёт и на 400px, не заставляя страницу ехать вбок. */
.tr-canvas { display: block; width: 100%; height: 100%; min-width: 0; }

.tr-gridx, .tr-gridy {
  stroke: var(--line);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.tr-gridy { opacity: .7; }
.tr-zero {
  stroke: var(--muted);
  stroke-width: 1;
  opacity: .5;
  vector-effect: non-scaling-stroke;
}
.tr-threshold, .tr-start {
  stroke: var(--muted);
  stroke-width: 1;
  stroke-dasharray: 4 3;
  vector-effect: non-scaling-stroke;
}
.tr-line {
  fill: none;
  stroke-width: 1.5;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.tr-line-v { stroke: var(--trace); }
.tr-line-g { stroke: var(--trace); stroke-width: 1.2; }
.tr-line-g.tr-tone-exc { stroke: var(--exc); }
.tr-line-g.tr-tone-inh { stroke: var(--inh); }
.tr-area.tr-tone-exc { fill: var(--exc); }
.tr-area.tr-tone-inh { fill: var(--inh); }
.tr-line-w { stroke: var(--mod); stroke-width: 2; }
.tr-area { fill: var(--trace); opacity: .16; stroke: none; }
.tr-spike { stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.tr-spike-exc { stroke: var(--exc); }
.tr-spike-inh { stroke: var(--inh); }

.tr-thr-label {
  position: absolute;
  right: var(--space-2);
  transform: translateY(-120%);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  line-height: 1;
  color: var(--muted);
  background: var(--bg);
  padding: 0 var(--space-1);
}
.tr-thr-under { transform: translateY(20%); }

.tr-timerow { margin-top: calc(-1 * var(--space-2)); }
.tr-ticks {
  position: relative;
  height: 18px;
  border-top: 1px solid var(--line);
}
.tr-tick {
  position: absolute;
  top: var(--space-1);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-2xs);
  line-height: 1;
  color: var(--muted);
}
.tr-tick { transform: translateX(-50%); }
.tr-tick:first-child { transform: none; }
.tr-tick-last { transform: translateX(-100%); }

/* Скраббер: сквозной курсор по времени. Раскладка держится на том, что
   зоны накрывают ровно колонку графиков -- тот же трек, что и у строк. */
.tr-block { position: relative; }
.tr-bar { height: 14px; }
.tr-scrub {
  position: absolute;
  left: var(--track-label, 168px);
  right: 0;
  top: var(--space-5);
  bottom: var(--space-5);
  z-index: 1;
}
.tr-hint {
  position: absolute;
  top: 0;
  left: 0;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  line-height: 1;
  color: var(--muted);
}
.tr-scrub:hover .tr-hint { opacity: 0; }
/* Зоны -- флекс-полоски равной ширины: тогда подпись можно позиционировать
   от всего слоя, а не от зоны, и на узком экране развернуть её во всю ширину.
   Курсор рисуем внутренней тенью, а не рамкой: рамка сдвинула бы раскладку. */
.tr-scrub { display: flex; }
.tr-hit { flex: 1 1 0; }
.tr-hit:hover { box-shadow: inset 1px 0 0 var(--ink); }
.tr-read {
  position: absolute;
  top: 0;
  display: none;
  transform: translateX(-50%);
  white-space: nowrap;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-2xs);
  line-height: 1;
  color: var(--ink);
  background: var(--panel);
  padding: 0 var(--space-1);
}
.tr-read-l { transform: none; }
.tr-read-r { transform: translateX(-100%); }
.tr-hit:hover .tr-read { display: block; }
/* На тач-устройствах hover не существует -- слой только мешал бы. */
@media (hover: none) {
  .tr-scrub { display: none; }
  .tr-bar { display: none; }
}

@media (max-width: 520px) {
  .tr-stat { margin-left: 0; width: 100%; }
  /* Узко: строка курсора не влезает рядом с ним -- кладём её на всю
     ширину блока и разрешаем перенос. */
  .tr-bar { height: 28px; }
  .tr-read, .tr-read-l, .tr-read-r {
    left: 0 !important;
    right: 0;
    transform: none;
    white-space: normal;
    font-size: 10px;
    padding: 0;
  }
}
"""


def _threshold_of(model: ir.Model, instance: str) -> float | None:
    try:
        return model.cell_type_of(instance).point_model.v_threshold
    except KeyError:
        return None


def _shared_voltage_scale(
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
        if _threshold_on_scale(points, threshold) and threshold is not None:
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
    frame = _Frame(model.run.duration)
    figures: list[str] = []

    prepared: list[tuple[str, str, list[tuple[float, float]], float | None]] = []
    for key, values in result.traces.items():
        if not values:
            continue
        head, _, kind = key.partition(":")
        if kind in ("v", ""):
            points = downsample_minmax(result.times[: len(values)], values)
            prepared.append(
                (head, kind, points, _threshold_of(model, head.split(".")[0]))
            )
    voltage_scale = _shared_voltage_scale(prepared)

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
                _spikes_figure(
                    frame,
                    head,
                    spike_times(times, values),
                    is_inhibitory(model, instance),
                )
            )
            continue

        points = downsample_minmax(times, values)
        if kind in ("g", "g_exc", "g_inh"):
            figures.append(_conductance_figure(frame, head, points, kind))
        elif kind == "w":
            figures.append(_weight_figure(frame, head, points, values[0], values[-1]))
        else:
            figures.append(
                _voltage_figure(
                    frame,
                    head,
                    points,
                    _threshold_of(model, instance),
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
        + _time_axis(frame)
        + _scrub(frame, series)
        + "</div></section>"
    )
