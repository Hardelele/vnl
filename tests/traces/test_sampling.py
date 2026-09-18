"""Прореживание: экстремумы обязаны доживать до картинки."""

import re

import pytest

from vnl import traces


def test_downsampling_keeps_peaks():
    times = [i * 0.1 for i in range(5000)]
    values = [0.0] * 5000
    values[1234] = 9.5        # одиночный всплеск -- его нельзя потерять
    values[4321] = -3.25      # и одиночный провал тоже
    points = traces.downsample_minmax(times, values, columns=200)
    assert len(points) < len(values)
    kept = [value for _, value in points]
    assert max(kept) == max(values)
    assert min(kept) == min(values)


def test_spike_times_catch_fronts_not_plateaus():
    """Спайк -- это фронт 0→1, а не каждый шаг, пока держится единица."""
    times = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5]
    values = [0.0, 1.0, 1.0, 0.0, 1.0, 0.0]
    assert traces.spike_times(times, values) == [0.1, 0.4]


def test_downsampled_peak_survives_in_the_svg_path(block_for):
    """Сравниваем максимум данных с максимумом, попавшим в путь SVG."""
    _, result, block = block_for("depression")
    peak = max(result.traces["DEP.soma:g"])

    figure = next(part for part in block.split("<figure") if "tr-line-g" in part)
    path = re.search(r'class="tr-line tr-line-g" d="([^"]+)"', figure).group(1)
    ys = [float(pair.split(",")[1]) for pair in path.replace("M", "").split(" L")]
    labels = [
        float(text.replace("−", "-"))
        for text in re.findall(r'class="tr-lvl"[^>]*>([^<]+)<', figure)
    ]
    low, high = min(labels), max(labels)
    restored = high - min(ys) / 100.0 * (high - low)
    assert restored == pytest.approx(peak, rel=1e-3, abs=1e-3)
