"""Общая рамка блока: система координат, ось времени, примитивы путей.

Все графики блока читают друг под другом, поэтому сетка по X и жёлоб под
подписи считаются здесь один раз и раздаются фигурам.
"""

from __future__ import annotations

from ..render_util import nice_step
from .scales import fmt

# Внутренняя система координат SVG: ширина и высота условные, реальный
# размер задаёт CSS. Числа круглые, чтобы проценты подписей и координаты
# путей считались в одной шкале.
VB_W = 1000.0
VB_H = 100.0


class Frame:
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


def path_d(
    frame: Frame, points: list[tuple[float, float]], low: float, high: float
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


def levels_html(levels: list[float], low: float, high: float, digits: int) -> str:
    span = high - low or 1.0
    return "".join(
        f'<span class="tr-lvl" style="top:{(high - level) / span * 100:.2f}%">'
        f"{fmt(level, digits)}</span>"
        for level in levels
    )


def baseline(low: float, high: float) -> str:
    """Ноль отдельной линией: для проводимости и веса это опора отсчёта."""
    if not (low <= 0.0 <= high):
        return ""
    y = (high - 0.0) / (high - low or 1.0) * VB_H
    return f'<line class="tr-zero" x1="0" y1="{y:.2f}" x2="{VB_W:.0f}" y2="{y:.2f}"/>'


def time_axis(frame: Frame) -> str:
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
