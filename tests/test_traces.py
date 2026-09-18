import re
from pathlib import Path

import pytest

from vnl import traces
from vnl.resolve import load
from vnl.sim import simulate

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


def block_for(name: str) -> tuple[object, object, str]:
    model, _ = load(example(name))
    result = simulate(model)
    return model, result, traces.render(model, result)


def test_traces_block_draws_every_recorded_value():
    model, _, block = block_for("ffi")
    assert block.count("<svg") == len(model.recordings)


def test_every_kind_gets_its_own_presentation():
    """Четыре вида записей не должны выглядеть одинаково."""
    _, _, dis = block_for("disinhibition")
    _, _, dep = block_for("depression")

    # потенциал: своя подпись с единицами и линия порога
    assert "мембранный потенциал, мВ" in dis
    assert "tr-line-v" in dis
    # вес: своя кривая и отметка стартового уровня
    assert "суммарный вес пластичных входов, нСм" in dis
    assert "tr-line-w" in dis and "tr-start" in dis
    # спайки: штрихи, а не ломаная
    assert "tr-spike" in dis
    assert "tr-plot-spikes" in dis
    # проводимость: заливка от нуля
    assert "синаптическая проводимость, нСм" in dep
    assert "tr-area" in dep and "tr-line-g" in dep


def test_voltage_figure_draws_threshold_line_with_label():
    model, _, block = block_for("ffi")
    threshold = model.cell_type_of("E").point_model.v_threshold
    assert "tr-threshold" in block
    assert f"порог −{abs(threshold):.1f} мВ" in block


def test_spikes_are_strokes_not_polyline():
    """Бинарную величину рисуем событиями: число штрихов = число спайков."""
    model, result, block = block_for("disinhibition")
    values = result.traces["SST.soma:spikes"]
    moments = traces.spike_times(result.times, values)
    assert len(moments) > 0
    assert block.count('class="tr-spike ') == len(moments)


def test_zero_is_shown_for_conductance_and_weight():
    _, _, dep = block_for("depression")
    _, _, dis = block_for("disinhibition")
    assert "tr-zero" in dep
    assert "tr-zero" in dis
    # ноль подписан в жёлобе уровней
    assert re.search(r'class="tr-lvl"[^>]*>0(\.0+)?<', dep)


def test_weight_figure_reports_start_and_end():
    _, result, block = block_for("disinhibition")
    values = result.traces["PYR.soma:w"]
    assert "было" in block and "стало" in block
    assert f"{values[0]:.2f}" in block
    assert f"{values[-1]:.2f}" in block


def test_shared_time_axis_is_the_same_for_all_plots():
    model, _, block = block_for("ffi")
    # сетка по X в каждом графике плюс единственная подписанная ось внизу
    assert block.count("tr-timerow") == 1
    assert block.count("мс</span>") == 1
    grids = [b.count("tr-gridx") for b in block.split("<figure")[1:]]
    assert len(set(grids)) == 1 and grids[0] > 1
    assert f">{model.run.duration:g} мс<" in block


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


def test_downsampled_peak_survives_in_the_svg_path():
    """Сравниваем максимум данных с максимумом, попавшим в путь SVG."""
    _, result, block = block_for("depression")
    values = result.traces["DEP.soma:g"]
    peak = max(values)

    figure = next(f for f in block.split("<figure") if "tr-line-g" in f)
    path = re.search(r'class="tr-line tr-line-g" d="([^"]+)"', figure).group(1)
    ys = [float(pair.split(",")[1]) for pair in path.replace("M", "").split(" L")]
    levels = [
        float(m) for m in re.findall(r'class="tr-lvl" style="top:([\d.]+)%', figure)
    ]
    # верх шкалы -- уровень с наименьшим top; максимум данных должен
    # дотягиваться до соответствующей ему координаты пути
    labels = [
        float(text.replace("−", "-"))
        for text in re.findall(r'class="tr-lvl"[^>]*>([^<]+)<', figure)
    ]
    low, high = min(labels), max(labels)
    assert min(levels) < 1e-6
    restored = high - min(ys) / 100.0 * (high - low)
    assert restored == pytest.approx(peak, rel=1e-3, abs=1e-3)


def test_no_scripts_or_external_resources():
    _, _, block = block_for("disinhibition")
    assert "<script" not in block
    assert "http://" not in block and "https://" not in block


def test_style_is_exported_and_prefixed():
    assert traces.STYLE.strip()
    selectors = re.findall(r"^\.([a-z-]+)", traces.STYLE, re.MULTILINE)
    assert selectors and all(s.startswith("tr-") for s in selectors)
    # свои цвета не изобретаем -- только токены темы
    assert not re.search(r"#[0-9a-fA-F]{3,6}\b", traces.STYLE)


def test_empty_result_does_not_break_the_block():
    model, _ = load(example("ffi"))
    from vnl.sim import SimResult

    block = traces.render(model, SimResult(dt=0.1, times=[]))
    assert "записей нет" in block


def test_far_threshold_does_not_flatten_the_voltage_trace():
    """Порог -20 мВ при трассе около -63 не должен расплющивать кривую."""
    model, _, block = block_for("depression")
    assert model.cell_type_of("DEP").point_model.v_threshold == -20.0
    assert "вне шкалы" in block
    figure = next(f for f in block.split("<figure") if "DEP.soma" in f and "мВ" in f)
    assert "tr-threshold" not in figure
    labels = [
        float(text.replace("−", "-"))
        for text in re.findall(r'class="tr-lvl"[^>]*>([^<]+)<', figure)
    ]
    assert max(labels) <= -40.0


def test_voltage_traces_share_one_scale_when_comparable():
    """Соседние потенциалы сравнимого размаха читают по одной шкале."""
    _, _, block = block_for("depression")
    scales = []
    for figure in block.split("<figure")[1:]:
        if "tr-line-v" not in figure:
            continue
        scales.append(re.findall(r'class="tr-lvl"[^>]*>([^<]+)<', figure))
    assert len(scales) == 2
    assert scales[0] == scales[1]


def test_scrubber_lets_you_move_along_the_timeline_without_js():
    """Перемещение по таймлайну сделано зонами hover, а не скриптом."""
    _, _, block = block_for("disinhibition")
    assert "<script" not in block and "onmouse" not in block.lower()
    assert block.count('class="tr-hit"') == traces.SCRUB_ZONES
    assert block.count('class="tr-read') == traces.SCRUB_ZONES
    assert "tr-scrub" in block


def test_scrubber_shows_real_values_at_that_time():
    """Число в строке курсора -- это значение трассы в этой точке."""
    model, result, block = block_for("disinhibition")
    reads = re.findall(r'class="tr-read[^"]*"[^>]*>([^<]+)<', block)
    assert len(reads) == traces.SCRUB_ZONES

    zone = traces.SCRUB_ZONES // 2
    text = reads[zone]
    expected_time = (zone + 0.5) / traces.SCRUB_ZONES * model.run.duration
    assert text.startswith(f"{expected_time:.0f} мс")

    values = result.traces["PYR.soma:v"]
    index = zone * len(values) // traces.SCRUB_ZONES
    assert f"PYR {values[index]:.1f}".replace("-", "−") in text
    # спайки показываем событием, а не числом
    # Событие показано отметкой, а не числом; позиция в строке не важна.
    assert "SST ●" in text or "SST ○" in text
