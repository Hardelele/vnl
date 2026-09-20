"""Второй вид точечной модели: адаптивный экспоненциальный LIF.

Проверяется три вещи, и порядок здесь по важности.

Первая -- что правка оказалась добавлением. Ни одна схема, написанная до
появления `adex`, не имеет права посчитаться иначе, и «на глаз то же самое»
тут не подходит: сдвиг на один спайк в одной клетке из двадцати трёх файлов
глазами не виден, а числа в шапках примеров после него врут.

Вторая -- что новое умеет то, ради чего заводилось: разгон у порога, пачка,
отдача после торможения. Каждое свойство проверяется числом, а не тем, что
прогон не упал.

Третья -- что оно не разваливается на краях: экспонента не переполняется,
снимок состояния несёт ток адаптации, бессмысленные параметры отвергаются с
внятным сообщением.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import pytest

from vnl import ir
from vnl.resolve import ValidationError, load
from vnl.sim import simulate
from vnl.sim.lif import Simulator

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


def run(name: str):
    model, diagnostics = load(example(name), source=f"examples/{name}.vnl", strict=True)
    return model, diagnostics, simulate(model)


# --- прежние схемы считаются ровно как прежде ------------------------------

#: Спайки всех схем, какие были в `examples/` до появления `adex`: счёт по
#: клеткам и отпечаток полного списка времён (округлённых до 0.1 мкс). Счёт --
#: чтобы по упавшему тесту было видно, что именно разъехалось; отпечаток --
#: чтобы разъехаться не могло молча: сдвиг одного спайка на шаг счёт не меняет.
#: Числа сняты прогоном до правки, а не переписаны из шапок.
#:
#: Пересняты после #568, и вот чем это законно. До правки событийный стимул
#: доставлялся дважды: написанный импульс 0.5 нСм клал на клетку 0.928 нСм, а
#: поезд из восьми давал шестнадцать доставок. То есть отпечатки держали не
#: «как считалось раньше», а «как считалось при вдвое большем драйве, чем
#: написано в схеме», -- и сохранять их значило бы закреплять ошибку.
#:
#: Разъехались 14 записей из 23, и разъехались одинаково: клетка под прямым
#: событийным драйвом добирается до порога на 0.6 мс дольше, и весь прогон за
#: ней сдвигается на те же 0.6 мс. Счёт спайков уцелел везде, кроме `VTA` в
#: `disinhibition`: четыре написанных импульса подкрепления давали шесть
#: разрядов, теперь дают четыре -- столько, сколько написано. Девять записей
#: не изменились вовсе: там драйв пуассоновский или токовый, а его доставка
#: правкой не затронута.
BEFORE_ADEX: dict[str, tuple[dict[str, int], str]] = {
    "depression": ({"DEP": 0, "FAC": 0, "IN": 8}, "31f9db0bbf9902ff"),
    "disinhibition": (
        {"IN": 85, "PYR": 25, "SST": 60, "VIP": 36, "VTA": 4},
        "6de07493ccc8b737",
    ),
    "ffi": ({"E": 6, "I": 45, "IN": 45}, "59f1dfbcce92d6b7"),
    "library/convergent_excitation": (
        {"A": 3, "B": 3, "C": 1, "X": 2},
        "31ca542328deaa9b",
    ),
    "library/disinhibition": (
        {"IN": 85, "PYR": 25, "SST": 60, "VIP": 36, "VTA": 4},
        "6de07493ccc8b737",
    ),
    "library/divergent_excitation": (
        {"A": 8, "B": 8, "C": 8, "D": 8},
        "78b03d25f0e2b139",
    ),
    "library/ei_loop": ({"E1": 24, "E2": 20, "I": 60}, "9e1566da6e515d3d"),
    "library/eligibility_trace": (
        {"E_LONG": 9, "E_SHORT": 9, "IN": 19, "VTA": 4},
        "7e00bff649d85509",
    ),
    "library/excitatory_synapse": ({"E": 8, "IN": 8}, "9439851d774724a7"),
    "library/feedback_inhibition": (
        {"E": 16, "I": 32, "IN": 37},
        "32d6225f2fee529e",
    ),
    "library/feedforward_excitation": (
        {"A": 8, "B": 8, "C": 8},
        "96a5b8e6e3a57000",
    ),
    "library/ffi": ({"E": 6, "I": 45, "IN": 45}, "59f1dfbcce92d6b7"),
    "library/hyperpolarizing_inhibition": (
        {"E": 12, "I": 37, "IN": 20},
        "4a50107f270ce3f4",
    ),
    "library/lateral_inhibition": (
        {"I1": 12, "I2": 68, "I3": 10, "P1": 6, "P2": 35, "P3": 5},
        "8e37998e289ec709",
    ),
    "library/local_excitation_global_inhibition": (
        {"E1": 25, "E2": 25, "E3": 12, "GI": 52},
        "654501bc41c75b9a",
    ),
    "library/mutual_inhibition": ({"A": 42, "B": 7}, "dc42288fe43469cd"),
    "library/neuromodulated_plasticity": (
        {"E": 14, "IN": 29, "VTA": 4},
        "1f86f7fb0b5d9b9d",
    ),
    "library/recurrent_excitation": (
        {"A": 26, "B": 26, "IN": 9},
        "96b1bc75247993da",
    ),
    "library/shared_inhibitory_pool": (
        {"E1": 23, "E2": 7, "E3": 5, "POOL": 36},
        "04eec2af1959d9b6",
    ),
    "library/short_term_depression": (
        {"DEP": 0, "IN": 8, "REF": 0},
        "59a24e0fc4a1065a",
    ),
    "library/short_term_facilitation": (
        {"FAC": 0, "IN": 8, "REF": 0},
        "744c5f9307610129",
    ),
    "library/spike_frequency_adaptation": (
        {"ADAPT": 21, "IN": 77, "PLAIN": 77},
        "0f5fc34b85480cea",
    ),
    "library/synaptic_delay": ({"FAR": 8, "IN": 8, "NEAR": 8}, "9d7b78e3910a25c9"),
}


def _fingerprint(spikes: dict[str, list[float]]) -> str:
    rounded = {
        name: [round(time, 4) for time in times] for name, times in sorted(spikes.items())
    }
    blob = json.dumps(rounded, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


@pytest.mark.parametrize("name", sorted(BEFORE_ADEX))
def test_schemes_written_before_adex_give_the_same_spikes(name):
    counts, digest = BEFORE_ADEX[name]
    _, _, result = run(name)
    assert result.spike_count() == counts
    assert _fingerprint(result.spikes) == digest, (
        f"{name}: счёт спайков тот же, а времена разъехались -- значит ветка lif "
        f"всё-таки изменилась"
    )


def test_the_default_point_model_is_still_lif():
    """Умолчание -- не деталь: от него зависят все схемы, где вид не написан."""
    assert ir.PointModel().kind == "lif"
    model, _ = load(
        """
model probe
cell any : excitatory, glutamate { tau_m = 10ms }
neuron A : any
run { dt = 0.1ms  duration = 10ms }
""",
        strict=True,
    )
    assert model.cell_types["any"].point_model.kind == "lif"


# --- разгон у порога ------------------------------------------------------


_RAMP = """
model ramp
cell linear : excitatory, glutamate {{
    point = lif  tau_m = 10ms  v_rest = -65mV  threshold = 40mV  refractory = 2ms
}}
cell exponential : excitatory, glutamate {{
    point = adex  tau_m = 10ms  v_rest = -65mV  v_t = -50mV  delta_t = 2mV
    v_peak = 0mV  v_reset = -65mV  refractory = 2ms  tau_w = 1000ms  a = 0nS  b = 0pA
}}
neuron LIN : linear
neuron EXP : exponential
stim push1 -> LIN.soma : current amplitude=0.25nA start=0ms stop=200ms
stim push2 -> EXP.soma : current amplitude=0.25nA start=0ms stop=200ms
record LIN.soma.v
record EXP.soma.v
run {{ dt = 0.1ms  duration = 200ms  level = L1  seed = 1 }}
"""


def _crossing(times: list[float], values: list[float], level: float) -> float | None:
    for time, value in zip(times, values):
        if value >= level:
            return time
    return None


def test_adex_accelerates_near_the_threshold_and_a_linear_cell_does_not():
    """Разгон -- это измеримое ускорение, а не «кривая выглядит круче».

    Обе клетки получают один и тот же постоянный ток и различаются только видом
    модели; порог линейной унесён туда, куда она не дойдёт, чтобы сравнивать
    именно подъём, а не момент срабатывания. Меряются два равных по высоте
    участка выше точки разгона, по 3 мВ каждый. У линейной клетки второй обязан
    оказаться медленнее первого -- она подходит к своей асимптоте, -- а у `adex`
    быстрее: это и есть разгон.
    """
    model, _ = load(_RAMP.format(), strict=True)
    result = simulate(model)
    times = result.times
    lin = result.traces["LIN.soma:v"]
    exp = result.traces["EXP.soma:v"]

    def spans(trace: list[float], marks: tuple[float, ...]) -> list[float]:
        crossings = [_crossing(times, trace, level) for level in marks]
        assert all(mark is not None for mark in crossings), f"не дошла до {marks}"
        return [b - a for a, b in zip(crossings, crossings[1:])]

    # v_t = -50 мВ: первый участок начинается ровно на точке разгона.
    lin_first, lin_second = spans(lin, (-50.0, -47.0, -44.0))
    exp_first, exp_second = spans(exp, (-50.0, -47.0, -44.0))

    # Линейная клетка замедляется, `adex` ускоряется -- и это не «примерно»:
    # 3.5 -> 5.6 мс против 2.2 -> 1.4 мс.
    assert lin_second > lin_first
    assert exp_second < exp_first
    # И те же 6 мВ `adex` проходит больше чем вдвое быстрее.
    assert (exp_first + exp_second) * 2 < lin_first + lin_second
    # Линейная клетка вообще не дотягивает до -40 мВ: её асимптота ровно там,
    # а `adex` этот потолок проходит и уходит выше.
    assert max(lin) < -40.0
    assert max(exp) > -40.0


def test_below_the_threshold_adex_is_still_the_same_passive_membrane():
    """Разгон не имеет права подменять подпороговое поведение.

    Иначе `adex` был бы не «LIF плюс разгон», а другой клеткой целиком, и
    подобранные под LIF веса в схеме значили бы не то же самое.
    """
    model, _ = load(_RAMP.format(), strict=True)
    result = simulate(model)
    lin = result.traces["LIN.soma:v"]
    exp = result.traces["EXP.soma:v"]
    # До -58 мВ (7 мВ ниже точки разгона) кривые совпадают с точностью 0.05 мВ.
    pairs = [(a, b) for a, b in zip(lin, exp) if a <= -58.0]
    assert pairs, "клетки не дошли даже до -58 мВ -- тест ничего не проверил"
    assert max(abs(a - b) for a, b in pairs) < 0.05


# --- пачка ----------------------------------------------------------------


def test_the_adaptation_current_makes_a_burst_where_lif_gives_one_spike():
    """Числа из шапки `examples/adex_burst.vnl` -- здесь, чтобы они не врали."""
    _, diagnostics, result = run("adex_burst")
    assert [d for d in diagnostics if d.severity == "error"] == []

    assert result.spike_count()["LIF"] == 3, "линейная клетка обязана дать спайк на толчок"
    burst = result.spikes["BURST"]
    assert len(burst) == 15

    intervals = [b - a for a, b in zip(burst, burst[1:])]
    inside = [gap for gap in intervals if gap < 50.0]
    between = [gap for gap in intervals if gap >= 50.0]
    assert len(between) == 2, "три толчка -- три пачки, значит два промежутка"
    assert len(inside) == 12
    # «В разы меньше» -- это число, и вот оно: самый длинный интервал внутри
    # пачки против самого короткого промежутка между пачками.
    assert max(inside) < 5.0
    assert min(between) > 100.0
    assert min(between) / max(inside) > 20.0


def test_without_the_increment_the_burst_never_ends():
    """`b` -- это то, чем пачка кончается, и проверяется это его отключением.

    С `b = 0` останавливать разгон нечем: клетка после каждого сброса снова
    выше точки разгона, и разряжается до конца прогона с частотой, которую
    задаёт одна рефрактерность. Если бы пачка кончалась сама, механизм был бы
    не тот, что написан в шапке примера.
    """
    model, _ = load(example("adex_burst"), strict=True)
    model.cell_types["burster"].point_model.w_increment = 0.0
    result = simulate(model)
    count = len(result.spikes["BURST"])
    # 500 мс прогона, рефрактерность 3 мс плюс время разгона -- порядок сотни.
    assert count > 100
    assert count == max(result.spike_count().values())


def test_the_adaptation_current_runs_during_the_refractory_period():
    """Иначе пачка не кончится: в рефрактерности `v` держат у `v_reset`.

    У пачечной клетки `v_reset` стоит выше точки разгона, то есть после каждого
    разряда она снова в зоне разгона, и единственное, что её останавливает, --
    накопленный ток. Замри он на рефрактерность -- и `b` перестал бы работать
    вовсе.
    """
    model, _ = load(example("adex_burst"), strict=True)
    sim = Simulator(model)
    cell = sim.cells["BURST"]
    while not cell.spiked:
        assert sim.step_once(), "клетка так и не разрядилась"
    assert cell.refractory_left > 0.0
    after_spike = cell.w
    sim.step_once()
    assert cell.refractory_left > 0.0, "шаг вышел из рефрактерности -- тест не о том"
    assert cell.w != after_spike


# --- отдача после торможения ----------------------------------------------


def test_rebound_after_inhibition_needs_the_subthreshold_coupling():
    """Числа из шапки `examples/adex_rebound.vnl`.

    Торможение к порогу не ведёт никогда, поэтому спайк после его снятия --
    работа клетки, а не входа. Контрольная клетка отличается одним числом
    (`a = 0`), и она молчит.
    """
    _, diagnostics, result = run("adex_rebound")
    assert [d for d in diagnostics if d.severity == "error"] == []

    rebound = result.spikes["REB"]
    assert len(rebound) == 1
    assert result.spike_count()["FLAT"] == 0
    # Спайк -- после снятия торможения, а не во время него.
    assert rebound[0] > 200.0
    assert rebound[0] == pytest.approx(236.6, abs=0.15)

    # Мембрану действительно уводили ниже покоя, иначе отдаче не с чего быть.
    assert min(result.traces["REB.soma:v"]) < -69.0
    # И перелёт над покоем есть только у той клетки, где есть `a`.
    after = [
        (time, value)
        for time, value in zip(result.times, result.traces["FLAT.soma:v"])
        if time > 200.0
    ]
    assert max(value for _, value in after) < -64.0


# --- устойчивость счёта ---------------------------------------------------


_WILD = """
model wild
cell reckless : excitatory, glutamate {{
    point = adex  tau_m = 1ms  v_rest = -65mV  v_t = -50mV  delta_t = {delta}mV
    v_peak = {peak}mV  v_reset = -65mV  refractory = 0ms  tau_w = 5ms
    a = 0nS  b = 0pA
}}
neuron A : reckless
stim push -> A.soma : current amplitude=2nA start=0ms stop=100ms
record A.soma.v
run {{ dt = 0.1ms  duration = 100ms  level = L1  seed = 1 }}
"""


@pytest.mark.parametrize(
    "delta, peak",
    [
        (0.05, 40.0),   # крутая экспонента и высокий потолок: показатель ~1800
        (2.0, 40.0),
        (20.0, 40.0),
    ],
)
def test_the_exponential_never_overflows_the_trace(delta, peak):
    """`inf` в трассе хуже отказа: он тихо превращается в `nan` и расходится.

    Проверяется то, что записано, а не то, что посчитано внутри: смотрящий
    видит трассу, и если в неё попала бесконечность, прогон бесполезен, хотя
    формально прошёл.
    """
    model, _ = load(_WILD.format(delta=delta, peak=peak), strict=True)
    result = simulate(model)
    trace = result.traces["A.soma:v"]
    assert all(math.isfinite(value) for value in trace)
    # Зажим не должен и «подвесить» клетку: разряды обязаны идти.
    assert len(result.spikes["A"]) > 5
    # Записанный потенциал не уходит выше потолка: сброс случается на том же
    # шаге, и в трассу попадает уже `v_reset`.
    assert max(trace) <= peak


def test_a_clamped_exponent_cannot_change_the_spike_train():
    """Зажим выше `v_peak` безопасен, и вот почему -- поднятый потолок ничего
    не меняет, пока клетка всё равно разряжается на первом же его пересечении.
    """
    tight, _ = load(_WILD.format(delta=0.05, peak=40.0), strict=True)
    loose, _ = load(_WILD.format(delta=0.05, peak=39.0), strict=True)
    assert simulate(tight).spikes["A"] == simulate(loose).spikes["A"]


# --- доля заряда ----------------------------------------------------------


def test_charge_means_the_same_in_both_models():
    """Ноль -- покой, единица -- разряд. У двух видов модели одно и то же.

    Иначе число над клеткой в интерфейсе означало бы у `lif` одно, а у `adex`
    другое, и сравнить две клетки на схеме стало бы нельзя.
    """
    lif = ir.PointModel(kind="lif", v_rest=-65.0, v_threshold=-50.0)
    adex = ir.PointModel(
        kind="adex", v_rest=-65.0, v_threshold=-50.0, v_peak=-40.0
    )
    assert lif.v_discharge == -50.0
    assert adex.v_discharge == -40.0

    from vnl.sim.lif import _Cell

    for point in (lif, adex):
        cell = _Cell(id="A", model=point, v=point.v_rest)
        assert cell.charge == pytest.approx(0.0)
        cell.v = point.v_discharge
        assert cell.charge == pytest.approx(1.0)
        # Торможение видно отрицательной долей у обоих видов.
        cell.v = point.v_rest - 5.0
        assert cell.charge < 0.0

    # У `adex` точка разгона -- осмысленная отметка внутри шкалы, а не её конец.
    cell = _Cell(id="A", model=adex, v=adex.v_threshold)
    assert cell.charge == pytest.approx(0.6)


def test_a_bursting_cell_never_shows_less_than_it_does():
    """Пачка обязана быть видна смотрящему.

    Между двумя взглядами интерфейса проходит полсотни шагов, а разряд занимает
    один. `peek` отдаёт пик за промежуток, и у пачечной клетки он обязан
    доходить до единицы -- иначе пачка на экране выглядит спокойной клеткой.
    """
    model, _ = load(example("adex_burst"), strict=True)
    sim = Simulator(model)
    seen_peak = 0.0
    fired = False
    while not sim.finished:
        sim.advance(50)
        state = sim.peek()["BURST"]
        seen_peak = max(seen_peak, state["peak"])
        fired = fired or state["fired"]
    assert fired
    assert seen_peak == pytest.approx(1.0)


# --- снимок и откат -------------------------------------------------------


def test_the_snapshot_carries_the_adaptation_current():
    """Откат посреди пачки: продолжение обязано совпасть с непрерывным прогоном.

    Это ровно тот случай, где забытая переменная состояния не видна нигде,
    кроме результата: клетка восстановится с правильным потенциалом и пойдёт
    другой пачкой, потому что забыла, сколько уже отработала.
    """
    model, _ = load(example("adex_burst"), strict=True)
    sim = Simulator(model)
    # Встать посреди первой пачки: спайк уже был, а пачка ещё идёт.
    while len(sim.result.spikes["BURST"]) < 2:
        assert sim.step_once()
    mark = sim.snapshot()
    assert sim.cells["BURST"].w > 0.0, "к середине пачки ток уже накоплен"

    straight = simulate(model).spikes["BURST"]

    sim.advance(1000)
    sim.restore(mark)
    assert sim.cells["BURST"].w == pytest.approx(mark.cells["BURST"][2])
    while sim.step_once():
        pass
    assert sim.result.spikes["BURST"] == straight


def test_restoring_a_lif_cell_still_works():
    """Снимок вырос на одно поле, и распаковка обязана остаться согласованной."""
    model, _ = load(example("ffi"), strict=True)
    sim = Simulator(model)
    sim.advance(1500)
    mark = sim.snapshot()
    sim.advance(1500)
    sim.restore(mark)
    while sim.step_once():
        pass
    assert sim.result.spikes == simulate(model).spikes


# --- бессмысленные параметры отвергаются ----------------------------------


_CELL = """
model probe
cell odd : excitatory, glutamate {{
    point = adex  tau_m = 10ms  v_rest = -65mV  v_t = -50mV
    delta_t = {delta}mV  v_peak = {peak}mV  v_reset = {reset}mV  tau_w = {tau_w}ms
}}
neuron A : odd
run {{ dt = 0.1ms  duration = 10ms }}
"""


def _fails(delta=2.0, peak=-40.0, reset=-65.0, tau_w=100.0) -> str:
    with pytest.raises(ValidationError) as failure:
        load(
            _CELL.format(delta=delta, peak=peak, reset=reset, tau_w=tau_w),
            strict=True,
        )
    return "\n".join(str(d) for d in failure.value.diagnostics)


def test_a_nonpositive_delta_t_is_refused():
    assert "delta_t" in _fails(delta=0.0)


def test_a_nonpositive_tau_w_is_refused():
    assert "tau_w" in _fails(tau_w=0.0)


def test_a_peak_below_the_takeoff_is_refused():
    message = _fails(peak=-55.0)
    assert "v_peak" in message and "v_t" in message


def test_a_reset_above_the_peak_is_refused():
    """Такая клетка разряжается до конца прогона независимо от входа.

    Считать её можно, и она даст числа -- поэтому отказ, а не предупреждение:
    числа будут про клетку, которую никто не описывал.
    """
    message = _fails(reset=-35.0)
    assert "v_reset" in message


def test_threshold_adaptation_on_an_adex_cell_is_reported_as_unread():
    """Два механизма адаптации сразу означали бы, что её считают дважды.

    `adex` выражает адаптацию током, и сдвиг порога он не читает. Молчать об
    этом нельзя: человек написал параметр и вправе знать, что он не работает.
    """
    _, diagnostics = load(
        """
model probe
cell odd : excitatory, glutamate {
    point = adex  tau_m = 10ms  adaptation = 2mV  b = 40pA
}
neuron A : odd
run { dt = 0.1ms  duration = 10ms }
""",
        strict=True,
    )
    warnings = [d for d in diagnostics if d.severity == "warning"]
    assert any("adaptation" in d.message and "не читается" in d.message for d in warnings)


def test_the_export_says_adex_does_not_survive_l2():
    """Контракт `vnl export` -- «скрипт плюс список потерь».

    Развернуть `adex` в клетку с каналами Ходжкина--Хаксли и промолчать значило
    бы выдать другой механизм за тот же.
    """
    from vnl.backends.netpyne_export import export

    model, _ = load(example("adex_burst"), strict=True)
    report = export(model)
    assert any("адаптивный экспоненциальный" in loss for loss in report.losses)
    assert any("burster" in loss for loss in report.losses)
