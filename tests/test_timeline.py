import re
from pathlib import Path

from vnl.resolve import load
from vnl.sim import simulate

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


def built(name: str):
    model, _ = load(example(name))
    return model, simulate(model)


def test_block_has_a_time_axis_with_round_labels():
    from vnl.timeline import render

    model, result = build = built("ffi")
    html = render(model, result)
    assert html.count('class="na-tick"') >= 4
    # Подписи шкалы -- круглые числа с шагом nice_step, первая с единицей.
    assert ">0 мс</span>" in html
    assert ">400</span>" in html
    assert ">137</span>" not in html
    assert build  # модель и результат использованы выше


def test_every_track_shares_one_viewbox_width():
    """Тики сойдутся у всех строк, только если ширина координат общая."""
    from vnl.timeline import VIEW_W, render

    model, result = built("disinhibition")
    html = render(model, result)
    widths = set(re.findall(r'viewBox="0 0 (\d+) \d+"', html))
    assert widths == {f"{VIEW_W:.0f}"}
    assert html.count('width="100%"') == 0  # ширину задаёт CSS, не атрибут
    assert html.count("na-svg") >= len(model.instances)


def test_tracks_mark_when_each_stimulus_was_running():
    from vnl.timeline import render

    model, result = built("disinhibition")
    html = render(model, result)
    assert html.count('class="na-stim"') == len(model.stimuli)
    # Протокол назван словами, а не машинным именем рода: «poisson» в подписи
    # ничего не объясняло, а «в среднем 300 Гц» объясняет и род, и число (#508).
    assert "gate: пуассоновский, в среднем 300 Гц" in html
    assert "reward: список, 4 импульса" in html


def test_counts_and_rate_live_in_the_label():
    from vnl.timeline import render

    model, result = built("ffi")
    html = render(model, result)
    count = len(result.spikes["IN"])
    rate = count / (model.run.duration / 1000)
    assert f"{count} спайков · {rate:.0f} Гц" in html
    # Из SVG счётчики убраны: на дорожке остаются только события во времени.
    assert "row-count" not in html


def test_inhibitory_cells_get_their_own_colour_class():
    from vnl.timeline import render

    model, result = built("ffi")
    html = render(model, result)
    assert "na-inh-dot" in html and "na-exc-dot" in html
    assert "na-inh-stroke" in html and "na-exc-stroke" in html


def test_membrane_trace_is_drawn_and_thinned():
    from vnl.timeline import TRACE_POINTS, membrane_trace, render, track_svg

    model, result = built("ffi")
    assert membrane_trace(result, "E") is not None
    svg = track_svg(model, result, "E")
    assert "na-trace-line" in svg and "na-trace-fill" in svg
    # Прореживание: точек в пути заметно меньше, чем сэмплов в записи.
    line = re.search(r'class="na-trace-line[^"]*" d="([^"]+)"', svg).group(1)
    points = line.count("L") + 1
    assert points <= TRACE_POINTS + 2
    assert len(result.traces["E.soma:v"]) > points * 4


def test_row_without_a_trace_is_shorter():
    """Нет записи потенциала -- строка только со штрихами и ниже ростом."""
    from vnl.timeline import ROW_H, ROW_H_BARE, membrane_trace, track_svg

    model, result = built("ffi")
    assert membrane_trace(result, "IN") is not None
    result.traces.pop("IN.soma:v")
    svg = track_svg(model, result, "IN")
    assert f"{ROW_H_BARE:.0f}" in svg.split("viewBox=")[1][:24]
    assert "na-trace-line" not in svg
    assert ROW_H_BARE < ROW_H


def test_render_returns_the_whole_block_without_scripts():
    from vnl.timeline import STYLE, render

    model, result = built("depression")
    html = render(model, result)
    assert html.startswith("<h2>Активность сети</h2><section")
    assert html.rstrip().endswith("</section>")
    assert "<script" not in html and "http://" not in html
    # Своих цветов в стилях нет -- только переменные темы.
    assert "#" not in STYLE
    assert "--exc" in STYLE and "--inh" in STYLE
