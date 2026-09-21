"""Что из написанного драйва не доходит до клетки -- и говорится вслух (#512).

Три места, где стимул молча делал не то, что написано в тексте модели: времена
вне окна, времена за концом прогона и потолок пуассоновского рода. Все три
давали «прогон прошёл, числа не те» -- самый дорогой вид ошибки.

Здесь проверяется не только то, что диагностика появилась, но и то, что она
говорит правду: сколько импульсов дойдёт, столько и доходит; потолок рода --
там, где назван.
"""

from __future__ import annotations

import pytest

from vnl import ir, protocols
from vnl.resolve import ValidationError, load
from vnl.sim import simulate

#: Клетка с недостижимым порогом: считаются доставки, а не разряды. Каждая
#: доставка -- единственный шаг, на котором `g` растёт (спад её только
#: уменьшает), поэтому доставки видно прямо по трассе и белым ящиком лезть
#: никуда не нужно.
PROBE = """
model delivery
cell mute : excitatory, glutamate {{ tau_m = 10ms  threshold = -20mV }}
neuron E : mute
stim s -> E.soma : {stim}
record E.soma.g
run {{ dt = {dt}ms  duration = {duration}ms  level = L1  seed = 1 }}
"""


def build(stim: str, duration: float = 500.0, dt: float = 0.1, strict: bool = False):
    return load(
        PROBE.format(stim=stim, duration=duration, dt=dt),
        source="delivery.vnl",
        strict=strict,
    )


def notes(stim: str, duration: float = 500.0, dt: float = 0.1) -> str:
    _, diagnostics = build(stim, duration, dt)
    return "\n".join(str(d) for d in diagnostics)


def delivered(model) -> int:
    trace = simulate(model).traces["E.soma:g"]
    return sum(1 for before, after in zip(trace, trace[1:]) if after > before)


# --- времена вне окна ------------------------------------------------------


def test_times_outside_the_window_are_named_not_swallowed():
    """`times = 50, 150, 250` при `start = 100ms` -- два спайка из трёх."""
    stim = 'spikes weight=3nS times="50 150 250" start=100ms'
    text = notes(stim)
    assert "подано будет 2 времени из 3" in text
    assert "вне окна с 100 мс осталось 50" in text

    model, _ = build(stim)
    assert delivered(model) == 2  # диагностика сказала правду


def test_the_window_cuts_and_does_not_shift_and_says_so():
    """Решение задачи: у `times` моменты абсолютные, `start` -- граница.

    Сдвигающая семантика (как у шаблонов, где `start` -- начало расписания)
    была бы ровно так же молчалива: написанные 50 мс тихо уехали бы на 150.
    Поэтому выбран отказ от сдвига плюс диагностика, которая эту разницу
    называет: у шаблона моменты строятся от `start`, у списка -- пишутся
    руками, и одно слово не может значить в них разное молча.
    """
    text = notes('spikes weight=3nS times="50 150 250" start=100ms')
    assert "start для них -- граница, а не начало расписания" in text

    model, _ = build('spikes weight=3nS times="50 150 250" start=100ms')
    trace = simulate(model).traces["E.soma:g"]
    times = [
        round(index * model.run.dt, 1)
        for index, (before, after) in enumerate(zip(trace, trace[1:]), start=1)
        if after > before
    ]
    # Сдвиг дал бы 150 и 250 плюс 350; отсечение даёт то, что написано, минус
    # выпавшее. Задержка входного контакта -- 0.1 мс, один шаг.
    assert times == [150.1, 250.1]


def test_a_template_with_start_loses_nothing():
    """У шаблона `start` -- начало расписания, и окно ничего не режет."""
    assert "вне окна" not in notes(
        "train weight=3nS n=8 freq=20Hz start=100ms", duration=600
    )


# --- времена за концом прогона ---------------------------------------------


def test_a_time_past_the_end_of_the_run_is_named():
    """`times = 600` при `duration = 500ms` -- сегодня тишина и ноль спайков."""
    text = notes('spikes weight=3nS times="600"')
    assert "1 время за концом прогона 500 мс: 600" in text
    assert "не доживёт" in text
    assert delivered(build('spikes weight=3nS times="600"')[0]) == 0


def test_the_recovery_pulse_that_falls_off_the_run_is_named():
    """Тот самый случай из карточки: тест восстановления на 950 мс при 500."""
    text = notes("train weight=3nS n=8 freq=20Hz recovery=500ms")
    assert "за концом прогона 500 мс: 850" in text


def test_nothing_is_said_when_everything_fits():
    """Диагностика, которая говорит всегда, не говорит ничего."""
    assert notes('spikes weight=3nS times="50 150 250"') == ""
    assert notes("poisson rate=250Hz weight=1.5nS start=20ms stop=380ms") == ""


# --- два времени в одном шаге ----------------------------------------------


def test_two_times_inside_one_step_are_named_and_summed():
    """Импульсы складываются -- и об этом сказано.

    Терять один из двух нельзя: это молча половина заданного драйва, ровно та
    ошибка, которой болел движок до #568. Значит, единственно честное
    поведение -- сложить и назвать, что сложено.
    """
    text = notes('spikes weight=3nS times="100 100.04"')
    assert "в один шаг 0.1 мс попадает больше одного импульса (100, 100.04 мс)" in text
    assert "сложатся в один импульс двойной амплитуды" in text

    one, _ = build('spikes weight=3nS times="100"')
    two, _ = build('spikes weight=3nS times="100 100.04"')
    peak_one = max(simulate(one).traces["E.soma:g"])
    peak_two = max(simulate(two).traces["E.soma:g"])
    assert delivered(two) == 1  # один шаг -- один рост, но вдвое выше
    assert peak_two == pytest.approx(2 * peak_one, rel=1e-9)


def test_poisson_cannot_get_into_that_regime_silently():
    """У `poisson` шаг несёт не больше одного события -- и выше потолка отказ.

    Сравнять два рода «сложением» нельзя: чтобы `poisson` клал в шаг больше
    одного события, розыгрыш пришлось бы поменять, а от него зависит каждое
    число библиотеки и каждый закреплённый отпечаток. Поэтому сравняли
    наблюдаемое: ни один род больше не теряет событий молча -- событийный
    складывает, пуассоновский отказывается считать там, где начал бы терять.
    """
    with pytest.raises(ValidationError) as exc:
        build("poisson rate=20000Hz weight=1.5nS", strict=True)
    assert "потолка 10000 Гц" in str(exc.value)


# --- потолок пуассоновского рода -------------------------------------------


def test_the_ceiling_is_refused_with_words_not_met_silently():
    text = notes("poisson rate=20000Hz weight=1.5nS")
    assert "ОШИБКА" in text
    assert "2 события на шаг" in text
    assert "выше потолка 10000 Гц стимул выдал бы 10000 Гц" in text
    assert "40 стимулов по 500 Гц вместо одного" in text


def test_a_smaller_step_lifts_the_ceiling():
    """Совет из отказа обязан работать, и работать молча.

    Шаг, который отказ называет, обязан выводить и из-под предупреждения --
    иначе совет привёл бы из ошибки в замечание и человек справедливо решил
    бы, что его обманули.
    """
    assert "0.0025 мс или меньше" in notes("poisson rate=20000Hz weight=1.5nS")
    assert notes("poisson rate=20000Hz weight=1.5nS", dt=0.0025) == ""


@pytest.mark.parametrize(
    "rate, load", [(1000, "0.1"), (2000, "0.2"), (5000, "0.5")]
)
def test_a_heavy_step_is_warned_about_with_its_number(rate, load):
    text = notes(f"poisson rate={rate}Hz weight=1.5nS")
    assert "предупр." in text
    assert f"{load} события на шаг" in text
    assert "потолок рода -- 10000 Гц" in text


def test_the_background_drive_of_the_library_is_not_nagged_about():
    """250 Гц при dt = 0.1 мс -- 0.025 события на шаг, и это законный драйв."""
    assert notes("poisson rate=250Hz weight=1.5nS") == ""


def test_the_warning_tells_the_truth_about_the_count():
    """Предупреждение обещает сохранность счёта -- проверяем счётом.

    Карточка задачи ждала здесь дефицита около 5%: мол, бернуллиев розыгрыш
    недодаёт `p/2` событий. Измерение этого не подтверждает, и вот почему.
    Розыгрыш ведётся с вероятностью `p = rate·dt/1000`, то есть с тем же
    средним, что у пуассоновского процесса: за 5 с при 1000 Гц доставляется
    5053 события против ожидаемых 5000 (+1.1%, порядок случайного разброса).
    Теряется не число событий, а их совместность: шаг несёт не больше одного,
    и совпадения внутри шага -- те самые ~5% событий при `p = 0.1` -- приходят
    порознь. Предупреждение говорит именно это, а не про дефицит счёта.
    """
    model, _ = build("poisson rate=1000Hz weight=0.05nS", duration=5000)
    count = delivered(model)
    assert count == pytest.approx(5000, rel=0.05)
    assert "Суммарное число событий сохраняется" in notes(
        "poisson rate=1000Hz weight=0.05nS"
    )


# --- где это видно ---------------------------------------------------------


def test_the_sandbox_sees_the_same_notes():
    """В песочнице длительность и моменты правят руками и врозь."""
    from vnl.compose import compose
    from vnl.patterns import Endpoint, Sandbox, SandboxNeuron, SandboxStimulus

    sandbox = Sandbox.empty("проба")
    sandbox.cell_types["mute"] = ir.CellType(id="mute", tags=("excitatory",))
    sandbox.neurons["E"] = SandboxNeuron(id="E", cell_type="mute")
    sandbox.stimuli.append(
        SandboxStimulus(
            id="s",
            target=Endpoint("E"),
            kind="spikes",
            times=(600.0,),
            amplitude=3.0,
        )
    )
    sandbox.run.duration = 500.0
    assert any(
        "за концом прогона 500 мс: 600" in note
        for note in compose(sandbox).warnings
    )


def test_the_threshold_of_the_warning_is_one_number_in_one_place():
    """Порог -- в реестре протоколов, а не в тексте сообщения и не в тесте."""
    assert protocols.POISSON_SAFE_LOAD == 0.1
