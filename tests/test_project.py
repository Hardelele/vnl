"""Операции над проектом: отмена, устаревание прогона, несохранённое."""

from pathlib import Path

import pytest

from vnl import ir
from vnl.patterns import (
    Endpoint,
    Pattern,
    PatternError,
    Port,
    Sandbox,
    SandboxRecording,
    SandboxStimulus,
)
from vnl.project import Project
from vnl.resolve import load
from vnl.store import Store

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


@pytest.fixture
def ffi() -> Pattern:
    model, _ = load(example("ffi"))
    return Pattern.from_model(
        model,
        id="ffi",
        name="FFI",
        status="ready",
        ports=[
            Port("in", "in", ir.Site("IN", "soma", 0.5)),
            Port("out", "out", ir.Site("E", "soma", 0.5)),
        ],
    )


@pytest.fixture
def project(tmp_path, ffi) -> Project:
    store = Store(tmp_path)
    store.save_pattern(ffi)
    sandbox = Sandbox(id="s1", name="Рабочая", run=ir.RunSpec(duration=200.0, seed=7))
    return Project(sandbox, store)


def running_project(project: Project, ffi: Pattern) -> Project:
    """Готовая к запуску схема: блок, драйв, запись."""
    project.insert_pattern(ffi, instance_id="a")
    project.stimulate(
        SandboxStimulus(
            id="drive", target=Endpoint("a", "in"), rate=250.0, amplitude=1.5
        )
    )
    project.record(SandboxRecording(id="r1", target=Endpoint("a", "out")))
    return project


# --- отмена ---------------------------------------------------------------


def test_undo_returns_the_previous_state(project, ffi):
    project.insert_pattern(ffi, instance_id="a")
    project.insert_pattern(ffi, instance_id="b")
    assert len(project.sandbox.instances) == 2

    label = project.undo()
    assert "FFI" in (label or "")
    assert [block.id for block in project.sandbox.instances] == ["a"]


def test_a_batch_is_undone_in_one_step(project, ffi):
    """Пачка правок Claude отменяется целиком, а не по одному нейрону."""
    with project.batch("Claude собрал цепочку") as work:
        work.insert_pattern(ffi, instance_id="a")
        work.insert_pattern(ffi, instance_id="b")
        work.connect(Endpoint("a", "out"), Endpoint("b", "in"), link_id="a_to_b")

    assert len(project.sandbox.instances) == 2 and len(project.sandbox.links) == 1

    assert project.undo() == "Claude собрал цепочку"
    assert project.sandbox.instances == [] and project.sandbox.links == []
    assert not project.can_undo


def test_undo_on_empty_history_is_quiet(project):
    assert project.undo() is None


def test_history_does_not_grow_without_bound(project, ffi):
    for index in range(80):
        project.insert_pattern(ffi, instance_id=f"b{index}")
    assert len(project.history) <= 50


# --- несохранённое --------------------------------------------------------


def test_dirty_reflects_real_changes(project, ffi):
    assert not project.dirty

    project.insert_pattern(ffi, instance_id="a")
    assert project.dirty

    project.save()
    assert not project.dirty

    project.undo()
    assert project.dirty, "откат — тоже изменение относительно сохранённого"


def test_saving_a_pattern_is_not_saving_the_sandbox(project, ffi):
    project.insert_pattern(ffi, instance_id="a")
    pattern, _ = project.extract(["a"], "Кусок")
    project.save_as_pattern(pattern)

    assert project.dirty, "песочница так и осталась несохранённой"
    assert project.store is not None
    assert project.store.load_pattern(pattern.id).name == "Кусок"


# --- запуск и устаревание -------------------------------------------------


def test_run_refuses_a_broken_schema(project, ffi):
    project.insert_pattern(ffi, instance_id="a")
    project.connect(Endpoint("a", "out"), Endpoint("ghost", "in"), link_id="bad")

    assert project.check(), "проблемы должны быть видны до запуска"
    with pytest.raises(PatternError, match="не готова"):
        project.run()


def test_run_gives_a_result_tied_to_this_state(project, ffi):
    run = running_project(project, ffi).run()

    assert run.result.spike_count()["a/IN"] > 0
    assert not project.run_is_stale


def test_changing_the_schema_marks_the_result_stale(project, ffi):
    running_project(project, ffi).run()
    assert not project.run_is_stale

    project.insert_pattern(ffi, instance_id="b")
    assert project.run_is_stale, "результат уже про другую сеть"


def test_moving_a_block_does_not_stale_the_result(project, ffi):
    """Рисование не определяет физику: сдвиг по холсту результат не старит."""
    running_project(project, ffi).run()
    project.move("a", (120.0, 40.0))

    assert not project.run_is_stale
    assert project.dirty, "но сохранить проект всё же нужно"


# --- операции -------------------------------------------------------------


def test_removing_a_block_takes_its_links_and_stimuli(project, ffi):
    running_project(project, ffi)
    project.insert_pattern(ffi, instance_id="b")
    project.connect(Endpoint("a", "out"), Endpoint("b", "in"), link_id="a_to_b")

    project.remove("a")

    assert [block.id for block in project.sandbox.instances] == ["b"]
    assert project.sandbox.links == [], "висячая связь осталась бы битой"
    assert project.sandbox.stimuli == []


def test_parameters_change_through_the_project(project, ffi):
    project.insert_pattern(ffi, instance_id="a")
    project.insert_pattern(ffi, instance_id="b")
    link = project.connect(Endpoint("a", "out"), Endpoint("b", "in"), link_id="x")

    project.set_parameters("x", weight=4.0, delay=2.5)
    assert (link.weight, link.delay) == (4.0, 2.5)

    with pytest.raises(PatternError, match="нет параметров"):
        project.set_parameters("x", colour="red")

    project.undo()
    assert project.sandbox.links[0].weight != 4.0


def test_fork_leaves_the_library_alone(project, ffi):
    project.insert_pattern(ffi, instance_id="a")
    forked = project.fork("a", name="FFI медленный")
    forked.body.contacts[0].delay = 9.0
    project.save_as_pattern(forked)

    assert project.store is not None
    assert project.store.load_pattern("ffi").body.contacts[0].delay != 9.0
    assert len(project.sandbox.instances) == 1, "fork не трогает песочницу"


# --- настройки блока, клетки, стимула и прогона ----------------------------


def test_renaming_a_block_touches_the_instance_not_the_pattern(project, ffi):
    """Подпись на холсте -- у экземпляра: одноимённые блоки надо различать."""
    project.insert_pattern(ffi, instance_id="a")
    project.insert_pattern(ffi, instance_id="b")

    project.rename("a", "Вход")

    assert project.sandbox.instance("a").label == "Вход"
    assert project.sandbox.instance("b").label == "FFI", "сосед не переименован"
    assert project.sandbox.instance("a").snapshot.name == "FFI"
    assert project.store is not None
    assert project.store.load_pattern("ffi").name == "FFI"

    with pytest.raises(PatternError, match="пустой"):
        project.rename("a", "   ")


def test_cell_parameters_change_only_inside_this_block(project, ffi):
    """У каждого блока снимок свой, поэтому порог правится поблочно."""
    project.insert_pattern(ffi, instance_id="a")
    project.insert_pattern(ffi, instance_id="b")

    project.set_cell("a", "pyr_l5", v_threshold=-45.0, tau_m=20.0, adaptation=3.0)

    first = project.sandbox.instance("a").snapshot.body.cell_types["pyr_l5"]
    second = project.sandbox.instance("b").snapshot.body.cell_types["pyr_l5"]
    assert (first.point_model.v_threshold, first.point_model.tau_m) == (-45.0, 20.0)
    assert second.point_model.v_threshold == -50.0, "второй блок не задет"
    assert project.store is not None
    library = project.store.load_pattern("ffi").body.cell_types["pyr_l5"]
    assert library.point_model.v_threshold == -50.0, "библиотека тоже не задета"


def test_a_changed_cell_makes_the_result_stale(project, ffi):
    """Порог -- это физика: прежний прогон после правки уже про другую сеть."""
    running_project(project, ffi).run()
    assert not project.run_is_stale

    project.set_cell("a", "pyr_l5", v_threshold=-40.0)
    assert project.run_is_stale


def test_a_lower_threshold_gives_more_spikes(project, ffi):
    """Правка должна доходить до симулятора, а не только до файла."""
    before = running_project(project, ffi).run().result.spike_count()["a/E"]

    project.set_cell("a", "pyr_l5", v_threshold=-58.0)
    after = project.run().result.spike_count()["a/E"]

    assert after > before


def test_cell_parameters_are_checked_before_they_break_the_run(project, ffi):
    project.insert_pattern(ffi, instance_id="a")

    with pytest.raises(PatternError, match="нет параметров"):
        project.set_cell("a", "pyr_l5", colour="red")
    with pytest.raises(PatternError, match="больше нуля"):
        project.set_cell("a", "pyr_l5", tau_m=0.0)
    with pytest.raises(PatternError, match="рефрактерность"):
        project.set_cell("a", "pyr_l5", refractory=-1.0)
    with pytest.raises(PatternError, match="несколько типов"):
        project.set_cell("a")
    with pytest.raises(PatternError, match="нет типа клетки"):
        project.set_cell("a", "нет такого")


def test_stimulus_parameters_are_editable_after_it_is_created(project, ffi):
    """Драйв создаётся с числами по умолчанию, а не с высеченными в камне."""
    running_project(project, ffi)
    quiet = project.run().result.spike_count()["a/IN"]

    project.set_stimulus("drive", rate=20.0)
    assert project.sandbox.stimuli[0].rate == 20.0
    assert project.run().result.spike_count()["a/IN"] < quiet

    with pytest.raises(PatternError, match="род стимула"):
        project.set_stimulus("drive", kind="барабан")
    with pytest.raises(PatternError, match="отрицательной"):
        project.set_stimulus("drive", rate=-1.0)
    with pytest.raises(PatternError, match="раньше"):
        project.set_stimulus("drive", start=300.0, stop=100.0)
    with pytest.raises(PatternError, match="стимула"):
        project.set_stimulus("нет такого", rate=1.0)


def test_recording_changes_what_is_written(project, ffi):
    running_project(project, ffi)
    project.set_recording("r1", "g_exc")

    run = project.run()
    assert "a/E.soma:g_exc" in run.result.traces

    with pytest.raises(PatternError, match="записать"):
        project.set_recording("r1", "температура")


def test_run_parameters_are_editable_and_checked(project, ffi):
    running_project(project, ffi)
    project.set_run(duration=100.0, dt=0.2, seed=42)

    run = project.run()
    assert project.sandbox.run.seed == 42
    assert len(run.result.times) == 500

    with pytest.raises(PatternError, match="шаг"):
        project.set_run(dt=0.0)
    with pytest.raises(PatternError, match="длительность"):
        project.set_run(duration=-5.0)
    with pytest.raises(PatternError, match="отсчётов"):
        project.set_run(duration=1e9, dt=0.01)
    with pytest.raises(PatternError, match="уровень"):
        project.set_run(level="L9")


def test_a_changed_seed_gives_another_realisation(project, ffi):
    """Зерно правится не для красоты: другое зерно -- другой шум стимула."""
    running_project(project, ffi)
    first = project.run().result.spikes["a/IN"]

    project.set_run(seed=99)
    assert project.run().result.spikes["a/IN"] != first


def test_settings_are_undone_one_step_each(project, ffi):
    running_project(project, ffi)
    project.set_run(duration=100.0)
    project.rename("a", "Вход")

    assert project.undo() == "переименован a"
    assert project.sandbox.instance("a").label == "FFI"
    assert project.sandbox.run.duration == 100.0

    assert project.undo() == "параметры прогона"
    assert project.sandbox.run.duration == 200.0
