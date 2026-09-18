"""Паттерны и песочницы: что должно быть правдой независимо от интерфейса."""

from pathlib import Path

import pytest

from vnl import ir
from vnl.patterns import (
    Endpoint,
    Link,
    Pattern,
    PatternError,
    Port,
    Sandbox,
    extract_pattern,
)
from vnl.resolve import load

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


@pytest.fixture
def ffi_pattern() -> Pattern:
    """Feed-forward inhibition как паттерн: вход снаружи, выход с пирамиды."""
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


def test_port_points_at_a_real_place_inside(ffi_pattern):
    assert ffi_pattern.validate() == []
    assert ffi_pattern.port("out").site.instance == "E"
    with pytest.raises(PatternError, match="нет порта"):
        ffi_pattern.port("nope")


def test_stimuli_left_in_the_body_are_a_problem(ffi_pattern):
    ffi_pattern.body.stimuli.append(
        ir.Stimulus(id="drive", target=ir.Site("IN", "soma", 0.5))
    )
    assert any("витрина" in problem for problem in ffi_pattern.validate())


def test_port_into_nothing_is_caught(ffi_pattern):
    ffi_pattern.ports.append(Port("ghost", "in", ir.Site("Ghost", "soma", 0.5)))
    problems = ffi_pattern.validate()
    assert any("Ghost" in problem for problem in problems)


def test_instance_keeps_the_definition_it_was_inserted_with(ffi_pattern):
    """Правка библиотеки не должна незаметно менять собранный проект."""
    sandbox = Sandbox(id="s1", name="Песочница")
    block = sandbox.add_instance(ffi_pattern)

    ffi_pattern.name = "FFI переделанный"
    ffi_pattern.body.contacts.clear()
    ffi_pattern.ports.clear()

    assert block.snapshot.name == "FFI"
    assert block.snapshot.body.contacts, "снимок опустел вслед за оригиналом"
    assert block.site_of("out").instance == "E"


def test_two_instances_are_independent(ffi_pattern):
    sandbox = Sandbox(id="s1", name="Песочница")
    first = sandbox.add_instance(ffi_pattern)
    second = sandbox.add_instance(ffi_pattern)

    assert first.id != second.id
    second.snapshot.body.contacts[0].weight = 99.0
    assert first.snapshot.body.contacts[0].weight != 99.0


def test_fork_does_not_touch_the_original(ffi_pattern):
    sandbox = Sandbox(id="s1", name="Песочница")
    block = sandbox.add_instance(ffi_pattern)

    forked = sandbox.fork(block, name="FFI помедленнее")
    forked.body.contacts[0].delay = 12.0

    assert forked.id != ffi_pattern.id
    assert forked.status == "draft"
    assert ffi_pattern.body.contacts[0].delay != 12.0
    assert block.snapshot.body.contacts[0].delay != 12.0


# --- выделение -> паттерн -------------------------------------------------


def two_block_sandbox(pattern: Pattern) -> Sandbox:
    """Два блока, связанных между собой, плюс сосед снаружи."""
    sandbox = Sandbox(id="s1", name="Песочница")
    sandbox.add_instance(pattern, instance_id="ffi")
    sandbox.add_instance(pattern, instance_id="ffi2")

    relay = ir.CellType(id="relay", tags=("excitatory",), transmitter="glutamate")
    sandbox.cell_types["relay"] = relay
    sandbox.neurons["OUT"] = ir.Instance(id="OUT", cell_type="relay")

    sandbox.links += [
        Link("l1", Endpoint("ffi", "out"), Endpoint("ffi2", "in"), weight=2.0),
        Link("l2", Endpoint("ffi2", "out"), Endpoint("OUT"), weight=1.5),
    ]
    return sandbox


def test_selection_takes_inner_links_and_leaves_the_rest(ffi_pattern):
    sandbox = two_block_sandbox(ffi_pattern)
    pattern, notes = extract_pattern(sandbox, ["ffi", "ffi2"], "Цепочка", level="L3")

    # Связь между выбранными блоками уехала внутрь.
    assert any(contact.id == "l1" for contact in pattern.body.contacts)
    # Связь наружу -- нет, но её точка стала портом.
    assert not any(contact.id == "l2" for contact in pattern.body.contacts)
    assert any(port.direction == "out" for port in pattern.ports)
    assert any("l2" in note for note in notes)
    # Посторонний сосед внутрь не утащен.
    assert "OUT" not in pattern.body.instances


def test_selection_does_not_change_the_sandbox(ffi_pattern):
    sandbox = two_block_sandbox(ffi_pattern)
    before = (len(sandbox.instances), len(sandbox.links), len(sandbox.neurons))

    extract_pattern(sandbox, ["ffi", "ffi2"], "Цепочка")

    assert (len(sandbox.instances), len(sandbox.links), len(sandbox.neurons)) == before


def test_extracted_pattern_is_a_draft_and_keeps_inner_names_apart(ffi_pattern):
    sandbox = two_block_sandbox(ffi_pattern)
    pattern, _ = extract_pattern(sandbox, ["ffi", "ffi2"], "Цепочка")

    assert pattern.status == "draft"
    assert pattern.level_name == "Микросхемы"
    # Внутренности двух экземпляров разведены по именам, иначе они бы слиплись.
    assert "ffi/E" in pattern.body.instances
    assert "ffi2/E" in pattern.body.instances
    assert len(pattern.body.instances) == 2 * len(ffi_pattern.body.instances)


def test_empty_or_unknown_selection_is_refused(ffi_pattern):
    sandbox = two_block_sandbox(ffi_pattern)
    with pytest.raises(PatternError, match="пусто"):
        extract_pattern(sandbox, [], "Ничего")
    with pytest.raises(PatternError, match="нет таких объектов"):
        extract_pattern(sandbox, ["ffi", "ghost"], "Цепочка")


def test_demo_run_is_not_part_of_the_construction(ffi_pattern):
    """Стимулы витрины не должны переезжать с паттерном в чужую сеть."""
    assert ffi_pattern.demo is not None
    assert ffi_pattern.demo.stimuli, "пример запуска из .vnl сохранён"

    sandbox = Sandbox(id="s1", name="Песочница")
    block = sandbox.add_instance(ffi_pattern)

    assert block.snapshot.demo is not None, "витрина карточки сохраняется"
    assert not block.snapshot.body.stimuli, "но в конструкции её нет"
    assert not sandbox.stimuli, "и в песочницу она не переехала"
