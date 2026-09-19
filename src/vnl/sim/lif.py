"""Уровень L1: точечные нейроны, проводимостные синапсы, чистый Python.

Нужен не как «упрощённая замена NEURON», а как интерактивное превью: запускать
NEURON на каждое движение мыши в редакторе нельзя. Всё, что теряется при
переходе L2 -> L1 (прежде всего положение синапса на дендрите), сворачивается
по явным правилам и попадает в отчёт деградации, а не исчезает молча.

Движок шаговый. Симуляция в интерфейсе -- это среда с управляемым временем, а
не расчёт с отчётом в конце: время идёт, его останавливают, отматывают назад и
продолжают с выбранного момента. Поэтому здесь есть `step_once`/`advance`,
снимок состояния и восстановление из него, а `run()` -- всего лишь «считать до
конца», как раньше.

Что входит в снимок, определяется одним вопросом: что нужно, чтобы продолжение
после восстановления совпало с непрерывным прогоном. Это потенциалы и
рефрактерность, проводимости, ресурсы Цодыкса--Маркрама, следы STDP,
обучаемые веса, уровни нейромодуляторов, очередь задержанных передач -- и
состояние генератора случайных чисел. Без последнего пуассоновский стимул
после отката пойдёт другим, и «то же самое место» окажется другим местом.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from .. import ir

# Скорость пассивного распространения по дендриту, мкм/мс.
DENDRITIC_SPEED = 200.0


@dataclass
class SimResult:
    dt: float
    times: list[float]
    traces: dict[str, list[float]] = field(default_factory=dict)
    spikes: dict[str, list[float]] = field(default_factory=dict)
    degradation: list[str] = field(default_factory=list)

    def spike_count(self) -> dict[str, int]:
        return {name: len(times) for name, times in self.spikes.items()}

    def truncate(self, samples: int) -> None:
        """Отрезать всё, что записано после `samples` отсчётов.

        Откат во времени стирает прежнее будущее: держать его в трассах
        значило бы показывать на графике то, чего в этой симуляции уже нет.
        """
        del self.times[samples:]
        for values in self.traces.values():
            del values[samples:]
        for name, times in self.spikes.items():
            self.spikes[name] = [
                time for time in times if round(time / self.dt) < samples
            ]


@dataclass
class _Cell:
    id: str
    model: ir.PointModel
    v: float
    threshold_offset: float = 0.0
    refractory_left: float = 0.0
    conductance: dict[str, float] = field(default_factory=dict)
    current: float = 0.0
    spiked: bool = False
    post_trace: float = 0.0

    @property
    def charge(self) -> float:
        """Насколько клетка заряжена: доля пути от покоя до порога.

        Покой -- 0, порог -- 1, разряд происходит на 1. Считается по параметрам
        этой клетки: у корзинчатой порог -52 мВ, у пирамиды -50, и общая на всех
        шкала врала бы про то, насколько каждая близка к разряду.

        Снизу не обрезается. Торможение уводит мембрану ниже покоя, и
        отрицательная доля -- это ровно то, что должно быть видно: пришло
        возбуждение, а сразу за ним торможение. Ноль вместо неё означал бы, что
        тормозной вход ничего не сделал.

        Сверху тоже не обрезается: адаптация поднимает настоящий порог клетки на
        `adaptation` мВ за каждый свой спайк, и после разряда пирамида добирает
        до 110% номинала. Это не ошибка счёта, а видимая работа адаптации;
        считать долю от подвинутого порога значило бы прятать её.
        """
        # В кадре разряда потенциал уже сброшен к `v_reset`, и доля по нему
        # оказалась бы нулём -- спайк выглядел бы как пустая клетка.
        if self.spiked:
            return 1.0
        span = self.model.v_threshold - self.model.v_rest
        # Порог не выше покоя: доли пути нет, клетка разряжается сама.
        if span <= 0.0:
            return 0.0
        return (self.v - self.model.v_rest) / span


@dataclass
class _Synapse:
    contact: ir.Contact
    target: str
    source: str | None          # None -- внешний стимул
    weight: float               # эффективный вес после деградации
    delay: float                # эффективная задержка после деградации
    x: float = 1.0              # ресурс Цодыкса--Маркрама
    u: float = 0.0
    last_spike: float | None = None
    pre_trace: float = 0.0
    eligibility: float = 0.0


@dataclass(frozen=True)
class Snapshot:
    """Состояние симулятора на конкретном шаге.

    Непрозрачен снаружи: снимать и восстанавливать его умеет только сам
    симулятор. Хранится по значению, поэтому снимок не «уедет» вслед за
    продолжающейся симуляцией.
    """

    step: int
    time: float
    #: Имя клетки -> её состояние.
    cells: dict[str, tuple]
    #: Состояния синапсов в порядке `Simulator.all_synapses`.
    synapses: tuple[tuple, ...]
    #: Шаг доставки -> список (номер синапса, амплитуда).
    pending: dict[int, tuple[tuple[int, float], ...]]
    modulator_level: dict[str, float]
    #: Состояние генератора: без него повтор разойдётся с исходным прогоном.
    rng: tuple
    #: Сколько отсчётов записано к этому моменту.
    samples: int


def _degrade(model: ir.Model, contact: ir.Contact) -> tuple[float, float, str | None]:
    """L2 -> L1: положение синапса сворачивается в вес и задержку."""
    morph = model.morphology_of(contact.post.instance)
    section = morph.sections[contact.post.section]
    if section.kind == "soma":
        return contact.weight, contact.delay, None
    attenuation = morph.attenuation(contact.post.section, contact.post.fraction)
    distance = morph.path_to_soma(contact.post.section, contact.post.fraction)
    extra_delay = distance / DENDRITIC_SPEED
    note = (
        f"контакт {contact.id}: положение {contact.post.section}"
        f"@{contact.post.fraction:g} ({distance:.0f} мкм от сомы) свёрнуто в "
        f"вес x{attenuation:.3f} и задержку +{extra_delay:.2f} мс"
    )
    return contact.weight * attenuation, contact.delay + extra_delay, note


def _decay(value: float, dt: float, tau: float) -> float:
    if tau <= 0.0:
        return 0.0
    return value * math.exp(-dt / tau)


class Simulator:
    def __init__(self, model: ir.Model) -> None:
        self.model = model
        self.dt = model.run.dt
        self.rng = random.Random(model.run.seed)
        self.time = 0.0
        self.degradation: list[str] = []

        self.cells: dict[str, _Cell] = {}
        for instance in model.instances.values():
            point = model.cell_types[instance.cell_type].point_model
            self.cells[instance.id] = _Cell(
                id=instance.id, model=point, v=point.v_rest
            )

        self.synapses: list[_Synapse] = []
        for contact in model.contacts:
            weight, delay, note = _degrade(model, contact)
            if note:
                self.degradation.append(note)
            self.synapses.append(
                _Synapse(
                    contact=contact,
                    target=contact.post.instance,
                    source=contact.pre.instance,
                    weight=weight,
                    delay=delay,
                )
            )

        # Синапсы, которые стимул создаёт на целевой клетке.
        self.stim_synapses: dict[str, _Synapse] = {}
        for stim in model.stimuli:
            if stim.kind == "current":
                continue
            fake = ir.Contact(
                id=f"stim:{stim.id}",
                pre=stim.target,
                post=stim.target,
                receptor=stim.receptor,
                weight=stim.amplitude,
                delay=max(self.dt, 0.1),
            )
            self.stim_synapses[stim.id] = _Synapse(
                contact=fake,
                target=stim.target.instance,
                source=None,
                weight=stim.amplitude,
                delay=max(self.dt, 0.1),
            )

        self.pending: dict[int, list[tuple[_Synapse, float]]] = {}
        self.modulator_level: dict[str, float] = {m: 0.0 for m in model.modulators}

        # Общий порядок синапсов. Очередь задержанных передач ссылается на
        # объекты, а снимок хранится по значению -- значит в нём нужен номер,
        # по которому синапс находится обратно.
        self.all_synapses: list[_Synapse] = [
            *self.synapses,
            *self.stim_synapses.values(),
        ]
        self._synapse_index = {
            id(synapse): number for number, synapse in enumerate(self.all_synapses)
        }

        self.step = 0
        self.total_steps = int(round(model.run.duration / self.dt))

        self.result = SimResult(dt=self.dt, times=[])
        for instance_id in self.cells:
            self.result.spikes[instance_id] = []
        for recording in model.recordings:
            self.result.traces[self._trace_key(recording)] = []
        self.result.degradation = self.degradation

    @staticmethod
    def _trace_key(recording: ir.Recording) -> str:
        return ir.trace_key(
            recording.target.instance, recording.target.section, recording.var
        )

    # --- шаг -----------------------------------------------------------

    def _schedule(self, synapse: _Synapse, amplitude: float) -> None:
        step = int(round((self.time + synapse.delay) / self.dt))
        self.pending.setdefault(step, []).append((synapse, amplitude))

    def _release(self, synapse: _Synapse) -> float:
        """Амплитуда выброса с учётом кратковременной динамики."""
        dyn = synapse.contact.dynamics
        if not dyn.enabled:
            return synapse.weight
        gap = (
            float("inf")
            if synapse.last_spike is None
            else self.time - synapse.last_spike
        )
        if dyn.tau_facil > 0.0:
            decayed = 0.0 if gap == float("inf") else _decay(synapse.u, gap, dyn.tau_facil)
            synapse.u = decayed + dyn.u * (1.0 - decayed)
        else:
            synapse.u = dyn.u
        if dyn.tau_rec > 0.0:
            synapse.x = (
                1.0
                if gap == float("inf")
                else 1.0 - (1.0 - synapse.x) * math.exp(-gap / dyn.tau_rec)
            )
        else:
            synapse.x = 1.0
        amplitude = synapse.weight * synapse.u * synapse.x
        synapse.x -= synapse.u * synapse.x
        synapse.last_spike = self.time
        return amplitude

    def _stimulate(self) -> None:
        for stim in self.model.stimuli:
            if not stim.start <= self.time < stim.stop:
                continue
            if stim.kind == "current":
                self.cells[stim.target.instance].current += stim.amplitude
            elif stim.kind == "poisson":
                if self.rng.random() < stim.rate * self.dt / 1000.0:
                    self._schedule(self.stim_synapses[stim.id], stim.amplitude)
            elif stim.kind == "spikes":
                for spike_time in stim.times:
                    if 0.0 <= spike_time - self.time < self.dt:
                        self._schedule(self.stim_synapses[stim.id], stim.amplitude)

    def _deliver(self, step: int) -> None:
        for synapse, _ in self.pending.pop(step, []):
            amplitude = self._release(synapse)
            cell = self.cells[synapse.target]
            receptor = synapse.contact.receptor
            cell.conductance[receptor] = (
                cell.conductance.get(receptor, 0.0) + amplitude
            )
            if synapse.contact.plasticity.enabled:
                synapse.pre_trace += 1.0
                self._on_pre(synapse, cell)

    def _integrate(self) -> None:
        dt = self.dt
        for cell in self.cells.values():
            cell.spiked = False
            for receptor, value in list(cell.conductance.items()):
                tau = ir.RECEPTORS[receptor][1]
                cell.conductance[receptor] = _decay(value, dt, tau)
            if cell.refractory_left > 0.0:
                cell.refractory_left -= dt
                cell.v = cell.model.v_reset
                cell.current = 0.0
                continue
            point = cell.model
            synaptic = sum(
                value * (ir.RECEPTORS[receptor][0] - cell.v)
                for receptor, value in cell.conductance.items()
            )
            # МОм * нА = мВ: сопротивление и ток уже в тех единицах, в
            # которых считается мембрана, и переводить нечего. Лишний
            # множитель 1e-3 здесь означал бы, что ток на самом деле в
            # пикоамперах, а реобаза клетки -- сотни наноампер.
            drive = (point.v_rest - cell.v) + point.r_in * cell.current
            cell.v += dt / point.tau_m * (drive + synaptic)
            cell.current = 0.0
            cell.threshold_offset = _decay(
                cell.threshold_offset, dt, point.tau_adaptation
            )
            if cell.v >= point.v_threshold + cell.threshold_offset:
                cell.v = point.v_reset
                cell.refractory_left = point.refractory
                cell.threshold_offset += point.adaptation
                cell.spiked = True
                self.result.spikes[cell.id].append(self.time)

    def _propagate(self) -> None:
        for synapse in self.synapses:
            if synapse.source is None:
                continue
            if self.cells[synapse.source].spiked:
                self._schedule(synapse, synapse.weight)

    # --- пластичность и нейромодуляция ---------------------------------

    def _on_pre(self, synapse: _Synapse, cell: _Cell) -> None:
        """Пришёл пресинаптический спайк: pre-after-post -> депрессия."""
        plast = synapse.contact.plasticity
        change = -plast.a_minus * cell.post_trace
        self._apply_change(synapse, change)

    def _on_post(self, cell: _Cell) -> None:
        """Клетка дала спайк: pre-before-post -> потенциация."""
        for synapse in self.synapses:
            if synapse.target != cell.id:
                continue
            plast = synapse.contact.plasticity
            if not plast.enabled:
                continue
            self._apply_change(synapse, plast.a_plus * synapse.pre_trace)

    def _apply_change(self, synapse: _Synapse, change: float) -> None:
        plast = synapse.contact.plasticity
        if plast.rule == "stdp":
            synapse.weight = min(
                plast.w_max, max(plast.w_min, synapse.weight + change)
            )
        elif plast.rule == "stdp_rl":
            synapse.eligibility += change

    def _plasticity_step(self) -> None:
        dt = self.dt
        for cell in self.cells.values():
            cell.post_trace = _decay(cell.post_trace, dt, 20.0)
            if cell.spiked:
                cell.post_trace += 1.0
                self._on_post(cell)

        for name, modulator in self.model.modulators.items():
            level = _decay(self.modulator_level[name], dt, modulator.tau)
            for source in modulator.sources:
                if self.cells[source].spiked:
                    level += modulator.gain
            self.modulator_level[name] = level

        for synapse in self.synapses:
            plast = synapse.contact.plasticity
            if not plast.enabled:
                continue
            synapse.pre_trace = _decay(synapse.pre_trace, dt, plast.tau_plus)
            if plast.rule != "stdp_rl":
                continue
            synapse.eligibility = _decay(
                synapse.eligibility, dt, plast.tau_eligibility
            )
            level = self.modulator_level.get(plast.modulator or "", 0.0)
            if level:
                synapse.weight = min(
                    plast.w_max,
                    max(plast.w_min, synapse.weight + level * synapse.eligibility * dt),
                )

    # --- запись --------------------------------------------------------

    def _record(self) -> None:
        for recording in self.model.recordings:
            key = self._trace_key(recording)
            cell = self.cells[recording.target.instance]
            if recording.var == "v":
                value = cell.v
            elif recording.var == "g":
                value = sum(cell.conductance.values())
            elif recording.var in ("g_exc", "g_inh"):
                # Возбуждение и торможение врозь: их баланс и есть то, что
                # решает судьбу клетки, а в сумме он теряется.
                inhibitory = recording.var == "g_inh"
                value = sum(
                    conductance
                    for receptor, conductance in cell.conductance.items()
                    if ir.is_inhibitory_receptor(receptor) is inhibitory
                )
            elif recording.var == "spikes":
                value = 1.0 if cell.spiked else 0.0
            else:  # w -- суммарный вес пластичных входов клетки
                value = sum(
                    synapse.weight
                    for synapse in self.synapses
                    if synapse.target == cell.id
                    and synapse.contact.plasticity.enabled
                )
            self.result.traces[key].append(value)

    # --- ход времени ----------------------------------------------------

    def step_once(self) -> bool:
        """Один шаг `dt`. `False` -- прогон дошёл до конца длительности."""
        if self.step >= self.total_steps:
            return False
        self.time = self.step * self.dt
        self._stimulate()
        self._deliver(self.step)
        self._integrate()
        self._propagate()
        self._plasticity_step()
        self.result.times.append(self.time)
        self._record()
        self.step += 1
        return True

    def advance(self, steps: int) -> int:
        """Сколько шагов удалось сделать -- меньше запрошенного у конца прогона."""
        done = 0
        for _ in range(steps):
            if not self.step_once():
                break
            done += 1
        return done

    @property
    def finished(self) -> bool:
        return self.step >= self.total_steps

    def run(self) -> SimResult:
        """Считать до конца. Прежний способ: он же шаги, только все сразу."""
        while self.step_once():
            pass
        return self.result

    # --- снимок и откат ---------------------------------------------------

    def snapshot(self) -> Snapshot:
        index = self._synapse_index
        return Snapshot(
            step=self.step,
            time=self.time,
            cells={
                name: (
                    cell.v,
                    cell.threshold_offset,
                    cell.refractory_left,
                    dict(cell.conductance),
                    cell.current,
                    cell.spiked,
                    cell.post_trace,
                )
                for name, cell in self.cells.items()
            },
            synapses=tuple(
                (
                    synapse.weight,
                    synapse.x,
                    synapse.u,
                    synapse.last_spike,
                    synapse.pre_trace,
                    synapse.eligibility,
                )
                for synapse in self.all_synapses
            ),
            pending={
                step: tuple(
                    (index[id(synapse)], amplitude) for synapse, amplitude in items
                )
                for step, items in self.pending.items()
                if items
            },
            modulator_level=dict(self.modulator_level),
            rng=self.rng.getstate(),
            samples=len(self.result.times),
        )

    def restore(self, state: Snapshot) -> None:
        """Вернуть симулятор в снятое состояние вместе с записанным к тому часу."""
        self.step = state.step
        self.time = state.time
        for name, values in state.cells.items():
            cell = self.cells[name]
            (
                cell.v,
                cell.threshold_offset,
                cell.refractory_left,
                conductance,
                cell.current,
                cell.spiked,
                cell.post_trace,
            ) = values
            cell.conductance = dict(conductance)
        for synapse, values in zip(self.all_synapses, state.synapses):
            (
                synapse.weight,
                synapse.x,
                synapse.u,
                synapse.last_spike,
                synapse.pre_trace,
                synapse.eligibility,
            ) = values
        self.pending = {
            step: [(self.all_synapses[number], amplitude) for number, amplitude in items]
            for step, items in state.pending.items()
        }
        self.modulator_level = dict(state.modulator_level)
        self.rng.setstate(state.rng)
        self.result.truncate(state.samples)


def simulate(model: ir.Model) -> SimResult:
    return Simulator(model).run()
