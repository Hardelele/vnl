from pathlib import Path

import pytest

from vnl.backends.netpyne_export import export, sanitize
from vnl.morphology import Morphology, MorphologyError, Section
from vnl.parser import ParseError, parse
from vnl.resolve import ValidationError, load
from vnl.sim import simulate
from vnl.units import UnitError, parse_quantity

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


# --- единицы --------------------------------------------------------------


def test_units_convert_to_base():
    assert parse_quantity("1.2 ms") == (1.2, "time")
    assert parse_quantity("1s") == (1000.0, "time")
    assert parse_quantity("0.8nS") == (0.8, "conductance")
    assert parse_quantity("0.5") == (0.5, None)


def test_units_reject_unknown_suffix():
    with pytest.raises(UnitError):
        parse_quantity("5 parsec")


# --- морфология и адресация ----------------------------------------------


@pytest.fixture
def pyramid() -> Morphology:
    morph = Morphology("pyr")
    morph.add(Section("soma", "soma", None, 20, 20))
    for index in range(3):
        morph.add(Section(f"dend.apical[{index}]", "dend", "soma", 200, 2))
    morph.add(Section("axon", "axon", "soma", 500, 1))
    return morph


def test_address_resolves_to_section_and_fraction(pyramid):
    assert pyramid.resolve("dend.apical[2]@0.72") == ("dend.apical[2]", 0.72)


def test_address_without_fraction_lands_mid_section(pyramid):
    assert pyramid.resolve("axon") == ("axon", 0.5)


def test_unknown_section_is_rejected(pyramid):
    with pytest.raises(MorphologyError, match="dend.basal"):
        pyramid.resolve("dend.basal[0]")


def test_fraction_out_of_range_is_rejected(pyramid):
    with pytest.raises(MorphologyError, match=r"\[0,1\]"):
        pyramid.resolve("dend.apical[0]@1.5")


def test_attenuation_falls_with_distance(pyramid):
    near = pyramid.attenuation("dend.apical[0]", 0.1)
    far = pyramid.attenuation("dend.apical[0]", 0.9)
    assert pyramid.attenuation("soma", 0.5) == 1.0
    assert 0.0 < far < near < 1.0


def test_point_model_collapses_address_with_a_note():
    point = Morphology.point("relay")
    section, fraction, note = point.resolve_with_note("dend.apical[2]@0.8")
    assert (section, fraction) == ("soma", 0.5)
    assert note and "точечной" in note


# --- парсер ---------------------------------------------------------------


def test_parses_example_into_expected_counts():
    parsed = parse(example("ffi"))
    assert parsed.name == "ffi"
    assert set(parsed.instances) == {"IN", "E", "I"}
    assert len(parsed.contacts) == 3
    assert parsed.run.dt == 0.1
    assert parsed.run.duration == 400.0


def test_parses_nested_dynamics_block():
    parsed = parse(
        """
        cell c : excitatory
        neuron A : c
        neuron B : c
        A.axon -> B.soma { weight = 2nS, depression = { u = 0.3, tau_rec = 200ms } }
        """
    )
    dynamics = parsed.contacts[0].dynamics
    assert (dynamics.u, dynamics.tau_rec) == (0.3, 200.0)
    assert dynamics.enabled


def test_unclosed_brace_is_reported():
    with pytest.raises(ParseError, match="незакрытая"):
        parse("cell c : excitatory { tau_m = 5ms ")


def test_morphology_section_must_be_known_kind():
    with pytest.raises(ParseError, match="soma, dend или axon"):
        parse("morphology m { soma len=10um\n spine len=1um }")


# --- проверка модели ------------------------------------------------------


def test_unknown_neuron_in_contact_is_an_error():
    with pytest.raises(ValidationError, match="Ghost"):
        load("cell c : excitatory\nneuron A : c\nA.soma -> Ghost.soma { weight = 1nS }")


def test_delay_below_timestep_is_an_error():
    source = """
    cell c : excitatory
    neuron A : c
    neuron B : c
    A.soma -> B.soma { weight = 1nS, delay = 0.05ms }
    run { dt = 0.1ms }
    """
    with pytest.raises(ValidationError, match="задержка"):
        load(source)


def test_transmitter_and_receptor_mismatch_is_a_warning_not_an_error():
    source = """
    cell inh : inhibitory, gaba
    cell exc : excitatory, glutamate
    neuron A : inh
    neuron B : exc
    A.soma -> B.soma { receptor = ampa, weight = 1nS }
    record B.soma.v
    """
    model, diagnostics = load(source)
    assert len(model.contacts) == 1
    assert any("возбуждающий" in d.message for d in diagnostics)
    assert all(d.severity == "warning" for d in diagnostics)


def test_stdp_rl_without_modulator_is_an_error_when_ambiguous():
    source = """
    cell c : excitatory
    neuron A : c
    neuron B : c
    A.soma -> B.soma { weight = 1nS, plasticity = stdp_rl { } }
    """
    with pytest.raises(ValidationError, match="modulator"):
        load(source)


# --- симуляция L1 ---------------------------------------------------------


def test_feed_forward_inhibition_reduces_output():
    model, _ = load(example("ffi"))
    with_inhibition = simulate(model)

    open_loop, _ = load(example("ffi"))
    open_loop.contacts = [c for c in open_loop.contacts if c.receptor != "gaba_a"]
    without = simulate(open_loop)

    assert with_inhibition.spike_count()["E"] < without.spike_count()["E"]
    assert with_inhibition.spike_count()["I"] > 0


def test_dendritic_position_is_folded_into_weight_and_reported():
    model, _ = load(example("ffi"))
    result = simulate(model)
    assert any("свёрнуто в вес" in note for note in result.degradation)


def test_depression_shrinks_and_facilitation_grows():
    model, _ = load(example("depression"))
    result = simulate(model)

    def peaks(key: str) -> list[float]:
        trace = result.traces[key]
        return [
            trace[i]
            for i in range(1, len(trace) - 1)
            if trace[i] > trace[i - 1] and trace[i] >= trace[i + 1] and trace[i] > 1e-3
        ]

    depressing, facilitating = peaks("DEP.soma:g"), peaks("FAC.soma:g")
    assert len(depressing) == len(facilitating) == 8
    assert depressing[-1] < depressing[0] / 5
    assert facilitating[-1] > facilitating[0] * 1.5


def test_reinforced_plasticity_waits_for_the_modulator():
    model, _ = load(example("disinhibition"))
    result = simulate(model)
    weight = result.traces["PYR.soma:w"]
    before_reward = weight[int(400 / model.run.dt)]
    assert before_reward == pytest.approx(weight[0])
    assert weight[-1] > weight[0]


def test_simulation_is_reproducible_for_a_fixed_seed():
    model, _ = load(example("ffi"))
    first = simulate(model).spikes
    model, _ = load(example("ffi"))
    second = simulate(model).spikes
    assert first == second


# --- экспорт --------------------------------------------------------------


def test_exported_script_compiles_and_keeps_synapse_position():
    model, _ = load(example("ffi"), source="examples/ffi.vnl")
    report = export(model)
    compile(report.script, "generated.py", "exec")
    assert "'sec': 'dend_apical_1'" in report.script
    assert "'loc': 0.6" in report.script


def test_export_reports_what_it_could_not_carry_over():
    model, _ = load(example("depression"))
    report = export(model)
    assert any("Цодыкса" in loss for loss in report.losses)


def test_sanitize_makes_neuron_safe_names():
    assert sanitize("dend.apical[12]") == "dend_apical_12"


# --- отрисовка ------------------------------------------------------------


def test_report_is_valid_standalone_html():
    from vnl.report import render

    model, _ = load(example("ffi"), source="examples/ffi.vnl")
    page = render(model, simulate(model))
    assert page.startswith("<!doctype html>")
    assert '<meta charset="utf-8">' in page
    assert page.rstrip().endswith("</html>")
    assert "<script" not in page and "http://" not in page


def test_numeric_columns_are_aligned_with_their_headers():
    from vnl.report import render

    model, _ = load(example("ffi"))
    page = render(model, simulate(model))
    assert page.count('<th class="num">') == page.count("<th>") + 1
    assert "th.num, td.num { text-align: right;" in page


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


def test_raster_has_a_time_grid_with_round_labels():
    from vnl.report import raster_svg

    model, _ = load(example("ffi"))
    svg = raster_svg(model, simulate(model))
    assert svg.count('class="grid"') >= 4
    assert '>0</text>' in svg and ">400</text>" in svg


def test_raster_marks_when_each_stimulus_was_running():
    from vnl.report import raster_svg

    model, _ = load(example("disinhibition"))
    svg = raster_svg(model, simulate(model))
    assert svg.count('class="stim-band"') == len(model.stimuli)
    assert "gate: poisson" in svg


def test_modulator_is_drawn_towards_the_contact_it_governs():
    from vnl.report import circuit_svg

    model, _ = load(example("disinhibition"))
    svg = circuit_svg(model)
    assert 'class="edge mod"' in svg
    assert "управляет контактом" in svg
