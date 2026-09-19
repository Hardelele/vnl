"""IR -- единственный источник истины для модели.

Всё остальное (парсер, симуляторы, экспортёры) работает только с этими
структурами. Формат NeuroML сюда не протекает: он экспортный, а не внутренний.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .morphology import Morphology

DetailLevel = Literal["L0", "L1", "L2"]

# Рецепторы: реверсал (мВ) и постоянная спада (мс) по умолчанию.
RECEPTORS: dict[str, tuple[float, float]] = {
    "ampa": (0.0, 2.0),
    "nmda": (0.0, 100.0),
    "gaba_a": (-70.0, 6.0),
    "gaba_b": (-90.0, 150.0),
    "nicotinic": (0.0, 5.0),
}

# Тормозный рецептор определяется по реверсалу ниже потенциала покоя: именно
# он решает, тянет синапс клетку к порогу или от него.
INHIBITORY_RECEPTORS = frozenset(
    name for name, (reversal, _) in RECEPTORS.items() if reversal < -50.0
)


def is_inhibitory_receptor(receptor: str) -> bool:
    return receptor in INHIBITORY_RECEPTORS


@dataclass(frozen=True)
class RecordedVariable:
    """Что за величина пишется и как её читать.

    Реестр живёт в ядре, потому что это знание предметной области, а не
    оформление: единицы нужны и выгрузке в JSON, и подписи на графике, и
    CSV. Раньше каждый потребитель знал это по-своему и знал по-разному.
    """

    name: str
    unit: str
    #: Шкала обязана включать ноль -- у проводимости и веса он осмыслен.
    from_zero: bool = False
    #: Величина 0/1: ломаной её рисовать бессмысленно, только событиями.
    binary: bool = False
    #: У величины есть порог клетки, относительно которого её читают.
    against_threshold: bool = False


RECORDED: dict[str, RecordedVariable] = {
    "v": RecordedVariable(
        "мембранный потенциал", "мВ", against_threshold=True
    ),
    "g": RecordedVariable("синаптическая проводимость", "нСм", from_zero=True),
    "g_exc": RecordedVariable("возбуждающая проводимость", "нСм", from_zero=True),
    "g_inh": RecordedVariable("тормозная проводимость", "нСм", from_zero=True),
    "w": RecordedVariable(
        "суммарный вес пластичных входов", "нСм", from_zero=True
    ),
    "spikes": RecordedVariable("спайки", "", binary=True),
}


def trace_key(instance: str, section: str, var: str) -> str:
    """Имя трассы. Один формат на симулятор, выгрузку и отрисовку."""
    return f"{instance}.{section}:{var}"


def parse_trace_key(key: str) -> tuple[str, str, str]:
    """'E.soma:v' -> ('E', 'soma', 'v')."""
    address, _, var = key.rpartition(":")
    instance, _, section = address.partition(".")
    if not var or not instance:
        raise ValueError(f"не разобрать имя трассы: {key!r}")
    return instance, section, var


def is_inhibitory_cell(cell_type: "CellType") -> bool:
    """Тормозная ли клетка. Решается в одном месте, иначе разъедется."""
    return "inhibitory" in cell_type.tags or cell_type.transmitter == "gaba"


#: Виды точечной модели, которые симулятор действительно считает. Список
#: нужен затем, чтобы объявленный в тексте, но не реализованный вид отвергался
#: разбором, а не считался молча как что-то другое.
POINT_MODELS: tuple[str, ...] = ("lif", "adex")


@dataclass
class PointModel:
    """Параметры точечной модели мембраны.

    Видов два, и выбирается вид полем `kind`.

    `lif` -- мембрана течёт к покою, а на пороге потенциал приравнивается к
    `v_reset`. Подъём к разряду здесь не динамика, а срабатывание сравнения:
    до порога клетка ведёт себя линейно, за порогом её уже нет.

    `adex` -- то же плюс два слагаемых из Brette--Gerstner 2005. Первое,
    экспоненциальное, превращает подъём к разряду в разгон: чем ближе клетка к
    `v_threshold`, тем сильнее она сама себя деполяризует, и последние
    несколько мВ проходятся не потому, что пришёл вход, а потому что уже
    началось. Второе -- ток адаптации `w` со своей переменной состояния: он
    накапливается на спайках и подтягивается к подпороговому потенциалу,
    поэтому у клетки появляется собственная медленная память о том, что она
    только что делала. Отсюда пачки, плато и отдача после торможения --
    ничего этого сдвигом порога получить нельзя.

    Чего `adex` не даёт: формы самого разряда. Сброс остаётся мгновенным, как
    во всех точечных моделях. Настоящая форма спайка -- это Ходжкина--Хаксли,
    и свой солвер для неё не пишется; за ней идут на L2.

    Поля ниже до `tau_adaptation` читают оба вида, дальше -- только `adex`.
    """

    kind: str = "lif"
    v_rest: float = -65.0        # мВ
    v_reset: float = -65.0
    #: У `lif` -- порог: пересекли, значит разряд. У `adex` -- точка, с которой
    #: начинается экспоненциальный разгон; разряд признаётся выше, на `v_peak`.
    #: Поле одно на оба вида: это тот потенциал, на котором клетка перестаёт
    #: быть пассивной, и заводить под это два поля значило бы, что у одной
    #: клетки два порога.
    v_threshold: float = -50.0
    tau_m: float = 10.0          # мс
    r_in: float = 100.0          # МОм, для перевода тока в напряжение
    refractory: float = 2.0      # мс
    adaptation: float = 0.0      # мВ прибавки к порогу на спайк
    tau_adaptation: float = 100.0

    # --- только `adex` ---------------------------------------------------
    #: Насколько резок разгон у порога, мВ. Это масштаб экспоненты: на
    #: `delta_t` мВ выше `v_threshold` собственный ток клетки вырастает в `e`
    #: раз. Мало -- разгон почти мгновенный и клетка ведёт себя как LIF с
    #: жёстким порогом; много -- разгон растянут, и клетка умеет подолгу
    #: держаться выше порога, не разряжаясь (это и есть плато).
    delta_t: float = 2.0
    #: Потенциал, на котором разряд признан состоявшимся, мВ. Нужен затем, что
    #: экспонента уходит в бесконечность, и «вершину» приходится назначать, а
    #: не ждать. Он же -- сто процентов заряда клетки: см. `v_discharge`.
    v_peak: float = -40.0
    #: За сколько рассасывается ток адаптации, мс. Коротко -- ток успевает
    #: уйти между спайками, и адаптация видна только внутри пачки; долго --
    #: клетка помнит прошлую активность секунды.
    tau_w: float = 144.0
    #: Насколько ток адаптации следит за подпороговым потенциалом, нСм.
    #: Положительное -- ток идёт за потенциалом с отставанием `tau_w`:
    #: деполяризация подтягивает тормозящий ток и клетка гасит себя заранее, а
    #: гиперполяризация, наоборот, уводит ток в минус, то есть делает его
    #: деполяризующим. Из второго и получается отдача после торможения: покой
    #: мембрана набирает за `tau_m`, а накопленный деполяризующий ток
    #: рассасывается за `tau_w`, и в этом зазоре он перебрасывает мембрану через
    #: покой. Отрицательное -- обратное: ток усиливает то, что с клеткой уже
    #: происходит, и подъём к разряду становится ещё резче.
    w_coupling: float = 4.0
    #: Сколько тока адаптации добавляет один разряд. Это то, чем заканчивается
    #: пачка: пока накопленного мало, клетка разряжается снова, а когда
    #: хватило -- замолкает. Ноль означает «адаптации на спайк нет».
    #: Внутри IR ток в нА, как и всюду; в тексте схемы это пишется `b = 80.5pA`.
    w_increment: float = 0.0805

    @property
    def v_discharge(self) -> float:
        """Потенциал, на котором клетка считается разрядившейся.

        Одно понятие на оба вида модели, и держится оно здесь, потому что его
        спрашивают и симулятор (когда ставить спайк), и доля заряда (что
        считать сотней процентов). Две разные ответы на этот вопрос означали
        бы, что «100%» у `lif` и у `adex` -- про разное.
        """
        return self.v_peak if self.kind == "adex" else self.v_threshold


@dataclass
class CellType:
    id: str
    tags: tuple[str, ...] = ()
    transmitter: str | None = None
    morphology: Morphology = field(default_factory=Morphology.point)
    point_model: PointModel = field(default_factory=PointModel)

    @property
    def is_point(self) -> bool:
        return len(self.morphology.sections) == 1


@dataclass
class Instance:
    id: str
    cell_type: str
    tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class Site:
    """Разрешённый адрес точки на клетке."""

    instance: str
    section: str
    fraction: float

    def __str__(self) -> str:
        return f"{self.instance}.{self.section}@{self.fraction:g}"


@dataclass
class ShortTermDynamics:
    """Модель Цодыкса--Маркрама: депрессия и фасилитация."""

    u: float = 0.5               # доля ресурса, тратится на спайк
    tau_rec: float = 0.0         # мс, восстановление ресурса (0 = выключено)
    tau_facil: float = 0.0       # мс, распад фасилитации (0 = выключено)

    @property
    def enabled(self) -> bool:
        return self.tau_rec > 0.0 or self.tau_facil > 0.0


@dataclass
class Plasticity:
    rule: str = "none"           # none | stdp | stdp_rl
    a_plus: float = 0.01         # нСм за пару pre->post
    a_minus: float = 0.012
    tau_plus: float = 20.0       # мс
    tau_minus: float = 20.0
    w_max: float = 5.0           # нСм
    w_min: float = 0.0
    tau_eligibility: float = 500.0   # мс, только для stdp_rl
    modulator: str | None = None     # id источника нейромодулятора

    @property
    def enabled(self) -> bool:
        return self.rule != "none"


@dataclass
class Contact:
    """Контакт между двумя точками. Пре- и постсинаптическая стороны --
    оба Site, поэтому axo-axonic не является спецслучаем."""

    id: str
    pre: Site
    post: Site
    receptor: str = "ampa"
    weight: float = 1.0          # нСм
    delay: float = 1.0           # мс
    dynamics: ShortTermDynamics = field(default_factory=ShortTermDynamics)
    plasticity: Plasticity = field(default_factory=Plasticity)

    @property
    def reversal(self) -> float:
        return RECEPTORS[self.receptor][0]

    @property
    def tau_decay(self) -> float:
        return RECEPTORS[self.receptor][1]


@dataclass
class Modulator:
    id: str
    transmitter: str = "dopamine"
    sources: tuple[str, ...] = ()   # id инстансов-источников
    gain: float = 1.0
    tau: float = 200.0              # мс, распад концентрации


@dataclass
class Stimulus:
    id: str
    target: Site
    kind: str = "current"        # current | poisson | spikes
    amplitude: float = 0.0       # нА для current, нСм для poisson
    rate: float = 0.0            # Гц для poisson
    times: tuple[float, ...] = () # мс для spikes
    start: float = 0.0
    stop: float = float("inf")
    receptor: str = "ampa"


@dataclass
class Recording:
    id: str
    target: Site
    var: str = "v"               # v | spikes | g | w


@dataclass
class RunSpec:
    dt: float = 0.1              # мс
    duration: float = 500.0      # мс
    level: DetailLevel = "L1"
    seed: int = 1


@dataclass
class Model:
    name: str = "model"
    cell_types: dict[str, CellType] = field(default_factory=dict)
    instances: dict[str, Instance] = field(default_factory=dict)
    contacts: list[Contact] = field(default_factory=list)
    modulators: dict[str, Modulator] = field(default_factory=dict)
    stimuli: list[Stimulus] = field(default_factory=list)
    recordings: list[Recording] = field(default_factory=list)
    run: RunSpec = field(default_factory=RunSpec)
    source: str | None = None

    def cell_type_of(self, instance_id: str) -> CellType:
        return self.cell_types[self.instances[instance_id].cell_type]

    def morphology_of(self, instance_id: str) -> Morphology:
        return self.cell_type_of(instance_id).morphology

    def summary(self) -> dict[str, Any]:
        return {
            "cell_types": len(self.cell_types),
            "instances": len(self.instances),
            "contacts": len(self.contacts),
            "modulators": len(self.modulators),
            "stimuli": len(self.stimuli),
            "recordings": len(self.recordings),
        }
