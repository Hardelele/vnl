"""Граница сети с внешним миром: сенсор на входе, мотор на выходе (#560).

Проверяется одно и то же свойство с разных сторон: величина, поданная
снаружи, -- это вход прогона, а не свойство схемы. Отсюда и три опорные
проверки этого файла: без подачи сенсор молчит; с одной и той же записью
значений прогон повторяется спайк в спайк; отпечаток сети от подачи не
меняется.
"""

import math
from pathlib import Path

import pytest

from vnl import ir, protocols
from vnl.backends.netpyne_export import export
from vnl.compose import compose
from vnl.patterns import Endpoint, Sandbox
from vnl.project import Project
from vnl.report import border_html
from vnl.resolve import ValidationError, load
from vnl.expectations import check_model, failures
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


#: Та же схема родом `hold`: величина держит проводимость, а не льёт импульсы.
#: Вес подставляется -- вокруг него и идёт весь разговор о чувствительности.
HOLD = """
model border_hold

cell motoneuron : excitatory, glutamate {{
    tau_m      = 10ms
    threshold  = -50mV
    refractory = 2ms
}}

neuron MN : motoneuron

sensor touch : hold
touch -> MN.soma {{ receptor = ampa  weight = {weight}nS  delay = 1.0ms }}

record MN.soma.v
record MN.soma.g_exc
run {{ dt = 0.1ms  duration = 300ms  level = L1  seed = 1 }}
"""


def model(text: str = SCHEMA) -> ir.Model:
    built, _ = load(text, source="тест")
    return built


def sensed(events: list[tuple[float, float]], text: str = SCHEMA):
    """Прогон по записи значений сенсора `key`."""
    built = model(text)
    name = "touch" if "sensor touch" in text else "key"
    log = [SenseEvent(time=time, sensor=name, value=value) for time, value in events]
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


# --- род удержания ----------------------------------------------------------
#
# Род `rate` льёт импульсы, и это про аксон, который уже выстрелил. Сам
# сенсорный нейрон устроен иначе: каналы открыты, пока есть стимул. Отсюда
# второй род -- `hold`, у которого величина превращается в проводимость и
# держится (#579).


def test_the_hold_kind_opens_a_share_of_the_weight():
    """Доля идёт пропорционально величине, и своего числа у рода нет.

    «Сколько откроется при полной величине» -- это вес связи; второй множитель
    в свойствах сенсора спрашивал бы силу дважды.
    """
    sensor = ir.Sensor(id="touch", kind="hold")
    assert protocols.sensor_hold(sensor, 1.0) == 1.0
    assert protocols.sensor_hold(sensor, 0.5) == 0.5
    assert protocols.sensor_hold(sensor, 0.0) == 0.0
    # У событийного рода держать нечего, и он отвечает нулём, а не ошибкой:
    # солвер спрашивает оба вопроса у всякого сенсора.
    assert protocols.sensor_hold(ir.Sensor(id="key", kind="rate"), 1.0) == 0.0
    assert protocols.sensor_events(sensor, 1.0, 1.0, 0.0, 0.1) == (0, 0.0)


def test_the_hold_kind_declares_conductance_and_not_current():
    """Род говорит, чем действует, и это не придирка к слову.

    У проводимости есть реверсал: она тянет мембрану к нему, у него же
    останавливается и попутно шунтирует всё остальное. Ток не знает, где
    клетка, и гонит её куда угодно. Рецептор -- это открытые каналы, то есть
    проводимость; током подают из пипетки.
    """
    kind = protocols.SENSOR_KINDS["hold"]
    assert (kind.emits, kind.trigger, kind.receptor) == ("conductance", "level", True)
    assert kind.params == (), "своего числа у рода нет: сила живёт на связи"


def test_a_held_input_stands_exactly_where_it_was_put():
    """Проводимость держится на написанном весе, а не подползает к нему.

    Удержание выражено подливанием утёкшего, и проверка здесь именно на это:
    подлей чуть меньше -- уровень поедет вниз, чуть больше -- вверх, и оба
    случая видны в третьем знаке.
    """
    _, result = sensed([(0.0, 1.0)], HOLD.format(weight=0.25))
    conductance = result.traces["MN.soma:g_exc"]
    assert conductance[-1] == pytest.approx(0.25, abs=1e-9)
    # И потенциал встаёт туда, куда велит уравнение мембраны:
    # v = (v_rest + g·E) / (1 + g) = -65 / 1.25.
    assert result.traces["MN.soma:v"][-1] == pytest.approx(-52.0, abs=0.01)


def test_half_a_value_opens_half_the_weight():
    _, result = sensed([(0.0, 0.5)], HOLD.format(weight=0.5))
    assert result.traces["MN.soma:g_exc"][-1] == pytest.approx(0.25, abs=1e-9)


def test_holding_takes_the_threshold_three_times_cheaper_than_the_stream():
    """Приёмка задачи, числом с обеих сторон порога.

    0.3 нСм -- ровно порог по формуле, поэтому проверяются соседи: 0.35
    разряжает, 0.25 не разряжает ни разу и стоит под порогом сколько угодно
    долго. Потоку в 100 Гц на то же самое не хватает и 1 нСм -- вчетверо
    большего веса.
    """
    _, fires = sensed([(0.0, 1.0)], HOLD.format(weight=0.35))
    assert len(fires.spikes["MN"]) > 0

    _, quiet = sensed([(0.0, 1.0)], HOLD.format(weight=0.25))
    assert quiet.spikes["MN"] == []
    assert max(quiet.traces["MN.soma:v"]) < -50.0

    _, stream = sensed([(0.0, 1.0)], SCHEMA.replace("weight = 2nS", "weight = 1nS"))
    assert stream.spikes["MN"] == [], "потоку того же не хватает и вчетверо"


def test_letting_go_closes_the_channel():
    """Отпустили -- канал закрывается, и остаток утекает постоянной рецептора.

    Не обрывается: открытые каналы закрываются не мгновенно, и обрыв был бы
    единственным местом в движке, где проводимость исчезает скачком.
    """
    _, result = sensed([(0.0, 1.0), (100.0, 0.0)], HOLD.format(weight=0.35))
    assert result.spikes["MN"], "до отпускания клетка обязана разряжаться"
    assert max(result.spikes["MN"]) < 105.0, "после отпускания разрядов нет"

    trace = result.traces["MN.soma:g_exc"]
    step = int(round(100.0 / 0.1))
    assert trace[step] == pytest.approx(0.35, abs=1e-9)
    # Спад начинается на миллисекунду позже отпускания -- ровно на задержке
    # связи: отпущенное едет к клетке столько же, сколько нажатое. Через
    # десять постоянных спада (tau AMPA 2 мс) от уровня остаются тысячные, но
    # не ровно ноль.
    assert 0.0 < trace[step + 200] < 0.35 * 0.001


def test_the_level_travels_the_same_delay_as_an_impulse():
    """Величина доходит до клетки за задержку связи, а не мгновенно.

    Провести её мгновенно значило бы сказать, что у двери, в отличие от
    всякого другого входа, расстояния нет.
    """
    _, result = sensed([(0.0, 1.0)], HOLD.format(weight=0.35).replace(
        "delay = 1.0ms", "delay = 5.0ms"
    ))
    trace = result.traces["MN.soma:g_exc"]
    opened = next(index for index, value in enumerate(trace) if value > 0.0)
    assert opened * 0.1 == pytest.approx(5.0, abs=0.11)


def test_rewinding_replays_a_held_input():
    """Откат и пересчёт дают тот же прогон -- спайк в спайк.

    Уровень в пути -- такое же состояние, как выброс в пути, и в снимке он
    обязан лежать по той же причине: без него откат вернул бы клетку в момент,
    когда дверь уже открыта, а проводимости к ней ещё не доехало.
    """
    built = model(HOLD.format(weight=0.35))
    log = [SenseEvent(time=0.0, sensor="touch", value=1.0)]

    straight = simulate(built, sense=list(log))

    simulator = Simulator(built, sense=list(log))
    simulator.advance(1000)
    mark = simulator.snapshot()
    simulator.advance(2000)
    simulator.restore(mark)
    simulator.result.truncate(mark.samples)
    simulator.advance(2000)

    assert simulator.result.spikes["MN"] == straight.spikes["MN"]
    assert simulator.result.traces["MN.soma:g_exc"] == pytest.approx(
        straight.traces["MN.soma:g_exc"]
    )


def test_a_held_input_adds_to_what_else_arrives():
    """Удержание складывается с прочим входом в тот же рецептор, а не подменяет.

    Подливается столько, сколько утекло с удерживаемого уровня, и добавка не
    смотрит, что уже лежит в канале, -- поэтому импульс, пришедший поверх,
    остаётся целым импульсом.
    """
    text = HOLD.format(weight=0.25).replace(
        "record MN.soma.v",
        "stim extra -> MN.soma : spikes weight=1nS times=\"150\"\nrecord MN.soma.v",
    )
    _, result = sensed([(0.0, 1.0)], text)
    trace = result.traces["MN.soma:g_exc"]
    peak = max(trace[int(round(150.0 / 0.1)) : int(round(160.0 / 0.1))])
    # Удержание стоит ровно на 0.25, а импульс виден с первым своим спадом --
    # как всякий импульс в этом движке: пик записывается после шага спада, и
    # потому 1 нСм веса даёт 1·exp(−dt/tau) в трассе. Разница между «держат» и
    # «ударили» тут и видна: уровень не спадает, удар спадает сразу.
    kept = math.exp(-0.1 / 2.0)
    assert peak == pytest.approx(0.25 + kept, abs=1e-6), "импульс лёг поверх уровня"
    assert trace[-1] == pytest.approx(0.25, abs=1e-9), "и уровень остался своим"


def test_the_stream_kind_is_untouched():
    """Род `rate` обязан считать ровно то же, что считал до второго рода."""
    _, result = sensed([(0.0, 1.0)])
    assert len(result.spikes["MN"]) == 28


def test_the_loop_through_the_world_runs_on_a_held_input():
    """Петля #574 на тоническом сенсоре заводится и держится.

    Здесь воспроизведено то, что делает браузер: кадрами по 8 мс смотрит на
    мотор и держит кнопку, пока он ненулевой. Толчок -- три импульса драйва,
    после них сеть себя поддерживает сама: разряд -> мотор -> кнопка ->
    удержание -> разряд.

    Числа этого замера: петля подхватывает через 4.7 модельных мс после
    первого разряда (задержка связи 1 мс плюс кадр опроса), и дальше клетка
    разряжается до конца прогона. Проверяется не само 4.7 -- оно зависит от
    кадра, -- а то, что задержка не больше кадра с задержкой связи и что
    петля живёт после конца толчка.
    """
    text = HOLD.format(weight=0.35).replace(
        "record MN.soma.v",
        'motor out : rate { from = MN.soma, window = 50ms }\n'
        'stim kick -> MN.soma : spikes weight=3nS times="50 52 54"\n'
        "record MN.soma.v",
    )
    built = model(text)
    simulator = Simulator(built)

    frame = int(round(8.0 / simulator.dt))
    held = 0.0
    caught: float | None = None
    while simulator.step < simulator.total_steps:
        simulator.advance(frame)
        value = 1.0 if simulator.motors()["out"] > 0.0 else 0.0
        if value != held:
            now = simulator.step * simulator.dt
            simulator.sense_at(now, "touch", value)
            if value == 1.0 and caught is None:
                caught = now
            held = value

    spikes = simulator.result.spikes["MN"]
    first = spikes[0]
    assert caught is not None, "петля обязана подхватить разряд"
    assert caught - first <= 8.0 + 1.0, "дольше кадра с задержкой связи"
    # Толчок кончился на 54 мс; всё, что после, -- работа самой петли.
    # Прогон идёт 300 мс, и последний разряд стоит от его конца не дальше, чем
    # петля вообще разряжает клетку (около 18 мс).
    assert max(spikes) > 250.0, "петля обязана держать сеть до конца прогона"
    assert len(spikes) > 10


def test_the_example_holds_its_numbers():
    """Числа шапки `examples/sensor_hold.vnl` сверяются прогоном (#501).

    Прогон -- по той же записи входа, при которой числа сняты: без поданной
    величины сенсор молчит, и сверять было бы нечего.
    """
    text = (EXAMPLES / "sensor_hold.vnl").read_text(encoding="utf-8")
    built, diagnostics = load(text, source="examples/sensor_hold.vnl", strict=True)
    assert not [d for d in diagnostics if d.severity == "error"]
    result = simulate(
        built,
        sense=[
            SenseEvent(time=100.0, sensor="touch", value=1.0),
            SenseEvent(time=200.0, sensor="touch", value=0.0),
        ],
    )
    assert not failures(check_model(built, result))


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


def test_a_sandbox_sensor_can_be_held_and_switched_back():
    """Род выбирается и в песочнице, и смена рода не теряет набранного.

    Число `to` остаётся лежать на сенсоре и при роде `hold`, который его не
    читает, -- ровно как числа неиспользуемого рода лежат у стимула: заглянул
    в соседний род и вернулся -- своё на месте.
    """
    project = sandbox_with_border()
    sensor = project.set_sensor("key", kind="hold")
    assert sensor.kind == "hold"
    assert sensor.to == 100.0, "число прежнего рода не выброшено"

    built = compose(project.sandbox).model
    assert built.sensors["key"].kind == "hold"

    result = simulate(
        built, sense=[SenseEvent(time=0.0, sensor="key", value=1.0)]
    )
    assert result.spikes["MN"], "весом 2 нСм удержание разряжает клетку с запасом"

    assert project.set_sensor("key", kind="rate").kind == "rate"


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
