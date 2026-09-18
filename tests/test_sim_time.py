"""Управляемое время: шаги, снимок состояния и откат.

Проверяется одно свойство, из которого следует всё остальное: продолжение
после восстановления совпадает с непрерывным прогоном до последнего знака.
Если бы в снимок не попала хоть одна величина -- вес, ресурс синапса, очередь
задержанных передач или состояние генератора, -- расхождение вылезло бы здесь.
"""

from pathlib import Path

import pytest

from vnl.resolve import load
from vnl.sim.lif import Simulator, simulate

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def model(name: str):
    parsed, _ = load((EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8"))
    return parsed


@pytest.fixture
def ffi():
    return model("ffi")


def test_stepping_to_the_end_is_the_old_run(ffi):
    whole = simulate(ffi)

    piecewise = Simulator(ffi)
    while piecewise.advance(137):  # число нарочно некруглое
        pass

    assert piecewise.finished
    assert piecewise.result.times == whole.times
    assert piecewise.result.spikes == whole.spikes
    assert piecewise.result.traces == whole.traces


def test_advance_stops_at_the_end_of_the_run(ffi):
    simulator = Simulator(ffi)
    simulator.advance(simulator.total_steps - 5)
    assert simulator.advance(1000) == 5, "дальше длительности прогон не идёт"
    assert simulator.finished


def test_restore_gives_back_the_same_future(ffi):
    whole = simulate(ffi)

    simulator = Simulator(ffi)
    simulator.advance(1000)
    mark = simulator.snapshot()
    simulator.advance(1500)  # это будущее откатом стирается
    simulator.restore(mark)
    simulator.run()

    assert simulator.result.times == whole.times
    assert simulator.result.spikes == whole.spikes
    assert simulator.result.traces == whole.traces


def test_restore_drops_the_recorded_future(ffi):
    simulator = Simulator(ffi)
    simulator.advance(1000)
    mark = simulator.snapshot()
    simulator.advance(1200)
    assert len(simulator.result.times) == 2200

    simulator.restore(mark)
    assert simulator.step == 1000
    assert len(simulator.result.times) == 1000
    assert all(
        time < mark.time
        for times in simulator.result.spikes.values()
        for time in times
    )


def test_the_generator_is_part_of_the_snapshot(ffi):
    """Без состояния генератора пуассоновский стимул после отката пойдёт другим."""
    simulator = Simulator(ffi)
    simulator.advance(1000)
    mark = simulator.snapshot()
    after_first = simulator.advance(400) and dict(simulator.result.spikes)

    simulator.restore(mark)
    simulator.advance(400)

    assert simulator.result.spikes == after_first
    # Тот же прогон с другим зерном даёт другие спайки -- значит сравнение выше
    # действительно что-то проверяет.
    other = model("ffi")
    other.run.seed += 1
    assert simulate(other).spikes != after_first


def test_a_learned_weight_comes_back():
    """Вес пластичного входа растёт под дофамином -- откат должен его вернуть."""
    disinhibition = model("disinhibition")
    simulator = Simulator(disinhibition)
    # Дофамин в примере приходит на 420 мс, так что 300 мс -- ещё «до».
    simulator.advance(3000)
    mark = simulator.snapshot()
    before = _plastic_weight(simulator)

    simulator.advance(2000)
    assert _plastic_weight(simulator) != pytest.approx(before), (
        "к этому времени вес обязан измениться, иначе тест ничего не проверяет"
    )

    simulator.restore(mark)
    assert _plastic_weight(simulator) == pytest.approx(before)


def test_deliveries_in_flight_survive_the_snapshot(ffi):
    """Спайк, уже вышедший, но ещё не дошедший, не должен потеряться."""
    simulator = Simulator(ffi)
    while not simulator.pending and simulator.step_once():
        pass
    assert simulator.pending, "в примере есть задержки, очередь не может быть пустой"

    mark = simulator.snapshot()
    assert mark.pending, "очередь задержанных передач попала в снимок"

    simulator.advance(500)
    simulator.restore(mark)
    assert _queue(simulator) == sorted(
        (step, tuple(items)) for step, items in mark.pending.items()
    )


def test_a_snapshot_does_not_follow_the_simulation(ffi):
    """Снимок хранится по значению: симуляция ушла вперёд -- снимок остался."""
    simulator = Simulator(ffi)
    simulator.advance(500)
    mark = simulator.snapshot()
    cells_then = dict(mark.cells)

    simulator.advance(500)
    assert mark.cells == cells_then
    assert mark.step == 500


def _queue(simulator: Simulator) -> list[tuple[int, tuple[tuple[int, float], ...]]]:
    """Очередь доставок номерами синапсов -- в том же виде, в каком её хранит снимок."""
    numbers = {id(synapse): n for n, synapse in enumerate(simulator.all_synapses)}
    return sorted(
        (step, tuple((numbers[id(synapse)], amplitude) for synapse, amplitude in items))
        for step, items in simulator.pending.items()
    )


def _plastic_weight(simulator: Simulator) -> float:
    for synapse in simulator.synapses:
        if synapse.contact.plasticity.enabled:
            return synapse.weight
    raise AssertionError("в модели нет пластичного контакта")
