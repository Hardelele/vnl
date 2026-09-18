from pathlib import Path

import pytest

from vnl.resolve import load
from vnl.sim import simulate

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


# --- отрисовка ------------------------------------------------------------


def test_report_is_valid_standalone_html():
    from vnl.report import render

    model, _ = load(example("ffi"), source="examples/ffi.vnl")
    page = render(model, simulate(model))
    assert page.startswith("<!doctype html>")
    assert '<meta charset="utf-8">' in page
    assert page.rstrip().endswith("</html>")
    assert "<script" not in page and "http://" not in page


def test_circuit_draws_every_cell_and_contact():
    from vnl.report import circuit_svg

    model, _ = load(example("ffi"))
    svg = circuit_svg(model)
    assert svg.count('class="edge') == len(model.contacts)
    assert svg.count('class="cell-name"') == len(model.instances)
    # тормозный контакт помечен иначе, чем возбуждающий
    assert 'class="edge inh"' in svg and 'class="edge exc"' in svg


def test_dendritic_contact_gets_a_marker_on_the_branch():
    from vnl.report import circuit_svg

    model, _ = load(example("ffi"))
    svg = circuit_svg(model)
    assert 'class="bouton' in svg
    assert "dend.apical[1]@0.6" in svg


def test_modulator_is_drawn_towards_the_contact_it_governs():
    from vnl.report import circuit_svg

    model, _ = load(example("disinhibition"))
    svg = circuit_svg(model)
    assert 'class="edge mod"' in svg
    assert "управляет контактом" in svg
