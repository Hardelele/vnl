"""Зрение: поле сенсоров, слой клеток и программа за дверью (#580).

Три свойства, ради которых всё и делалось, и каждое проверяется с той
стороны, с которой оно ломается.

Поле -- это много обычных сенсоров под одним именем: величина каждого живёт
своей жизнью, тёмный пиксель молчит, а яркость по-прежнему превращается в
частоту. Слой -- это много обычных клеток: стрелка «каждый к своему» связывает
пиксель с его клеткой и ни с чьей чужой. Источник -- это чужая программа:
через границу идут числа, и прогон по её выводу повторяется в точности, потому
что вывод лёг в ту же запись входа, что и нажатие кнопки.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from vnl import ir, sources
from vnl.resolve import ValidationError, load
from vnl.sim import SenseEvent, Simulator, simulate

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"
TOOLS = ROOT / "tools"

#: Опорная схема: поле 4x4 и слой той же сетки. Маленькая нарочно -- всё, что
#: проверяется, видно на шестнадцати величинах, а считается оно мгновенно.
FIELD = """
model vision_test

cell relay : excitatory, glutamate {
    tau_m      = 10ms
    threshold  = -50mV
    refractory = 2ms
}

neuron R[4x4] : relay

sensor eye : rate { grid = 4x4, channels = gray, to = 100Hz }
eye -> R.soma { weight = 2nS, delay = 1.0ms }

run { dt = 0.1ms  duration = 200ms  level = L1  seed = 1 }
"""

#: То же поле в цвете: у пикселя три величины и одна клетка.
COLOR = FIELD.replace("channels = gray", "channels = rgb").replace(
    "eye -> R.soma", "eye.r -> R.soma"
)


def model_of(text: str):
    model, _ = load(text, strict=True)
    return model


def lit(frame: list[float], places: list[int], value: float = 1.0) -> tuple[float, ...]:
    out = [0.0] * len(frame)
    for place in places:
        out[place] = value
    return tuple(out)


# --- поле в языке ---------------------------------------------------------


def test_one_line_opens_a_field_of_many_values():
    sensor = model_of(FIELD).sensors["eye"]
    assert (sensor.rows, sensor.cols) == (4, 4)
    assert sensor.size == 16
    # Поле -- всё ещё одна дверь: в модели один сенсор, а не шестнадцать. Иначе
    # всё, что перечисляет сенсоры (отчёт, интерфейс, сессия), показывало бы
    # человеку сетку вместо схемы.
    assert list(model_of(FIELD).sensors) == ["eye"]


def test_a_field_of_the_same_grid_is_wired_pixel_to_its_own_cell():
    model = model_of(FIELD)
    links = model.sensors["eye"].targets
    assert len(links) == 16
    # Каждая величина -- в свою клетку, и ни одна клетка не получила две.
    assert [link.index for link in links] == list(range(16))
    assert [link.target.instance for link in links] == [
        f"R[{row},{col}]" for row in range(4) for col in range(4)
    ]


def test_a_colour_pixel_has_three_values_and_one_cell():
    model = model_of(COLOR)
    sensor = model.sensors["eye"]
    assert sensor.channels == ("r", "g", "b")
    assert sensor.size == 48
    links = model.sensors["eye"].targets
    # Канал целиком -- 16 связей, по одной на клетку; номера величин идут через
    # три, потому что каналы в кадре чередуются.
    assert len(links) == 16
    assert [link.index for link in links] == list(range(0, 48, 3))


def test_a_single_value_may_be_wired_by_hand():
    model = model_of(
        FIELD.replace("eye -> R.soma", "eye[1,2] -> R[0,0].soma")
    )
    links = model.sensors["eye"].targets
    assert len(links) == 1
    assert links[0].index == model.sensors["eye"].index_of(1, 2)
    assert links[0].target.instance == "R[0,0]"


def test_grids_that_do_not_match_are_refused_with_both_numbers():
    with pytest.raises(ValidationError) as failure:
        load(FIELD.replace("neuron R[4x4]", "neuron R[3x3]"), strict=True)
    message = str(failure.value)
    assert "16 пикселей" in message and "9" in message


def test_an_unknown_channel_is_refused():
    with pytest.raises(ValidationError) as failure:
        load(COLOR.replace("eye.r ->", "eye.k ->"), strict=True)
    assert "канала 'k'" in str(failure.value)


def test_an_unknown_channel_set_is_refused_instead_of_spelled_out():
    # `rbg` -- это опечатка, а не набор: разбери мы его по буквам, зелёное
    # молча поменялось бы местами с синим на всём прогоне.
    with pytest.raises(ValidationError) as failure:
        load(FIELD.replace("channels = gray", "channels = rbg"), strict=True)
    assert "набор каналов" in str(failure.value)


def test_the_address_of_a_value_reads_as_it_is_written():
    sensor = model_of(COLOR).sensors["eye"]
    assert sensor.address_of(sensor.index_of(3, 1, 2)) == "eye.b[3,1]"


# --- слой клеток ----------------------------------------------------------


def test_a_layer_is_ordinary_cells_written_in_one_line():
    model = model_of(FIELD)
    assert len(model.instances) == 16
    assert model.populations["R"].size == 16
    # Слой -- это запись о том, что клетки заведены вместе; сами они обычные, и
    # знать про сетку прогон не обязан.
    assert model.instances["R[2,3]"].cell_type == "relay"


def test_a_layer_into_one_cell_is_all_to_one():
    model = model_of(
        FIELD + "neuron SUM : relay\nR -> SUM.soma { weight = 0.1nS }\n"
    )
    into_sum = [c for c in model.contacts if c.post.instance == "SUM"]
    assert len(into_sum) == 16


def test_two_layers_of_one_grid_are_each_to_its_own():
    model = model_of(
        FIELD + "neuron S[4x4] : relay\nR -> S.soma { weight = 0.1nS }\n"
    )
    pairs = {(c.pre.instance, c.post.instance) for c in model.contacts}
    assert ("R[1,2]", "S[1,2]") in pairs
    assert ("R[1,2]", "S[2,1]") not in pairs
    assert len(pairs) == 16


def test_layers_of_different_grids_are_refused():
    with pytest.raises(ValidationError) as failure:
        load(
            FIELD + "neuron S[3x3] : relay\nR -> S.soma { weight = 0.1nS }\n",
            strict=True,
        )
    assert "разного размера" in str(failure.value)


def test_one_arrow_complains_once_however_many_cells_it_reached():
    # Претензия относится к написанной строке, а не к 16 её следствиям: 16
    # одинаковых строк не добавляют ни слова и прячут за собой остальные.
    _, diagnostics = load(
        FIELD.replace("delay = 1.0ms", "delay = 0.01ms"), strict=False
    )
    about_delay = [d for d in diagnostics if "задержка" in d.message]
    assert len(about_delay) == 1


# --- как это считается ----------------------------------------------------


def test_a_dark_pixel_says_nothing_and_a_lit_one_fires():
    model = model_of(FIELD)
    frame = lit([0.0] * 16, [5, 6])
    result = simulate(model, sense=[SenseEvent(time=0.0, sensor="eye", value=frame)])
    counts = result.spike_count()
    assert counts["R[1,1]"] > 0 and counts["R[1,2]"] > 0
    assert sum(counts[name] for name in counts if name not in ("R[1,1]", "R[1,2]")) == 0


def test_brightness_is_frequency_for_every_value_of_the_field():
    model = model_of(FIELD)
    full = simulate(
        model, sense=[SenseEvent(0.0, "eye", lit([0.0] * 16, [5]))]
    ).spike_count()["R[1,1]"]
    half = simulate(
        model, sense=[SenseEvent(0.0, "eye", lit([0.0] * 16, [5], 0.5))]
    ).spike_count()["R[1,1]"]
    # Ровно то же правило, что у одиночной двери: половина величины -- половина
    # потока. Поле не меняет в этом ничего.
    assert full == 18 and half == 6


def test_a_value_of_the_field_may_be_fed_alone():
    model = model_of(FIELD)
    sim = Simulator(model)
    sim.sense_at(0.0, "eye[1,1]", 1.0)
    result = sim.run()
    assert result.spike_count()["R[1,1]"] > 0
    assert result.spike_count()["R[0,0]"] == 0


def test_a_frame_that_does_not_fit_the_field_is_refused():
    sim = Simulator(model_of(FIELD))
    with pytest.raises(Exception) as failure:
        sim.sense_frame(0.0, "eye", [1.0] * 15)
    # Не дополняем нулями: источник, который шлёт 15 величин вместо 16,
    # ошибается, а дорисованный угол человек искал бы в схеме.
    assert "16 величин" in str(failure.value)


def test_the_same_frame_replays_spike_for_spike():
    model = model_of(FIELD)
    frame = lit([0.0] * 16, [0, 5, 10, 15])
    first = simulate(model, sense=[SenseEvent(20.0, "eye", frame)]).spikes
    second = simulate(model, sense=[SenseEvent(20.0, "eye", frame)]).spikes
    assert first == second


def test_rewinding_does_not_let_the_network_see_a_future_frame():
    model = model_of(FIELD)
    sim = Simulator(model)
    sim.sense_frame(0.0, "eye", list(lit([0.0] * 16, [5])))
    sim.advance(1000)          # 100 мс
    mark = sim.snapshot()
    sim.advance(500)
    sim.restore(mark)
    # Кадр подан на нулевой, значит после отката он всё ещё держится -- а вот
    # посчитанное после метки будущее стёрлось вместе с трассами.
    assert sim.held()["eye"][5] == 1.0
    assert len(sim.result.times) == mark.samples


def test_only_live_values_are_counted_each_step():
    # Свойство не про скорость ради скорости: без него шаг прогона стоил бы
    # всей сетки, и поле 24x24 считалось бы минутами.
    model = model_of(FIELD)
    sim = Simulator(model)
    sim.sense_frame(0.0, "eye", list(lit([0.0] * 16, [5])))
    sim.advance(10)
    assert sim.sensor_live["eye"] == {5}


# --- программа за дверью --------------------------------------------------


def test_a_source_line_may_carry_a_frame_or_a_single_value():
    frame = sources.parse_line('{"t": 10, "frame": [0, 0.5]}', "eye", "тест", 1)
    assert frame is not None and frame.is_frame and frame.time == 10.0
    single = sources.parse_line('{"value": 1, "at": "eye.r[3,7]"}', "eye", "тест", 2)
    assert single is not None and single.address == "eye.r[3,7]"
    assert single.time is None


def test_blank_lines_and_comments_are_not_readings():
    assert sources.parse_line("", "eye", "тест", 1) is None
    assert sources.parse_line("# греюсь", "eye", "тест", 2) is None


def test_a_broken_line_names_the_line_and_the_source():
    with pytest.raises(sources.SourceError) as failure:
        sources.parse_line("{не json}", "eye", "источник 'eye'", 7)
    message = str(failure.value)
    # Источник -- чужая программа, и ошибка в ней ищется по её выводу.
    assert "строка 7" in message and "eye" in message


def test_a_line_without_frame_or_value_is_refused():
    with pytest.raises(sources.SourceError):
        sources.parse_line('{"t": 5}', "eye", "тест", 1)


def test_a_source_is_read_to_the_end_of_its_output():
    command = (
        f'"{sys.executable}" -c "print(\'{{\\"frame\\": [0, 1]}}\'); '
        "print('{\\\"t\\\": 5, \\\"value\\\": 0.5}')\""
    )
    readings = sources.collect(command, "eye")
    assert len(readings) == 2
    assert readings[0].is_frame and readings[1].value == 0.5


# --- буквы ----------------------------------------------------------------


def run_tool(*args: str) -> list[dict]:
    done = subprocess.run(
        [sys.executable, str(TOOLS / "letters.py"), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=TOOLS,
    )
    assert done.returncode == 0, done.stderr
    return [json.loads(line) for line in done.stdout.splitlines() if line.strip()]


def test_a_letter_comes_out_as_a_frame_of_the_grid():
    (line,) = run_tool("T")
    frame = line["frame"]
    assert len(frame) == 24 * 24
    # Растры лежат в репозитории текстом, поэтому число светящихся пикселей --
    # свойство файла, а не шрифта, стоящего на машине.
    assert sum(1 for value in frame if value > 0) == 158


def test_letters_differ_from_each_other():
    counts = {
        name: sum(1 for value in run_tool(name)[0]["frame"] if value > 0)
        for name in ("T", "O", "I")
    }
    assert counts == {"T": 158, "O": 212, "I": 110}


def test_a_letter_may_be_dimmed():
    (line,) = run_tool("T", "--level", "0.5")
    assert max(line["frame"]) == 0.5


def test_a_colour_letter_fills_three_channels():
    (line,) = run_tool("T", "--channels", "rgb", "--color", "1,0,0")
    frame = line["frame"]
    assert len(frame) == 24 * 24 * 3
    # Красный светится, зелёный и синий -- нет: каналы в кадре чередуются.
    assert max(frame[0::3]) == 1.0 and max(frame[1::3]) == 0.0


def test_the_example_reads_a_letter_through_the_engine():
    model, _ = load(
        (EXAMPLES / "vision.vnl").read_text(encoding="utf-8"), strict=True
    )
    command = f'"{sys.executable}" "{TOOLS / "letters.py"}" T'
    readings = sources.collect(command, "eye")
    assert len(readings) == 1
    result = simulate(
        model,
        sense=[SenseEvent(0.0, "eye", tuple(readings[0].value))],  # type: ignore[arg-type]
    )
    counts = result.spike_count()
    awake = [name for name, count in counts.items() if count and name != "SUM"]
    # Те же числа, что записаны словами в шапке примера.
    assert len(awake) == 158
    assert counts["R[1,5]"] == 28
    assert counts["SUM"] == 28


def test_the_library_block_carries_the_field_and_its_layer():
    model, _ = load(
        (EXAMPLES / "library" / "retina24.vnl").read_text(encoding="utf-8"),
        strict=True,
    )
    assert model.sensors["eye"].size == 24 * 24
    assert model.populations["R"].size == 24 * 24
    assert len(model.sensors["eye"].targets) == 24 * 24
