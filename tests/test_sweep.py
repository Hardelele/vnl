from pathlib import Path

import pytest

from vnl.resolve import load
from vnl.sweep import SweepError, parse_spec, run_sweep, summarise

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


def test_spec_reads_values_with_and_without_units():
    assert parse_spec("c1.delay=0.5,1,2,4") == ("c1.delay", [0.5, 1.0, 2.0, 4.0])
    assert parse_spec("pyr.tau_m=8ms,15ms") == ("pyr.tau_m", [8.0, 15.0])


def test_single_value_is_not_a_sweep():
    with pytest.raises(SweepError, match="сравнивать нечего"):
        parse_spec("c1.delay=1")


def test_unreadable_spec_says_the_expected_shape():
    with pytest.raises(SweepError, match="c1.delay=0.5,1,2,4"):
        parse_spec("c1.delay 0.5 1 2")


def test_unknown_target_lists_what_there_is():
    model, _ = load(example("ffi"))
    with pytest.raises(SweepError, match="контакты: c1, c2, c3"):
        run_sweep(model, "c99.delay=1,2")


def test_unknown_field_is_rejected_rather_than_silently_set():
    model, _ = load(example("ffi"))
    with pytest.raises(SweepError, match="крутить нельзя"):
        run_sweep(model, "c1.colour=1,2")


def test_sweep_leaves_the_original_model_untouched():
    model, _ = load(example("ffi"))
    before = [contact.delay for contact in model.contacts]
    run_sweep(model, "c1.delay=5,10")
    assert [contact.delay for contact in model.contacts] == before


def test_later_inhibition_widens_the_integration_window():
    """Смысл развёртки: поздний тормоз оставляет пирамиде больше времени."""
    model, _ = load(example("ffi"))
    sweep = run_sweep(model, "c3.delay=0.5,1.4,4,10")
    counts = [row["spikes"]["E"] for row in summarise(sweep, model)]
    assert counts == sorted(counts)
    assert counts[-1] > counts[0]


def test_stronger_inhibition_silences_the_pyramid():
    model, _ = load(example("ffi"))
    sweep = run_sweep(model, "c3.weight=0,0.9,2")
    counts = [row["spikes"]["E"] for row in summarise(sweep, model)]
    assert counts == sorted(counts, reverse=True)
    assert counts[-1] == 0


def test_nested_parameter_is_reachable():
    model, _ = load(example("depression"))
    sweep = run_sweep(model, "c1.dynamics.tau_rec=50,400")
    assert [variant.value for variant in sweep.variants] == [50.0, 400.0]
    # Чем дольше восстановление, тем сильнее садится ответ к концу пачки.
    peaks = []
    for variant in sweep.variants:
        trace = variant.result.traces["DEP.soma:g"]
        peaks.append(max(trace[-len(trace) // 3 :]))
    assert peaks[1] < peaks[0]


def test_value_outside_limits_is_reported_not_swallowed():
    model, _ = load(example("ffi"))
    sweep = run_sweep(model, "c1.delay=0.01,1")
    messages = [d.message for variant in sweep.variants for d in variant.diagnostics]
    assert any("меньше шага" in message for message in messages)


def test_payload_keeps_every_variant():
    from vnl.api import run_payload
    from vnl.sim import simulate

    model, _ = load(example("ffi"))
    sweep = run_sweep(model, "c3.delay=1.4,4")
    payload = run_payload(model, simulate(model), [], sweep)

    assert payload["sweep"]["path"] == "c3.delay"
    assert [v["label"] for v in payload["sweep"]["variants"]] == ["1.4", "4"]
    assert all(v["result"]["traces"] for v in payload["sweep"]["variants"])
    # Базовый прогон на месте: интерфейс без поддержки развёртки не сломается.
    assert payload["result"]["traces"]
