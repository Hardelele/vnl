"""Прогон в JSON для интерфейса.

Единственный контракт между Python и фронтендом. Формат намеренно плоский и
описательный: интерфейс не должен знать про внутренние классы IR и не должен
пересчитывать то, что уже посчитано здесь (знак рецептора, тормозность клетки,
ключ трассы).

Чего здесь сознательно нет:
- массива времён: он восстанавливается как t = i * dt и занимал бы столько же,
  сколько сама трасса;
- полной точности значений: трассы округляются, потому что различия ниже
  сотой доли милливольта на экране не существуют, а размер файла кратен им.
"""

from __future__ import annotations

import json
from typing import Any

from . import ir
from .sim import SimResult

# Версия формата. Фронтенд проверяет её и отказывается читать чужое.
SCHEMA_VERSION = 1

# Знаков после запятой в трассах: мВ и нСм читаются с запасом, а файл вдвое
# меньше, чем при полной точности float.
TRACE_DIGITS = 3
TIME_DIGITS = 2


def _site(site: ir.Site) -> dict[str, Any]:
    return {
        "instance": site.instance,
        "section": site.section,
        "fraction": site.fraction,
    }


def _morphology(morph) -> dict[str, Any]:
    return {
        "name": morph.name,
        "isPoint": morph.is_point,
        "sections": [
            {
                "id": section.id,
                "kind": section.kind,
                "parent": section.parent,
                "length": section.length,
                "diam": section.diam,
                "lambda": section.lambda_dc,
            }
            for section in morph.sections.values()
        ],
    }


def _cell_type(cell_type: ir.CellType) -> dict[str, Any]:
    point = cell_type.point_model
    return {
        "id": cell_type.id,
        "tags": list(cell_type.tags),
        "transmitter": cell_type.transmitter,
        "inhibitory": "inhibitory" in cell_type.tags
        or cell_type.transmitter == "gaba",
        "pointModel": {
            "kind": point.kind,
            "vRest": point.v_rest,
            "vReset": point.v_reset,
            "vThreshold": point.v_threshold,
            "tauM": point.tau_m,
            "rIn": point.r_in,
            "refractory": point.refractory,
            "adaptation": point.adaptation,
            "tauAdaptation": point.tau_adaptation,
        },
        "morphology": _morphology(cell_type.morphology),
    }


def _contact(contact: ir.Contact) -> dict[str, Any]:
    dynamics = contact.dynamics
    plasticity = contact.plasticity
    return {
        "id": contact.id,
        "pre": _site(contact.pre),
        "post": _site(contact.post),
        "receptor": contact.receptor,
        "inhibitory": ir.is_inhibitory_receptor(contact.receptor),
        "reversal": contact.reversal,
        "tauDecay": contact.tau_decay,
        "weight": contact.weight,
        "delay": contact.delay,
        "dynamics": {
            "enabled": dynamics.enabled,
            "u": dynamics.u,
            "tauRec": dynamics.tau_rec,
            "tauFacil": dynamics.tau_facil,
        },
        "plasticity": {
            "enabled": plasticity.enabled,
            "rule": plasticity.rule,
            "aPlus": plasticity.a_plus,
            "aMinus": plasticity.a_minus,
            "tauPlus": plasticity.tau_plus,
            "tauMinus": plasticity.tau_minus,
            "wMax": plasticity.w_max,
            "wMin": plasticity.w_min,
            "tauEligibility": plasticity.tau_eligibility,
            "modulator": plasticity.modulator,
        },
    }


def _stimulus(stim: ir.Stimulus, duration: float) -> dict[str, Any]:
    return {
        "id": stim.id,
        "target": _site(stim.target),
        "kind": stim.kind,
        "receptor": stim.receptor,
        "amplitude": stim.amplitude,
        "rate": stim.rate,
        "times": list(stim.times),
        "start": stim.start,
        # Бесконечность в JSON не выразить, поэтому обрезаем по прогону:
        # стимул всё равно не действует дольше, чем он длится.
        "stop": min(stim.stop, duration),
    }


def trace_key(recording: ir.Recording) -> str:
    return f"{recording.target.instance}.{recording.target.section}:{recording.var}"


def model_payload(model: ir.Model) -> dict[str, Any]:
    return {
        "name": model.name,
        "source": model.source,
        "run": {
            "dt": model.run.dt,
            "duration": model.run.duration,
            "level": model.run.level,
            "seed": model.run.seed,
        },
        "cellTypes": {
            name: _cell_type(cell_type)
            for name, cell_type in model.cell_types.items()
        },
        "neurons": [
            {
                "id": instance.id,
                "cellType": instance.cell_type,
                "tags": list(instance.tags),
                "inhibitory": "inhibitory"
                in model.cell_type_of(instance.id).tags
                or model.cell_type_of(instance.id).transmitter == "gaba",
            }
            for instance in model.instances.values()
        ],
        "contacts": [_contact(contact) for contact in model.contacts],
        "modulators": [
            {
                "id": modulator.id,
                "transmitter": modulator.transmitter,
                "sources": list(modulator.sources),
                "gain": modulator.gain,
                "tau": modulator.tau,
            }
            for modulator in model.modulators.values()
        ],
        "stimuli": [
            _stimulus(stim, model.run.duration) for stim in model.stimuli
        ],
        "recordings": [
            {
                "id": recording.id,
                "target": _site(recording.target),
                "var": recording.var,
                "key": trace_key(recording),
            }
            for recording in model.recordings
        ],
    }


def result_payload(result: SimResult) -> dict[str, Any]:
    return {
        "dt": result.dt,
        "samples": len(result.times),
        "traces": {
            key: [round(value, TRACE_DIGITS) for value in values]
            for key, values in result.traces.items()
        },
        "spikes": {
            name: [round(time, TIME_DIGITS) for time in times]
            for name, times in result.spikes.items()
        },
        "degradation": list(result.degradation),
    }


def run_payload(
    model: ir.Model,
    result: SimResult,
    diagnostics: list[Any] | None = None,
) -> dict[str, Any]:
    """Всё, что нужно интерфейсу для одного прогона."""
    return {
        "schema": SCHEMA_VERSION,
        "model": model_payload(model),
        "result": result_payload(result),
        "diagnostics": [
            {"severity": d.severity, "where": d.where, "message": d.message}
            for d in (diagnostics or [])
        ],
    }


def dumps(payload: dict[str, Any], pretty: bool = False) -> str:
    """JSON без экранирования кириллицы: файл читают и глазами."""
    return json.dumps(
        payload,
        ensure_ascii=False,
        indent=2 if pretty else None,
        separators=None if pretty else (",", ":"),
    )
