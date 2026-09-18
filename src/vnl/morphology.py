"""Морфология клетки и адресация точки контакта.

Логический адрес (`dend.apical[2]@0.72`) хранится в исходнике и переживает
смену морфологии. Резолвер превращает его в пару (section_id, fraction) --
ровно тот кортеж, который понимают и NEURON (`sec(0.72)`), и NeuroML2
(`postSegmentId` + `postFractionAlong`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

SOMA = "soma"

_ADDR = re.compile(
    r"^(?P<path>[A-Za-z_][A-Za-z_0-9.]*)"
    r"(?:\[(?P<index>\d+)\])?"
    r"(?:@(?P<frac>[01]?\.?\d*))?$"
)


class MorphologyError(ValueError):
    pass


@dataclass(frozen=True)
class Section:
    """Один неветвящийся отрезок дерева."""

    id: str                      # 'soma', 'dend.apical[2]', 'axon'
    kind: str                    # soma | dend | axon
    parent: str | None
    length: float                # мкм
    diam: float                  # мкм
    lambda_dc: float = 250.0     # электротоническая длина, мкм


@dataclass
class Morphology:
    name: str
    sections: dict[str, Section] = field(default_factory=dict)

    @staticmethod
    def point(name: str = "point") -> "Morphology":
        """Вырожденная морфология для точечных моделей: одна сома."""
        return Morphology(
            name=name,
            sections={SOMA: Section(SOMA, "soma", None, length=20.0, diam=20.0)},
        )

    def add(self, section: Section) -> None:
        if section.id in self.sections:
            raise MorphologyError(f"секция {section.id!r} уже объявлена")
        if section.parent is not None and section.parent not in self.sections:
            raise MorphologyError(
                f"секция {section.id!r} ссылается на неизвестного родителя "
                f"{section.parent!r}"
            )
        self.sections[section.id] = section

    def kind_of(self, section_id: str) -> str:
        return self.sections[section_id].kind

    @property
    def is_point(self) -> bool:
        return len(self.sections) == 1 and SOMA in self.sections

    def resolve(self, address: str) -> tuple[str, float]:
        section_id, fraction, _ = self.resolve_with_note(address)
        return section_id, fraction

    def resolve_with_note(self, address: str) -> tuple[str, float, str | None]:
        """'dend.apical[2]@0.72' -> ('dend.apical[2]', 0.72, None).

        У точечной модели отсеков нет, поэтому логический адрес схлопывается
        в сому -- с пометкой, а не молча.
        """
        m = _ADDR.match(address.strip())
        if not m:
            raise MorphologyError(f"нечитаемый адрес участка: {address!r}")
        path = m.group("path")
        index = m.group("index")
        frac_text = m.group("frac")

        section_id = f"{path}[{index}]" if index is not None else path
        note: str | None = None

        if self.is_point and section_id != SOMA:
            if path.split(".")[0] not in ("soma", "dend", "axon"):
                raise MorphologyError(
                    f"нечитаемый адрес участка: {address!r}"
                )
            note = (
                f"адрес {address!r} схлопнут в сому: у точечной модели "
                f"{self.name!r} нет отсеков"
            )
            return SOMA, 0.5, note

        if section_id not in self.sections:
            # одиночная ветвь может быть объявлена как dend.apical[0]
            if index is None and f"{path}[0]" in self.sections:
                section_id = f"{path}[0]"
            else:
                known = ", ".join(sorted(self.sections)) or "нет секций"
                raise MorphologyError(
                    f"в морфологии {self.name!r} нет участка {section_id!r} "
                    f"(есть: {known})"
                )

        if frac_text in (None, ""):
            fraction = 0.5
        else:
            fraction = float(frac_text)
            if not 0.0 <= fraction <= 1.0:
                raise MorphologyError(
                    f"доля вдоль участка вне [0,1]: {address!r}"
                )
        return section_id, fraction, note

    def path_to_soma(self, section_id: str, fraction: float) -> float:
        """Длина пути от точки до центра сомы, мкм."""
        section = self.sections[section_id]
        distance = section.length * fraction
        parent = section.parent
        seen = {section_id}
        while parent is not None:
            if parent in seen:
                raise MorphologyError(f"цикл в дереве секций у {section_id!r}")
            seen.add(parent)
            node = self.sections[parent]
            if node.kind == "soma":
                break
            distance += node.length
            parent = node.parent
        return distance

    def attenuation(self, section_id: str, fraction: float) -> float:
        """Пассивное затухание сигнала до сомы, множитель в (0, 1].

        Используется правилом деградации L2 -> L1: на точечной модели
        положение синапса исчезает, и его влияние сворачивается в вес.
        """
        section = self.sections[section_id]
        if section.kind == "soma":
            return 1.0
        distance = self.path_to_soma(section_id, fraction)
        lam = max(section.lambda_dc, 1e-6)
        return float(pow(2.718281828459045, -distance / lam))
