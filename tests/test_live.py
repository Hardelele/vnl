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
