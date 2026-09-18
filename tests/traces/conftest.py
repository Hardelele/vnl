"""Общая оснастка тестов блока трасс.

Прогон примера стоит секунды, а нужен почти каждому тесту, поэтому он
считается один раз на сессию и раздаётся фикстурой.
"""

from pathlib import Path

import pytest

from vnl import traces
from vnl.resolve import load
from vnl.sim import simulate

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


def read_example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def example():
    """Исходник примера по имени."""
    return read_example


@pytest.fixture(scope="session")
def block_for():
    """Фабрика: имя примера -> (модель, результат, готовый HTML блока)."""
    cache: dict[str, tuple] = {}

    def build(name: str):
        if name not in cache:
            model, _ = load(read_example(name))
            result = simulate(model)
            cache[name] = (model, result, traces.render(model, result))
        return cache[name]

    return build
