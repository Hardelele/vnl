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
from decimal import Decimal

_NUM =r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"
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


def unit_factor(suffix: str) -> float:
    """Во сколько базовых единиц обходится одна написанная (`'nS'` -> 1.0).

    Обратный перевод нужен, чтобы показать посчитанное теми же единицами,
    какими написано ожидание: «получено 0.700 нСм» читается, «получено
    0.7000000000000001» -- нет.
    """
    if not suffix:
        return 1.0
    if suffix not in _UNITS:
        raise UnitError(f"неизвестная единица измерения: {suffix!r}")
    return _UNITS[suffix][0]


def looks_like_quantity(text: str) -> bool:
    return bool(_LITERAL.match(text.strip()))


def written_precision(text: str) -> float:
    """Половина последнего написанного разряда, в базовых единицах.

    `'2.09nS'` -> 0.005, `'24.4ms'` -> 0.05, `'2.5171nS'` -> 0.00005.

    Нужна там, где число сверяют с прогоном (#501). Заявленный результат
    записан с той точностью, с какой его сняли: «пик g 0.685 нСм» -- это
    утверждение про тысячные, а не про десятимиллионные. Допуск, взятый из
    написанного, держит точность в одном месте -- рядом с числом.
    Альтернатива -- общий допуск в коде проверки -- сводит все числа к одной
    мерке: для `0.685` она либо слишком груба (и проверка пропустит сдвиг),
    либо слишком строга для `24.4` (и проверка станет краснеть на последнем
    знаке двоичной дроби).
    """
    m = _LITERAL.match(text.strip())
    if not m:
        raise UnitError(f"не число с единицей: {text!r}")
    number, suffix = m.group(1), m.group(2)
    exponent = Decimal(number).as_tuple().exponent
    if not isinstance(exponent, int):  # nan/inf -- до сюда не доходят
        raise UnitError(f"не число: {text!r}")
    factor = _UNITS[suffix][0] if suffix in _UNITS else 1.0
    return float(Decimal(10) ** exponent) / 2.0 * factor
