"""Зависимость NMDA от напряжения: совпадение, плато, устойчивость (#498).

Отдельным файлом, как `test_shunt.py` и `test_sim_adex.py`: проверяется новое
поведение движка, и вопросы к нему свои -- растёт ли вклад с деполяризацией (а
не убывает, как было), есть ли порог по числу совпавших входов, держится ли
плато после снятия входа, и отказывается ли солвер считать там, где явная схема
разваливается.
"""

from pathlib import Path

import pytest

from vnl import ir
from vnl.backends.netpyne_export import export as netpyne_export
from vnl.resolve import load
from vnl.sim import simulate
from vnl.sim.lif import SimulationError, Simulator

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
PATTERN = EXAMPLES / "library" / "nmda_spike.vnl"

#: Две клетки под одинаковым входом -- через `ampa` и через `nmda`. Порог
#: отодвинут, потому что разряд сбросил бы `v` к покою и стёр ровно ту
#: деполяризацию, про которую вопрос. Веса `0.2`/`0.5` подобраны так, что
#: одиночный вход даёт на обеих почти один и тот же EPSP (3.3 против 3.4 мВ):
#: сравнивать надо равные ответы, иначе разницу даст просто больший вес.
SOURCE = """
model nmda

cell reader : excitatory, glutamate {{ tau_m = 10ms  threshold = -20mV }}

neuron EA : reader
neuron EN : reader

stim a -> EA.soma : spikes weight={wa}nS receptor=ampa times="100"
stim n -> EN.soma : spikes weight={wn}nS receptor=nmda times="100"

record EA.soma.v
record EN.soma.v
record EN.soma.g

run {{ dt = 0.1ms  duration = 500ms  level = L1  seed = 1 }}
"""


#: Одиночный вход и четыре совпавших: у совпадения тот же вес, умноженный
#: на четыре, -- проводимости складываются, и «четыре сразу» это и есть.
ONE = SOURCE.format(wa=0.2, wn=0.5)
FOUR = SOURCE.format(wa=0.8, wn=2.0)
#: Заведомо расходящийся прогон: столько проводимости явная схема при dt = 0.1
#: мс не держит.
BOOM = SOURCE.format(wa=0.2, wn=400.0)


def model_of(text: str):
    model, diagnostics = load(text)
    assert model is not None, [str(d) for d in diagnostics]
    return model


def rise(result, key: str) -> float:
    """Пик отклика над покоем, мВ."""
    return max(result.traces[key]) + 65.0


# --- сам множитель ---------------------------------------------------------


def test_the_magnesium_block_opens_with_depolarization():
    """Главное свойство: доля открытых каналов растёт с потенциалом."""
    values = [ir.mg_block(v) for v in (-80.0, -65.0, -40.0, -20.0, 0.0)]
    assert values == sorted(values), "монотонно вверх"
    assert ir.mg_block(-65.0) == pytest.approx(0.0597, abs=0.001)
    assert ir.mg_block(-20.0) == pytest.approx(0.508, abs=0.001)

    # Без магния выталкивать нечего -- канал открыт целиком. Это не
    # вырожденный случай, а тот опыт, которым NMDA-ток и выделяют.
    assert ir.mg_block(-65.0, mg=0.0) == 1.0
    assert ir.mg_block(-65.0, mg=2.0) < ir.mg_block(-65.0, mg=1.0)

    # Заведомо бессмысленный потенциал не должен давать `inf` в трассе.
    assert ir.mg_block(-100000.0) == pytest.approx(0.0, abs=1e-20)


def test_only_nmda_has_a_gate():
    assert ir.RECEPTORS["nmda"].voltage_dependent
    for name in ("ampa", "gaba_a", "gaba_b", "nicotinic"):
        # Ровная единица, а не «почти единица»: умножение на неё не может
        # сдвинуть ни один прежний прогон.
        assert ir.RECEPTORS[name].gate(-65.0) == 1.0
        assert ir.RECEPTORS[name].gate(0.0) == 1.0


# --- ток -------------------------------------------------------------------


def test_the_nmda_contribution_grows_with_depolarization():
    """Знак зависимости от потенциала обратный тому, что был до #498.

    Раньше `nmda` считалась как `ampa` с другой постоянной спада, и её вклад с
    приближением к порогу только убывал -- множитель `(0 − v)` тает. Теперь
    растущий `B(v)` его перебивает.
    """
    ампа = ir.RECEPTORS["ampa"]
    нмда = ir.RECEPTORS["nmda"]

    def current(kind, v):
        return kind.gate(v) * (kind.reversal - v)

    assert current(ампа, -30.0) < current(ампа, -65.0), "AMPA слабеет"
    assert current(нмда, -30.0) > current(нмда, -65.0), "NMDA усиливается"


def test_a_single_input_passes_neither_but_coincidence_is_superlinear():
    """Четыре совпавших входа на NMDA дают заметно больше, чем четыре порознь."""
    one = simulate(model_of(ONE))
    one_a = rise(one, "EA.soma:v")
    one_n = rise(one, "EN.soma:v")
    assert one_a == pytest.approx(one_n, abs=0.2), "одиночные ответы равны"

    four = simulate(model_of(FOUR))
    ratio_a = rise(four, "EA.soma:v") / (4 * one_a)
    ratio_n = rise(four, "EN.soma:v") / (4 * one_n)

    assert ratio_a < 1.0, "AMPA насыщается к реверсалу: нелинейность вниз"
    assert ratio_n > 1.8, "NMDA складывает совпавшие входы с усилением"


def test_the_plateau_outlives_the_input():
    """Вход длится один шаг, а надпороговое состояние -- десятки миллисекунд."""
    result = simulate(model_of(FOUR))
    dt = result.dt

    def above(key: str) -> float:
        return sum(1 for v in result.traces[key] if v > -50.0) * dt

    assert above("EA.soma:v") == 0.0, "AMPA до -50 мВ на этом весе не доходит"
    assert above("EN.soma:v") > 50.0, "NMDA держит клетку деполяризованной"


def test_the_recorded_conductance_is_the_one_that_conducts():
    """У NMDA пишется эффективная проводимость, а не открытая медиатором.

    Сырая выросла бы до веса в первый же шаг и сотню миллисекунд спадала,
    ничего не делая: на графике это выглядело бы как большой вход, которого
    клетка не почувствовала. Эффективная растёт вместе с деполяризацией -- то
    есть объясняет нелинейность, а не прячет её.
    """
    result = simulate(model_of(FOUR))
    trace = result.traces["EN.soma:g"]
    assert max(trace) < 4.0, "записана не сырая проводимость"

    # Пик проводимости приходится не на приход входа, а на самую деполяризацию.
    at_arrival = trace[int(102 / result.dt)]
    assert max(trace) > at_arrival * 1.5


# --- устойчивость ----------------------------------------------------------


def test_the_answer_does_not_depend_on_the_step():
    """Тот же прогон при вдвое меньшем `dt` -- те же числа."""
    coarse = simulate(model_of(FOUR))
    fine = simulate(model_of(FOUR.replace("dt = 0.1ms", "dt = 0.05ms")))
    assert rise(fine, "EN.soma:v") == pytest.approx(
        rise(coarse, "EN.soma:v"), abs=0.02
    )


def test_a_diverging_run_refuses_instead_of_writing_garbage():
    """Явная схема имеет предел, и за ним она даёт `inf`, а не ответ.

    Отказ называет клетку, момент и тот `dt`, при котором счёт сойдётся, --
    чинится это одним числом в `run`. Зажим `v` сверху вместо отказа оставил бы
    правдоподобную трассу с неправдой внутри.
    """
    with pytest.raises(SimulationError) as failure:
        simulate(model_of(BOOM))
    message = str(failure.value)
    assert "EN" in message and "dt" in message and "0.0" in message

    # Тот же прогон мелким шагом считается и мусора не даёт.
    fine = simulate(
        model_of(BOOM.replace("dt = 0.1ms", "dt = 0.01ms"))
    )
    assert all(value == value for value in fine.traces["EN.soma:v"])
    assert max(fine.traces["EN.soma:v"]) < 1.0, "выше реверсала ток не тянет"


# --- экспорт ---------------------------------------------------------------


def test_export_says_out_loud_that_nmda_becomes_linear():
    """Молча экспортировать NMDA-спайк линейным Exp2Syn нельзя."""
    report = netpyne_export(model_of(FOUR))
    assert any(
        "зависимость проводимости от потенциала" in loss for loss in report.losses
    )
    assert any("Джара--Стивенса" in loss for loss in report.losses)

    # У схемы без NMDA этой строки быть не должно: список потерь читают.
    plain = netpyne_export(
        model_of(FOUR.replace("receptor=nmda", "receptor=ampa"))
    )
    assert not any("потенциала" in loss for loss in plain.losses)


# --- библиотека ------------------------------------------------------------


def test_the_library_pattern_shows_the_coincidence_threshold():
    """Числа из шапки `nmda_spike.vnl` -- это и есть приёмка #498."""
    text = PATTERN.read_text(encoding="utf-8")
    model, diagnostics = load(text, source=str(PATTERN))
    assert model is not None, [str(d) for d in diagnostics]
    result = simulate(model)

    def peak(cell: str, low: float, high: float) -> float:
        return max(
            value
            for time, value in zip(result.times, result.traces[f"{cell}.soma:v"])
            if low <= time < high
        ) + 65.0

    def plateau(low: float, high: float) -> float:
        return sum(
            1
            for time, value in zip(result.times, result.traces["EN.soma:v"])
            if low <= time < high and value > -50.0
        ) * result.dt

    def fired(low: float, high: float) -> int:
        return sum(1 for time in result.spikes["EB"] if low <= time < high)

    # Одиночный вход не проходит нигде и даёт почти один и тот же EPSP.
    assert peak("EA", 100, 350) == pytest.approx(3.30, abs=0.01)
    assert peak("EN", 100, 350) == pytest.approx(3.22, abs=0.01)

    assert peak("EA", 350, 700) == pytest.approx(9.32, abs=0.01)
    assert peak("EN", 350, 700) == pytest.approx(14.29, abs=0.01)
    assert peak("EA", 700, 1100) == pytest.approx(12.07, abs=0.01)
    assert peak("EN", 700, 1100) == pytest.approx(24.63, abs=0.01)

    # Порог по числу совпавших входов: три не поднимают выше -50 мВ вовсе.
    assert (plateau(350, 700), fired(350, 700)) == (0.0, 0)
    assert plateau(700, 1100) == pytest.approx(65.7, abs=0.1)
    assert fired(700, 1100) == 2

    # Отношение «ответ на N входов / N x ответ на один»: у AMPA меньше
    # единицы (насыщение), у NMDA вдвое больше.
    one_a, one_n = peak("EA", 100, 350), peak("EN", 100, 350)
    assert peak("EA", 700, 1100) / (4 * one_a) == pytest.approx(0.91, abs=0.01)
    assert peak("EN", 700, 1100) / (4 * one_n) == pytest.approx(1.91, abs=0.01)


# --- снимок и перемотка ----------------------------------------------------


def test_rewind_returns_the_same_run_with_nmda():
    """Ворота считаются от текущего `v`, и своего состояния у них нет.

    Проверяется именно это: если бы множитель где-то запомнился, перемотка
    вернула бы клетку с воротами из будущего (#534, #537).
    """
    straight = simulate(model_of(FOUR))

    stepped = Simulator(model_of(FOUR))
    stepped.advance(1200)
    saved = stepped.snapshot()
    stepped.advance(600)
    stepped.restore(saved)
    while stepped.step_once():
        pass

    assert stepped.result.traces == straight.traces
    assert stepped.result.spikes == straight.spikes
