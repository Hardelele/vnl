"""Оператор `expect`: как читается, что отвергает и что говорит вслух (#501).

Сверкой корпуса занят `test_library_numbers`; здесь -- сам язык. Главное
здесь -- третий раздел: проверка, которая не падала, ничего не гарантирует, и
сообщение о расхождении читают чаще, чем пишут.
"""

from __future__ import annotations

import pytest

from vnl import ir
from vnl.expectations import check_model, failures
from vnl.patterns import Pattern
from vnl.resolve import ValidationError, load
from vnl.sim import simulate

#: Две клетки, событийный драйв, ничего случайного: числа здесь можно считать
#: в уме, и падение теста означает разговор про `expect`, а не про солвер.
PAIR = """
model pair
cell relay : excitatory, glutamate {{ tau_m = 8ms  threshold = -50mV  refractory = 4ms }}
cell target : excitatory, glutamate {{ tau_m = 10ms  threshold = -50mV  refractory = 4ms }}
neuron IN : relay
neuron E  : target
IN.soma -> E.soma {{ receptor = ampa  weight = 2.2nS  delay = 1.0ms }}
stim drive -> IN.soma : spikes weight=3nS times="20 60 100"
record E.soma.v
record E.soma.g_exc
expect {{
{body}
}}
run {{ dt = 0.1ms  duration = 200ms  level = L1  seed = 1 }}
"""


def build(body: str, strict: bool = True):
    return load(PAIR.format(body=body), source="pair.vnl", strict=strict)


# --- чтение ----------------------------------------------------------------


def test_counts_windows_and_traces_are_read():
    model, _ = build(
        """
        E.spikes = 3
        E.spikes = 2  start=0ms stop=80ms
        E.first_spike = 24.4ms
        E.soma.g_exc.max = 2.09nS
        E.soma.g_exc.peak = 2.09nS index=2
        sweep "c1.weight=0.4,2.2" E.spikes = 0, 3
        """
    )
    assert [e.measure for e in model.expectations] == [
        "spikes",
        "spikes",
        "first_spike",
        "max",
        "peak",
        "spikes",
    ]
    assert model.expectations[1].stop == 80.0
    assert model.expectations[3].target == "E.soma:g_exc"
    assert model.expectations[5].sweep == "c1.weight=0.4,2.2"
    assert not failures(check_model(model))


def test_tolerance_comes_from_the_written_number():
    """Допуск -- в числе, а не в коде проверки.

    `2.2nS` -- утверждение про десятые, `2.2000nS` -- про десятитысячные. Одна
    общая мерка на оба случая либо пропустила бы сдвиг у второго, либо краснела
    бы на последнем знаке двоичной дроби у первого.
    """
    model, _ = build(
        """
        E.soma.g_exc.max = 2.2nS
        E.soma.g_exc.max = 2.2000nS
        E.first_spike = 24ms
        E.first_spike = 24.4ms  tol=0.001ms
        """
    )
    assert [e.tolerance for e in model.expectations] == [0.05, 0.00005, 0.5, 0.001]


def test_spikes_are_compared_exactly():
    """У счёта спайков допуска нет: «почти шесть спайков» ничего не значит."""
    model, _ = build("E.spikes = 4")
    assert model.expectations[0].measure == "spikes"
    assert failures(check_model(model)) == [
        "pair: E.spikes ожидалось 4, получено 3"
    ]


# --- что отвергается -------------------------------------------------------


@pytest.mark.parametrize(
    "body, expected",
    [
        ("NOPE.spikes = 3", "неизвестный нейрон"),
        ("E.soma.v.mean = 3mV\nE.spikes = 3\nE.soma.w.max = 1nS", "не записана"),
        ("E.soma.v.nonsense = 3mV", "неизвестная величина"),
        ("E.spikes = 2.5", "спайки целые"),
        ("E.spikes = 1, 2", "ряд чисел бывает только у развёртки"),
        ('sweep "c1.weight=1,2,3" E.spikes = 1, 2', "вариантов 3, а заявленных чисел 2"),
        ('sweep "нет=1,2" E.spikes = 1, 2', "не разобрать развёртку"),
        ("E.spikes = 3 window=5ms", "непонятное уточнение"),
    ],
)
def test_bad_expectations_are_refused_with_words(body, expected):
    with pytest.raises(ValidationError) as exc:
        build(body)
    assert expected in str(exc.value), str(exc.value)


def test_expectation_on_an_unrecorded_trace_is_an_error():
    """Самая обидная ошибка оператора: сверять нечего, а выглядит как проверка."""
    _, diagnostics = build("E.soma.w.final = 2.2nS", strict=False)
    text = "\n".join(str(d) for d in diagnostics)
    assert "E.soma:w не записана" in text
    assert "record E.soma.w" in text


# --- проверка ловит поломку ------------------------------------------------


def test_the_message_names_the_pattern_and_both_numbers():
    """`ffi: E.spikes ожидалось 6, получено 9`, а не `assert 9 == 6`."""
    model, _ = build("E.spikes = 6\nE.soma.g_exc.max = 5nS")
    assert failures(check_model(model)) == [
        "pair: E.spikes ожидалось 6, получено 3",
        "pair: E.soma.g_exc.max ожидалось 5nS, получено 2.093nS; допуск 0.5nS",
    ]


def test_a_broken_solver_is_caught_by_the_sweep_too():
    """Развёртка называет и разошедшийся вариант: ряд -- одно утверждение."""
    model, _ = build('sweep "c1.weight=0.4,2.2" E.spikes = 3, 3')
    assert failures(check_model(model)) == [
        "pair: sweep c1.weight=0.4,2.2 E.spikes ожидалось 3, 3, получено 0, 3 "
        "(разошлись варианты: 0.4)"
    ]


def test_a_missing_spike_is_named_not_swallowed():
    model, _ = build("E.first_spike = 24.4ms  start=150ms stop=200ms")
    assert failures(check_model(model)) == [
        "pair: E.first_spike -- у E нет спайков в окне 150..200 мс"
    ]


# --- место ожиданий в модели ----------------------------------------------


def test_expectations_do_not_travel_into_someone_elses_network():
    """Заявленное число -- про демонстрацию, а не про конструкцию блока."""
    model, _ = build("E.spikes = 3")
    pattern = Pattern.from_model(model, id="pair", name="Пара")
    assert model.expectations
    assert pattern.body.expectations == []
    assert pattern.demo is not None


def test_a_model_without_expect_is_still_a_model():
    """Оператор необязателен: схема в работе ничего заявлять не обязана."""
    model, diagnostics = load(
        """
model bare
cell any : excitatory, glutamate { tau_m = 10ms }
neuron A : any
record A.soma.v
run { dt = 0.1ms  duration = 10ms }
""",
        strict=True,
    )
    assert model.expectations == []
    assert not [d for d in diagnostics if d.severity == "error"]
    assert check_model(model, simulate(model)) == []


def test_sweeps_are_run_once_per_spec(monkeypatch):
    """У `ffi` на одной развёртке три утверждения -- прогонов должно быть три.

    Считай проверка развёртку на каждое ожидание, полная сверка библиотеки
    подорожала бы вдвое ни за что: три утверждения дали бы девять прогонов
    вместо трёх.
    """
    from vnl import expectations as module

    calls: list[str] = []
    original = module.run_sweep

    def counted(model, spec):
        calls.append(spec)
        return original(model, spec)

    monkeypatch.setattr(module, "run_sweep", counted)
    model, _ = build(
        """
        sweep "c1.weight=0.4,2.2" E.spikes = 0, 3
        sweep "c1.weight=0.4,2.2" IN.spikes = 3, 3
        """
    )
    assert not failures(check_model(model))
    assert calls == ["c1.weight=0.4,2.2"]


def test_the_operator_keeps_its_place_in_the_language():
    """`expect` -- не конструкция схемы: без него IR тот же самый."""
    with_expect, _ = build("E.spikes = 3")
    without = PAIR.format(body="").replace("expect {\n\n}", "")
    plain, _ = load(without, source="pair.vnl", strict=True)
    assert isinstance(with_expect.expectations[0], ir.Expectation)
    assert plain.summary() == with_expect.summary()
