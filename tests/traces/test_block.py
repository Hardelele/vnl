"""Сборка блока: состав, общая ось времени, пустой результат."""

from vnl import traces
from vnl.resolve import load
from vnl.sim import SimResult


def test_block_draws_every_recorded_value(block_for):
    model, _, block = block_for("ffi")
    assert block.count("<svg") == len(model.recordings)


def test_shared_time_axis_is_the_same_for_all_plots(block_for):
    model, _, block = block_for("ffi")
    # сетка по X в каждом графике плюс единственная подписанная ось внизу
    assert block.count("tr-timerow") == 1
    assert block.count("мс</span>") == 1
    grids = [part.count("tr-gridx") for part in block.split("<figure")[1:]]
    assert len(set(grids)) == 1 and grids[0] > 1
    assert f">{model.run.duration:g} мс<" in block


def test_no_scripts_or_external_resources(block_for):
    _, _, block = block_for("disinhibition")
    assert "<script" not in block
    assert "http://" not in block and "https://" not in block


def test_empty_result_does_not_break_the_block(example):
    model, _ = load(example("ffi"))
    block = traces.render(model, SimResult(dt=0.1, times=[]))
    assert "записей нет" in block
