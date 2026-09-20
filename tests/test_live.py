"""Сессия симуляции: пуск, пауза, откат и приращения.

Время здесь двигается вручную (`advance_ms`), а не ожиданием настоящих
секунд: тест, который спит, проверяет заодно и скорость машины.
"""

from pathlib import Path

import pytest

from vnl import protocols
from vnl.live import Pool, Session, SessionError
from vnl.resolve import load
from vnl.sim.lif import simulate

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def model(name: str = "ffi"):
    parsed, _ = load((EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8"))
    return parsed


@pytest.fixture
def session():
    item = Session("s1", model(), source="паттерн ffi")
    yield item
    item.close()


def test_a_fresh_session_stands_still(session):
    assert session.state == "paused"
    assert session.update()["samples"] == 0
    assert session.update()["time"] == 0.0


def test_time_moves_only_when_asked(session):
    session.advance_ms(50)
    first = session.update()
    assert first["time"] == pytest.approx(50.0, abs=session.dt)
    assert first["samples"] == 500


def test_an_update_brings_only_what_is_new(session):
    session.advance_ms(50)
    session.update()
    session.advance_ms(10)

    delta = session.update(since=500)
    assert delta["from"] == 500
    assert delta["rewound"] is False
    assert all(len(values) == 100 for values in delta["traces"].values())
    assert all(time >= 50.0 for times in delta["spikes"].values() for time in times)


def test_the_end_of_the_run_is_a_state_not_an_error(session):
    session.advance_ms(session.duration + 100)
    assert session.state == "finished"
    assert session.update()["samples"] == session.simulator.total_steps

    session.start()
    assert session.state == "finished", "продолжать неоткуда -- это дело «Сброса»"


def test_seek_rewinds_the_engine_not_the_cursor(session):
    session.advance_ms(200)
    later = session.update()

    session.seek(80.0)
    back = session.update()

    assert back["state"] == "paused"
    assert back["time"] == pytest.approx(80.0, abs=session.dt)
    assert back["samples"] < later["samples"], "записанное будущее стёрлось"
    # Состояние клеток -- то, что было в ту секунду, а не то, что осталось.
    assert back["cells"] != later["cells"]


def test_continuing_after_a_rewind_repeats_the_same_future(session):
    whole = simulate(model())

    session.advance_ms(300)
    session.seek(120.0)
    session.advance_ms(session.duration)

    assert session.simulator.result.spikes == whole.spikes
    assert session.simulator.result.traces == whole.traces


def test_a_client_ahead_of_the_session_is_told_to_start_over(session):
    session.advance_ms(200)
    session.seek(20.0)

    delta = session.update(since=2000)
    assert delta["rewound"] is True
    assert delta["from"] == 0, "интерфейсу отдаётся всё заново, а не пустота"


def test_reset_returns_to_the_very_beginning(session):
    session.advance_ms(200)
    session.reset()

    fresh = session.update()
    assert fresh["time"] == 0.0
    assert fresh["samples"] == 0
    assert fresh["state"] == "paused"


def test_snapshots_are_kept_along_the_way(session):
    session.advance_ms(200)
    marks = [mark.time for mark in session._marks]
    assert marks[0] == 0.0
    assert len(marks) > 1
    # Шаг между снимками -- заданный, а не какой получится.
    steps = [round(b - a, 3) for a, b in zip(marks, marks[1:])]
    assert all(step >= session.snapshot_every for step in steps)


def test_marks_after_the_rewind_point_are_dropped(session):
    session.advance_ms(200)
    session.seek(50.0)
    assert all(mark.time <= 50.0 for mark in session._marks)


def test_the_running_flag_reflects_reality(session):
    session.start()
    assert session.state == "running"
    session.pause()
    assert session.state == "paused"


def test_a_session_remembers_what_it_was_opened_from():
    """Происхождение сессии -- её свойство, а не догадка по идентификатору.

    Одной подписи для интерфейса не хватает: от «паттерн или песочница» зависит,
    пускать ли к `/api/sim/<id>` без входа, а по пути этого не видно. Сессия без
    сказанного происхождения считается песочницей -- забытое должно оказаться
    закрытым, а не открытым.
    """
    pool = Pool()
    shown = pool.open(model(), source="паттерн ffi", origin="pattern")
    assert pool.origin_of(shown.id) == "pattern"
    assert pool.origin_of(pool.open(model()).id) == "sandbox"
    # «Такой нет» -- не ошибка, а такой же ответ «сюда нельзя».
    assert pool.origin_of("sim404") is None
    pool.close_all()


def test_a_pool_hands_out_and_closes_sessions():
    pool = Pool()
    first = pool.open(model(), source="паттерн ffi")
    second = pool.open(model(), source="песочница")
    assert first.id != second.id
    assert len(pool) == 2
    assert pool.get(first.id) is first

    pool.close(first.id)
    assert len(pool) == 1
    with pytest.raises(SessionError, match="нет"):
        pool.get(first.id)

    pool.close_all()
    assert len(pool) == 0


# --- заряд клетки ---------------------------------------------------------
#
# Насколько клетка заряжена -- это доля пути от покоя до порога, и она приходит
# в интерфейсе вместе с потенциалом. Проверяется здесь не арифметика, а смысл
# концов шкалы: покой -- ноль, порог -- сто процентов, ниже покоя -- минус.


def test_at_rest_the_charge_is_nothing(session):
    """Покой -- ноль: от него и ведётся отсчёт доли."""
    cells = session.update()["cells"]
    # Доля есть у всех клеток, а не только у тех, за которыми ведётся запись:
    # схема подсвечивается целиком.
    assert set(cells) == {"IN", "E", "I"}
    assert all(cell["charge"] == 0.0 for cell in cells.values())


def test_at_the_threshold_the_charge_is_whole(session):
    """Порог -- сто процентов: на нём происходит разряд."""
    cell = session.simulator.cells["E"]
    cell.v = cell.model.v_threshold
    assert session.update()["cells"]["E"]["charge"] == 1.0


def test_each_cell_is_measured_by_its_own_threshold(session):
    """У клеток разные пороги, и каждая считается по своему.

    Общая на всех шкала врала бы про то, насколько клетка близка к разряду:
    один и тот же потенциал для корзинчатой клетки ближе к порогу, чем для
    пирамиды, -- в этом половина смысла торможения с опережением.
    """
    for name in ("E", "I"):
        session.simulator.cells[name].v = -57.5

    cells = session.update()["cells"]
    # E -- пирамида, порог -50 мВ: ровно полпути от покоя -65 мВ.
    assert cells["E"]["charge"] == 0.5
    # I -- корзинчатая, порог -52 мВ: тот же потенциал уже 58% пути.
    assert cells["I"]["charge"] == pytest.approx(7.5 / 13.0, abs=1e-3)
    assert cells["I"]["charge"] > cells["E"]["charge"]


def test_a_discharge_reads_as_a_full_charge(session):
    """В кадре разряда потенциал уже сброшен, а доля обязана показать сто.

    Иначе спайк выглядел бы на схеме как мгновенно опустевшая клетка -- ровно в
    тот момент, который нужно увидеть.
    """
    while not session.simulator.finished:
        session.advance_ms(session.dt)
        spiking = [
            name for name, cell in session.simulator.cells.items() if cell.spiked
        ]
        if spiking:
            break

    assert spiking, "за прогон не разрядилась ни одна клетка"
    cells = session.update(since=session.simulator.step)["cells"]
    for name in spiking:
        assert cells[name]["charge"] == 1.0
        # Потенциал при этом уже на `v_reset`: доля говорит о разряде, а не о
        # том, что осталось от него на мембране.
        assert cells[name]["v"] == session.simulator.cells[name].model.v_reset


def test_a_frame_shows_the_discharge_that_happened_between_frames(session):
    """Кадр редкий, разряд короткий -- и на мгновенном значении его не видно.

    Между двумя взглядами проходит полсотни шагов (темп 50 мс модели в секунду,
    `dt` 0.1 мс), а разряд занимает один: у `E` в `ffi` это пять шагов из трёх
    тысяч. Спрашивая последний шаг, сто процентов не увидишь никогда -- хотя в
    движке клетка доходит до них при каждом спайке. Поэтому кадр рассказывает
    про весь отрезок: был ли разряд и до чего клетка дошла.
    """
    seen_spike = False
    peaks: list[float] = []
    while not session.simulator.finished:
        # Ровно столько модельного времени, сколько проходит между кадрами.
        session.advance_ms(50.0 * 0.1)
        cells = session.update(since=session.simulator.step)["cells"]
        if cells["E"]["spiked"]:
            seen_spike = True
            peaks.append(cells["E"]["peak"])

    assert seen_spike, "разряд `E` не попал ни в один кадр"
    assert all(peak >= 1.0 for peak in peaks), "кадр с разрядом не дошёл до ста"


def test_a_frame_without_a_discharge_does_not_invent_one(session):
    """Пик не должен тянуться из прошлого: он про этот отрезок, а не про прогон."""
    session.advance_ms(5.0)
    session.update(since=session.simulator.step)
    # Второй взгляд сразу за первым: считать между ними нечего.
    cells = session.update(since=session.simulator.step)["cells"]

    assert cells["E"]["spiked"] is False
    assert cells["E"]["peak"] == cells["E"]["charge"]


def test_a_rewind_forgets_the_peak_of_a_future_that_no_longer_is(session):
    """Откат возвращает состояние -- и накопленное для показа тоже.

    Иначе первый кадр после отката показал бы пик из отменённого будущего.
    """
    session.advance_ms(100.0)
    session.update(since=session.simulator.step)
    session.seek(1.0)

    cells = session.update(since=0)["cells"]
    assert cells["E"]["spiked"] is False
    assert cells["E"]["peak"] == cells["E"]["charge"]


def test_a_rewind_forwards_does_not_leave_an_old_discharge_glowing():
    """Перемотка вперёд не превращает давний разряд в сегодняшний (#534).

    Снимок берётся до запрошенного момента, остаток догоняется шагами, и
    взгляда между ними нет. Без обнуления первый же кадр сообщал бы `fired`
    про всякую клетку, разрядившуюся где-то внутри догоняемого отрезка, --
    а человек видел бы на схеме сто процентов у клетки, которая давно стоит
    на покое и по растру молчит.

    Отрезок тем длиннее, чем больше возили курсором: снимки после точки
    отката выбрасываются, новых при перемотке не берут. Поэтому в тесте
    сначала откат к началу, и только потом ход вперёд.
    """
    item = Session("s2", model("library/convergent_excitation"), source="сходящееся")
    try:
        item.advance_ms(250.0)
        item.update(since=0)
        item.seek(10.0)
        item.seek(105.0)

        payload = item.update(since=0)
        cells = payload["cells"]
        # `A` разрядилась на 50.4 мс и с тех пор молчит: к 105 мс она на покое.
        assert payload["spikes"]["A"] == [50.4]
        assert cells["A"]["spiked"] is False
        assert cells["A"]["peak"] == cells["A"]["charge"]
        assert cells["A"]["charge"] == pytest.approx(0.0, abs=0.01)
        # `B` разрядилась на 100.4 мс -- тоже до этого момента, а не в нём.
        assert cells["B"]["spiked"] is False
        # А `X` за порог так и не вышла: её доля -- настоящая, и её видно.
        assert cells["X"]["spiked"] is False
        assert 0.5 < cells["X"]["charge"] < 0.8
    finally:
        item.close()


# --- шаг по времени -------------------------------------------------------
#
# Шаг и прыжок курсором кончаются одним -- время встало на другом моменте, -- а
# различаются ровно тем, показан ли разряд, попавший внутрь перехода. Поэтому
# проверяется здесь не арифметика времени, а это различие: шаг вперёд -- кадр,
# прыжок -- не кадр, шаг назад -- состояние, а не событие.
#
# Схема `synaptic_delay` выбрана за известные наперёд моменты разрядов: `NEAR`
# разряжается на 23.8 мс (шапка паттерна обещает то же число), `FAR` -- на 9 мс
# позже. Значит шаг с 23.0 на 24.0 накрывает разряд, а следующий -- уже нет.


def delayed() -> Session:
    return Session("s-step", model("library/synaptic_delay"), source="задержка")


def test_a_step_forward_shows_the_discharge_inside_it():
    """Разряд, попавший в шаг, виден -- ради этого шагают.

    Разряд занимает один шаг движка из десяти в миллисекунде, и по мгновенному
    значению его не видно никогда: сразу после него клетка на `v_reset`, то
    есть по заряду -- ноль. Шаг вперёд -- кадр, и кадр рассказывает про весь
    отрезок.
    """
    item = delayed()
    try:
        item.seek(23.0)
        before = item.update(since=0)["cells"]["NEAR"]
        assert before["spiked"] is False, "разряд ещё не случился"

        item.step(1.0)
        inside = item.update(since=0)
        assert inside["time"] == pytest.approx(24.0, abs=item.dt)
        assert inside["spikes"]["NEAR"] == [23.8], "разряд и правда внутри шага"
        assert inside["cells"]["NEAR"]["spiked"] is True
        assert inside["cells"]["NEAR"]["peak"] >= 1.0

        item.step(1.0)
        after = item.update(since=0)["cells"]["NEAR"]
        # В следующем шаге -- настоящий заряд после сброса, а не тот же пик.
        assert after["spiked"] is False
        assert after["peak"] == after["charge"]
    finally:
        item.close()


def test_a_step_back_shows_the_state_not_the_event():
    """Назад смотрят на состояние: разряда, случившегося позже, там нет.

    Шаг назад иначе как восстановлением не сделать -- движок умеет идти только
    вперёд, -- но дело не в механике: миллисекундой раньше разряда ещё не
    было, и показывать его значило бы врать про момент, на который встали.
    """
    item = delayed()
    try:
        item.seek(23.0)
        item.step(1.0)
        assert item.update(since=0)["cells"]["NEAR"]["spiked"] is True

        item.step(-1.0)
        back = item.update(since=0)
        assert back["time"] == pytest.approx(23.0, abs=item.dt)
        cells = back["cells"]["NEAR"]
        assert cells["spiked"] is False
        assert cells["peak"] == cells["charge"]
        # И это настоящий заряд той миллисекунды, а не ноль после сброса.
        assert cells["charge"] > 0.5
    finally:
        item.close()


def test_a_jump_of_the_same_size_is_still_not_a_frame():
    """Прыжок курсором не показывает разряд, даже если он ровно с шаг.

    Ради этого шаг и перемотка -- разные вызовы, а не один с догадкой по
    величине дельты: догадка однажды ошиблась бы, и человек увидел бы разряд
    из чужого отрезка (#534 про то, чем это кончается).
    """
    item = delayed()
    try:
        item.seek(23.0)
        item.seek(24.0)

        cells = item.update(since=0)["cells"]["NEAR"]
        assert cells["spiked"] is False
        assert cells["peak"] == cells["charge"]
    finally:
        item.close()


def test_steps_leave_snapshots_to_come_back_to():
    """Шаг берёт снимки: иначе откатываться после сотни шагов будет некуда.

    Внутри перемотки движок идёт без снимков, и если бы шаг был устроен так
    же, то сто шагов по миллисекунде от начала оставили бы один снимок на
    нуле -- и следующий шаг назад пересчитывал бы весь прогон заново.
    """
    item = delayed()
    try:
        item.seek(20.0)
        marks = len(item._marks)
        for _ in range(60):
            item.step(1.0)

        assert item.elapsed == pytest.approx(80.0, abs=item.dt)
        assert len(item._marks) > marks, "за 60 мс шагов не взято ни одного снимка"
        assert all(mark.time <= item.elapsed for mark in item._marks)
    finally:
        item.close()


def test_a_step_stops_the_running_time():
    """Шаг -- это кадр по требованию, и время после него стоит.

    Иначе шагнувший на миллисекунду тут же потерял бы её: фоновый поток
    добавил бы своё, и разглядеть отрезок было бы нечем.
    """
    item = delayed()
    try:
        item.start()
        assert item.state == "running"
        item.step(1.0)
        assert item.state == "paused"
    finally:
        item.close()


def test_a_step_does_not_run_past_the_end_of_the_run():
    item = delayed()
    try:
        item.seek(item.duration)
        item.step(1.0)
        assert item.elapsed == pytest.approx(item.duration, abs=item.dt)
    finally:
        item.close()


def test_a_step_back_from_the_start_stays_at_the_start():
    item = delayed()
    try:
        item.seek(0.5)
        item.step(-1.0)
        assert item.elapsed == 0.0
    finally:
        item.close()


def test_inhibition_reads_as_a_charge_below_rest():
    """Клетка ниже покоя -- отрицательная доля, а не ноль.

    Ноль здесь означал бы «клетка в покое», то есть что тормозный вход ничего не
    сделал, -- ровно наоборот тому, что произошло. Схема `hyperpolarizing_-
    inhibition` для этого и сделана: gaba_a с реверсалом -70 мВ тянет мембрану
    ниже покоя -65 мВ, и на прогоне она доходит до -69.2 мВ.
    """
    session = Session("s-inh", model("library/hyperpolarizing_inhibition"))
    try:
        lowest = 0.0
        while not session.simulator.finished:
            session.advance_ms(0.5)
            # Приращением, а не целиком: полный ответ переписывал бы все трассы
            # на каждом шаге, и тест мерил бы скорость машины.
            cells = session.update(since=session.simulator.step)["cells"]
            lowest = min(lowest, cells["E"]["charge"])
    finally:
        session.close()

    # (-69.2 + 65) / (-50 + 65) = -0.28: доля не обрезана нулём и видна.
    assert lowest == pytest.approx(-0.28, abs=0.02)


# --- живой вход: сенсор и мотор в сессии (#561) ------------------------------
#
# Опорное свойство одно: поток входа -- часть состояния сессии, а не внешняя
# переменная. Из него следуют все проверки ниже, включая ту, ради которой всё
# затевалось: опыт с кнопками обязан повторяться.


@pytest.fixture
def border():
    """Сессия со схемой приёмки: сенсор `key`, клетка `MN`, мотор `out`."""
    item = Session("s-border", model("sensor_motor"), source="песочница")
    yield item
    item.close()


def pressed(session, hold=(100.0, 200.0)):
    """Нажать на 100-й миллисекунде и отпустить на 200-й, досчитав до конца."""
    start, stop = hold
    session.advance_ms(start)
    session.sense("key", 1)
    session.advance_ms(stop - start)
    session.sense("key", 0)
    session.advance_ms(session.duration)
    return session.update()


def test_a_session_without_a_border_answers_exactly_as_before(session):
    """Сессия без сенсоров -- без лишних полей: иначе «ничего не поменялось»
    пришлось бы доказывать."""
    payload = session.update()
    assert "sensors" not in payload
    assert "motors" not in payload
    assert "input" not in payload


def test_a_pressed_sensor_makes_the_cell_fire_inside_the_window(border):
    """Приёмка: разряды есть между 100 и 200 мс и нет вне этого окна."""
    payload = pressed(border)
    spikes = border.simulator.result.spikes["MN"]

    assert spikes, "клетка обязана разрядиться, пока кнопку держат"
    assert all(100.0 < time < 205.0 for time in spikes), spikes
    assert payload["sensors"] == {"key": 0.0}, "кнопку отпустили"
    assert payload["input"] == [
        {"time": 100.0, "sensor": "key", "value": 1.0},
        {"time": 200.0, "sensor": "key", "value": 0.0},
    ]


def test_the_motor_speaks_in_the_same_answer_as_the_cells(border):
    """Величина мотора приходит тем же куском, что клетки, трассы и спайки."""
    border.advance_ms(100)
    border.sense("key", 1)
    border.advance_ms(100)

    payload = border.update()
    assert payload["motors"]["out"] > 0.0
    assert set(payload) >= {"cells", "traces", "spikes", "sensors", "motors"}


def test_a_press_is_visible_in_its_own_answer(border):
    """Нажал -- и в ответе на это нажатие величина уже единица.

    Величина, поданная «сейчас», применится на следующем шаге, и отвечай
    сессия применённым значением, кнопка сообщала бы человеку прошлое: нажал,
    а в ответе ноль. Поэтому отдаётся то, что держится на текущем моменте --
    по той же записи и по тому же правилу, по которому её применяет прогон.
    """
    border.advance_ms(100)
    payload = border.update()
    assert payload["sensors"] == {"key": 0.0}

    border.sense("key", 1)
    assert border.update()["sensors"] == {"key": 1.0}
    assert border.simulator.result.spikes["MN"] == [], "время ещё не шло"


def test_rewinding_and_recounting_repeats_the_picture_spike_for_spike(border):
    """Приёмка: перемотали на 150 мс, досчитали -- картина та же.

    Ровно та же, а не похожая: поток входа переигрывается из записи, как
    переигрывается случайный драйв по состоянию генератора.
    """
    pressed(border)
    whole = dict(border.simulator.result.spikes)
    traces = {key: list(values) for key, values in border.simulator.result.traces.items()}

    border.seek(150.0)
    border.advance_ms(border.duration)

    assert border.simulator.result.spikes == whole
    assert border.simulator.result.traces == traces


def test_after_a_rewind_the_network_does_not_know_the_future_value(border):
    """Приёмка: перемотали на 50 мс -- значения, поданного на 100-й, нет.

    И запись при этом цела: перемотка стирает прежние трассы, но не опыт.
    """
    pressed(border)

    border.seek(50.0)
    payload = border.update()

    assert payload["sensors"] == {"key": 0.0}
    assert payload["motors"] == {"out": 0.0}
    assert border.simulator.result.spikes["MN"] == []
    assert len(payload["input"]) == 2, "запись пережила перемотку -- её переиграют"


def test_a_step_by_a_millisecond_still_works_with_a_live_input(border):
    """Шаг по миллисекунде (#537) от подачи не ломается."""
    border.advance_ms(100)
    border.sense("key", 1)
    for _ in range(40):
        border.step(1.0)

    assert border.elapsed == pytest.approx(140.0, abs=border.dt)
    assert border.update()["motors"]["out"] > 0.0


def test_reset_keeps_the_record_and_plays_it_again(border):
    """«Сброс» не стирает опыт: запись переигрывается с начала.

    Зерно генератора сброс тоже не выбрасывает -- поток входа ведёт себя так
    же. Иначе повторить опыт с кнопками стало бы нельзя ровно тогда, когда это
    нужнее всего.
    """
    first = pressed(border)
    border.reset()

    assert border.update()["input"] == first["input"], "запись цела"
    assert border.update()["sensors"] == {"key": 0.0}, "величина с нуля"

    border.advance_ms(border.duration)
    again = border.update()
    assert again["spikes"] == first["spikes"]


def test_a_new_press_wipes_the_future_that_was_recorded(border):
    """Взялись за кнопку -- прежнее будущее перестало быть будущим.

    Это и есть дорога к чистому листу: сброс плюс нажатие на нуле, а не
    отдельная кнопка «забыть вход».
    """
    pressed(border)
    border.seek(150.0)
    border.sense("key", 0.5)

    record = border.update()["input"]
    assert [event["time"] for event in record] == [100.0, 150.0]
    assert record[-1]["value"] == 0.5


def test_a_value_for_an_unknown_sensor_is_refused(border):
    with pytest.raises(protocols.SenseError):
        border.sense("педаль", 1)


def test_the_value_of_a_sensor_is_a_share_not_a_frequency(border):
    """Вне 0…1 -- отказ, а не зажим: чужая шкала не должна проехать молча."""
    with pytest.raises(protocols.SenseError):
        border.sense("key", 100)
