from pathlib import Path

import pytest

from vnl.resolve import load
from vnl.sim import simulate

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


def test_builtin_layout_routes_every_contact():
    from vnl.layout import layout

    model, _ = load(example("disinhibition"))
    placement = layout(model, "builtin")
    assert placement.engine == "builtin"
    assert set(model.instances) == set(placement.cells)
    for contact in model.contacts:
        assert contact.id in placement.routes


def test_layout_falls_back_when_elk_is_missing(monkeypatch):
    from vnl.layout import layout

    monkeypatch.setenv("VNL_ELK_SCRIPT", str(EXAMPLES / "no-such-script.js"))
    placement = layout(load(example("ffi"))[0], "auto")
    assert placement.engine == "builtin"
    assert any("elkjs" in note for note in placement.notes)


@pytest.mark.skipif(
    not __import__("vnl.layout", fromlist=["x"]).elk_available(),
    reason="нужен Node с elkjs",
)
def test_elk_brings_the_edge_to_the_declared_point_on_the_dendrite():
    from vnl.layout import layout

    model, _ = load(example("ffi"))
    placement = layout(model, "elk")
    assert placement.engine == "elk"

    contact = next(c for c in model.contacts if c.post.section != "soma")
    expected = placement.cells[contact.post.instance].point_on(
        contact.post.section, contact.post.fraction
    )
    landed = placement.routes[contact.id].end
    assert landed == pytest.approx(expected, abs=1.0)


@pytest.mark.skipif(
    not __import__("vnl.layout", fromlist=["x"]).elk_available(),
    reason="нужен Node с elkjs",
)
def test_elk_keeps_parallel_edges_apart():
    """Два контакта из одного аксона не должны идти по одной линии."""
    from vnl.layout import layout

    model, _ = load(example("ffi"))
    placement = layout(model, "elk")
    first, second = placement.routes["c1"].points, placement.routes["c2"].points
    assert first[0] == pytest.approx(second[0], abs=1.0)  # общий выход аксона
    midpoint_gap = abs(first[len(first) // 2][1] - second[len(second) // 2][1])
    assert midpoint_gap > 10.0
