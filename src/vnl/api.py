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

from . import ir, protocols
from .catalog import STATUS_NAMES, Query, facets, search
from .patterns import LEVEL_NAMES, PORT_NOTES, cell_type_at
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


def _port(port: Any) -> dict[str, Any]:
    """Порт наружу. Один вид на карточку, на блок в песочнице и на догадку.

    Он же принимается обратно при сохранении паттерна (`server.Api._ports`):
    интерфейс возвращает то, что получил, поправив имена, -- и два формата
    одного порта завелись бы ровно на этом шаге.
    """
    return {
        "name": port.name,
        "direction": port.direction,
        "site": _site(port.site),
        "note": port.note,
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
    # Только `kind = adex`. Отдаются всегда: у поля есть значение по умолчанию
    # и у lif-клетки, а условный состав ответа означал бы, что интерфейс не
    # знает заранее, какие ключи придут.
    "deltaT": "delta_t",
    "vPeak": "v_peak",
    "tauW": "tau_w",
    "wCoupling": "w_coupling",
    "wIncrement": "w_increment",
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


def _contact(model: ir.Model, contact: ir.Contact) -> dict[str, Any]:
    """Контакт для интерфейса. Полярность -- по реверсалу, а не по имени (#496).

    `polarity` говорит всё: `exc`, `inh` или `shunt`. `inhibitory` остаётся
    рядом и отвечает на более грубый вопрос -- «не ведёт ли контакт клетку к
    порогу»; шунт в нём true, потому что к порогу он не ведёт, а третьего
    значения у логического поля нет. Убрать его нельзя: по нему интерфейс
    рисует плашку, и молча перевернуть его смысл было бы хуже, чем оставить
    загрубление рядом с точным ответом.

    `reversal` -- число, по которому считают, `reversalOverride` -- написанное
    в схеме или `null`. Панель свойств должна показывать пустое поле, когда
    реверсал взят из реестра, а не подставлять туда его значение: иначе
    человек, ничего не трогая, закрепил бы реестровое число на века.
    """
    dynamics = contact.dynamics
    plasticity = contact.plasticity
    polarity = model.polarity_of(contact)
    return {
        "id": contact.id,
        "pre": _site(contact.pre),
        "post": _site(contact.post),
        "receptor": contact.receptor,
        "polarity": polarity,
        "inhibitory": polarity != ir.POLARITY_EXC,
        "reversal": contact.reversal,
        "reversalOverride": contact.reversal_override,
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


def _shape(stim: Any) -> dict[str, Any]:
    """Числа шаблона протокола и то, во что они разворачиваются.

    `times` -- всегда развёрнутый список, а не то, что записано в поле: шаблон
    обязан уметь напечатать себя списком времён, и печатает он его здесь
    (#508). У `spikes` это тот же список, что набран руками, -- в том и смысл,
    что разницы между написанным и развёрнутым нет.

    Рядом едет `protocol` -- тот же протокол словами. Числа и слова вместе,
    потому что вопросов два: «что это за эксперимент» и «в какие именно
    моменты придут импульсы», и ответ на второй пятьюдесятью числами не
    заменяет ответа на первый.
    """
    return {
        "times": [round(time, TIME_DIGITS) for time in protocols.spike_times(stim)],
        "protocol": protocols.describe(stim),
        "n": stim.n,
        "freq": stim.freq,
        "isi": stim.isi,
        "duration": stim.duration,
        "bursts": stim.bursts,
        "burst_period": stim.burst_period,
        "repeats": stim.repeats,
        "period": stim.period,
        "recovery": stim.recovery,
    }


def _stimulus(stim: ir.Stimulus, duration: float) -> dict[str, Any]:
    return {
        "id": stim.id,
        "target": _site(stim.target),
        "kind": stim.kind,
        "receptor": stim.receptor,
        "amplitude": stim.amplitude,
        "rate": stim.rate,
        "start": stim.start,
        # Бесконечность в JSON не выразить, поэтому обрезаем по прогону:
        # стимул всё равно не действует дольше, чем он длится.
        "stop": min(stim.stop, duration),
        **_shape(stim),
    }


def _sensor(model: ir.Model, sensor: ir.Sensor) -> dict[str, Any]:
    """Сенсор наружу: род, его числа и куда он подключён.

    `story` -- род словами вместе с числами («частота, 100 Гц при 1»), и
    собирает его реестр родов, а не интерфейс: та же причина, по которой
    протокол драйва печатается словами отсюда же (#508). Список подключений
    едет полями связи -- теми же, что у контакта: для человека это одна и та же
    стрелка, и называться в ответе она обязана одинаково.
    """
    return {
        "id": sensor.id,
        "kind": sensor.kind,
        "story": protocols.describe_sensor(sensor),
        "to": sensor.to,
        "targets": [
            {
                "target": _site(link.target),
                "receptor": link.receptor,
                "polarity": model.polarity_at(link.target, link.reversal),
                "inhibitory": (
                    model.polarity_at(link.target, link.reversal)
                    != ir.POLARITY_EXC
                ),
                "reversal": link.reversal,
                "reversalOverride": link.reversal_override,
                "weight": link.weight,
                "delay": link.delay,
            }
            for link in sensor.targets
        ],
    }


def _motor(motor: ir.Motor) -> dict[str, Any]:
    """Мотор наружу: на кого смотрит, каким родом и в чём меряет.

    Единица приходит отсюда, а не подписывается в браузере, по той же причине,
    что единицы записей: число без единицы -- шифр, а расшифровать его может
    только тот, кто знает предмет (#541).
    """
    return {
        "id": motor.id,
        "kind": motor.kind,
        "story": protocols.describe_motor(motor),
        "unit": protocols.motor_unit(motor),
        "window": motor.window,
        "source": _site(motor.source),
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
        "contacts": [_contact(model, contact) for contact in model.contacts],
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
        "sensors": [_sensor(model, sensor) for sensor in model.sensors.values()],
        "motors": [_motor(motor) for motor in model.motors.values()],
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
        # Величины моторов на конец прогона. Не трасса: мотор отдаёт число
        # сейчас, а «сейчас» у досчитанного прогона одно -- его последний
        # момент. Округление общее с трассами: одна и та же величина не должна
        # приходить по-разному.
        "motors": {
            name: round(value, TRACE_DIGITS)
            for name, value in result.motors.items()
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
            # `kind` у ребра двузначен, и трогать его нельзя: по нему
            # холст рисует плашку. Шунт едет в `inh` -- «не возбуждает», --
            # а точная полярность лежит рядом полем `polarity`.
            "kind": (
                "exc"
                if model.polarity_of(contact) == ir.POLARITY_EXC
                else "inh"
            ),
            "polarity": model.polarity_of(contact),
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
        "ports": [_port(port) for port in pattern.ports],
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


# --- каталог типов клеток -------------------------------------------------


def cell_payload(cell: Any) -> dict[str, Any]:
    """Тип клетки для палитры.

    Собран из тех же кусков, что тип клетки внутри модели (`_point_model`,
    `_morphology`): палитра и панель свойств показывают одни и те же поля, и
    второй вид одной мембраны разошёлся бы с первым на первой же правке.

    Тормозность считается здесь, а не в интерфейсе: от неё зависит фигура на
    холсте, и второе место, где «тормозная» значит своё, разойдётся с первым
    незаметно.
    """
    cell_type = cell.type
    return {
        "id": cell.id,
        "name": cell.name,
        "note": cell.note,
        "tags": list(cell_type.tags),
        "transmitter": cell_type.transmitter,
        "inhibitory": ir.is_inhibitory_cell(cell_type),
        "builtin": cell.builtin,
        "source": cell.source,
        "pointModel": _point_model(cell_type.point_model),
        "morphology": _morphology(cell_type.morphology),
    }


def _param(param: Any) -> dict[str, Any]:
    """Поле рода: как его подписать, чем мерить и чем заполнить по умолчанию.

    Один вид на все роды -- драйва, сенсора и мотора: `protocols.Param` у них
    общий, и три способа отдать одно и то же поле означали бы три способа его
    нарисовать.
    """
    return {
        "name": param.name,
        "label": param.label,
        "unit": param.unit,
        "default": param.default,
        "step": param.step,
        "form": param.form,
        "note": param.note,
    }


def glossary_payload() -> dict[str, Any]:
    """Расшифровка подписей песочницы: рецепторы, мембрана, контакт, порты.

    Одним ответом, потому что вопрос один: «что значит то, что написано на
    экране». Три запроса вместо одного заставили бы панель свойств знать, какая
    часть её подписей объясняется откуда, -- а для человека это одно и то же.

    Тексты сюда не пишутся: каждый лежит рядом со своим предметом
    (`ir.RECEPTORS`, `ir.POINT_NOTES`, `ir.CONTACT_NOTES`,
    `patterns.PORT_NOTES`), и здесь они только собираются в ответ. Второе место,
    где написано, что такое `gaba_a`, разошлось бы с первым незаметно: подсказка
    ни на один прогон не влияет и на тестах прогона не всплыла бы.

    Каталога клеток здесь нет намеренно: у клетки объяснение уже есть -- `note`
    в `/api/cells`, -- и повторять его вторым ответом значило бы завести о
    пирамиде две правды.

    Имена полей мембраны -- те же, что в `pointModel` (`POINT_FIELDS`): ключ,
    по которому интерфейс берёт число, и ключ, по которому он берёт подсказку,
    обязаны совпадать, иначе подпись однажды объяснит соседнее поле.
    """
    field_names = {field: name for name, field in POINT_FIELDS.items()}
    return {
        "schema": SCHEMA_VERSION,
        "receptors": [
            {
                "id": name,
                "note": receptor.note,
                "reversal": receptor.reversal,
                "tauDecay": receptor.tau_decay,
                "inhibitory": ir.is_inhibitory_receptor(name),
            }
            for name, receptor in ir.RECEPTORS.items()
        ],
        "cell": {
            field_names[field]: note
            for field, note in ir.POINT_NOTES.items()
            if field in field_names
        },
        "contact": dict(ir.CONTACT_NOTES),
        "port": dict(PORT_NOTES),
        # Роды драйва одним списком с полями каждого (#553). Список именно
        # отсюда, а не из браузера: он же решает, какие числа у протокола
        # осмысленны, и разворачивает их в моменты импульсов. Вторая его копия
        # в интерфейсе -- та же болезнь, что была со списком рецепторов: новый
        # протокол появлялся бы в симуляторе и не появлялся в поле выбора.
        #
        # Поля едут вместе с родом, а не подписями в панели, по той же
        # причине: что у `tbs` есть «пачек» и «между пачками», а у `train` --
        # «тест восстановления», знает реестр, и браузеру остаётся нарисовать
        # то, что пришло.
        "drive": protocols.KIND_NOTE,
        "drives": [
            {
                "id": drive.id,
                "name": drive.name,
                "note": drive.note,
                "receptor": drive.receptor,
                "template": drive.expand is not None,
                "params": [_param(param) for param in drive.params],
            }
            for drive in protocols.DRIVE_KINDS.values()
        ],
        # Что означает `g_exc` -- такая же расшифровка подписи, как «что такое
        # gaba_a», и приходит она отсюда же (#546). Реестр с именами и
        # единицами уже есть в `ir.RECORDED`: по нему подписывают оси графика и
        # колонки CSV, и список записей на карточке обязан звать величину тем
        # же словом. Свой список в браузере разошёлся бы с этим молча --
        # подписи ни на один прогон не влияют.
        "recorded": [
            {"id": name, "name": variable.name, "unit": variable.unit}
            for name, variable in ir.RECORDED.items()
        ],
        # Роды сенсора и мотора -- тем же списком и с теми же полями, что роды
        # драйва. Оттуда же, из реестра: панель кнопок обязана называть род
        # теми же словами, какими его называет прогон, и `trigger` здесь не
        # украшение -- «отвечает на уровень» и «отвечает на изменение» для
        # того, кто жмёт кнопку, разные вещи.
        "sensor": protocols.SENSOR_NOTE,
        "sensors": [
            {
                "id": kind.id,
                "name": kind.name,
                "note": kind.note,
                "trigger": kind.trigger,
                "emits": kind.emits,
                "receptor": kind.receptor,
                "params": [_param(param) for param in kind.params],
            }
            for kind in protocols.SENSOR_KINDS.values()
        ],
        "motor": protocols.MOTOR_NOTE,
        "motors": [
            {
                "id": kind.id,
                "name": kind.name,
                "note": kind.note,
                "unit": kind.unit,
                "params": [_param(param) for param in kind.params],
            }
            for kind in protocols.MOTOR_KINDS.values()
        ],
        # Границы величины, которую принимает сенсор. Числами, а не словами в
        # подсказке: ровно ими ползунок задаст свои края, а кнопка -- свои
        # «нажато» и «отпущено».
        "value": {"min": protocols.VALUE_MIN, "max": protocols.VALUE_MAX},
    }


def cells_payload(cells: Sequence[Any]) -> dict[str, Any]:
    """Каталог типов клеток: встроенные и свои одним списком.

    Одним списком нарочно: для того, кто кладёт клетку на холст, «встроенная»
    -- пометка, а не другой сорт вещи. Порядок задаёт `cells.catalog`.
    """
    return {
        "schema": SCHEMA_VERSION,
        "cells": [cell_payload(cell) for cell in cells],
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


def _block_contacts(block: Any) -> list[dict[str, Any]]:
    """Контакты снимка блока -- теми же полями, что и связь песочницы (#531).

    Состав полей один, потому что вещь одна: связь холста и контакт внутри
    блока различаются только адресом -- у связи он в объектах холста
    (`ffi.out`), здесь в точках снимка (`IN.soma`). Завести для внутреннего
    контакта свой набор полей значило бы объявить, что «вес» и «задержка»
    внутри блока означают что-то другое.

    Приставки экземпляра (`ffi/c1`) тут нет намеренно: правится снимок, а не
    собранная сеть, и адрес обязан совпадать с тем, который примет
    `Project.set_contact`. `dynamics` и `plasticity` не отдаются: их в панели
    не правят, а `scheme` рядом уже сказала, кто с кем связан.
    """
    return [
        {
            "id": contact.id,
            "pre": _site(contact.pre),
            "post": _site(contact.post),
            "receptor": contact.receptor,
            "polarity": block.snapshot.body.polarity_of(contact),
            "inhibitory": (
                block.snapshot.body.polarity_of(contact) != ir.POLARITY_EXC
            ),
            "reversal": contact.reversal,
            "reversalOverride": contact.reversal_override,
            "weight": contact.weight,
            "delay": contact.delay,
        }
        for contact in block.snapshot.body.contacts
    ]


def _link_reversal(link: Any) -> float:
    """Реверсал связи холста, мВ: написанный или реестровый."""
    if link.reversal is None:
        return ir.RECEPTORS[link.receptor].reversal
    return link.reversal


def _link_polarity(sandbox: Any, link: Any) -> str:
    """Что связь холста делает с клеткой, в которую входит (#496).

    Полярность считается по той клетке, а не по одному на всех порогу: у
    корзинчатой он -52 мВ, у пирамиды -50, и шунт на одной может оказаться
    возбуждением на другой. Тип цели бывает и неизвестен (связь показывает на
    несуществующий блок) -- тогда берутся значения мембраны по умолчанию:
    нарисовать связь надо в любом случае, а про сломанный адрес скажет сборка.
    """
    cell_type = cell_type_at(sandbox, link.target)
    point = cell_type.point_model if cell_type else ir.PointModel()
    return ir.synapse_polarity(_link_reversal(link), point)


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
                "ports": [_port(port) for port in block.snapshot.ports],
                "counts": {
                    "neurons": len(block.snapshot.body.instances),
                    "contacts": len(block.snapshot.body.contacts),
                },
                "scheme": scheme_payload(block.snapshot.body),
                "cells": _block_cells(block),
                "contacts": _block_contacts(block),
            }
            for block in sandbox.instances
        ],
        "neurons": [
            {
                "id": neuron.id,
                "cellType": neuron.cell_type,
                "position": list(neuron.position),
                # Тормозная клетка рисуется другой фигурой, и решает это
                # сервер: интерфейс, считающий тормозность сам, разойдётся с
                # `ir.is_inhibitory_cell` незаметно. У клетки с потерянным
                # типом решать не по чему -- тогда она просто не тормозная.
                "inhibitory": (
                    ir.is_inhibitory_cell(sandbox.cell_types[neuron.cell_type])
                    if neuron.cell_type in sandbox.cell_types
                    else False
                ),
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
                "polarity": _link_polarity(sandbox, link),
                "inhibitory": (
                    _link_polarity(sandbox, link) != ir.POLARITY_EXC
                ),
                "reversal": _link_reversal(link),
                "reversalOverride": link.reversal,
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
                "start": stim.start,
                "stop": min(stim.stop, sandbox.run.duration),
                **_shape(stim),
            }
            for stim in sandbox.stimuli
        ],
        # Граница с миром. Приходит вместе с остальным состоянием, а не
        # отдельным запросом, по той же причине, что и всё прочее в этом
        # ответе: панель кнопок -- ещё одно представление того же проекта, и
        # список сенсоров, собранный в браузере по своим правилам, разошёлся бы
        # с тем, что считает сервер.
        #
        # Подключений у сенсора здесь нет: они живут в `links` обычными
        # связями, у которых источник -- сам сенсор. Второй список тех же
        # стрелок означал бы, что связь от сенсора -- не связь.
        "sensors": [
            {
                "id": sensor.id,
                "kind": sensor.kind,
                "story": protocols.describe_sensor(sensor),
                "to": sensor.to,
                "position": list(sensor.position),
            }
            for sensor in sandbox.sensors
        ],
        "motors": [
            {
                "id": motor.id,
                "kind": motor.kind,
                "story": protocols.describe_motor(motor),
                "unit": protocols.motor_unit(motor),
                "window": motor.window,
                "source": _endpoint(motor.source),
                "position": list(motor.position),
            }
            for motor in sandbox.motors
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
        # Что предложить в форме «Сохранить как паттерн»: клетка без входящих
        # связей похожа на вход, без исходящих -- на выход. Догадка приходит
        # вместе с остальным состоянием, а не отдельным запросом: это часть
        # того же ответа, из которого живут все представления проекта. Считает
        # её Python (`patterns.suggest_ports`) -- тот же вопрос задаст Claude
        # через MCP, и вторая реализация разошлась бы с первой незаметно.
        "portHints": [_port(port) for port in project.port_hints()],
        # Факты о проекте, а не подписи из макета (#483).
        "dirty": project.dirty,
        "canUndo": project.can_undo,
        "problems": project.check(),
        # Рядом, но отдельным полем: `problems` -- это отказ, а здесь то, что
        # запускать не мешает, но делает результат пустым (#506). Свести их в
        # один список значило бы либо запретить запуск схемы без драйва (её
        # законно считают, пока собирают), либо разрешить запуск того, что не
        # собирается.
        "warnings": project.warnings(),
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
