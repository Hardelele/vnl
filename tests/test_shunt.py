"""Реверсал параметром контакта: шунт, полярность по числу, третья корзина (#496).

Отдельным файлом, как `test_sim_adex.py`: проверяется не ещё одно поле, а новое
поведение движка, и вопросы к нему свои -- делит ли шунт, не слился ли он с
торможением в записи, не молчит ли диагностика про реверсал выше порога.
"""

from pathlib import Path

import pytest

from vnl import ir
from vnl.backends.dot_export import export as dot_export
from vnl.backends.netpyne_export import export as netpyne_export
from vnl.resolve import load
from vnl.sim import simulate
from vnl.sweep import run_sweep

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"

#: Две клетки под одним тоническим торможением. Рецептор один и тот же
#: (`gaba_a`), реверсал разный -- ровно тот случай, который при прежнем
#: хранении проводимости считался бы по одному числу на обе.
SOURCE = """
model shunt

cell basket : inhibitory, gaba { tau_m = 6ms  threshold = -52mV  refractory = 2ms }
cell reader : excitatory, glutamate { tau_m = 10ms  threshold = -20mV }

neuron I  : basket
neuron ES : reader
neuron EH : reader

stim veto  -> I.soma  : train weight=1.5nS n=100 freq=200Hz start=0ms
stim pushS -> ES.soma : current amplitude=0.4nA start=100ms
stim pushH -> EH.soma : current amplitude=0.4nA start=100ms

I.soma -> ES.soma { id = shunt  receptor = gaba_a  reversal = -65mV  weight = 1.2nS }
I.soma -> EH.soma { id = hyper  receptor = gaba_a  weight = 1.2nS }

record ES.soma.g_shunt
record EH.soma.g_inh
record ES.soma.v
record EH.soma.v

run { dt = 0.1ms  duration = 300ms  level = L1  seed = 1 }
"""

SHUNT_LINE = (
    "I.soma -> ES.soma { id = shunt  receptor = gaba_a  "
    "reversal = -65mV  weight = 1.2nS }"
)


def model_of(source: str) -> ir.Model:
    model, diagnostics = load(source)
    assert model is not None, [str(d) for d in diagnostics]
    return model


def steady(result, key: str, samples: int = 200) -> float:
    """Установившийся отклик над покоем, мВ: среднее последних отсчётов."""
    trace = result.traces[key]
    return sum(trace[-samples:]) / samples + 65.0


# --- язык ------------------------------------------------------------------


def test_written_reversal_wins_over_the_registry():
    model = model_of(SOURCE)
    shunt = next(c for c in model.contacts if c.id == "shunt")
    hyper = next(c for c in model.contacts if c.id == "hyper")

    assert (shunt.reversal, shunt.reversal_override) == (-65.0, -65.0)
    assert (hyper.reversal, hyper.reversal_override) == (-70.0, None)
    assert shunt.receptor == hyper.receptor == "gaba_a", "имя рецептора прежнее"


def test_polarity_is_decided_by_the_number_and_by_the_target_cell():
    model = model_of(SOURCE)
    assert model.polarity_of(next(c for c in model.contacts if c.id == "shunt")) == "shunt"
    assert model.polarity_of(next(c for c in model.contacts if c.id == "hyper")) == "inh"

    # Одно и то же число на разных клетках означает разное: порог у них свой.
    low = ir.PointModel(v_rest=-65.0, v_threshold=-50.0)
    high = ir.PointModel(v_rest=-65.0, v_threshold=-60.0)
    assert ir.synapse_polarity(-55.0, low) == "shunt"
    assert ir.synapse_polarity(-55.0, high) == "exc"
    # Покой засчитан в шунт: на нём и стоит канонический шунт.
    assert ir.synapse_polarity(-65.0, low) == "shunt"
    assert ir.synapse_polarity(-65.1, low) == "inh"


# --- физика ----------------------------------------------------------------


def test_two_contacts_of_one_receptor_keep_their_own_reversals():
    """Суть задачи: одно имя рецептора, два реверсала -- и считаются они врозь.

    При прежнем хранении (проводимость в словаре по имени рецептора) оба
    контакта слились бы в одно число и посчитались по одному реверсалу -- молча
    и неверно. Проверяется по результату, а не по внутренностям: у шунта
    мембрана стоит ровно на покое, у гиперполяризующего проваливается ниже.
    """
    result = simulate(model_of(SOURCE))

    quiet = slice(500, 1000)   # 50-100 мс: торможение уже идёт, драйва ещё нет
    shunt_v = result.traces["ES.soma:v"][quiet]
    hyper_v = result.traces["EH.soma:v"][quiet]

    assert max(shunt_v) - min(shunt_v) < 1e-9, "шунт мембрану не двигает вовсе"
    assert min(shunt_v) == pytest.approx(-65.0)
    assert min(hyper_v) < -67.0, "вычитание уводит мембрану от порога"


def test_the_shunt_divides_while_hyperpolarization_subtracts():
    """Поведенческий опыт: доля от драйва у шунта та же, у вычитания растёт."""
    weak_text = SOURCE.replace("amplitude=0.4nA", "amplitude=0.05nA")
    bare_text = SOURCE.replace(SHUNT_LINE, "")

    strong = simulate(model_of(SOURCE))
    weak = simulate(model_of(weak_text))
    bare_strong = simulate(model_of(bare_text))
    bare_weak = simulate(model_of(bare_text.replace("amplitude=0.4nA", "amplitude=0.05nA")))

    share_weak = steady(weak, "ES.soma:v") / steady(bare_weak, "ES.soma:v")
    share_strong = steady(strong, "ES.soma:v") / steady(bare_strong, "ES.soma:v")
    assert share_weak == pytest.approx(share_strong, abs=0.005), (
        "шунт делит: оставленная доля от уровня драйва не зависит"
    )

    hyper_weak = steady(weak, "EH.soma:v") / steady(bare_weak, "ES.soma:v")
    hyper_strong = steady(strong, "EH.soma:v") / steady(bare_strong, "ES.soma:v")
    assert hyper_strong > hyper_weak + 0.2, (
        "вычитание с ростом драйва почти перестаёт работать"
    )


def test_the_sweep_through_rest_is_continuous():
    """Развёртка реверсала: от вычитания через шунт к возбуждению без скачка."""
    sweep = run_sweep(model_of(SOURCE), "shunt.reversal=-70,-67,-65,-62")
    answers = [
        steady(variant.result, "ES.soma:v") for variant in sweep.variants
    ]
    assert answers == sorted(answers), "монотонно по реверсалу"
    steps = [b - a for a, b in zip(answers, answers[1:])]
    assert max(steps) < 3 * min(steps), "на покое ничего не ломается"


# --- запись ----------------------------------------------------------------


def test_shunt_conductance_is_recorded_on_its_own():
    """Шунт не зачисляется ни в `g_exc`, ни в `g_inh` -- у него своя корзина."""
    result = simulate(model_of(SOURCE))
    assert max(result.traces["ES.soma:g_shunt"]) > 1.0
    assert max(result.traces["EH.soma:g_inh"]) > 1.0

    # У шунтирующей клетки `g_inh` пуст. Зачисли шунт туда -- и график обещал бы
    # торможение, которого на мембране не видно.
    swapped = model_of(SOURCE.replace("record ES.soma.g_shunt", "record ES.soma.g_inh"))
    assert max(simulate(swapped).traces["ES.soma:g_inh"]) == 0.0


# --- диагностика -----------------------------------------------------------


def test_a_written_reversal_above_threshold_is_not_silent():
    _, diagnostics = load(SOURCE.replace("reversal = -65mV", "reversal = -10mV"))
    assert any("не ниже порога" in d.message for d in diagnostics)

    # Реестровый ноль `ampa` выше порога у всех клеток, и ругаться на него
    # нельзя: предупреждение выпадало бы на каждую вторую связь каждой схемы.
    _, quiet = load((EXAMPLES / "ffi.vnl").read_text(encoding="utf-8"))
    assert not any("не ниже порога" in d.message for d in quiet)


def test_a_shunt_from_a_gaba_cell_is_not_a_disagreement():
    """ГАМК-клетка через шунт -- учебник, а не спор: ругаться не на что."""
    _, quiet = load(SOURCE)
    assert not any("возбуждающий" in d.message for d in quiet)

    _, loud = load(SOURCE.replace("reversal = -65mV", "reversal = -10mV"))
    assert any("возбуждающий" in d.message for d in loud)


def test_a_current_drive_has_no_reversal():
    """Инжекция тока проводимости не открывает -- реверсала у неё нет вовсе.

    Отказ, а не предупреждение: человек, написавший реверсал у токового
    стимула, ждал шунта, а получил бы прежний ток и ничего больше.
    """
    from vnl.resolve import ValidationError

    with pytest.raises(ValidationError) as failure:
        load(
            SOURCE.replace(
                "stim pushS -> ES.soma : current amplitude=0.4nA start=100ms",
                "stim pushS -> ES.soma : current amplitude=0.4nA "
                "reversal=-65mV start=100ms",
            )
        )
    assert "нет реверсала" in str(failure.value)


# --- экспорт ---------------------------------------------------------------


def test_export_keeps_two_mechanisms_for_two_reversals():
    """Один механизм на имя рецептора схлопнул бы шунт с вычитанием."""
    report = netpyne_export(model_of(SOURCE))

    assert "'gaba_a'" in report.script, "реестровый реверсал сохраняет имя"
    assert "gaba_a_em65" in report.script, "написанный получает своё"
    assert any("шунт настроен на покой" in loss for loss in report.losses), (
        "молча экспортировать шунт на клетку с другим покоем нельзя"
    )


def test_dot_draws_the_shunt_with_its_own_arrow():
    dot = dot_export(model_of(SOURCE))
    assert "arrowhead=odot" in dot, "шунт -- кружок"
    assert "arrowhead=tee" in dot, "вычитание -- плашка"


# --- библиотека ------------------------------------------------------------


def test_the_library_pattern_shows_division():
    """Числа из шапки `shunting_inhibition.vnl` -- это и есть приёмка #496."""
    text = (EXAMPLES / "library" / "shunting_inhibition.vnl").read_text(
        encoding="utf-8"
    )
    model, diagnostics = load(text, source="examples/library/shunting_inhibition.vnl")
    assert model is not None, [str(d) for d in diagnostics]
    result = simulate(model)

    def window(cell: str, low: float, high: float) -> float:
        values = [
            value
            for time, value in zip(result.times, result.traces[f"{cell}.soma:v"])
            if low <= time < high
        ]
        return sum(values) / len(values) + 65.0

    bare = (window("E0", 180, 200), window("E0", 380, 400))
    shunt = (window("ES", 180, 200), window("ES", 380, 400))
    hyper = (window("EH", 180, 200), window("EH", 380, 400))

    assert bare == pytest.approx((5.00, 39.99), abs=0.01)
    assert shunt == pytest.approx((2.06, 16.48), abs=0.01)
    assert hyper == pytest.approx((2.06, 26.77), abs=0.01)

    # Доля, которую оставляет шунт, от уровня драйва не зависит -- это деление.
    assert shunt[0] / bare[0] == pytest.approx(shunt[1] / bare[1], abs=0.001)
    # У вычитания она растёт: при сильном драйве оно почти не работает.
    assert hyper[1] / bare[1] > hyper[0] / bare[0] + 0.25

    # 2.09, а не прежние 2.11: тоническое торможение приходит с корзинчатой
    # клетки, а её саму гонит `train`, который до #568 доставлялся дважды.
    # Уровень отклика мембраны это не сдвинуло вовсе (числа выше те же):
    # корзинчатая клетка и с одинарной доставкой разряжается на каждый импульс
    # поезда, -- сдвинулся только пик суммы, потому что импульсы перестали
    # приходить парами.
    assert max(result.traces["ES.soma:g_shunt"]) == pytest.approx(2.09, abs=0.01)
    assert max(result.traces["EH.soma:g_inh"]) == pytest.approx(0.61, abs=0.01)


# --- снимок и перемотка ----------------------------------------------------


def test_rewind_returns_the_same_run_with_two_reversals():
    """Ключ проводимости стал парой -- значит и в снимке он обязан быть парой.

    Иначе откат времени вернул бы клетку с половиной её проводимостей, и
    продолжение разошлось бы с непрерывным прогоном (#534, #537).
    """
    from vnl.sim.lif import Simulator

    straight = simulate(model_of(SOURCE))

    stepped = Simulator(model_of(SOURCE))
    stepped.advance(1000)
    saved = stepped.snapshot()
    stepped.advance(500)
    stepped.restore(saved)
    while stepped.step_once():
        pass

    assert stepped.result.traces == straight.traces
    assert stepped.result.spikes == straight.spikes
