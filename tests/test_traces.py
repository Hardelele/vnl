from pathlib import Path

import pytest

from vnl.resolve import load
from vnl.sim import simulate

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


def test_traces_block_draws_every_recorded_value():
    from vnl import traces

    model, _ = load(example("ffi"))
    block = traces.render(model, simulate(model))
    assert block.count("<svg") == len(model.recordings)
