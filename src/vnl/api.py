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
from typing import Any, Sequence

from . import ir
from .catalog import STATUS_NAMES, Query, facets, search
from .patterns import LEVEL_NAMES
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


# Параметры мембраны: имя в JSON -> поле `ir.PointModel`. Таблица одна на обе
# стороны -- ею и отдаётся наружу, и разбирается правка, поэтому «порог» не
# может называться в ответе одним словом, а в запросе другим.
POINT_FIELDS: dict[str, str] = {
    "kind": "kind",
    "vRest": "v_rest",
    "vReset": "v_reset",
    "vThreshold": "v_threshold",
    "tauM": "tau_m",
    "rIn": "r_in",
    "refractory": "refractory",
    "adaptation": "adaptation",
    "tauAdaptation": "tau_adaptation",
}


def _point_model(point: ir.PointModel) -> dict[str, Any]:
    return {name: getattr(point, field) for name, field in POINT_FIELDS.items()}


def _cell_type(cell_type: ir.CellType) -> dict[str, Any]:
    return {
        "id": cell_type.id,
        "tags": list(cell_type.tags),
        "transmitter": cell_type.transmitter,
        "inhibitory": ir.is_inhibitory_cell(cell_type),
        "pointModel": _point_model(cell_type.point_model),
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
    return ir.trace_key(
        recording.target.instance, recording.target.section, recording.var
    )


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
                "inhibitory": ir.is_inhibitory_cell(
                    model.cell_type_of(instance.id)
                ),
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


def _diagnostics(items: list[Any] | None) -> list[dict[str, Any]]:
    return [
        {"severity": d.severity, "where": d.where, "message": d.message}
        for d in (items or [])
    ]


def sweep_payload(sweep: Any, model: ir.Model) -> dict[str, Any]:
    """Развёртка параметра: каждый вариант -- отдельный прогон.

    Базовый прогон остаётся в `result`, поэтому интерфейс, который про
    развёртку не знает, продолжает работать как прежде.
    """
    from .sweep import summarise

    rates = {row["label"]: row for row in summarise(sweep, model)}
    return {
        "spec": sweep.spec,
        "path": sweep.path,
        "variants": [
            {
                "label": variant.label,
                "value": variant.value,
                "result": result_payload(variant.result),
                "spikes": rates[variant.label]["spikes"],
                "rates": rates[variant.label]["rates"],
                "diagnostics": _diagnostics(variant.diagnostics),
            }
            for variant in sweep.variants
        ],
    }


def run_payload(
    model: ir.Model,
    result: SimResult,
    diagnostics: list[Any] | None = None,
    sweep: Any | None = None,
) -> dict[str, Any]:
    """Всё, что нужно интерфейсу для одного прогона."""
    payload: dict[str, Any] = {
        "schema": SCHEMA_VERSION,
        "model": model_payload(model),
        "result": result_payload(result),
        "diagnostics": _diagnostics(diagnostics),
    }
    if sweep is not None:
        payload["sweep"] = sweep_payload(sweep, model)
    return payload


# --- библиотека паттернов -------------------------------------------------


def scheme_payload(model: ir.Model) -> dict[str, Any]:
    """Схема паттерна для миниатюры: кто есть и кто с кем связан.

    Миниатюра в каталоге рисуется из схемы, а не лежит картинкой рядом,
    поэтому здесь ровно то, что нужно для маленького рисунка: тормозность
    клетки, направление связи и её род. Раскладку считает интерфейс.

    Нейромодулятор -- такая же линия, как контакт, хотя механизм другой: он
    ведёт от источника к клетке, на контакт которой действует. Без него
    микросхема, вся суть которой в модуляции, выглядела бы в каталоге как
    обычная цепочка.
    """
    edges: list[dict[str, Any]] = [
        {
            "id": contact.id,
            "from": contact.pre.instance,
            "to": contact.post.instance,
            "kind": "inh" if ir.is_inhibitory_receptor(contact.receptor) else "exc",
        }
        for contact in model.contacts
    ]
    for modulator in model.modulators.values():
        governed = [
            contact
            for contact in model.contacts
            if contact.plasticity.modulator == modulator.id
        ]
        for source in modulator.sources:
            for contact in governed:
                edges.append(
                    {
                        "id": f"mod:{modulator.id}:{source}:{contact.id}",
                        "from": source,
                        "to": contact.post.instance,
                        "kind": "mod",
                    }
                )
    return {
        "neurons": [
            {
                "id": instance.id,
                "inhibitory": ir.is_inhibitory_cell(model.cell_type_of(instance.id)),
            }
            for instance in model.instances.values()
        ],
        "edges": edges,
    }


def _demo_payload(demo: Any) -> dict[str, Any]:
    duration = demo.run.duration
    return {
        "stimuli": [_stimulus(stim, duration) for stim in demo.stimuli],
        "recordings": [
            {
                "id": recording.id,
                "target": _site(recording.target),
                "var": recording.var,
                "key": trace_key(recording),
            }
            for recording in demo.recordings
        ],
        "run": {
            "dt": demo.run.dt,
            "duration": duration,
            "level": demo.run.level,
            "seed": demo.run.seed,
        },
    }


def pattern_payload(pattern: Any, body: bool = False) -> dict[str, Any]:
    """Паттерн для каталога; с `body=True` -- ещё и вся начинка для карточки.

    Каталогу тело не нужно: библиотека на сотню микросхем прислала бы
    мегабайты ради списка имён. Карточка (#478) просит `body` отдельно.

    `problems` -- это `Pattern.validate()`, а не «проверено на сервере»:
    черновик обязан открываться и показывать, чего ему не хватает, иначе
    незавершённое нельзя ни сохранить, ни продолжить.
    """
    payload: dict[str, Any] = {
        "id": pattern.id,
        "name": pattern.name,
        "level": pattern.level,
        "levelName": pattern.level_name,
        "status": pattern.status,
        "statusName": STATUS_NAMES.get(pattern.status, pattern.status),
        "ports": [
            {
                "name": port.name,
                "direction": port.direction,
                "site": _site(port.site),
                "note": port.note,
            }
            for port in pattern.ports
        ],
        "counts": {
            "neurons": len(pattern.body.instances),
            "contacts": len(pattern.body.contacts),
            "ports": len(pattern.ports),
        },
        "scheme": scheme_payload(pattern.body),
        "demo": _demo_payload(pattern.demo) if pattern.demo else None,
        "problems": pattern.validate(),
        "createdAt": pattern.created_at,
        "updatedAt": pattern.updated_at,
    }
    if body:
        payload["body"] = model_payload(pattern.body)
    return payload


def catalog_payload(library: Sequence[Any], query: Query | None = None) -> dict[str, Any]:
    """Библиотека после отбора -- вместе с тем, из чего отбирали.

    Отбор и счётчики чипов считаются здесь одним вызовом: разойдись они -- и
    фильтр показывал бы «L2 (7)», отдавая четыре паттерна, а искать причину
    такого пришлось бы в двух местах сразу.
    """
    query = query or Query()
    return catalog_payload_of(search(library, query), facets(library), len(library), query)


def catalog_payload_of(
    chosen: Sequence[Any],
    counts: dict[str, dict[str, int]],
    total: int,
    query: Query,
) -> dict[str, Any]:
    """То же самое, но отбор и счётчики уже посчитаны -- например индексом.

    Отдельной функцией, потому что источник отбора бывает разный (обход файлов
    или запрос к базе), а формат ответа обязан быть один: интерфейс не должен
    догадываться, чем именно ему ответили.
    """
    return {
        "schema": SCHEMA_VERSION,
        "query": {
            "text": query.text,
            "levels": list(query.levels),
            "statuses": list(query.statuses),
        },
        "total": total,
        "matched": len(chosen),
        "levels": [
            {"id": level, "name": name, "count": counts["level"].get(level, 0)}
            for level, name in LEVEL_NAMES.items()
        ],
        "statuses": [
            {"id": status, "name": name, "count": counts["status"].get(status, 0)}
            for status, name in STATUS_NAMES.items()
        ],
        "patterns": [pattern_payload(pattern) for pattern in chosen],
    }


# --- песочница ------------------------------------------------------------


def _endpoint(endpoint: Any) -> dict[str, Any]:
    return {
        "instance": endpoint.instance,
        "port": endpoint.port,
        "section": endpoint.section,
        "fraction": endpoint.fraction,
    }


def _block_cells(block: Any) -> list[dict[str, Any]]:
    """Клетки блока, сгруппированные по типу.

    Параметры мембраны в IR живут на типе клетки, а не на нейроне, поэтому и
    в панели свойств правится тип: порог у трёх нейронов одного типа один. У
    каждого блока снимок свой, так что два экземпляра одного паттерна
    расходятся свободно -- а вот два нейрона внутри одного блока нет.
    Перечисляем, кого правка задевает, чтобы это не было сюрпризом.
    """
    body = block.snapshot.body
    users: dict[str, list[str]] = {}
    for neuron in body.instances.values():
        users.setdefault(neuron.cell_type, []).append(neuron.id)
    return [
        {
            "type": type_id,
            "neurons": users[type_id],
            "inhibitory": ir.is_inhibitory_cell(cell_type),
            "pointModel": _point_model(cell_type.point_model),
        }
        for type_id, cell_type in body.cell_types.items()
        # Тип без нейронов править незачем: на сеть он не влияет.
        if type_id in users
    ]


def sandbox_payload(project: Any) -> dict[str, Any]:
    """Всё состояние песочницы одним куском.

    Три представления макета -- холст, дерево объектов и свойства -- это один
    и тот же ответ, разложенный по-разному. Отдавать им разные срезы значило бы
    завести три правды о проекте: изменение видно сразу везде только тогда,
    когда источник один.
    """
    sandbox = project.sandbox
    return {
        "schema": SCHEMA_VERSION,
        "id": sandbox.id,
        "name": sandbox.name,
        "blocks": [
            {
                "id": block.id,
                "patternId": block.pattern_id,
                "label": block.label,
                "position": list(block.position),
                "ports": [
                    {
                        "name": port.name,
                        "direction": port.direction,
                        "site": _site(port.site),
                        "note": port.note,
                    }
                    for port in block.snapshot.ports
                ],
                "counts": {
                    "neurons": len(block.snapshot.body.instances),
                    "contacts": len(block.snapshot.body.contacts),
                },
                "scheme": scheme_payload(block.snapshot.body),
                "cells": _block_cells(block),
            }
            for block in sandbox.instances
        ],
        "neurons": [
            {
                "id": neuron.id,
                "cellType": neuron.cell_type,
                # Тип может быть и неизвестным: это чинят, а не скрывают, --
                # нейрон обязан остаться в дереве объектов.
                "pointModel": (
                    _point_model(sandbox.cell_types[neuron.cell_type].point_model)
                    if neuron.cell_type in sandbox.cell_types
                    else None
                ),
            }
            for neuron in sandbox.neurons.values()
        ],
        "links": [
            {
                "id": link.id,
                "source": _endpoint(link.source),
                "target": _endpoint(link.target),
                "receptor": link.receptor,
                "inhibitory": ir.is_inhibitory_receptor(link.receptor),
                "weight": link.weight,
                "delay": link.delay,
            }
            for link in sandbox.links
        ],
        "stimuli": [
            {
                "id": stim.id,
                "target": _endpoint(stim.target),
                "kind": stim.kind,
                "receptor": stim.receptor,
                "rate": stim.rate,
                "amplitude": stim.amplitude,
                "times": list(stim.times),
                "start": stim.start,
                "stop": min(stim.stop, sandbox.run.duration),
            }
            for stim in sandbox.stimuli
        ],
        "recordings": [
            {"id": rec.id, "target": _endpoint(rec.target), "var": rec.var}
            for rec in sandbox.recordings
        ],
        "run": {
            "dt": sandbox.run.dt,
            "duration": sandbox.run.duration,
            "level": sandbox.run.level,
            "seed": sandbox.run.seed,
        },
        # Факты о проекте, а не подписи из макета (#483).
        "dirty": project.dirty,
        "canUndo": project.can_undo,
        "problems": project.check(),
        # Отпечаток собираемой сети. По нему интерфейс узнаёт, что открытая
        # сессия считает уже не эту схему: сессия привязана к модели на момент
        # запуска, а правка веса или порога делает её результат результатом
        # другой сети (#481). Сдвиг блока по холсту отпечаток не меняет.
        "fingerprint": project.fingerprint(),
        "updatedAt": sandbox.updated_at,
    }


def dumps(payload: dict[str, Any], pretty: bool = False) -> str:
    """JSON без экранирования кириллицы: файл читают и глазами."""
    return json.dumps(
        payload,
        ensure_ascii=False,
        indent=2 if pretty else None,
        separators=None if pretty else (",", ":"),
    )
