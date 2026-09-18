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
