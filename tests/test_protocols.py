"""Протоколы стимуляции: шаблон и написанный руками список времён.

Главная проверка здесь одна и она не про арифметику: шаблон обязан быть сахаром
над `spikes`, то есть давать побитово тот же прогон, что список тех же чисел.
Всё остальное -- частные случаи этого требования: развёртка в числа, отказы на
бессмысленных параметрах и то, что список времён видно в ответе, в экспорте и
в отчёте.
"""

from pathlib import Path

import pytest

from vnl import ir, protocols
from vnl.api import glossary_payload, model_payload
from vnl.backends.netpyne_export import export
from vnl.patterns import Endpoint, PatternError, Sandbox, SandboxStimulus
from vnl.project import Project
from vnl.resolve import ValidationError, load
from vnl.sim import simulate
from vnl.store import Store, to_plain

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


# --- чистые функции: шаблон -> список времён -------------------------------


def test_train_expands_to_even_comb():
    assert protocols.train(n=8, freq=20, start=100) == (
        100.0,
        150.0,
        200.0,
        250.0,
        300.0,
        350.0,
        400.0,
        450.0,
    )


def test_train_recovery_adds_one_test_pulse():
    times = protocols.train(n=8, freq=20, start=100, recovery=500)
    assert times[-1] == 950.0
    assert len(times) == 9


def test_train_repeats_shift_whole_episode():
    times = protocols.train(n=2, freq=100, repeats=3, period=1000)
    assert times == (0.0, 10.0, 1000.0, 1010.0, 2000.0, 2010.0)


def test_pairs_put_two_pulses_at_the_interval():
    assert protocols.pairs(isi=50, start=100) == (100.0, 150.0)
    # 15 пар с частотой повторения 10 Гц -- набор STDP из Sjöström и др.
    times = protocols.pairs(n=15, isi=10, freq=10)
    assert len(times) == 30
    assert times[:4] == (0.0, 10.0, 100.0, 110.0)


def test_burst_is_four_pulses_at_hundred_hertz():
    assert protocols.burst() == (0.0, 10.0, 20.0, 30.0)


def test_tetanus_counts_pulses_by_window_not_by_last_one():
    # 100 Гц в течение 1000 мс -- 100 импульсов, последний в 990 мс.
    times = protocols.tetanus(freq=100, duration=1000)
    assert len(times) == 100
    assert times[-1] == 990.0


def test_theta_burst_matches_the_canonical_protocol():
    times = protocols.theta_burst(n=4, freq=100, bursts=10, burst_period=200)
    assert len(times) == 40
    assert times[:4] == (0.0, 10.0, 20.0, 30.0)
    assert times[4] == 200.0
    assert times[-1] - times[0] == 1830.0


@pytest.mark.parametrize(
    "call",
    [
        lambda: protocols.train(n=0, freq=20),
        lambda: protocols.train(n=8, freq=0),
        lambda: protocols.train(n=8, freq=20, repeats=2),
        lambda: protocols.pairs(isi=0),
        lambda: protocols.tetanus(freq=100, duration=5),
        lambda: protocols.tetanus(freq=1000, duration=60_000),
    ],
)
def test_nonsense_parameters_are_refused(call):
    with pytest.raises(protocols.ProtocolError):
        call()


# --- язык: шаблон в .vnl ---------------------------------------------------


CHAIN = """
model chain
cell relay : excitatory, glutamate {{ tau_m = 8ms  threshold = -50mV }}
neuron A : relay
{stim}
record A.soma.v
run {{ dt = 0.1ms  duration = 300ms  level = L1  seed = 1 }}
"""


def chain(stim: str) -> ir.Model:
    model, _ = load(CHAIN.format(stim=stim))
    return model


def test_train_parses_with_units_and_keeps_its_numbers():
    model = chain("stim s -> A.soma : train { n = 8, freq = 50Hz, start = 50ms, weight = 3nS }")
    stim = model.stimuli[0]
    assert (stim.kind, stim.n, stim.freq, stim.start) == ("train", 8, 50.0, 50.0)
    assert protocols.spike_times(stim) == (50, 70, 90, 110, 130, 150, 170, 190)


def test_train_without_numbers_takes_canonical_ones():
    """Протокол на то и протокол, что его значения известны."""
    model = chain("stim s -> A.soma : train { weight = 3nS }")
    stim = model.stimuli[0]
    assert (stim.n, stim.freq) == (8, 20.0)
    assert protocols.spike_times(stim)[:2] == (0.0, 50.0)


def test_unknown_kind_names_the_ones_that_exist():
    with pytest.raises(ValidationError, match="train"):
        chain("stim s -> A.soma : marching { weight = 3nS }")


def test_broken_template_is_refused_before_the_run():
    with pytest.raises(ValidationError, match="freq"):
        chain("stim s -> A.soma : train { n = 8, freq = 0Hz, weight = 3nS }")


# --- главное: сахар ничего не меняет ---------------------------------------


TEMPLATE = "stim s -> A.soma : train { n = 8, freq = 50Hz, start = 50ms, weight = 3nS }"
LITERAL = 'stim s -> A.soma : spikes weight=3nS times="50 70 90 110 130 150 170 190"'


def test_template_and_hand_written_list_give_the_same_run():
    """Побитово: до солвера доходит один и тот же кортеж чисел."""
    by_template = simulate(chain(TEMPLATE))
    by_hand = simulate(chain(LITERAL))
    assert by_template.spikes == by_hand.spikes
    assert by_template.traces == by_hand.traces


def test_template_prints_itself_as_a_list_of_times():
    template = chain(TEMPLATE).stimuli[0]
    literal = chain(LITERAL).stimuli[0]
    assert protocols.spike_times(template) == protocols.spike_times(literal)


def test_library_train_matches_short_term_depression_by_hand():
    """Поезд 8×50 Гц -- ровно тот стимул, которым проверена депрессия."""
    text = (EXAMPLES / "library" / "short_term_depression.vnl").read_text(
        encoding="utf-8"
    )
    model, _ = load(text)
    stim = model.stimuli[0]
    assert stim.times == protocols.train(n=8, freq=50, start=50)


# --- слова протокола -------------------------------------------------------


def test_protocol_is_told_in_words_not_in_numbers():
    model = chain(
        "stim s -> A.soma : train { n = 8, freq = 20Hz, recovery = 500ms, weight = 3nS }"
    )
    assert protocols.describe(model.stimuli[0]) == (
        "поезд, 8 импульсов, 20 Гц, тест восстановления через 500 мс"
    )


def test_poisson_is_called_average_in_words():
    model = chain("stim s -> A.soma : poisson rate=100Hz weight=1.5nS")
    assert "в среднем" in protocols.describe(model.stimuli[0])


def test_words_agree_on_number_forms():
    assert protocols._impulses(1) == "1 импульс"
    assert protocols._impulses(3) == "3 импульса"
    assert protocols._impulses(8) == "8 импульсов"
    assert protocols._impulses(11) == "11 импульсов"
    assert protocols._impulses(21) == "21 импульс"


# --- ответы сервера --------------------------------------------------------


def test_payload_carries_both_the_words_and_the_times():
    model = chain(TEMPLATE)
    stim = model_payload(model)["stimuli"][0]
    assert stim["kind"] == "train"
    assert stim["protocol"].startswith("поезд")
    assert stim["times"] == [50, 70, 90, 110, 130, 150, 170, 190]
    assert stim["n"] == 8


def test_glossary_brings_the_kinds_with_their_fields():
    drives = {drive["id"]: drive for drive in glossary_payload()["drives"]}
    assert set(drives) == set(protocols.KINDS)
    assert "в среднем" in drives["poisson"]["note"]
    assert drives["current"]["receptor"] is False
    assert drives["train"]["template"] is True
    names = [param["name"] for param in drives["train"]["params"]]
    assert names[:2] == ["n", "freq"]
    assert all(param["note"] for param in drives["tbs"]["params"])


def test_export_writes_the_expanded_list():
    report = export(chain(TEMPLATE))
    assert "[50.0, 70.0, 90.0, 110.0, 130.0, 150.0, 170.0, 190.0]" in report.script


# --- песочница -------------------------------------------------------------


@pytest.fixture
def project(tmp_path) -> Project:
    sandbox = Sandbox(id="s1", name="Рабочая", run=ir.RunSpec(duration=500.0))
    sandbox.neurons["A"] = _neuron()
    sandbox.stimuli.append(
        SandboxStimulus(
            id="drive1",
            target=Endpoint("A"),
            kind="poisson",
            rate=100.0,
            amplitude=1.5,
        )
    )
    return Project(sandbox, Store(tmp_path))


def _neuron():
    from vnl.patterns import SandboxNeuron

    return SandboxNeuron(id="A", cell_type="pyr_l5")


def test_switching_to_a_template_brings_its_canonical_numbers(project):
    stim = project.set_stimulus("drive1", kind="train")
    assert (stim.n, stim.freq) == (8, 20.0)
    # Набранное прежде не стирается: частота пуассона осталась на месте.
    assert stim.rate == 100.0


def test_switching_keeps_numbers_typed_by_hand(project):
    project.set_stimulus("drive1", kind="train", freq=100.0)
    stim = project.set_stimulus("drive1", kind="burst")
    assert stim.freq == 100.0


def test_refused_template_leaves_the_project_alone(project):
    project.set_stimulus("drive1", kind="train")
    with pytest.raises(PatternError, match="freq"):
        project.set_stimulus("drive1", freq=0.0)
    assert project.sandbox.stimuli[0].freq == 20.0


def test_template_survives_saving_and_loading(tmp_path, project):
    project.set_stimulus("drive1", kind="tbs", bursts=3)
    store = Store(tmp_path)
    store.save_sandbox(project.sandbox)
    again = store.load_sandbox("s1")
    stim = again.stimuli[0]
    assert (stim.kind, stim.bursts, stim.n) == ("tbs", 3, 4)
    assert len(protocols.spike_times(stim)) == 12
    assert to_plain(stim)["burst_period"] == 200.0


# --- живая просьба: «чтобы было 1 в 10 мс спайк» ---------------------------


def test_one_spike_every_ten_milliseconds_is_even(project):
    """Ровный гребень, а не пачки и провалы: все промежутки одинаковы."""
    project.set_stimulus("drive1", kind="train", n=50, freq=100.0, amplitude=3.0)
    times = protocols.spike_times(project.sandbox.stimuli[0])
    gaps = {round(b - a, 6) for a, b in zip(times, times[1:])}
    assert gaps == {10.0}
    assert (len(times), times[-1]) == (50, 490.0)

# --- протокол, на котором движку верить нельзя -----------------------------


STDP_CHAIN = """
model pairing
cell relay : excitatory, glutamate {{ tau_m = 8ms  threshold = -50mV }}
neuron A : relay
neuron B : relay
A -> B {{ receptor = ampa  weight = 1nS  delay = 1ms  plasticity = stdp }}
stim s -> A.soma : pairs {{ n = 15, isi = 10ms, freq = {freq}Hz, weight = 3nS }}
record B.soma.v
run {{ dt = 0.1ms  duration = 500ms  level = L1  seed = 1 }}
"""


def pairing(freq: float):
    from vnl.parser import parse
    from vnl.resolve import resolve

    _, diagnostics = resolve(parse(STDP_CHAIN.format(freq=freq)))
    return [d.message for d in diagnostics if d.severity == "warning"]


def test_fast_pairing_is_warned_about_not_silently_counted():
    """Выше ~25 Гц знак STDP задаёт частота, а не порядок спайков."""
    said = " ".join(pairing(40))
    assert "40 Гц" in said and "10-20 Гц" in said


def test_honest_pairing_rate_is_not_nagged_about():
    assert not [note for note in pairing(10) if "STDP" in note]


def test_without_plasticity_the_rate_is_nobody_business():
    # Предупреждение про STDP на схеме без пластичности было бы придиркой:
    # правило, о котором речь, там не работает вовсе.
    model = chain("stim s -> A.soma : pairs { n = 15, isi = 10ms, freq = 40Hz, weight = 3nS }")
    assert protocols.cautions(model) == []

# --- род драйва объяснён словами (#553) ------------------------------------


def note_of(kind: str) -> str:
    return protocols.DRIVE_KINDS[kind].note


def test_poisson_says_the_moments_are_random_and_the_rate_is_average():
    """Из-за этой строки и заводилась задача: 100 Гц читали как метроном."""
    said = note_of("poisson").lower()
    assert "случайн" in said
    assert "в среднем" in said
    assert "зерн" in said, "повторяемость -- половина ответа про случайность"


def test_poisson_rate_is_labelled_average_not_just_frequency():
    rate = next(
        param
        for param in protocols.DRIVE_KINDS["poisson"].params
        if param.name == "rate"
    )
    assert rate.label == "Средняя частота"
    assert rate.unit == "Гц"


def test_spikes_says_the_picture_always_repeats():
    said = note_of("spikes")
    assert "всегда" in said and "заданные моменты" in said


def test_current_says_there_are_no_events_at_all():
    said = note_of("current")
    assert "нет" in said and "ток" in said


def test_templates_are_explained_too_not_only_the_old_three():
    """Новый род без объяснения -- такой же шифр, каким было слово «пуассоновский»."""
    for kind in protocols.TEMPLATES:
        assert len(note_of(kind)) > 40, kind
    assert "ровно каждые" in note_of("train")


def test_every_number_of_every_kind_is_explained():
    unexplained = [
        f"{kind}.{param.name}"
        for kind, drive in protocols.DRIVE_KINDS.items()
        for param in drive.params
        if not param.note
    ]
    assert unexplained == []


def test_the_field_itself_is_explained_apart_from_its_values():
    # В закрытом списке видно одно значение: подсказка на нём расшифровывает
    # выбранное, а «что это за поле вообще» -- другой вопрос.
    assert "повторится" in protocols.KIND_NOTE
    assert protocols.KIND_NOTE not in {
        drive.note for drive in protocols.DRIVE_KINDS.values()
    }

