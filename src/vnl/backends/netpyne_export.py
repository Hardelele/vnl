"""Экспорт IR в скрипт NetPyNE (уровень L2, солвер -- NEURON).

Генерируется самодостаточный .py: его запускают там, где установлен NEURON.
Всё, что не переносится один в один, попадает в `ExportReport.losses` --
контракт «экспорт + список потерь», а не молчаливое усечение модели.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .. import ir, protocols

_SAFE = re.compile(r"[^0-9A-Za-z_]+")


def sanitize(name: str) -> str:
    """'dend.apical[1]' -> 'dend_apical_1' (имя секции для NEURON)."""
    return _SAFE.sub("_", name).strip("_")


@dataclass
class ExportReport:
    script: str
    losses: list[str] = field(default_factory=list)


def _cell_params(model: ir.Model) -> tuple[dict, list[str]]:
    losses: list[str] = []
    out: dict = {}
    for cell_type in model.cell_types.values():
        secs: dict = {}
        for section in cell_type.morphology.sections.values():
            entry = {
                "geom": {
                    "L": section.length,
                    "diam": section.diam,
                    "Ra": 150.0,
                    "cm": 1.0,
                },
                "mechs": {"pas": {"g": 0.0001, "e": cell_type.point_model.v_rest}},
            }
            if section.parent is not None:
                entry["topol"] = {
                    "parentSec": sanitize(section.parent),
                    "parentX": 1.0,
                    "childX": 0.0,
                }
            if section.kind == "soma":
                entry["mechs"]["hh"] = {
                    "gnabar": 0.12,
                    "gkbar": 0.036,
                    "gl": 0.0003,
                    "el": -54.3,
                }
            secs[sanitize(section.id)] = entry
        out[f"{cell_type.id}_rule"] = {
            "conds": {"cellType": cell_type.id},
            "secs": secs,
        }
        if cell_type.is_point:
            losses.append(
                f"тип {cell_type.id}: точечная модель развёрнута в односекционную "
                f"клетку с каналами Ходжкина--Хаксли; параметры LIF "
                f"(tau_m, порог, адаптация) на L2 не переносятся"
            )
        point = cell_type.point_model
        if point.kind == "adex":
            # Контракт файла -- «скрипт плюс список потерь». Развернуть AdEx в
            # клетку с каналами Ходжкина--Хаксли и промолчать нельзя: разгон у
            # порога и ток адаптации на L2 задаются совсем другими механизмами,
            # и подобранные под L1 значения там не значат того же.
            losses.append(
                f"тип {cell_type.id}: адаптивный экспоненциальный LIF на L2 не "
                f"переносится (delta_t = {point.delta_t:g} мВ, v_peak = "
                f"{point.v_peak:g} мВ, a = {point.w_coupling:g} нСм, b = "
                f"{point.w_increment * 1e3:g} пА, tau_w = {point.tau_w:g} мс); "
                f"своя динамика клетки -- пачки, плато, отдача после торможения "
                f"-- в этом скрипте отсутствует и требует своего механизма"
            )
        if point.adaptation and point.kind != "adex":
            losses.append(
                f"тип {cell_type.id}: адаптация порога {point.adaptation} мВ "
                f"не имеет прямого аналога и требует своего механизма"
            )
    return out, losses


def _mech_name(receptor: str, reversal: float) -> str:
    """Имя механизма для пары (рецептор, реверсал).

    Механизм в NetPyNE -- это `Exp2Syn` с числами, и реверсал одно из них.
    Один механизм на имя рецептора схлопнул бы два `gaba_a`-контакта с
    реверсалами -70 и -65 мВ в один, и экспортированный скрипт считал бы
    другую сеть -- молча, потому что синтаксически он остался бы верным.

    Имя при реестровом реверсале остаётся прежним (`gaba_a`), а не становится
    `gaba_a_e_70` для всех подряд: девяносто девять моделей из ста реверсал не
    трогают, и переименовывать у них все механизмы значило бы менять вид
    экспорта у тех, кого правка не касается. Минус в имени NEURON не живёт,
    поэтому знак пишется буквой `m`.
    """
    if reversal == ir.RECEPTORS[receptor].reversal:
        return receptor
    sign = "m" if reversal < 0 else ""
    return sanitize(f"{receptor}_e{sign}{abs(reversal):g}")


def _syn_mech_params(model: ir.Model) -> tuple[dict, list[str]]:
    used = {(contact.receptor, contact.reversal) for contact in model.contacts}
    used |= {
        (stim.receptor, stim.reversal)
        for stim in model.stimuli
        if stim.kind != "current"
    }
    out: dict = {}
    losses: list[str] = []
    for receptor, reversal in sorted(used):
        kind = ir.RECEPTORS[receptor]
        out[_mech_name(receptor, reversal)] = {
            "mod": "Exp2Syn",
            "tau1": max(0.1, kind.tau_decay / 10.0),
            "tau2": kind.tau_decay,
            "e": reversal,
        }
        if kind.voltage_dependent:
            # `Exp2Syn` линеен: проводимость в нём не зависит от потенциала.
            # Значит экспортированный NMDA -- это медленная AMPA, то есть
            # ровно та ловушка, из-за которой задача #498 и делалась, только
            # теперь на L2. Выбросить рецептор из скрипта нельзя (сеть станет
            # другой сильнее), подменить механизм нечем -- своего mod-файла у
            # нас нет, -- поэтому единственный честный ход: сказать вслух, что
            # скрипт считает другую сеть, и назвать, чего именно в нём не будет.
            losses.append(
                f"рецептор {receptor}: зависимость проводимости от потенциала "
                f"(блок магнием, [Mg] = {kind.mg:g} мМ) переносится как "
                f"линейный Exp2Syn -- в NEURON этот механизм её не знает. В "
                f"скрипте не будет ни порога по числу совпавших входов, ни "
                f"плато после снятия входа: NMDA там работает как медленная "
                f"AMPA. Для настоящего поведения нужен свой mod-механизм с "
                f"множителем Джара--Стивенса"
            )
    return out, losses


def _conn_params(model: ir.Model) -> tuple[dict, list[str]]:
    losses: list[str] = []
    out: dict = {}
    for contact in model.contacts:
        entry = {
            "preConds": {"pop": contact.pre.instance},
            "postConds": {"pop": contact.post.instance},
            "synMech": _mech_name(contact.receptor, contact.reversal),
            "weight": contact.weight * 0.001,  # нСм -> мкСм, единицы NEURON
            "delay": contact.delay,
            "sec": sanitize(contact.post.section),
            "loc": contact.post.fraction,
        }
        plast = contact.plasticity
        if plast.rule == "stdp":
            entry["plast"] = {
                "mech": "STDP",
                "params": {
                    "hebbwt": plast.a_plus,
                    "antiwt": -plast.a_minus,
                    "wmax": plast.w_max,
                    "tauhebb": plast.tau_plus,
                    "RLon": 0,
                },
            }
        elif plast.rule == "stdp_rl":
            entry["plast"] = {
                "mech": "STDP",
                "params": {
                    "hebbwt": plast.a_plus,
                    "antiwt": -plast.a_minus,
                    "wmax": plast.w_max,
                    "tauhebb": plast.tau_plus,
                    "RLon": 1,
                    "RLlenhebb": plast.tau_eligibility,
                },
            }
            losses.append(
                f"контакт {contact.id}: подкрепление переносится как RLon=1, но "
                f"сигнал модулятора {plast.modulator!r} надо подавать из кода "
                f"прогона -- в netParams его выразить нечем"
            )

        if contact.dynamics.enabled:
            losses.append(
                f"контакт {contact.id}: короткотечная динамика "
                f"(u={contact.dynamics.u}, tau_rec={contact.dynamics.tau_rec}, "
                f"tau_facil={contact.dynamics.tau_facil}) требует механизма "
                f"Цодыкса--Маркрама; Exp2Syn её не воспроизводит"
            )
        if model.polarity_of(contact) == ir.POLARITY_SHUNT:
            # Сам механизм переносится честно: `Exp2Syn` с `e` на уровне покоя
            # -- это и есть шунт, NEURON считает его как надо. Потеря в другом:
            # шунт настроен на покой точечной модели (`v_rest`), а на L2 покой
            # задают каналы Ходжкина--Хаксли, и реверсал, совпадавший с покоем
            # на L1, там окажется чуть выше или ниже него. Деление превратится
            # в деление с примесью, и разница будет тем больше, чем сильнее
            # контакт. Молчать нельзя: скрипт посчитается и ответит похоже, а
            # не так же.
            point = model.cell_type_of(contact.post.instance).point_model
            losses.append(
                f"контакт {contact.id}: шунт настроен на покой точечной модели "
                f"({point.v_rest:g} мВ, реверсал {contact.reversal:g} мВ); на "
                f"L2 покой задают каналы клетки, и деление входа окажется не "
                f"тем же -- сверьте реверсал с настоящим покоем экспортированной "
                f"клетки"
            )
        if contact.pre.section != "soma":
            losses.append(
                f"контакт {contact.id}: пресинаптическая точка "
                f"{contact.pre.section}@{contact.pre.fraction:g} свёрнута в спайк "
                f"сомы -- NetPyNE соединяет клетки, а не точки аксона"
            )
        out[contact.id] = entry
    return out, losses


def _stim_params(model: ir.Model) -> tuple[dict, dict, list[str]]:
    losses: list[str] = []
    sources: dict = {}
    targets: dict = {}
    for stim in model.stimuli:
        if stim.kind == "current":
            sources[stim.id] = {
                "type": "IClamp",
                "del": stim.start,
                "dur": (
                    stim.stop - stim.start
                    if stim.stop != float("inf")
                    else model.run.duration - stim.start
                ),
                "amp": stim.amplitude,
            }
            targets[f"{stim.id}_to"] = {
                "source": stim.id,
                "conds": {"pop": stim.target.instance},
                "sec": sanitize(stim.target.section),
                "loc": stim.target.fraction,
            }
            continue

        if stim.kind == "poisson":
            sources[stim.id] = {
                "type": "NetStim",
                "rate": stim.rate,
                "noise": 1.0,
                "start": stim.start,
            }
        else:  # список моментов: написанный руками или развёрнутый из шаблона
            # Шаблон протокола экспортируется тем же `VecStim`, что и явный
            # `spikes`: в NetPyNE «поезда» нет, а есть список времён, и это
            # ровно тот список, который считает наш солвер. Разворачивать его
            # здесь во второй раз значило бы завести вторую арифметику
            # протокола -- и разойтись с прогоном на округлении (#508).
            sources[stim.id] = {
                "type": "VecStim",
                "spkTimes": list(protocols.spike_times(stim)),
            }
        targets[f"{stim.id}_to"] = {
            "source": stim.id,
            "conds": {"pop": stim.target.instance},
            "sec": sanitize(stim.target.section),
            "loc": stim.target.fraction,
            "synMech": _mech_name(stim.receptor, stim.reversal),
            "weight": stim.amplitude * 0.001,
            "delay": 1.0,
        }
        if stim.kind == "poisson" and stim.stop != float("inf"):
            losses.append(
                f"стимул {stim.id}: NetStim не имеет момента остановки; "
                f"stop={stim.stop} мс задайте числом импульсов в скрипте прогона"
            )
    return sources, targets, losses


def _border_losses(model: ir.Model) -> list[str]:
    """Граница с миром на L2 не переносится -- и молчать об этом нельзя.

    Причина не в том, что в NetPyNE нечем: поданную запись значений можно было
    бы развернуть в `VecStim`, как разворачивается шаблон протокола. Дело в
    том, что разворачивать нечего -- у сенсора нет заранее известных моментов,
    в том и разница между ним и драйвом. Скрипт считается там, где никто
    кнопку не нажмёт, и честный ответ здесь -- «эта дверь осталась закрытой», а
    не молча выброшенный вход.

    Мотор не переносится по другой причине: он не механизм, а способ прочитать
    растр. Растр NetPyNE пишет сам, и посчитать по нему то же окно -- работа
    скрипта прогона, а не `netParams`.
    """
    out: list[str] = []
    for sensor in model.sensors.values():
        targets = ", ".join(str(link.target) for link in sensor.targets) or "никуда"
        out.append(
            f"сенсор {sensor.id}: живой вход ({protocols.describe_sensor(sensor)}) "
            f"на L2 не переносится -- заранее известных моментов у него нет; "
            f"клетки {targets} останутся без него. Подайте запись значений "
            f"списком времён через VecStim, если опыт надо повторить в NEURON"
        )
    for motor in model.motors.values():
        out.append(
            f"мотор {motor.id}: {protocols.describe_motor(motor)} по "
            f"{motor.source} -- это чтение растра, а не механизм; в netParams "
            f"его выразить нечем, считайте то же окно в скрипте прогона"
        )
    return out


def export(model: ir.Model) -> ExportReport:
    cell_params, losses_cells = _cell_params(model)
    conn_params, losses_conns = _conn_params(model)
    stim_sources, stim_targets, losses_stims = _stim_params(model)
    syn_mechs, losses_mechs = _syn_mech_params(model)

    pop_params = {
        instance.id: {
            "cellType": instance.cell_type,
            "numCells": 1,
            "cellsList": [{}],
        }
        for instance in model.instances.values()
    }

    record_cells = sorted({rec.target.instance for rec in model.recordings})
    record_traces = {}
    for recording in model.recordings:
        if recording.var == "v":
            key = f"V_{recording.target.instance}_{sanitize(recording.target.section)}"
            record_traces[key] = {
                "sec": sanitize(recording.target.section),
                "loc": recording.target.fraction,
                "var": "v",
            }

    body = f'''"""Сгенерировано VNL из {model.source or model.name}. Править сам файл не нужно."""

from netpyne import specs, sim

netParams = specs.NetParams()

netParams.cellParams = {cell_params!r}
netParams.popParams = {pop_params!r}
netParams.synMechParams = {syn_mechs!r}
netParams.connParams = {conn_params!r}
netParams.stimSourceParams = {stim_sources!r}
netParams.stimTargetParams = {stim_targets!r}

simConfig = specs.SimConfig()
simConfig.duration = {model.run.duration!r}
simConfig.dt = {model.run.dt!r}
simConfig.seeds = {{"conn": {model.run.seed!r}, "stim": {model.run.seed!r}, "loc": {model.run.seed!r}}}
simConfig.recordCells = {record_cells!r}
simConfig.recordTraces = {record_traces!r}
simConfig.recordStep = {model.run.dt!r}
simConfig.filename = {model.name!r}
simConfig.saveJson = True
simConfig.analysis["plotRaster"] = {{"saveFig": True}}

if __name__ == "__main__":
    sim.createSimulateAnalyze(netParams=netParams, simConfig=simConfig)
'''

    return ExportReport(
        script=body,
        losses=(
            losses_cells
            + losses_mechs
            + losses_conns
            + losses_stims
            + _border_losses(model)
        ),
    )
