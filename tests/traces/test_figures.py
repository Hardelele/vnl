"""Подача по видам записей: у каждого вида она своя."""

import re

from vnl import traces


def levels_of(figure: str) -> list[float]:
    return [
        float(text.replace("−", "-"))
        for text in re.findall(r'class="tr-lvl"[^>]*>([^<]+)<', figure)
    ]


def test_every_kind_gets_its_own_presentation(block_for):
    _, _, dis = block_for("disinhibition")
    _, _, dep = block_for("depression")

    # потенциал: своя подпись с единицами и линия порога
    assert "мембранный потенциал, мВ" in dis
    assert "tr-line-v" in dis
    # вес: своя кривая и отметка стартового уровня
    assert "суммарный вес пластичных входов, нСм" in dis
    assert "tr-line-w" in dis and "tr-start" in dis
    # спайки: штрихи, а не ломаная
    assert "tr-spike" in dis and "tr-plot-spikes" in dis
    # проводимость: заливка от нуля
    assert "проводимость, нСм" in dep
    assert "tr-area" in dep and "tr-line-g" in dep


def test_voltage_figure_draws_threshold_line_with_label(block_for):
    model, _, block = block_for("ffi")
    threshold = model.cell_type_of("E").point_model.v_threshold
    assert "tr-threshold" in block
    assert f"порог −{abs(threshold):.1f} мВ" in block


def test_far_threshold_does_not_flatten_the_voltage_trace(block_for):
    """Порог -20 мВ при трассе около -63 не должен расплющивать кривую."""
    model, _, block = block_for("depression")
    assert model.cell_type_of("DEP").point_model.v_threshold == -20.0
    assert "вне шкалы" in block
    figure = next(
        part for part in block.split("<figure")
        if "DEP.soma" in part and "мВ" in part
    )
    assert "tr-threshold" not in figure
    assert max(levels_of(figure)) <= -40.0


def test_voltage_traces_share_one_scale_when_comparable(block_for):
    """Соседние потенциалы сравнимого размаха читают по одной шкале."""
    _, _, block = block_for("depression")
    scales = [
        levels_of(figure)
        for figure in block.split("<figure")[1:]
        if "tr-line-v" in figure
    ]
    assert len(scales) == 2
    assert scales[0] == scales[1]


def test_zero_is_shown_for_conductance_and_weight(block_for):
    _, _, dep = block_for("depression")
    _, _, dis = block_for("disinhibition")
    assert "tr-zero" in dep and "tr-zero" in dis
    # ноль подписан в жёлобе уровней
    assert re.search(r'class="tr-lvl"[^>]*>0(\.0+)?<', dep)


def test_weight_figure_reports_start_and_end(block_for):
    _, result, block = block_for("disinhibition")
    values = result.traces["PYR.soma:w"]
    assert "было" in block and "стало" in block
    assert f"{values[0]:.2f}" in block
    assert f"{values[-1]:.2f}" in block


def test_spikes_are_strokes_not_polyline(block_for):
    """Бинарную величину рисуем событиями: число штрихов = число спайков."""
    _, result, block = block_for("disinhibition")
    moments = traces.spike_times(result.times, result.traces["SST.soma:spikes"])
    assert len(moments) > 0
    assert block.count('class="tr-spike ') == len(moments)
