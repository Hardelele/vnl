from pathlib import Path

import pytest

from vnl.resolve import load
from vnl.sim import simulate

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


def test_raster_has_a_time_grid_with_round_labels():
    from vnl.timeline import raster_svg

    model, _ = load(example("ffi"))
    svg = raster_svg(model, simulate(model))
    assert svg.count('class="grid"') >= 4
    assert '>0</text>' in svg and ">400</text>" in svg


def test_raster_marks_when_each_stimulus_was_running():
    from vnl.timeline import raster_svg

    model, _ = load(example("disinhibition"))
    svg = raster_svg(model, simulate(model))
    assert svg.count('class="stim-band"') == len(model.stimuli)
    assert "gate: poisson" in svg
