"""Хранилище и сценарий приёмки целиком.

Последний тест здесь -- проверка из задания: вставить два паттерна, соединить,
запустить, сохранить выделенное новым паттерном и использовать его в другой
песочнице. После перезагрузки схемы на месте, оригиналы не изменились.
"""

from pathlib import Path

import pytest

from vnl import ir
from vnl.compose import compose
from vnl.patterns import (
    Endpoint,
    Link,
    Pattern,
    Port,
    Sandbox,
    SandboxRecording,
    SandboxStimulus,
    extract_pattern,
)
from vnl.resolve import load
from vnl.sim import simulate
from vnl.store import Store, StoreError, to_plain

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
def store(tmp_path) -> Store:
    return Store(tmp_path)


def test_pattern_survives_a_round_trip(store, ffi):
    store.save_pattern(ffi)
    assert to_plain(store.load_pattern("ffi")) == to_plain(ffi)


def test_morphology_and_ports_come_back_as_objects(store, ffi):
    store.save_pattern(ffi)
    back = store.load_pattern("ffi")

    section = back.body.cell_types["pyr_l5"].morphology.sections["dend.apical[1]"]
    assert section.length == 200.0 and section.kind == "dend"
    assert back.port("out").site == ir.Site("E", "soma", 0.5)
    assert back.demo is not None and back.demo.stimuli[0].kind == "poisson"


def test_endless_stimulus_survives_json(store, ffi):
    """У стимула «до конца прогона» stop = inf, а в JSON бесконечности нет."""
    sandbox = Sandbox(id="s1", name="Песочница")
    sandbox.add_instance(ffi, instance_id="a")
    sandbox.stimuli.append(
        SandboxStimulus(id="drive", target=Endpoint("a", "in"), rate=100.0)
    )
    store.save_sandbox(sandbox)

    assert store.load_sandbox("s1").stimuli[0].stop == float("inf")


def test_library_lists_newest_first(store, ffi):
    store.save_pattern(ffi)
    second = Pattern.from_model(ffi.body, id="other", name="Другой")
    second.updated_at = "2030-01-01T00:00:00+00:00"
    store.save_pattern(second)

    assert [item.id for item in store.patterns()] == ["other", "ffi"]


def test_missing_things_are_named(store):
    with pytest.raises(StoreError, match="нет в библиотеке"):
        store.load_pattern("ghost")
    with pytest.raises(StoreError, match="песочницы"):
        store.load_sandbox("ghost")


def test_identifier_cannot_escape_the_store(store, ffi):
    """Идентификатор приходит снаружи, и путём наружу он быть не должен."""
    ffi.id = "../../evil"
    path = store.save_pattern(ffi)
    assert path.parent == store.root / "patterns"


def test_saving_twice_leaves_no_temporary_files(store, ffi):
    store.save_pattern(ffi)
    store.save_pattern(ffi)
    assert list((store.root / "patterns").glob("*.tmp")) == []


# --- сценарий приёмки -----------------------------------------------------


def test_the_whole_scenario(store, ffi):
    store.save_pattern(ffi)

    # Вставить два паттерна и соединить их.
    work = Sandbox(id="work", name="Рабочая", run=ir.RunSpec(duration=400.0, seed=7))
    work.add_instance(store.load_pattern("ffi"), instance_id="a")
    work.add_instance(store.load_pattern("ffi"), instance_id="b")
    work.links.append(
        Link("a_to_b", Endpoint("a", "out"), Endpoint("b", "in"), weight=6.0)
    )
    work.stimuli.append(
        SandboxStimulus(
            id="drive",
            target=Endpoint("a", "in"),
            rate=250.0,
            amplitude=1.5,
            start=20.0,
            stop=380.0,
        )
    )
    work.recordings.append(
        SandboxRecording(id="r1", target=Endpoint("b", "out"), var="v")
    )

    # Запустить общую схему и увидеть результат.
    built = compose(work)
    assert built.ok, built.problems
    result = simulate(built.model)
    assert result.spike_count()["b/IN"] > 0, "второй блок не получил сигнала"

    # Сохранить выделенное новым паттерном.
    chain, _ = extract_pattern(work, ["a", "b"], "Цепочка FFI", level="L3")
    store.save_pattern(chain)
    store.save_sandbox(work)

    # Использовать его в другой песочнице.
    other = Sandbox(id="other", name="Другая", run=ir.RunSpec(duration=200.0))
    other.add_instance(store.load_pattern(chain.id), instance_id="chain")
    store.save_sandbox(other)

    # Перезагрузка: всё на месте.
    fresh = Store(store.root)
    assert {item.id for item in fresh.patterns()} == {"ffi", chain.id}
    assert {item.id for item in fresh.sandboxes()} == {"work", "other"}

    reopened = fresh.load_sandbox("work")
    assert [block.id for block in reopened.instances] == ["a", "b"]
    assert compose(reopened).ok

    # Оригинал не изменился: в нём по-прежнему три нейрона, а не шесть.
    assert len(fresh.load_pattern("ffi").body.instances) == 3
    assert len(fresh.load_pattern(chain.id).body.instances) == 6

    # Вторая песочница считается сама по себе.
    second = compose(fresh.load_sandbox("other"))
    assert second.ok, second.problems
    assert len(second.model.instances) == 6
