"""Сессия симуляции: пуск, пауза, откат и приращения.

Время здесь двигается вручную (`advance_ms`), а не ожиданием настоящих
секунд: тест, который спит, проверяет заодно и скорость машины.
"""

from pathlib import Path

import pytest

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
