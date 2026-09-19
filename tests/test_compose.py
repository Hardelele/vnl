"""Сборка песочницы в исполняемую сеть.

Главное, что здесь проверяется: блок считается по-настоящему. Не одним
условным нейроном, не записью прошлой демонстрации.
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
    SandboxNeuron,
    SandboxRecording,
    SandboxStimulus,
)
from vnl.resolve import load
from vnl.sim import simulate

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


def chain(ffi: Pattern, *, connected: bool = True) -> Sandbox:
    """Два FFI подряд: драйв в первый, запись со второго."""
    sandbox = Sandbox(id="s1", name="Цепочка", run=ir.RunSpec(duration=400.0, seed=7))
    sandbox.add_instance(ffi, instance_id="a")
    sandbox.add_instance(ffi, instance_id="b")

    if connected:
        sandbox.links.append(
            Link(
                "a_to_b",
                Endpoint("a", "out"),
                Endpoint("b", "in"),
                receptor="ampa",
                weight=6.0,
                delay=1.0,
            )
        )

    sandbox.stimuli.append(
        SandboxStimulus(
            id="drive",
            target=Endpoint("a", "in"),
            kind="poisson",
            rate=250.0,
            amplitude=1.5,
            start=20.0,
            stop=380.0,
        )
    )
    sandbox.recordings.append(
        SandboxRecording(id="r1", target=Endpoint("b", "out"), var="v")
    )
    return sandbox


def test_instances_unfold_with_separate_names(ffi):
    built = compose(chain(ffi))
    assert built.ok, built.problems

    assert "a/E" in built.model.instances and "b/E" in built.model.instances
    assert len(built.model.instances) == 2 * len(ffi.body.instances)
    # Внутренние контакты тоже разведены по экземплярам.
    assert {c.id for c in built.model.contacts} >= {"a/c1", "b/c1"}


def test_link_becomes_a_contact_between_inner_points(ffi):
    built = compose(chain(ffi))
    contact = next(c for c in built.model.contacts if c.id == "a_to_b")

    assert contact.pre.instance == "a/E", "выход блока — его внутренний нейрон"
    assert contact.post.instance == "b/IN"
    assert contact.weight == 6.0


def test_map_ties_canvas_objects_to_network_objects(ffi):
    built = compose(chain(ffi))

    assert set(built.map.block_neurons) == {"a", "b"}
    assert built.map.owner["a/E"] == "a"
    assert built.map.link_contacts["a_to_b"] == "a_to_b"
    assert built.map.neurons_of("a") == built.map.block_neurons["a"]


def test_blocks_actually_drive_each_other(ffi):
    """Связь между блоками -- настоящая: без неё второй блок молчит."""
    with_link = simulate(compose(chain(ffi)).model)
    without = simulate(compose(chain(ffi, connected=False)).model)

    assert with_link.spike_count()["b/IN"] > 0
    assert without.spike_count()["b/IN"] == 0
    # И дальше по цепочке: тормозная клетка второго блока тоже заработала.
    assert with_link.spike_count()["b/I"] > without.spike_count()["b/I"]


def test_two_instances_keep_separate_state(ffi):
    result = simulate(compose(chain(ffi)).model)
    # Первый блок ведёт драйв, второй -- только через связь, поэтому
    # одинаковыми их активности быть не могут.
    assert result.spikes["a/IN"] != result.spikes["b/IN"]


def test_demo_stimuli_do_not_leak_into_the_network(ffi):
    """У паттерна есть свой драйв для карточки -- в сети его быть не должно."""
    assert ffi.demo is not None and ffi.demo.stimuli

    built = compose(chain(ffi))
    assert [stim.id for stim in built.model.stimuli] == ["drive"]


def test_recording_through_a_port_lands_on_a_real_point(ffi):
    built = compose(chain(ffi))
    recording = built.model.recordings[0]

    assert recording.target.instance == "b/E"
    key = ir.trace_key(recording.target.instance, recording.target.section, "v")
    assert built.map.recording_keys[key] == "r1"
    assert key in simulate(built.model).traces


def test_broken_port_is_reported_next_to_the_object(ffi):
    sandbox = chain(ffi)
    sandbox.links.append(
        Link("bad", Endpoint("a", "nope"), Endpoint("b", "in"))
    )
    built = compose(sandbox)

    assert not built.ok
    assert any("связь bad" in problem for problem in built.problems)
    # Остальная сеть при этом собралась.
    assert "a/E" in built.model.instances


def test_same_name_different_cell_types_are_kept_apart(ffi):
    other = Pattern.from_model(
        ffi.body, id="slow", name="Медленный", ports=list(ffi.ports)
    )
    other.body.cell_types["pyr_l5"].point_model.tau_m = 40.0

    sandbox = Sandbox(id="s2", name="Смесь")
    sandbox.add_instance(ffi, instance_id="a")
    sandbox.add_instance(other, instance_id="b")
    built = compose(sandbox)

    taus = {
        built.model.cell_types[built.model.instances[name].cell_type].point_model.tau_m
        for name in ("a/E", "b/E")
    }
    assert taus == {15.0, 40.0}, "разные типы под одним именем слиплись"


def test_empty_sandbox_is_a_problem_not_a_crash():
    built = compose(Sandbox(id="s0", name="Пусто"))
    assert not built.ok
    assert any("нечего считать" in problem for problem in built.problems)


def test_a_link_lands_on_a_neuron_inside_a_block(ffi):
    """Связь ведут прямо во внутренний узел, минуя порт.

    Порт -- названный автором ярлык частой точки, а не единственная дверь: от
    feed-forward inhibition берут тормозный нейрон, и порта под это автор не
    объявлял. Для сборки это обычная точка: `ffi/I` -- имя нейрона в собранной
    сети, и отдельного рода адреса здесь нет.
    """
    sandbox = Sandbox(id="s1", name="Мимо порта", run=ir.RunSpec(duration=200.0))
    sandbox.add_instance(ffi, instance_id="ffi")
    sandbox.cell_types["relay"] = ir.CellType(
        id="relay", tags=("excitatory",), transmitter="glutamate"
    )
    sandbox.neurons["X"] = SandboxNeuron(id="X", cell_type="relay")
    sandbox.links.append(
        Link("l1", Endpoint("X"), Endpoint("ffi/I"), receptor="ampa", weight=6.0)
    )

    built = compose(sandbox)

    assert built.ok, built.problems
    contact = next(c for c in built.model.contacts if c.id == "l1")
    assert (contact.pre.instance, contact.post.instance) == ("X", "ffi/I")
    # Контакт такой же, как те, что пришли из начинки блока: никакой пометки
    # «снаружи» у него нет -- иначе внутренность блока стала бы особым родом.
    assert contact.post.section == "soma"
    assert "ffi/I" in built.model.instances


def test_two_instances_keep_their_insides_apart(ffi):
    """Приставка разводит внутренние узлы, и адресуются они тоже по ней."""
    sandbox = Sandbox(id="s1", name="Два блока")
    sandbox.add_instance(ffi, instance_id="ffi")
    sandbox.add_instance(ffi, instance_id="ffi2")
    sandbox.cell_types["relay"] = ir.CellType(
        id="relay", tags=("excitatory",), transmitter="glutamate"
    )
    sandbox.neurons["X"] = SandboxNeuron(id="X", cell_type="relay")
    sandbox.links.append(Link("l1", Endpoint("X"), Endpoint("ffi2/I")))

    built = compose(sandbox)

    assert built.ok, built.problems
    contact = next(c for c in built.model.contacts if c.id == "l1")
    assert contact.post.instance == "ffi2/I"
    assert built.map.owner["ffi/I"] == "ffi"
    assert built.map.owner["ffi2/I"] == "ffi2"


def test_a_link_into_a_missing_inner_node_is_reported(ffi):
    """Опечатка в имени узла -- замечание рядом с объектом, а не молчание."""
    sandbox = Sandbox(id="s1", name="Опечатка")
    sandbox.add_instance(ffi, instance_id="ffi")
    sandbox.cell_types["relay"] = ir.CellType(
        id="relay", tags=("excitatory",), transmitter="glutamate"
    )
    sandbox.neurons["X"] = SandboxNeuron(id="X", cell_type="relay")
    sandbox.links.append(Link("l1", Endpoint("X"), Endpoint("ffi/НЕТ")))

    built = compose(sandbox)

    assert not built.ok
    assert any("ffi/НЕТ" in problem for problem in built.problems)
