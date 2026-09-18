"""Разбор числовых литералов с единицами измерения.

Внутренние базовые единицы IR:
    время          мс
    проводимость   нСм
    длина          мкм
    частота        Гц
    ток            нА
    напряжение     мВ
"""

from __future__ import annotations

import re

_NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"
_LITERAL = re.compile(rf"^({_NUM})\s*([a-zA-Zµ%]*)$")

# множитель к базовой единице -> размерность
_UNITS: dict[str, tuple[float, str]] = {
    "s": (1000.0, "time"),
    "ms": (1.0, "time"),
    "us": (1e-3, "time"),
    "µs": (1e-3, "time"),
    "S": (1e9, "conductance"),
    "mS": (1e6, "conductance"),
    "uS": (1e3, "conductance"),
    "µS": (1e3, "conductance"),
    "nS": (1.0, "conductance"),
    "pS": (1e-3, "conductance"),
    "m": (1e6, "length"),
    "mm": (1e3, "length"),
    "um": (1.0, "length"),
    "µm": (1.0, "length"),
    "Hz": (1.0, "frequency"),
    "kHz": (1e3, "frequency"),
    "A": (1e9, "current"),
    "mA": (1e6, "current"),
    "uA": (1e3, "current"),
    "nA": (1.0, "current"),
    "pA": (1e-3, "current"),
    "V": (1e3, "voltage"),
    "mV": (1.0, "voltage"),
}


class UnitError(ValueError):
    pass


def parse_quantity(text: str) -> tuple[float, str | None]:
    """'1.2 ms' -> (1.2, 'time'); '0.5' -> (0.5, None)."""
    m = _LITERAL.match(text.strip())
    if not m:
        raise UnitError(f"не число с единицей: {text!r}")
    value, suffix = float(m.group(1)), m.group(2)
    if not suffix:
        return value, None
    if suffix not in _UNITS:
        raise UnitError(f"неизвестная единица измерения: {suffix!r}")
    factor, dim = _UNITS[suffix]
    return value * factor, dim


def looks_like_quantity(text: str) -> bool:
    return bool(_LITERAL.match(text.strip()))
