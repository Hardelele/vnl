"""Сверка заявленных чисел с прогоном (#501).

Шапка каждого файла в `examples/library` доказывает паттерн числом: «выход
пирамиды падает с 13 спайков до 6», «пики g падают с 0.685 до 0.055 нСм».
Пока это только комментарий, число держится на доверии: движок меняется, число
остаётся, и расходятся они молча. Так и вышло с #568 -- событийный стимул бил
вдвое сильнее написанного, и восемь шапок врали, пока ошибку не нашли
случайно.

Здесь то же утверждение записано оператором `expect` и сверяется прогоном.
Модуль ничего не печатает и не падает сам: он возвращает список проверок с
готовыми человеческими сообщениями, а решает, что с ними делать, вызывающий --
тест, командная строка или карточка.

Почему сверка живёт отдельно от `sim`. Симулятор считает, а не судит: знание о
том, что такое «пик четвёртого спайка» и «среднее в окне», -- это про чтение
результата, и держать его в солвере значило бы, что всякая новая мерка требует
правки движка.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from . import ir
from .sim import SimResult, simulate
from .sweep import Sweep, run_sweep


@dataclass
class Check:
    """Одна сверка: что заявлено, что посчитано, сошлось ли."""

    expectation: ir.Expectation
    actual: tuple[float, ...]
    ok: bool
    message: str

    def __str__(self) -> str:
        return self.message


class ExpectationError(ValueError):
    """Ожидание нельзя посчитать: не с чем сверять."""


def _window(
    times: Iterable[float], values: Iterable[float], start: float, stop: float
) -> list[float]:
    return [value for time, value in zip(times, values) if start <= time < stop]


def _peaks(values: list[float]) -> list[float]:
    """Локальные максимумы трассы -- то, что в шапках зовут «пиками».

    Пик синаптической проводимости -- отсчёт сразу после прихода спайка, до
    начала спада. Условие строгое слева и нестрогое справа: у ступеньки,
    постоявшей два отсчёта, пик один, а не два.
    """
    out: list[float] = []
    for index in range(1, len(values) - 1):
        if values[index] > values[index - 1] and values[index] >= values[index + 1]:
            out.append(values[index])
    return out


def _spike_times(
    result: SimResult, expectation: ir.Expectation
) -> list[float]:
    times = result.spikes.get(expectation.target)
    if times is None:
        raise ExpectationError(
            f"нейрона {expectation.target} нет в растре прогона"
        )
    return [t for t in times if expectation.start <= t < expectation.stop]


def _trace_values(result: SimResult, expectation: ir.Expectation) -> list[float]:
    values = result.traces.get(expectation.target)
    if values is None:
        raise ExpectationError(
            f"трассы {expectation.target} нет в прогоне: величина не записана"
        )
    part = _window(result.times, values, expectation.start, expectation.stop)
    if not part:
        raise ExpectationError(
            f"в окне {_window_text(expectation)} нет ни одного отсчёта "
            f"{expectation.target}"
        )
    return part


def _window_text(expectation: ir.Expectation) -> str:
    stop = "до конца" if expectation.stop == float("inf") else f"{expectation.stop:g}"
    return f"{expectation.start:g}..{stop} мс"


def measure(result: SimResult, expectation: ir.Expectation) -> float:
    """Посчитать заявленную величину по одному прогону."""
    name = expectation.measure
    if name in ir.NEURON_MEASURES:
        times = _spike_times(result, expectation)
        if name == "spikes":
            return float(len(times))
        if not times:
            raise ExpectationError(
                f"у {expectation.target} нет спайков в окне "
                f"{_window_text(expectation)}"
            )
        if name == "first_spike":
            return times[0]
        if name == "last_spike":
            return times[-1]
        intervals = [b - a for a, b in zip(times, times[1:])]
        if not intervals:
            raise ExpectationError(
                f"у {expectation.target} один спайк: межспайкового интервала нет"
            )
        return intervals[0] if name == "first_isi" else intervals[-1]

    values = _trace_values(result, expectation)
    if name == "max":
        return max(values) - expectation.base
    if name == "min":
        return min(values) - expectation.base
    if name == "mean":
        return sum(values) / len(values) - expectation.base
    if name == "final":
        return values[-1] - expectation.base
    if name == "time_above":
        # Строго выше уровня и по числу отсчётов: так же, как это считали
        # руками, когда снимали плато NMDA для шапки.
        return sum(1 for value in values if value > expectation.level) * result.dt
    if name == "peak":
        peaks = _peaks(values)
        if len(peaks) < expectation.index:
            raise ExpectationError(
                f"у {expectation.target} в окне {_window_text(expectation)} "
                f"{len(peaks)} пиков, а спрошен {expectation.index}-й"
            )
        return peaks[expectation.index - 1] - expectation.base
    raise ExpectationError(f"неизвестная величина {name!r}")


def _show(value: float, expectation: ir.Expectation) -> str:
    """Посчитанное теми же единицами и с той же точностью, какими заявлено."""
    written = value / expectation.factor
    digits = 0
    tolerance = expectation.tolerance / expectation.factor
    while digits < 9 and 10.0**-digits > tolerance * 2:
        digits += 1
    text = f"{written:.{digits}f}" if digits else f"{written:.4g}"
    return f"{text}{expectation.unit}"


def _compare(
    expectation: ir.Expectation, actual: tuple[float, ...]
) -> tuple[bool, list[int]]:
    """Сошлось ли, и если нет -- какие места ряда разошлись."""
    bad: list[int] = []
    for index, (want, got) in enumerate(zip(expectation.values, actual)):
        if expectation.measure == "spikes":
            # Допуска нет нарочно: спайк целый, «почти 6» не бывает.
            ok = round(got) == round(want)
        else:
            ok = abs(got - want) <= expectation.tolerance
        if not ok:
            bad.append(index)
    return not bad, bad


def check(
    model: ir.Model,
    expectation: ir.Expectation,
    result: SimResult,
    sweeps: dict[str, Sweep] | None = None,
) -> Check:
    """Свести одно ожидание с прогоном (и, если оно про развёртку, с ней)."""
    prefix = f"{model.name}: {expectation.text}"
    try:
        if expectation.sweep:
            sweep = (sweeps or {}).get(expectation.sweep) or run_sweep(
                model, expectation.sweep
            )
            actual = tuple(
                measure(variant.result, expectation) for variant in sweep.variants
            )
            labels = [variant.label for variant in sweep.variants]
        else:
            actual = (measure(result, expectation),)
            labels = []
    except ExpectationError as exc:
        return Check(expectation, (), False, f"{prefix} -- {exc}")

    ok, bad = _compare(expectation, actual)
    if ok:
        return Check(expectation, actual, True, f"{prefix} -- сошлось")

    want = ", ".join(_show(value, expectation) for value in expectation.values)
    got = ", ".join(_show(value, expectation) for value in actual)
    message = f"{prefix} ожидалось {want}, получено {got}"
    if labels:
        message += f" (разошлись варианты: {', '.join(labels[i] for i in bad)})"
    if expectation.measure != "spikes":
        message += f"; допуск {_show(expectation.tolerance, expectation)}"
    if expectation.start or expectation.stop != float("inf"):
        message += f"; окно {_window_text(expectation)}"
    return Check(expectation, actual, False, message)


def check_model(model: ir.Model, result: SimResult | None = None) -> list[Check]:
    """Свести все ожидания модели с прогоном.

    Развёртки считаются по одной на спецификацию, а не по одной на ожидание:
    у `ffi` на развёртке по весу висят три утверждения (E, IN и I), и три
    одинаковых прогона стоили бы втрое дороже ни за что.
    """
    if result is None:
        result = simulate(model)
    sweeps: dict[str, Sweep] = {}
    for expectation in model.expectations:
        if expectation.sweep and expectation.sweep not in sweeps:
            sweeps[expectation.sweep] = run_sweep(model, expectation.sweep)
    return [
        check(model, expectation, result, sweeps) for expectation in model.expectations
    ]


def failures(checks: Iterable[Check]) -> list[str]:
    """Сообщения о расхождениях -- то, что показывают человеку."""
    return [item.message for item in checks if not item.ok]
