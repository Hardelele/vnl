"""Прореживание трасс и выделение спайков.

Точек в записи тысячи, в SVG нужны сотни. Здесь только про то, какие точки
оставить, и ничего про то, как их потом нарисовать.
"""

from __future__ import annotations

# Сколько столбцов оставляем после прореживания. Это примерно ширина блока
# в пикселях: больше точек глаз всё равно не различит, а вес страницы растёт.
COLUMNS = 280


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
