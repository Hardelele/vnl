"""Скраббер: перемещение по времени без единой строчки JavaScript.

Страница обязана оставаться статикой, поэтому курсор по таймлайну -- это
слой hover-зон с заранее посчитанными значениями.
"""

from __future__ import annotations

from ..render_util import esc
from .geometry import Frame
from .scales import fmt


# Сколько зон у скраббера. Каждая зона несёт заранее посчитанную строку
# значений, поэтому число -- компромисс между шагом курсора и весом страницы.
SCRUB_ZONES = 80

# Спайк -- событие, а не число: в строке курсора он показывается значком.
SPIKE_MARK = "●"
IDLE_MARK = "○"

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


def scrub_label(instance: str, kind: str) -> str:
    """Подпись ряда в строке курсора.

    Живёт рядом со скраббером, а не в сборке блока: это его формат строки.
    """
    return instance + _SCRUB_MARK.get(kind, " " + kind)


def scrub_value(
    kind: str, values: list[float], start: int, stop: int
) -> str:
    """Что показать в точке курсора: число или факт разряда."""
    if kind == "spikes":
        fired = any(value >= 0.5 for value in values[start:stop])
        return SPIKE_MARK if fired else IDLE_MARK
    index = min(len(values) - 1, start)
    return fmt(values[index], _SCRUB_DIGITS.get(kind, 2))


def scrub(
    frame: Frame,
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
            chunks.append(f"{label} {scrub_value(kind, values, start, stop)}")
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
