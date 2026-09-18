"""Шкалы и форматирование чисел для подписей.

Отдельно от рисования: круглые уровни и вид числа -- это арифметика, у неё
своя цена ошибки и свои тесты, а разметка тут ни при чём.
"""

from __future__ import annotations

import math

from ..render_util import nice_step


def minus(text: str) -> str:
    """Типографский минус: в колонке цифр дефис выглядит как мусор."""
    return text.replace("-", "−")


def fmt(value: float, digits: int) -> str:
    return minus(f"{value:.{digits}f}")


def digits_for(step: float) -> int:
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
