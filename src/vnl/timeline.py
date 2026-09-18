"""Блок «Активность сети»: по дорожке на нейрон на общей временной оси.

Основной экран: он масштабируется по числу клеток — новая клетка добавляет
строку, а не борется за то же место. Подробная физиология одного нейрона
живёт не здесь.

Раскладка — CSS grid «метка | дорожка». Почему не один большой SVG: там
строки жёстко связаны по высоте, а текст метки не умеет переноситься и
ужиматься под узкий экран. Сетка даёт нормальный HTML слева и SVG только
там, где он правда нужен — на дорожке. Чтобы тики совпадали у всех строк,
у всех дорожечных SVG одинаковый viewBox по ширине и width:100%.
"""

from __future__ import annotations

from . import ir
from .render_util import esc, is_inhibitory, nice_step
from .sim import SimResult

# Ширина системы координат дорожки. Одинакова у всех строк — только так
# вертикальные тики совпадают, хотя пиксельная ширина колонки резиновая.
VIEW_W = 1000.0

PAD_TOP = 6.0
SPIKE_H = 18.0          # высота штрихов спайков
GAP = 2.0
TRACE_H = 26.0          # высота мини-трассы мембранного потенциала
PAD_BOT = 6.0

ROW_H = PAD_TOP + SPIKE_H + GAP + TRACE_H + PAD_BOT
ROW_H_BARE = PAD_TOP + SPIKE_H + PAD_BOT

# Сколько точек оставлять в мини-трассе. В записи их тысячи; на дорожке
# шириной в несколько сотен пикселей больше просто нечего показать, а вес
# страницы растёт линейно.
TRACE_POINTS = 480


def _plural(count: int, forms: tuple[str, str, str]) -> str:
    """Русская форма числительного: 1 спайк, 2 спайка, 5 спайков."""
    tail100, tail10 = count % 100, count % 10
    if 11 <= tail100 <= 14:
        return forms[2]
    if tail10 == 1:
        return forms[0]
    if 2 <= tail10 <= 4:
        return forms[1]
    return forms[2]


def _fmt_rate(rate: float) -> str:
    """Частота: целая, пока крупная, и с десятой долей, когда мелкая."""
    return f"{rate:.0f}" if rate >= 10 else f"{rate:.1f}"


def ticks(duration: float) -> list[float]:
    """Круглые отметки времени — общие для шкалы и для сетки дорожек."""
    if duration <= 0:
        return [0.0]
    step = nice_step(duration)
    out: list[float] = []
    tick = 0.0
    while tick <= duration + 1e-9:
        out.append(tick)
        tick += step
    return out


def membrane_trace(result: SimResult, name: str) -> list[float] | None:
    """Запись мембранного потенциала клетки: «<имя>.<секция>:v».

    Секция заранее не известна (обычно soma, но записать могли и дендрит),
    поэтому ищем по префиксу; сому предпочитаем как «главную» запись.
    Нет записи — вернём None, и строка будет ниже, только со штрихами.
    """
    candidates = [
        key
        for key in result.traces
        if key.startswith(f"{name}.") and key.endswith(":v")
    ]
    if not candidates:
        return None
    key = next((c for c in candidates if c == f"{name}.soma:v"), candidates[0])
    return result.traces.get(key) or None


def _thin(times: list[float], values: list[float]) -> list[tuple[float, float]]:
    """Прореживание по корзинам с выбором пика.

    Простой шаг «через N» съедает спайк: в LIF пик держится один dt и почти
    наверняка не попадёт в выборку. Поэтому от корзины берём максимум — так
    видно и подпороговый ход, и сами спайки.
    """
    count = min(len(values), len(times))
    if count == 0:
        return []
    bucket = max(1, -(-count // TRACE_POINTS))  # округление вверх
    if bucket == 1:
        return [(times[i], values[i]) for i in range(count)]
    out: list[tuple[float, float]] = []
    for start in range(0, count, bucket):
        stop = min(start + bucket, count)
        peak = start
        for index in range(start + 1, stop):
            if values[index] > values[peak]:
                peak = index
        out.append((times[peak], values[peak]))
    return out


def _trace_paths(
    times: list[float], values: list[float], duration: float, top: float
) -> tuple[str, str]:
    """Пара путей мини-трассы: линия и та же линия, замкнутая под заливку."""
    points = _thin(times, values)
    if len(points) < 2:
        return "", ""
    low = min(value for _, value in points)
    high = max(value for _, value in points)
    if high - low < 1e-9:
        high = low + 1.0
    inset = 1.5  # чтобы линия не липла к границам строки
    usable = TRACE_H - inset * 2
    bottom = top + TRACE_H

    def at_x(time: float) -> float:
        return min(max(time, 0.0), duration) / duration * VIEW_W

    def at_y(value: float) -> float:
        return top + inset + (1 - (value - low) / (high - low)) * usable

    body = " L".join(f"{at_x(t):.1f} {at_y(v):.2f}" for t, v in points)
    line = "M" + body
    fill = (
        f"M{at_x(points[0][0]):.1f} {bottom:.1f} L{body} "
        f"L{at_x(points[-1][0]):.1f} {bottom:.1f} Z"
    )
    return line, fill


def track_svg(model: ir.Model, result: SimResult, name: str) -> str:
    """Дорожка одной клетки: окна стимулов, сетка, спайки, мини-трасса."""
    duration = model.run.duration or 1.0
    kind = "inh" if is_inhibitory(model, name) else "exc"
    trace = membrane_trace(result, name)
    height = ROW_H if trace else ROW_H_BARE

    def at(time: float) -> float:
        return min(max(time, 0.0), duration) / duration * VIEW_W

    bare = "" if trace else " na-svg-bare"
    parts = [
        f'<svg class="na-svg{bare}" viewBox="0 0 {VIEW_W:.0f} {height:.0f}" '
        f'preserveAspectRatio="none" role="img" '
        f'aria-label="Активность {esc(name)}">'
    ]

    # Окна работы стимулов — полосой во всю высоту строки целевой клетки:
    # видно, что происходило с клеткой именно тогда, когда её гнали.
    for stim in model.stimuli:
        if stim.target.instance != name:
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
            f'<rect class="na-stim" x="{start:.1f}" y="0" '
            f'width="{stop - start:.1f}" height="{height:.0f}">'
            f"<title>{esc(stim.id)}: {esc(stim.kind)}, {esc(detail)}, "
            f"{stim.start:g}–{min(stim.stop, duration):g} мс</title></rect>"
        )

    # Тики сквозные: пунктир идёт через всю строку, поэтому один момент
    # времени читается сразу во всех дорожках.
    for tick in ticks(duration):
        x = at(tick)
        parts.append(
            f'<line class="na-gridline" x1="{x:.1f}" y1="0" '
            f'x2="{x:.1f}" y2="{height:.0f}"/>'
        )

    base = PAD_TOP + SPIKE_H
    parts.append(
        f'<line class="na-base" x1="0" y1="{base:.0f}" '
        f'x2="{VIEW_W:.0f}" y2="{base:.0f}"/>'
    )
    for time in result.spikes.get(name, []):
        x = at(time)
        parts.append(
            f'<line class="na-spike na-{kind}-stroke" x1="{x:.1f}" '
            f'y1="{PAD_TOP:.0f}" x2="{x:.1f}" y2="{base:.0f}"/>'
        )

    if trace:
        line, fill = _trace_paths(result.times, trace, duration, base + GAP)
        if line:
            parts.append(
                f'<path class="na-trace-fill na-{kind}-fill" d="{fill}"/>'
                f'<path class="na-trace-line na-{kind}-line" d="{line}"/>'
            )

    parts.append("</svg>")
    return "".join(parts)


def axis_html(duration: float) -> str:
    """Общая шкала времени: те же круглые отметки, что и в сетке дорожек.

    Подписи — HTML, а не текст в SVG: дорожки растянуты
    preserveAspectRatio="none", и буквы в них поехали бы по ширине.
    """
    marks = ticks(duration)
    span = duration or 1.0
    parts = []
    for index, tick in enumerate(marks):
        percent = tick / span * 100
        # Последняя подпись у правого края уехала бы за карточку.
        last = index == len(marks) - 1
        end = " na-tlabel-end" if last and percent > 92 else ""
        if index == 0:
            end += " na-tlabel-first"
        # На узком экране подписи налезают друг на друга, а померить ширину
        # без JS нельзя -- поэтому заранее помечаем через одну (считая с
        # конца, чтобы крайняя отметка осталась) и прячем их медиазапросом.
        alt = " na-tlabel-alt" if (len(marks) - 1 - index) % 2 else ""
        label = f"{tick:g} мс" if index == 0 else f"{tick:g}"
        parts.append(
            f'<span class="na-tick" style="left:{percent:.3f}%"></span>'
            f'<span class="na-tlabel{end}{alt}" style="left:{percent:.3f}%">'
            f"{label}</span>"
        )
    return "".join(parts)


def label_html(model: ir.Model, result: SimResult, name: str) -> str:
    """Метка слева: цвет, имя и счётчики.

    Счётчики переехали сюда из SVG: в тексте они читаются и копируются, а
    дорожка остаётся под одно дело — показывать время.
    """
    kind = "inh" if is_inhibitory(model, name) else "exc"
    count = len(result.spikes.get(name, []))
    seconds = (model.run.duration or 0.0) / 1000.0
    rate = count / seconds if seconds > 0 else 0.0
    word = _plural(count, ("спайк", "спайка", "спайков"))
    return (
        f'<div class="na-name"><span class="na-dot na-{kind}-dot"></span>'
        f'<span class="na-title">{esc(name)}</span></div>'
        f'<div class="na-meta">{count} {word} · {_fmt_rate(rate)} Гц</div>'
    )


# Свои переменные темы не заводим и чужие не переопределяем: цвета берём из
# --exc/--inh/--ink/--line/--muted, шрифт — из --font-mono, если тема его
# объявит, иначе из запасного стека (внешних ресурсов на странице нет).
STYLE = f"""
section.na-card {{ padding: 0; overflow: hidden; }}
.na-grid {{ display: grid;
  grid-template-columns: var(--track-label, 168px) minmax(0, 1fr); }}
.na-cell {{ border-bottom: 1px solid var(--line); min-width: 0; }}
.na-side {{ border-right: 1px solid var(--line); padding: 10px 12px;
  display: flex; flex-direction: column; gap: 4px; justify-content: center; }}
.na-head {{ font-size: 11px; font-weight: 600; letter-spacing: .04em;
  color: var(--muted); padding: 8px 12px; }}
.na-axis {{ position: relative; height: 30px; }}
.na-tick {{ position: absolute; top: 0; bottom: 0; width: 0;
  border-left: 1px solid var(--line); }}
.na-tlabel {{ position: absolute; top: 9px; transform: translateX(-50%);
  white-space: nowrap; font-size: 11px; color: var(--muted);
  font-family: var(--font-mono, "Roboto Mono", ui-monospace, Consolas, monospace);
  font-variant-numeric: tabular-nums; }}
.na-tlabel-end {{ transform: translateX(-100%); }}
.na-tlabel-first {{ transform: none; }}
.na-name {{ display: flex; align-items: center; gap: 8px; min-width: 0; }}
.na-dot {{ width: 8px; height: 8px; border-radius: 2px; flex: none; }}
.na-exc-dot {{ background: var(--exc); }}
.na-inh-dot {{ background: var(--inh); }}
.na-title {{ font-size: 13px; font-weight: 600; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }}
.na-meta {{ font-size: 11px; line-height: 1.3; color: var(--muted);
  font-family: var(--font-mono, "Roboto Mono", ui-monospace, Consolas, monospace);
  font-variant-numeric: tabular-nums; }}
.na-track {{ display: flex; align-items: center; }}
.na-svg {{ display: block; flex: 1 1 auto; width: 100%; min-width: 0;
  height: {ROW_H:.0f}px; }}
.na-svg-bare {{ height: {ROW_H_BARE:.0f}px; }}
.na-gridline {{ stroke: var(--line); stroke-width: 1; stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke; }}
.na-base {{ stroke: var(--line); stroke-width: 1;
  vector-effect: non-scaling-stroke; }}
.na-stim {{ fill: var(--ink); opacity: .05; }}
.na-spike {{ stroke-width: 2; stroke-linecap: round;
  vector-effect: non-scaling-stroke; }}
.na-exc-stroke {{ stroke: var(--exc); }}
.na-inh-stroke {{ stroke: var(--inh); }}
.na-trace-fill {{ opacity: .12; stroke: none; }}
.na-exc-fill {{ fill: var(--exc); }}
.na-inh-fill {{ fill: var(--inh); }}
.na-trace-line {{ fill: none; stroke-width: 1.4; stroke-linejoin: round;
  vector-effect: non-scaling-stroke; }}
.na-exc-line {{ stroke: var(--exc); }}
.na-inh-line {{ stroke: var(--inh); }}
.na-foot {{ grid-column: 1 / -1; padding: 8px 12px; font-size: 11px;
  color: var(--muted); }}
@media (max-width: 640px) {{ .na-tlabel-alt {{ display: none; }} }}
.na-empty {{ padding: 14px 12px; color: var(--muted); font-size: 0.9rem; }}
"""


def render(model: ir.Model, result: SimResult) -> str:
    """Блок целиком, вместе с заголовком секции."""
    names = list(model.instances)
    if not names:
        return (
            '<h2>Активность сети</h2><section class="na-card">'
            '<p class="na-empty">в модели нет клеток</p></section>'
        )

    rows = "".join(
        f'<div class="na-cell na-side">{label_html(model, result, name)}</div>'
        f'<div class="na-cell na-track">{track_svg(model, result, name)}</div>'
        for name in names
    )
    return (
        "<h2>Активность сети</h2>"
        '<section class="na-card"><div class="na-grid">'
        '<div class="na-cell na-side na-head">Популяция</div>'
        f'<div class="na-cell na-head na-axis">{axis_html(model.run.duration)}</div>'
        f"{rows}"
        '<div class="na-foot">серая полоса — окно работы стимула, '
        "линия под штрихами — мембранный потенциал</div>"
        "</div></section>"
    )
