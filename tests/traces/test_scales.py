"""Шкалы: границы круглые, уровни подписаны, ноль на месте."""

from vnl import traces


def test_levels_are_round_and_cover_the_data():
    low, high, levels = traces.value_scale(-69.7, -43.2)
    assert low <= -69.7 and high >= -43.2
    assert len(levels) >= 3
    step = levels[1] - levels[0]
    assert all(
        abs((levels[index + 1] - levels[index]) - step) < 1e-9
        for index in range(len(levels) - 1)
    )


def test_zero_is_included_when_asked():
    """Проводимость и вес читают от нуля, даже если данные далеко от него."""
    low, high, levels = traces.value_scale(2.2, 3.4, include_zero=True)
    assert low == 0.0
    assert 0.0 in levels and high >= 3.4


def test_flat_trace_still_gets_a_scale():
    low, high, levels = traces.value_scale(-65.0, -65.0)
    assert high > low and len(levels) >= 2
