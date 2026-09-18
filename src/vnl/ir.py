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


@dataclass
class PointModel:
    """Параметры точечной модели мембраны (LIF с адаптацией)."""

    kind: str = "lif"
    v_rest: float = -65.0        # мВ
    v_reset: float = -65.0
    v_threshold: float = -50.0
    tau_m: float = 10.0          # мс
    r_in: float = 100.0          # МОм, для перевода тока в напряжение
    refractory: float = 2.0      # мс
    adaptation: float = 0.0      # мВ прибавки к порогу на спайк
    tau_adaptation: float = 100.0


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
