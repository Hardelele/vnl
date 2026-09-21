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

Видов точечной модели два, и выбираются они полем `PointModel.kind`. Ветка
`lif` -- прежняя и не меняется ни на одну операцию: схемы, написанные до
появления второго вида, обязаны давать те же спайки. Ветка `adex` добавляет к
ней экспоненциальный разгон у порога и вторую переменную состояния -- ток
адаптации `w`. Название файла осталось прежним: модуль про точечные модели
вообще, а не про одну из них, и переименование утащило бы за собой импорты во
всём проекте ради буквы.

Чего здесь нет и не будет ни у одного вида -- формы разряда. Сброс мгновенный:
потенциал приравнивается к `v_reset` за один шаг. `adex` делает подъём к
разряду настоящей динамикой, но сам разряд остаётся событием. Форма спайка
живёт в уравнениях Ходжкина--Хаксли, своего солвера для них тут нет, и путь к
ней один -- экспорт на L2.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Any

from .. import ir, protocols

# Скорость пассивного распространения по дендриту, мкм/мс.
DENDRITIC_SPEED = 200.0

# нСм * мВ даёт пА, а токи внутри IR -- в нА. Множитель нужен там, где
# проводимость умножают на напряжение и получают ток (`w_coupling` в `adex`),
# и не нужен там, где ток уже ток: `r_in` в МОм на нА даёт ровно мВ.
_NS_MV_TO_NA = 1e-3

# Потолок показателя экспоненты. Выше него exp() переполняется и в трассе
# появляется `inf`, а потом `nan`, то есть прогон молча превращается в мусор.
# Зажим безопасен, потому что показатель такой величины означает, что клетка
# уже далеко за `v_peak`: разряд на этом шаге будет признан в любом случае, и
# заменить 1e300 на 1e27 не может изменить ни один спайк. Единственное, что
# зажим меняет -- записанное значение в один отсчёт, и то лишь на заведомо
# бессмысленных параметрах.
_EXP_CEILING = 64.0

#: Записываемая величина -> полярность, чью проводимость она суммирует (#496).
#: Таблицей, а не тремя ветками `if`: имя величины и полярность связаны
#: один к одному, и разъехаться им негде.
_POLARITY_VARS: dict[str, str] = {
    "g_exc": ir.POLARITY_EXC,
    "g_inh": ir.POLARITY_INH,
    "g_shunt": ir.POLARITY_SHUNT,
}

#: Пустое расписание -- для стимула, у которого в прогон не попал ни один
#: импульс. Общий неизменяемый объект, а не `{}` на каждом шаге каждого
#: стимула: словарь-умолчание создавался бы тысячи раз за прогон и тут же
#: выбрасывался.
_NO_STEPS: dict[int, int] = {}


class SimulationError(ValueError):
    """Счёт зашёл туда, где ответа нет, -- и молчать об этом нельзя.

    Не диагностика разбора: схема законна и до какого-то шага считалась.
    Поднимается изнутри прогона, поэтому и живёт здесь, а не в `resolve`.

    Наследуется от `ValueError`, а не от `RuntimeError`, нарочно: сервер уже
    отвечает на `ValueError` четырёхсотым с текстом ошибки -- «неготовая схема
    -- нормальный исход, а не сбой». Расходящийся прогон ровно того же рода:
    чинится он числом в схеме, а человеку надо показать, каким именно. Пятисотый
    вместо этого сказал бы «сломался сервер» и спрятал бы сообщение, в котором
    и написано, что делать.
    """


@dataclass(frozen=True)
class SenseEvent:
    """Одно поданное снаружи значение: когда, какому сенсору и какое.

    Из таких событий состоит поток входа -- запись всего, что пришло в сеть
    извне. Запись, а не переменная: по ней прогон переигрывается заново, ровно
    как по зерну переигрывается случайный драйв. Поэтому у события есть
    модельное время, а не время по часам: настоящие секунды к прогону
    отношения не имеют и при откате повторить их нечем.
    """

    time: float
    sensor: str
    value: float


@dataclass
class SimResult:
    dt: float
    times: list[float]
    traces: dict[str, list[float]] = field(default_factory=dict)
    spikes: dict[str, list[float]] = field(default_factory=dict)
    degradation: list[str] = field(default_factory=list)
    #: Величины моторов на последний посчитанный момент. Не трасса: мотор
    #: отдаёт число сейчас, а не график за всё время, -- и считается оно по
    #: окну растра, то есть по тому, что уже лежит в `spikes`.
    motors: dict[str, float] = field(default_factory=dict)

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
    #: Ток адаптации `adex`, нА. Вторая переменная состояния мембраны: у `lif`
    #: её нет и она остаётся нулём. Именно она делает пачку конечной и даёт
    #: отдачу после торможения, поэтому она обязана попадать в снимок --
    #: иначе откат времени вернёт клетку без её собственной памяти.
    w: float = 0.0
    refractory_left: float = 0.0
    #: Открытая проводимость, нСм, по видам синаптического слагаемого.
    #:
    #: Ключ -- пара (рецептор, реверсал), а не имя рецептора, и это и есть
    #: правка #496. Раньше ключом было имя, и два `gaba_a`-контакта с разными
    #: реверсалами складывались в одно число, а считались по одному реверсалу
    #: -- молча и неверно. Пара разводит их по разным слагаемым, и у каждого
    #: остаётся свой множитель `(E − v)`.
    #:
    #: Почему пара, а не проводимость по каждому синапсу отдельно (второй
    #: вариант из карточки). Во-первых, числа: спад линеен, сумма двух
    #: раздельно спадающих величин равна спаду их суммы -- но только в
    #: арифметике вещественных чисел, а не в двоичных дробях. Разбиение на
    #: синапсы сдвинуло бы последний знак у всех двадцати паттернов
    #: библиотеки, где в шапках стоят заявленные результаты прогонов, ничего не
    #: меняя в физике. Во-вторых, смысла: слагаемые в `_integrate` различаются
    #: ровно реверсалом, постоянной спада и (с #498) зависимостью от
    #: напряжения -- всё это определяется парой, и два синапса с одной парой
    #: считались бы побуквенно одинаково. Пресинаптическое торможение,
    #: ради которого стоило бы хранить по синапсам, живёт не здесь: оно правит
    #: амплитуду выброса в `_release`, до того как проводимость попала на
    #: клетку.
    conductance: dict[tuple[str, float], float] = field(default_factory=dict)
    current: float = 0.0
    spiked: bool = False
    post_trace: float = 0.0
    #: Самое заряженное состояние с тех пор, как его последний раз забирали, и
    #: был ли за это время разряд. Смотрящему нужен не последний шаг, а то, что
    #: произошло: шагов между кадрами полсотни, разряд занимает один, и на
    #: мгновенном значении он не показывается никогда -- см. `peek`.
    peak: float = 0.0
    fired: bool = False

    @property
    def charge(self) -> float:
        """Насколько клетка заряжена: доля пути от покоя до разряда.

        Покой -- 0, разряд происходит на 1. Считается по параметрам этой
        клетки: у корзинчатой порог -52 мВ, у пирамиды -50, и общая на всех
        шкала врала бы про то, насколько каждая близка к разряду.

        Сто процентов -- это `PointModel.v_discharge`, то есть тот потенциал,
        на котором разряд признан состоявшимся. У `lif` это `v_threshold`, у
        `adex` -- `v_peak`, и это не две разные шкалы, а одна: «сколько пути до
        разряда пройдено». У `adex` есть и второй характерный потенциал --
        `v_threshold`, с которого начинается разгон, но сотней процентов он
        быть не может: клетка проходит его и продолжает подниматься, а число
        над клеткой обещает, что 100% -- это разряд. Зато у него появляется
        внятный смысл: при стандартных -65/-50/-40 разгон начинается на 60%, и
        всё выше -- участок, который клетка проходит сама.

        Снизу не обрезается. Торможение уводит мембрану ниже покоя, и
        отрицательная доля -- это ровно то, что должно быть видно: пришло
        возбуждение, а сразу за ним торможение. Ноль вместо неё означал бы, что
        тормозной вход ничего не сделал.

        Сверху тоже не обрезается: адаптация поднимает настоящий порог клетки на
        `adaptation` мВ за каждый свой спайк, и после разряда пирамида добирает
        до 110% номинала. Это не ошибка счёта, а видимая работа адаптации;
        считать долю от подвинутого порога значило бы прятать её. У `adex` за
        сотню выходит клетка, которой задали `v_reset` выше `v_peak`: она
        удерживается над потенциалом разряда, и пачка ещё не кончилась.
        """
        # В кадре разряда потенциал уже сброшен к `v_reset`, и доля по нему
        # оказалась бы нулём -- спайк выглядел бы как пустая клетка.
        if self.spiked:
            return 1.0
        span = self.model.v_discharge - self.model.v_rest
        # Разряд не выше покоя: доли пути нет, клетка разряжается сама.
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

    @property
    def key(self) -> tuple[str, float]:
        """Под каким ключом этот синапс копит проводимость на клетке.

        Считается от контакта, а не хранится полем: контакт -- единственное
        место, где реверсал решается (реестр или написанное число), и копия
        ключа в синапсе однажды разошлась бы с ним после правки веса через
        песочницу.
        """
        return (self.contact.receptor, self.contact.reversal)


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
    #: Шаг доставки -> номера синапсов, чей выброс к этому шагу придёт.
    pending: dict[int, tuple[int, ...]]
    #: Шаг -> (номер синапса, уровень) для удерживаемых входов в пути.
    holding: dict[int, tuple[tuple[int, float], ...]]
    modulator_level: dict[str, float]
    #: Состояние генератора: без него повтор разойдётся с исходным прогоном.
    rng: tuple
    #: Граница с миром: удерживаемые величины, фазы родов и то, сколько
    #: поданного уже применено. Здесь же и причина, по которой это в снимке:
    #: поток входа -- часть состояния прогона, а не внешняя переменная. Без
    #: курсора откат на 50 мс оставил бы сеть с величиной, поданной на 100-й,
    #: -- то есть показал бы прошлое, знающее своё будущее.
    sensor_value: dict[str, float]
    sensor_phase: dict[str, float]
    sensor_seen: dict[str, float]
    sensed: int
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
    if model.polarity_of(contact) == ir.POLARITY_SHUNT:
        # Ослабление веса -- честный перевод для контакта, который вливает в
        # клетку ток: до сомы доходит меньше. Для шунта это перевод неполный.
        # Шунт работает не током, а сопротивлением, и работает он там, где
        # сидит: на ветви он делит то, что идёт по этой ветви, а всё
        # остальное не трогает. В точке отсека нет, и поделено окажется всё
        # разом. Сказать об этом надо здесь, вместе с самим сворачиванием:
        # число в отчёте («вес x0.7») выглядит как полное описание потери, а
        # тут потеряна операция, а не доля.
        note += (
            "; контакт шунтирующий -- в точечной клетке он делит весь вход "
            "сразу, а не только то, что идёт по этой ветви"
        )
    return contact.weight * attenuation, contact.delay + extra_delay, note


def _open(cell: _Cell) -> list[tuple[tuple[str, float], float]]:
    """Эффективные проводимости клетки: сколько каждое слагаемое проводит сейчас.

    «Сейчас» -- потому что у NMDA открытая доля зависит от потенциала (#498), и
    записанное `g` у такой клетки перестаёт быть простой суммой того, что
    открыл медиатор. Пишется именно эффективная: сырая проводимость у
    NMDA-входа растёт от одного спайка и спадает сотню миллисекунд, ничего при
    этом не делая, -- на графике это выглядело бы как большой вход, которого
    клетка не почувствовала. Эффективная объясняет нелинейность прямо: она и
    есть та величина, что растёт вместе с деполяризацией.

    Для всех остальных рецепторов множитель -- ровная единица, поэтому у схем
    без NMDA записанное число не меняется ни в последнем знаке.
    """
    return [
        (key, value * ir.RECEPTORS[key[0]].gate(cell.v))
        for key, value in cell.conductance.items()
    ]


def _decay(value: float, dt: float, tau: float) -> float:
    if tau <= 0.0:
        return 0.0
    return value * math.exp(-dt / tau)


class Simulator:
    def __init__(
        self, model: ir.Model, sense: list[SenseEvent] | None = None
    ) -> None:
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
                reversal_override=stim.reversal_override,
            )
            self.stim_synapses[stim.id] = _Synapse(
                contact=fake,
                target=stim.target.instance,
                source=None,
                weight=stim.amplitude,
                delay=max(self.dt, 0.1),
            )

        # Моменты событийных стимулов -- одним списком и один раз, до прогона.
        # Шаблон протокола (`train`, `tbs`, ...) разворачивается здесь в тот же
        # кортеж времён, что написан руками у `spikes`: дальше солвер не знает,
        # откуда список взялся, и написанный руками поезд даёт побитово тот же
        # прогон, что шаблон с теми же числами (#508). Разворачивать на каждом
        # шаге значило бы пересчитывать одно и то же `duration/dt` раз подряд.
        self.stim_times: dict[str, tuple[float, ...]] = {
            stim.id: protocols.spike_times(stim)
            for stim in model.stimuli
            if stim.kind in protocols.EVENT_KINDS
        }

        # На каком шаге живёт каждый импульс -- посчитано здесь же, номером
        # шага, а не сравнением момента с часами на каждом шаге (#568).
        #
        # Сравнение с часами было неверным дважды. Во-первых, часы `step * dt`
        # в двоичных дробях не равны написанному моменту: у момента, кратного
        # шагу, окно `0 <= spike_time - time < dt` подходило к двум соседним
        # шагам сразу (на 99.9 разность 0.09999999999999432 -- меньше `dt`, на
        # 100.0 она ноль -- тоже проходит), и импульс ложился дважды: `spikes`,
        # `train`, `pairs`, `burst`, `tetanus`, `tbs` били вдвое сильнее
        # написанного веса. Во-вторых, окно ловило момент первым шагом, часы
        # которого момент ещё не догнали, -- то есть всегда раньше написанного
        # и вплоть до целого шага (у момента, кратного шагу, ровно на шаг).
        #
        # Правило здесь одно и то же самое, по которому `SimResult.truncate`
        # переводит время в номер отсчёта: `round(time / dt)` -- ближайший
        # шаг. Второго правила «в каком шаге живёт момент» в движке заводить
        # нельзя: разойдясь на шаг, они дали бы спайк, который в трассе есть,
        # а после отката на тот же момент исчезает.
        #
        # Ближайший шаг, а не предыдущий (`floor`), нарочно. Написанные 100 мс
        # -- это момент, а не «начало интервала 100.0-100.1»: сетка шагов
        # округляет его в обе стороны с ошибкой не больше полушага, тогда как
        # `floor` всегда сносит назад, до целого шага, и написанная задержка
        # 1.0 мс приходила бы как 0.9. На моментах, кратных шагу, -- а это весь
        # корпус примеров и все шаблоны протоколов, -- обе стороны вопроса
        # сходятся в одном: импульс ложится на тот шаг, часы которого равны
        # написанному моменту.
        #
        # Счётчик, а не флаг: два написанных момента могут попасть в один шаг
        # (`times="100 100.04"` при `dt = 0.1`), и класть тогда один импульс
        # значило бы тихо терять половину заданного драйва. Окно теряло их
        # так же молча.
        self.stim_steps: dict[str, dict[int, int]] = {}
        for stim in model.stimuli:
            if stim.kind not in protocols.EVENT_KINDS:
                continue
            steps: dict[int, int] = {}
            for spike_time in self.stim_times[stim.id]:
                # `start`/`stop` сравниваются с написанным моментом, а не с
                # часами: ровно от сравнения с часами лечила правка #508 --
                # первый импульс поезда с `start = 50ms` иначе выпадал.
                if not stim.start <= spike_time < stim.stop:
                    continue
                step = round(spike_time / self.dt)
                steps[step] = steps.get(step, 0) + 1
            self.stim_steps[stim.id] = steps

        # Синапсы сенсоров: у одного сенсора их столько, к скольким точкам он
        # подключён. Устроены они ровно как синапсы стимула -- источника-клетки
        # нет, амплитуда своя, -- потому что и вещь одна: событие приходит
        # снаружи и открывает проводимость. Разница только в том, откуда
        # берутся моменты.
        self.sensor_synapses: dict[str, list[_Synapse]] = {}
        for sensor in model.sensors.values():
            links: list[_Synapse] = []
            for number, link in enumerate(sensor.targets):
                fake = ir.Contact(
                    id=f"sensor:{sensor.id}:{number}",
                    pre=link.target,
                    post=link.target,
                    receptor=link.receptor,
                    weight=link.weight,
                    delay=max(link.delay, self.dt),
                    reversal_override=link.reversal_override,
                )
                links.append(
                    _Synapse(
                        contact=fake,
                        target=link.target.instance,
                        source=None,
                        weight=link.weight,
                        delay=max(link.delay, self.dt),
                    )
                )
            self.sensor_synapses[sensor.id] = links

        # Поток входа. Список приходит снаружи и остаётся общим объектом: его
        # хозяин (сессия) дописывает в него нажатия, а симулятор только читает
        # по порядку. Копия здесь означала бы, что после «Сброса» новый
        # симулятор считает уже без записи -- то есть опыт с кнопками
        # повторить нельзя.
        self.sense_log: list[SenseEvent] = [] if sense is None else sense
        self.sensed = 0
        #: Удерживаемая величина каждого сенсора. Ноль -- «ничего не подавали»:
        #: без привязки сенсор молчит, а не выдумывает себе вход.
        self.sensor_value: dict[str, float] = {s: 0.0 for s in model.sensors}
        #: Фаза рода: доля периода, накопленная с прошлого импульса.
        self.sensor_phase: dict[str, float] = {s: 0.0 for s in model.sensors}
        #: Величина на прошлом шаге -- её спрашивает род, отвечающий на
        #: изменение («нажали», «отпустили»), а не на уровень.
        self.sensor_seen: dict[str, float] = {s: 0.0 for s in model.sensors}

        self.pending: dict[int, list[_Synapse]] = {}
        #: Шаг -> какие удерживаемые входы к нему доедут и на каком уровне.
        #: Отдельно от `pending` нарочно: там выбросы, у которых сила одна и
        #: считается при доставке, здесь -- уровень, который у каждого свой и
        #: едет вместе с ним (#579).
        self.holding: dict[int, list[tuple[_Synapse, float]]] = {}
        self.modulator_level: dict[str, float] = {m: 0.0 for m in model.modulators}

        # Общий порядок синапсов. Очередь задержанных передач ссылается на
        # объекты, а снимок хранится по значению -- значит в нём нужен номер,
        # по которому синапс находится обратно.
        self.all_synapses: list[_Synapse] = [
            *self.synapses,
            *self.stim_synapses.values(),
            *(
                synapse
                for links in self.sensor_synapses.values()
                for synapse in links
            ),
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

    def _schedule(self, synapse: _Synapse) -> None:
        """Поставить выброс в очередь: на каком шаге он придёт -- и только.

        Силы здесь нет нарочно. Сколько придёт, решает `_release` в момент
        доставки, потому что кратковременная динамика (`u`, `x`) считается по
        промежутку до этого выброса, а не по тому, что было при постановке в
        очередь. Пока сила стояла в очереди вторым полем, она была мёртвой:
        `_deliver` её отбрасывал, и всякий, кто «ломал доставку», умножая её,
        ломал пустоту -- именно так проверка заявленных чисел и оказалась
        оболгана слепой (#577). Второго места, где живёт сила выброса, здесь
        быть не должно.
        """
        step = int(round((self.time + synapse.delay) / self.dt))
        self.pending.setdefault(step, []).append(synapse)

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
            if stim.kind in protocols.EVENT_KINDS:
                # Событийный стимул спрашивают номером шага: его моменты
                # разложены по шагам до прогона (см. `stim_steps`), и часы
                # здесь ни при чём. Окно по часам подходило к двум соседним
                # шагам сразу и клало импульс дважды (#568).
                #
                # Поэтому же тут `self.step`, а не `self.time`: после отката и
                # перемотки номер шага -- то же самое число, что и в первый
                # проход, а часы -- результат умножения, и сверять по ним
                # значило бы снова зависеть от двоичной дроби.
                repeats = self.stim_steps.get(stim.id, _NO_STEPS).get(self.step, 0)
                for _ in range(repeats):
                    self._schedule(self.stim_synapses[stim.id])
                continue
            if not stim.start <= self.time < stim.stop:
                continue
            if stim.kind == "current":
                self.cells[stim.target.instance].current += stim.amplitude
            elif stim.kind == "poisson":
                if self.rng.random() < stim.rate * self.dt / 1000.0:
                    self._schedule(self.stim_synapses[stim.id])

    # --- граница с миром --------------------------------------------------

    def sense_at(self, time: float, sensor_id: str, value: float) -> SenseEvent:
        """Записать величину, поданную снаружи, на момент модельного времени.

        Запись, а не присваивание: величина ложится в поток входа, и прогон
        после отката переигрывает её оттуда -- ровно как переигрывает случайный
        драйв по состоянию генератора. Живого «сейчас» у симулятора нет вовсе:
        то, что для человека «нажал сейчас», для прогона -- «на 137-й
        миллисекунде».

        В прошлое подать нельзя: оно уже посчитано, и вписать туда нажатие
        значило бы сделать вид, что клетка отвечала на то, чего не было.
        Поэтому момент не раньше ближайшего непосчитанного шага.

        Новое значение стирает записанное после себя будущее -- и это то же
        правило, по которому перемотка стирает прежние трассы. Поток входа
        переигрывается, пока время идёт по уже пройденному; но стоит человеку
        снова взяться за кнопку, как прежнее будущее перестаёт быть будущим
        этого прогона. Иначе нажатие на 150-й миллисекунде отменялось бы
        отпусканием, записанным в прошлый раз на 200-й, -- и объяснить это тому,
        кто держит кнопку, было бы нечем.
        """
        if sensor_id not in self.model.sensors:
            known = ", ".join(self.model.sensors) or "их нет вовсе"
            raise protocols.SenseError(
                f"в схеме нет сенсора {sensor_id!r} (есть: {known})"
            )
        number = protocols.check_value(value)
        moment = max(float(time), self.step * self.dt)
        kept = [
            event
            for event in self.sense_log
            if event.time < moment
            or (event.time == moment and event.sensor != sensor_id)
        ]
        event = SenseEvent(time=moment, sensor=sensor_id, value=number)
        kept.append(event)
        self.sense_log[:] = kept
        self.sensed = min(self.sensed, len(kept))
        return event

    def _sense(self) -> None:
        """Применить поданное к этому шагу и дать сенсорам сказать своё.

        Поток входа читается по порядку, курсором: он в снимке, поэтому после
        отката сеть видит ровно те значения, которые были поданы до того
        момента, и не видит поданных позже. Перебирать весь список на каждом
        шаге было бы и медленнее, и неверно -- курсор и есть то, что делает
        вход частью состояния, а не внешней переменной.
        """
        log = self.sense_log
        while self.sensed < len(log) and log[self.sensed].time <= self.time:
            event = log[self.sensed]
            if event.sensor in self.sensor_value:
                self.sensor_value[event.sensor] = event.value
            self.sensed += 1

        self._hold(self.step)

        for sensor in self.model.sensors.values():
            value = self.sensor_value[sensor.id]
            count, phase = protocols.sensor_events(
                sensor,
                value,
                self.sensor_seen[sensor.id],
                self.sensor_phase[sensor.id],
                self.dt,
            )
            self.sensor_phase[sensor.id] = phase
            self.sensor_seen[sensor.id] = value
            for _ in range(count):
                for synapse in self.sensor_synapses[sensor.id]:
                    self._schedule(synapse)
            share = protocols.sensor_hold(sensor, value)
            for synapse in self.sensor_synapses[sensor.id]:
                # Уровень едет по той же линии задержки, по которой едет
                # импульс: провести величину мгновенно значило бы сказать, что
                # у двери, в отличие от всех прочих входов, расстояния нет.
                step = self.step + max(1, int(round(synapse.delay / self.dt)))
                self.holding.setdefault(step, []).append(
                    (synapse, share * synapse.weight)
                )

    def _hold(self, step: int) -> None:
        """Подлить удерживаемым входам столько, сколько с них утекло за шаг.

        Род `hold` держит проводимость, а всё в `cell.conductance` спадает по
        постоянной рецептора. Вместо второго места, где живёт проводимость
        (неспадающего слагаемого, которое пришлось бы учесть и в шунте, и в
        воротах NMDA, и в проверке устойчивости), удержание выражено
        подливанием: каждый шаг добавляется ровно утёкшее, и сумма
        останавливается на заданном уровне.

        Добавка `g·(1 − d)/d`, где `d = exp(−dt/tau)`, -- это не подгонка, а
        решение `y = (y + a)·d` относительно `a`. Подливается до спада, там
        же, где кладут свою долю импульсы, поэтому в точке, где считается ток,
        удерживаемый вход стоит ровно на `g`. Сверить это с числом обязана
        проверка: стационарный потенциал при такой проводимости известен
        аналитически.

        Чужие доли отсюда не видны вовсе: добавка не зависит от того, что
        лежит в канале, поэтому другой вход в тот же рецептор просто
        складывается сверху -- как и складывался бы.
        """
        for synapse, level in self.holding.pop(step, ()):
            if level <= 0.0:
                continue
            tau = ir.RECEPTORS[synapse.key[0]].tau_decay
            if tau <= 0.0:
                continue
            kept = math.exp(-self.dt / tau)
            cell = self.cells[synapse.target]
            key = synapse.key
            cell.conductance[key] = cell.conductance.get(key, 0.0) + level * (
                1.0 - kept
            ) / kept

    def held(self, now: float | None = None) -> dict[str, float]:
        """Какая величина держится на этот момент -- по записи, а не по шагу.

        Отличается от `sensor_value` на один шаг, и разница не придирка.
        `sensor_value` -- то, что уже применено к посчитанному шагу; величина,
        поданная «сейчас», применится на следующем, и спроси мы её -- кнопка
        отвечала бы человеку прошлым: нажал, а в ответе ноль.

        Считается по той же записи и по тому же правилу, по которому её
        применяет прогон: последнее значение, поданное не позже момента.
        Поэтому после перемотки на 50 мс здесь честный ноль -- значения,
        поданного на 100-й, на 50-й ещё не было.
        """
        moment = self.step * self.dt if now is None else float(now)
        values = {name: 0.0 for name in self.model.sensors}
        for event in self.sense_log:
            if event.time <= moment and event.sensor in values:
                values[event.sensor] = event.value
        return values

    def motors(self) -> dict[str, float]:
        """Величины моторов на текущий момент -- по растру, а не по состоянию.

        Поэтому они и повторяются при откате сами собой: окно смотрит только
        назад, а прежнее будущее из растра стирается вместе с трассами.
        """
        now = self.step * self.dt
        return {
            motor.id: protocols.motor_value(
                motor, self.result.spikes.get(motor.source.instance, ()), now
            )
            for motor in self.model.motors.values()
        }

    def _deliver(self, step: int) -> None:
        for synapse in self.pending.pop(step, []):
            amplitude = self._release(synapse)
            cell = self.cells[synapse.target]
            key = synapse.key
            cell.conductance[key] = cell.conductance.get(key, 0.0) + amplitude
            if synapse.contact.plasticity.enabled:
                synapse.pre_trace += 1.0
                self._on_pre(synapse, cell)

    @staticmethod
    def _exp_drive(point: ir.PointModel, v: float) -> float:
        """Экспоненциальный разгон `adex`, мВ: `delta_t * exp((v - v_t)/delta_t)`.

        Это то, чего у LIF нет вовсе: чем ближе клетка к `v_threshold`, тем
        сильнее она деполяризует себя сама, и последние мВ до разряда клетка
        проходит без нового входа. Ниже порога член ничтожен -- при
        `delta_t = 2` мВ и покое на 15 мВ ниже он даёт 0.001 мВ, -- поэтому
        подпороговое поведение остаётся прежним.

        Потенциал берётся зажатым сверху по `v_peak`, и этот зажим -- и есть
        ответ на расходимость. Экспонента уходит в бесконечность, а проверки
        стоят раз в `dt`: при `dt = 0.1` мс клетка успевает между двумя
        проверками получить `inf`, дальше `nan`, и прогон молча превращается в
        мусор. Выше `v_peak` считать нечего по смыслу -- там разряд уже признан
        на этом же шаге, -- поэтому зажим не может изменить ни один спайк. Он
        только не пускает бесконечность в трассу. Второй рубеж -- `_EXP_CEILING`
        на сам показатель: он спасает от переполнения при заведомо
        бессмысленном `delta_t`, когда и зажатого размаха хватает на exp(1e4).
        """
        if point.delta_t <= 0.0:
            # Нулевая резкость -- вырожденный случай: разгона нет, остаётся
            # жёсткий порог на `v_peak`. Делить на ноль здесь нельзя, а
            # отказывать поздно -- отказ живёт в `resolve`.
            return 0.0
        power = (min(v, point.v_peak) - point.v_threshold) / point.delta_t
        return point.delta_t * math.exp(min(power, _EXP_CEILING))

    def _check_stable(self, cell: _Cell, total: float) -> None:
        """Не развалится ли явная схема на этом шаге -- и сказать об этом словами.

        Шаг мембраны здесь явный (Эйлер вперёд), и у него есть предел: при
        `dt/tau_m · (1 + Σg) >= 2` поправка перелетает цель дальше, чем была
        ошибка, и следующий шаг перелетает сильнее. Через десяток шагов в
        трассе `inf`, потом `nan`, а спайки при этом продолжают ставиться --
        то есть прогон превращается в мусор, не подавая виду.

        До #498 этого предела было не достать: проводимости приходили извне,
        и никакая из них сама себя не растила. NMDA растит: деполяризация
        открывает канал, открытый канал деполяризует. Поэтому проверка
        появляется вместе с ним и стоит здесь -- там, где `Σg` уже посчитана
        и платить за неё второй раз не надо.

        Отказ, а не зажим `v` сверху. Зажим оставил бы правдоподобную трассу с
        неправдой внутри: клетка «держала бы плато» на том потенциале, куда её
        поставил зажим, и отличить это от настоящего плато было бы нечем.
        Сообщение называет и клетку, и тот `dt`, при котором счёт сойдётся, --
        чинится это одним числом в `run`.
        """
        point = cell.model
        if point.tau_m <= 0.0:
            return
        limit = self.dt / point.tau_m * (1.0 + total)
        if limit < 2.0:
            return
        safe = 2.0 * point.tau_m / (1.0 + total)
        raise SimulationError(
            f"клетка {cell.id} на {self.time:g} мс: суммарная проводимость "
            f"{total:.1f} нСм при dt = {self.dt:g} мс и tau_m = "
            f"{point.tau_m:g} мс разваливает явную схему интегрирования "
            f"(dt/tau_m·(1+g) = {limit:.1f} при пределе 2). Возьмите dt "
            f"меньше {safe:.3f} мс или уменьшите веса входов; "
            f"регенеративный ток NMDA требует более мелкого шага"
        )

    @staticmethod
    def _advance_w(cell: _Cell, v: float, dt: float) -> None:
        """Шаг тока адаптации `adex`: `tau_w * dw/dt = a * (v - v_rest) - w`.

        Ток тянется к тому значению, которое задаёт подпороговый потенциал, а
        прибавку `b` ему добавляет сам разряд. Потенциал передаётся
        параметром -- тем же, от которого считается шаг мембраны: иначе
        половина шага пошла бы по новому состоянию, а половина по старому.
        """
        point = cell.model
        # нСм * мВ = пА, а `w` здесь в нА, как все токи в IR.
        target = point.w_coupling * (v - point.v_rest) * _NS_MV_TO_NA
        if point.tau_w <= 0.0:
            # Памяти нет: ток равен своему мгновенному значению.
            cell.w = target
            return
        cell.w += dt / point.tau_w * (target - cell.w)

    def _integrate(self) -> None:
        dt = self.dt
        for cell in self.cells.values():
            cell.spiked = False
            for key, value in list(cell.conductance.items()):
                tau = ir.RECEPTORS[key[0]].tau_decay
                cell.conductance[key] = _decay(value, dt, tau)
            point = cell.model
            adex = point.kind == "adex"
            if cell.refractory_left > 0.0:
                cell.refractory_left -= dt
                cell.v = point.v_reset
                cell.current = 0.0
                # Ток адаптации идёт и в рефрактерном периоде. Иначе пачка не
                # кончается никогда: у пачечной клетки `v_reset` стоит выше
                # `v_threshold`, то есть после каждого разряда она снова в зоне
                # разгона, и остановить её может только накопленное `w`. Замри
                # оно на рефрактерность -- и клетка разряжалась бы до конца
                # прогона, тем чаще, чем короче рефрактерность.
                if adex:
                    self._advance_w(cell, cell.v, dt)
                continue
            # Реверсал берётся из ключа, а не из реестра по имени рецептора:
            # в ключе он и лежит затем, чтобы у каждого слагаемого был свой.
            # Отсюда и шунт: при `E ≈ v_rest` множитель `(E − v)` у покоя равен
            # нулю, то есть мембрану контакт не двигает, -- но `value` осталось
            # в сумме и поделило всё остальное, потому что `dt/tau_m * g·v` --
            # это и есть добавка к скорости утечки.
            #
            # Проводимость берётся эффективная, с воротами (#498): у NMDA доля
            # открытых каналов зависит от потенциала, и считать её здесь надо
            # по тому же `v`, по которому считается шаг. Взять ворота от
            # прошлого шага значило бы, что клетка отвечает на своё вчера.
            total = 0.0
            synaptic = 0.0
            for (receptor, reversal), value in cell.conductance.items():
                open_g = value * ir.RECEPTORS[receptor].gate(cell.v)
                total += open_g
                synaptic += open_g * (reversal - cell.v)
            self._check_stable(cell, total)
            # МОм * нА = мВ: сопротивление и ток уже в тех единицах, в
            # которых считается мембрана, и переводить нечего. Лишний
            # множитель 1e-3 здесь означал бы, что ток на самом деле в
            # пикоамперах, а реобаза клетки -- сотни наноампер.
            drive = (point.v_rest - cell.v) + point.r_in * cell.current
            if adex:
                # Два слагаемых к тому же уравнению мембраны: разгон тянет
                # вверх тем сильнее, чем клетка выше порога, ток адаптации --
                # вниз тем сильнее, чем больше накопилось. `w` переводится в
                # напряжение тем же `r_in`, которым переводится инжектируемый
                # ток: это одно и то же входное сопротивление клетки.
                drive += self._exp_drive(point, cell.v) - point.r_in * cell.w
                self._advance_w(cell, cell.v, dt)
            cell.v += dt / point.tau_m * (drive + synaptic)
            cell.current = 0.0
            cell.threshold_offset = _decay(
                cell.threshold_offset, dt, point.tau_adaptation
            )
            # У `adex` адаптация выражена током, а не сдвигом порога: считать
            # ещё и сдвиг значило бы применить к клетке две адаптации сразу.
            # О том, что `adaptation` у такой клетки не читается, предупреждает
            # `resolve`, а не молчание здесь.
            if adex:
                fires = cell.v >= point.v_peak
            else:
                fires = cell.v >= point.v_threshold + cell.threshold_offset
            if fires:
                cell.v = point.v_reset
                cell.refractory_left = point.refractory
                if adex:
                    cell.w += point.w_increment
                else:
                    cell.threshold_offset += point.adaptation
                cell.spiked = True
                cell.fired = True
                self.result.spikes[cell.id].append(self.time)
            # Самое заряженное за промежуток между двумя взглядами. Считается
            # на каждом шаге, потому что взгляд редкий: иначе разряд, занявший
            # один шаг из пятидесяти, в кадр не попадёт.
            if cell.charge > cell.peak:
                cell.peak = cell.charge

    def _propagate(self) -> None:
        for synapse in self.synapses:
            if synapse.source is None:
                continue
            if self.cells[synapse.source].spiked:
                self._schedule(synapse)

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
                value = sum(open_g for _, open_g in _open(cell))
            elif recording.var in _POLARITY_VARS:
                # Возбуждение, торможение и шунт врозь: их баланс и есть то,
                # что решает судьбу клетки, а в сумме он теряется.
                #
                # Корзины три, и разбирает их реверсал, а не имя рецептора
                # (#496). Шунт не подводит к порогу и не уводит от него, и
                # зачисли его в `g_inh` -- график показывал бы «торможение»,
                # которого на `v` не видно. Кто записал только `g_exc` и
                # `g_inh`, шунта в них не увидит вовсе: это честнее, чем
                # приписать его к чужой сумме.
                want = _POLARITY_VARS[recording.var]
                value = sum(
                    open_g
                    for (_, reversal), open_g in _open(cell)
                    if ir.synapse_polarity(reversal, cell.model) == want
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
        # Вход снаружи -- до драйва: и то и другое кладёт события в очередь
        # доставки, и порядок между ними на результат не влияет, но читается
        # он сверху вниз -- сперва то, что пришло из мира, потом заданное
        # заранее.
        self._sense()
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

    def peek(self) -> dict[str, dict[str, Any]]:
        """Состояние клеток для смотрящего -- и счётчики обнуляются.

        Мгновенное значение здесь недостаточно, и это не придирка к точности.
        Между двумя взглядами проходит полсотни шагов (темп 50 мс модели в
        секунду, `dt` 0.1 мс), а разряд занимает ровно один: у клетки `E` в
        `ffi` это пять шагов из трёх тысяч. Спрашивая последний шаг, разряд
        видишь с вероятностью 0.17% -- то есть никогда, и сто процентов
        заряда, которые в движке есть всегда, на экран не попадают.

        Поэтому отдаётся и то, где клетка сейчас (`charge` -- по ней заливка),
        и то, до чего она доходила с прошлого взгляда (`peak`), и был ли
        разряд (`fired`). Провал ниже покоя так ловить не нужно: постоянная
        мембраны 6-15 мс против 5 мс между взглядами, и торможение никуда за
        кадр не исчезает.

        Вызов обнуляет накопленное: следующий взгляд -- про следующий отрезок,
        а не про всё время с начала прогона.
        """
        out: dict[str, dict[str, Any]] = {}
        for name, cell in self.cells.items():
            out[name] = {
                "v": cell.v,
                "charge": cell.charge,
                "peak": max(cell.peak, cell.charge),
                "fired": cell.fired,
            }
        self.forget_frame()
        return out

    def forget_frame(self) -> None:
        """Забыть накопленное для показа, не трогая физику.

        `peak` и `fired` -- это «что было с прошлого взгляда», и смысл у них
        только внутри кадра. Поэтому всякий, кто прогнал движок без взгляда,
        обязан их обнулить: иначе следующий кадр сообщит про разряд, который
        случился в середине пройденного отрезка, как про разряд сейчас, и
        клетка, давно вернувшаяся к покою, будет нарисована стопроцентно
        заряженной (#534).

        Обнуляется по достигнутому состоянию, а не в ноль: `charge` -- это
        то, где клетка стоит сию секунду, и пик отрезка длиной в один шаг
        равен ему же.

        Отдельным методом, а не двумя строчками на каждом месте: правило
        одно, а мест, где движок идёт без взгляда, уже три -- откат,
        перемотка и сброс.
        """
        for cell in self.cells.values():
            cell.peak = cell.charge
            cell.fired = False

    @property
    def finished(self) -> bool:
        return self.step >= self.total_steps

    def run(self) -> SimResult:
        """Считать до конца. Прежний способ: он же шаги, только все сразу."""
        while self.step_once():
            pass
        self.result.motors = self.motors()
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
                    # Ток адаптации -- вторая переменная состояния мембраны, и
                    # без неё восстановленная клетка забыла бы, сколько уже
                    # отработала: продолжение после отката пошло бы другой
                    # пачкой, чем непрерывный прогон.
                    cell.w,
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
                step: tuple(index[id(synapse)] for synapse in items)
                for step, items in self.pending.items()
                if items
            },
            holding={
                step: tuple((index[id(synapse)], level) for synapse, level in items)
                for step, items in self.holding.items()
                if items
            },
            modulator_level=dict(self.modulator_level),
            rng=self.rng.getstate(),
            sensor_value=dict(self.sensor_value),
            sensor_phase=dict(self.sensor_phase),
            sensor_seen=dict(self.sensor_seen),
            sensed=self.sensed,
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
                cell.w,
                cell.refractory_left,
                conductance,
                cell.current,
                cell.spiked,
                cell.post_trace,
            ) = values
            cell.conductance = dict(conductance)
        # Накопленное для показа -- не физика, и в снимке его нет. После отката
        # оно обязано начаться заново с восстановленного состояния, иначе
        # первый же кадр покажет пик из будущего, которого больше нет.
        self.forget_frame()
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
            step: [self.all_synapses[number] for number in items]
            for step, items in state.pending.items()
        }
        # Удерживаемое в пути -- такое же состояние, как выброс в пути: откат
        # обязан вернуть и уровень, который к этому шагу ещё не доехал.
        self.holding = {
            step: [(self.all_synapses[number], level) for number, level in items]
            for step, items in state.holding.items()
        }
        self.modulator_level = dict(state.modulator_level)
        self.rng.setstate(state.rng)
        # Поток входа не откатывается и не обрезается -- он запись, и по ней
        # продолжение переигрывается заново. Откатывается место в нём: курсор
        # и удерживаемые величины на тот момент.
        self.sensor_value = dict(state.sensor_value)
        self.sensor_phase = dict(state.sensor_phase)
        self.sensor_seen = dict(state.sensor_seen)
        self.sensed = state.sensed
        self.result.truncate(state.samples)
        # Величина мотора считается по растру, а растр только что обрезан:
        # оставить прежнюю значило бы показывать величину из стёртого будущего.
        self.result.motors = self.motors()


def simulate(
    model: ir.Model, sense: list[SenseEvent] | None = None
) -> SimResult:
    """Посчитать модель целиком. `sense` -- заранее известный поток входа.

    Поток передаётся сюда, а не подаётся по ходу, потому что здесь нет «по
    ходу»: это расчёт от начала до конца. Запись значений при этом та же, что
    в живой сессии, -- и прогон по ней совпадает с живым нажатием в те же
    моменты спайк в спайк. В том и смысл записи.
    """
    return Simulator(model, sense=sense).run()
