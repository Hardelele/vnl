"""Граница сети с внешним миром: сенсор на входе, мотор на выходе (#560).

Проверяется одно и то же свойство с разных сторон: величина, поданная
снаружи, -- это вход прогона, а не свойство схемы. Отсюда и три опорные
проверки этого файла: без подачи сенсор молчит; с одной и той же записью
значений прогон повторяется спайк в спайк; отпечаток сети от подачи не
меняется.
"""

from pathlib import Path

import pytest

from vnl import ir, protocols
from vnl.backends.netpyne_export import export
from vnl.compose import compose
from vnl.patterns import Endpoint, Sandbox
from vnl.project import Project
from vnl.report import border_html
from vnl.resolve import ValidationError, load
from vnl.sim import SenseEvent, Simulator, simulate

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"

#: Схема приёмки задачи: один сенсор, одна клетка, один мотор.
SCHEMA = """
model border

cell motoneuron : excitatory, glutamate {
    tau_m      = 10ms
    threshold  = -50mV
    refractory = 2ms
}

neuron MN : motoneuron

sensor key : rate { to = 100Hz }
key -> MN.soma { weight = 2nS }
motor out : rate { from = MN.soma, window = 50ms }

record MN.soma.v
run { dt = 0.1ms  duration = 300ms  level = L1  seed = 1 }
"""


def model(text: str = SCHEMA) -> ir.Model:
    built, _ = load(text, source="тест")
    return built


def sensed(events: list[tuple[float, float]], text: str = SCHEMA):
    """Прогон по записи значений сенсора `key`."""
    built = model(text)
    log = [SenseEvent(time=time, sensor="key", value=value) for time, value in events]
    return built, simulate(built, sense=log)


# --- язык -------------------------------------------------------------------


def test_the_language_knows_both_doors():
    built = model()
    assert list(built.sensors) == ["key"]
    assert list(built.motors) == ["out"]
    assert built.sensors["key"].to == 100.0
    assert built.motors["out"].window == 50.0
    assert built.motors["out"].source == ir.Site("MN", "soma", 0.5)


def test_a_sensor_is_wired_by_the_same_arrow_as_a_cell():
    """`key -> MN.soma` -- обычная стрелка, и параметры у неё те же.

    Но контактом она не становится: у сенсора нет пресинаптической клетки, и
    появись он в `model.contacts`, по нему пошли бы искать клетку все, кто
    умеет читать контакты, -- раскладка, отчёт, экспорт.
    """
    built = model()
    assert built.contacts == [], "вход сенсора -- не контакт между клетками"
    link = built.sensors["key"].targets[0]
    assert link.target == ir.Site("MN", "soma", 0.5)
    assert (link.receptor, link.weight, link.delay) == ("ampa", 2.0, 1.0)


def test_a_sensor_may_feed_more_than_one_cell():
    built = model(
        SCHEMA.replace(
            "neuron MN : motoneuron",
            "neuron MN : motoneuron\nneuron MN2 : motoneuron",
        ).replace(
            "motor out",
            "key -> MN2.soma { weight = 2nS }\nmotor out",
        )
    )
    assert [link.target.instance for link in built.sensors["key"].targets] == [
        "MN",
        "MN2",
    ]


def test_an_unknown_kind_is_refused_instead_of_counted_as_another():
    with pytest.raises(ValidationError) as error:
        model(SCHEMA.replace("sensor key : rate", "sensor key : guess"))
    assert "неизвестный род сенсора" in str(error.value)


def test_a_typo_in_a_kind_parameter_is_refused():
    """Молча проглоченное `windwo` -- это мотор с чужим окном и уверенный в
    обратном человек."""
    with pytest.raises(ValidationError) as error:
        model(SCHEMA.replace("window = 50ms", "windwo = 50ms"))
    assert "windwo" in str(error.value)


def test_a_sensor_cannot_take_the_name_of_a_cell():
    with pytest.raises(ValidationError) as error:
        model(SCHEMA.replace("sensor key", "sensor MN"))
    assert "имя занято нейроном" in str(error.value)


def test_nothing_enters_a_sensor():
    with pytest.raises(ValidationError) as error:
        model(SCHEMA.replace("key -> MN.soma", "MN.axon -> key"))
    assert "в сенсор ничего не входит" in str(error.value)


def test_a_motor_needs_to_know_where_it_looks():
    with pytest.raises(SyntaxError) as error:
        model(SCHEMA.replace("from = MN.soma, ", ""))
    assert "from" in str(error.value)


def test_an_unwired_sensor_is_warned_about_but_not_refused():
    built, diagnostics = load(
        SCHEMA.replace("key -> MN.soma { weight = 2nS }", ""), source="тест"
    )
    assert built.sensors["key"].targets == []
    assert any("ни к чему не подключён" in d.message for d in diagnostics)
    assert all(d.severity == "warning" for d in diagnostics)


# --- роды -------------------------------------------------------------------


def test_the_rate_kind_pours_a_steady_stream():
    """100 Гц при единице -- это ровно один импульс на каждые 10 мс.

    Ровно, а не в среднем: нажатие обязано повториться в точности, и
    случайность здесь была бы лишней.
    """
    sensor = ir.Sensor(id="key", to=100.0)
    phase = 0.0
    times: list[float] = []
    for step in range(1000):           # 100 мс шагом 0.1 мс
        count, phase = protocols.sensor_events(sensor, 1.0, 1.0, phase, 0.1)
        times.extend([step * 0.1] * count)
    assert len(times) == 10
    gaps = {round(b - a, 6) for a, b in zip(times, times[1:])}
    assert gaps == {10.0}


def test_half_a_value_is_half_a_stream():
    sensor = ir.Sensor(id="key", to=100.0)
    phase = 0.0
    total = 0
    for _ in range(1000):
        count, phase = protocols.sensor_events(sensor, 0.5, 0.5, phase, 0.1)
        total += count
    assert total == 5


def test_a_silent_sensor_says_nothing_at_all():
    sensor = ir.Sensor(id="key", to=100.0)
    count, phase = protocols.sensor_events(sensor, 0.0, 0.0, 0.0, 0.1)
    assert (count, phase) == (0, 0.0)


def test_the_registry_allows_a_kind_that_answers_to_change():
    """Событийного рода пока нет, но место под него в реестре есть.

    Проверяется не он сам, а то, ради чего поле заведено: род объявляет, на
    что отвечает, и прошлая величина доходит до него вместе с нынешней -- без
    этого «нажали» и «держат» различить нечем.
    """
    assert protocols.SENSOR_KINDS["rate"].trigger == "level"
    seen: list[tuple[float, float]] = []

    def remember(sensor, value, previous, phase, dt):
        seen.append((previous, value))
        return (1 if value != previous else 0), phase

    edge = protocols.SensorKind(
        id="edge",
        name="изменение",
        note="тест",
        params=(),
        trigger="change",
        events=remember,
    )
    assert edge.events(None, 1.0, 0.0, 0.0, 0.1) == (1, 0.0)
    assert edge.events(None, 1.0, 1.0, 0.0, 0.1) == (0, 0.0)
    assert seen == [(0.0, 1.0), (1.0, 1.0)]


def test_a_motor_counts_the_window_and_only_the_window():
    motor = ir.Motor(id="out", source=ir.Site("MN", "soma", 0.5), window=50.0)
    spikes = [10.0, 120.0, 140.0, 150.0]
    # Три спайка за окно 50 мс -- это 60 Гц, а не «четыре спайка за прогон»:
    # давний разряд на 10-й миллисекунде в окно уже не попадает.
    assert protocols.motor_value(motor, spikes, 150.0) == pytest.approx(60.0)
    assert protocols.motor_value(motor, spikes, 100.0) == 0.0
    # Окно смотрит только назад: разрядов из будущего мотор не видит.
    assert protocols.motor_value(motor, spikes, 119.0) == 0.0


# --- прогон -----------------------------------------------------------------


def test_without_a_value_the_sensor_stays_silent():
    """Схема с сенсором считается и в одиночку -- просто вход у неё нулевой."""
    built = model()
    result = simulate(built)
    assert result.spike_count() == {"MN": 0}
    assert result.motors == {"out": 0.0}


def test_a_held_value_makes_the_cell_fire_and_the_motor_speak():
    """Приёмка: при 1 клетка разряжается и мотор отдаёт ненулевую величину."""
    _, result = sensed([(0.0, 1.0)])
    assert result.spike_count()["MN"] == 28
    assert result.motors["out"] == pytest.approx(100.0)


def test_letting_go_stops_both():
    """Приёмка: при 0 молчат оба -- и клетка, и мотор."""
    built, result = sensed([(100.0, 1.0), (200.0, 0.0)])
    spikes = result.spikes["MN"]
    assert len(spikes) == 9
    assert all(100.0 < time < 205.0 for time in spikes), spikes
    # Хвост проводимости после отпускания короче окна мотора, поэтому к концу
    # прогона мотор уже молчит -- это и значит «отпустили».
    assert result.motors["out"] == 0.0


def test_the_same_record_gives_the_same_run():
    """Главное требование: та же запись -- тот же прогон, спайк в спайк."""
    events = [(100.0, 1.0), (170.0, 0.0), (200.0, 1.0)]
    first = sensed(events)[1]
    second = sensed(events)[1]
    assert first.spikes == second.spikes
    assert first.traces == second.traces


def test_a_value_out_of_range_is_refused_not_clipped():
    simulator = Simulator(model())
    with pytest.raises(protocols.SenseError):
        simulator.sense_at(0.0, "key", 5.0)
    with pytest.raises(protocols.SenseError):
        simulator.sense_at(0.0, "key", -1.0)


def test_a_value_for_a_sensor_that_does_not_exist_is_refused():
    simulator = Simulator(model())
    with pytest.raises(protocols.SenseError) as error:
        simulator.sense_at(0.0, "педаль", 1.0)
    assert "key" in str(error.value)


def test_a_new_value_wipes_the_future_that_was_written_before():
    """Взялись за кнопку -- прежнее будущее перестало быть будущим.

    Иначе нажатие на 150-й отменялось бы отпусканием, записанным в прошлый
    раз на 200-й, и объяснить это тому, кто держит кнопку, было бы нечем.
    """
    simulator = Simulator(model())
    simulator.sense_at(100.0, "key", 1.0)
    simulator.sense_at(200.0, "key", 0.0)
    simulator.advance(1500)            # дошли до 150 мс
    simulator.sense_at(150.0, "key", 0.5)
    assert [(e.time, e.value) for e in simulator.sense_log] == [
        (100.0, 1.0),
        (150.0, 0.5),
    ]


def test_a_value_cannot_be_posted_into_the_past():
    """Посчитанное время уже посчитано: вписать туда нажатие нельзя."""
    simulator = Simulator(model())
    simulator.advance(1000)            # 100 мс
    event = simulator.sense_at(10.0, "key", 1.0)
    assert event.time == pytest.approx(100.0)


# --- песочница --------------------------------------------------------------


def sandbox_with_border() -> Project:
    """Та же схема приёмки, но собранная операциями проекта."""
    built = model()
    sandbox = Sandbox(id="s1", name="Граница", run=ir.RunSpec(duration=300.0))
    sandbox.cell_types["motoneuron"] = built.cell_types["motoneuron"]
    project = Project(sandbox)
    project.add_neuron("MN", built.cell_types["motoneuron"])
    project.add_sensor("key", to=100.0)
    project.connect(Endpoint("key"), Endpoint("MN"), link_id="l1", weight=2.0)
    project.add_motor(Endpoint("MN"), motor_id="out", window=50.0)
    return project


def test_a_sandbox_carries_the_border_into_the_network():
    built = compose(sandbox_with_border().sandbox).model
    assert list(built.sensors) == ["key"]
    assert list(built.motors) == ["out"]
    assert built.contacts == [], "связь от сенсора -- вход, а не контакт"
    assert built.sensors["key"].targets[0].weight == 2.0
    assert built.motors["out"].source.instance == "MN"


def test_a_sandbox_with_a_sensor_is_not_scolded_for_having_no_drive():
    """«Нечем спайкать» здесь неправда: спайкать есть чем, просто не нажали."""
    warnings = compose(sandbox_with_border().sandbox).warnings
    assert any("сенсор молчит" in note for note in warnings), warnings
    assert all("нечем спайкать" not in note for note in warnings)


def test_removing_a_cell_takes_the_motor_that_watched_it():
    project = sandbox_with_border()
    project.remove("MN")
    assert project.sandbox.motors == []
    assert project.sandbox.links == [], "связь сенсора вела в убранную клетку"
    assert project.sandbox.sensors, "сам сенсор при этом остался"


def test_removing_a_sensor_takes_its_wire():
    project = sandbox_with_border()
    project.remove("key")
    assert project.sandbox.sensors == []
    assert project.sandbox.links == []


def test_a_sensor_cannot_take_a_taken_name():
    project = sandbox_with_border()
    with pytest.raises(Exception) as error:
        project.add_sensor("MN")
    assert "занято" in str(error.value)


def test_the_sandbox_border_survives_a_save(tmp_path):
    """Сохранение идёт по объявленным полям -- значит и граница сохраняется."""
    from vnl.store import Store, to_plain

    project = sandbox_with_border()
    store = Store(tmp_path)
    store.save_sandbox(project.sandbox)
    again = store.load_sandbox("s1")
    assert to_plain(again) == to_plain(project.sandbox)
    assert again.sensors[0].to == 100.0
    assert again.motors[0].source.instance == "MN"


def test_a_value_does_not_change_the_fingerprint():
    """Подача -- вход, а не схема: прогон от неё не стареет."""
    project = sandbox_with_border()
    before = project.fingerprint()
    built = compose(project.sandbox).model
    simulator = Simulator(built)
    simulator.sense_at(0.0, "key", 1.0)
    simulator.advance(500)
    assert project.fingerprint() == before


# --- о границе говорят вслух ------------------------------------------------


def test_the_export_admits_the_border_is_left_behind():
    losses = export(model()).losses
    assert any("сенсор key" in note for note in losses), losses
    assert any("мотор out" in note for note in losses), losses


def test_the_report_has_a_section_about_the_border():
    built = model()
    result = simulate(built, sense=[SenseEvent(0.0, "key", 1.0)])
    html = border_html(built, result)
    assert "Граница с миром" in html
    assert "сенсор key" in html and "мотор out" in html
    assert "100 Гц при 1" in html


def test_a_schema_without_a_border_gets_no_section():
    """Отчёт схемы без сенсоров обязан остаться ровно таким, каким был."""
    plain, _ = load((EXAMPLES / "ffi.vnl").read_text(encoding="utf-8"))
    assert border_html(plain, simulate(plain)) == ""
