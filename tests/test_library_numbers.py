"""Числа библиотеки проверяются прогоном, а не доверием (#501).

Каждый файл в `examples/library` доказывает свой паттерн числом в шапке: «выход
пирамиды падает с 13 спайков до 6», «пики g падают с 0.685 до 0.055 нСм», «вес
уходит на 2.5171 нСм». До этой задачи числа жили только в комментарии, то есть
не проверялись ничем. Цена такого устройства уже известна: #568 (событийный
стимул доставлялся дважды) прожила долго, нашлась случайно, и восемь шапок всё
это время утверждали неправду молча.

Здесь каждое такое утверждение записано оператором `expect` в самом `.vnl` и
сверяется прогоном. Разбор величин -- `vnl.expectations`, синтаксис -- он же и
`parser._stmt_expect`.

Почему обычный набор, а не медленный. Полная сверка -- 22 прогона плюс десять
развёрток, 4.0 с на этой машине против 120 с всего набора. Смысл проверки в
том, что она идёт при каждой правке солвера; вынеси её по расписанию -- и
регрессия доживёт до следующего запуска по расписанию.

Про воспроизводимость. Все паттерны фиксируют `seed`, и пуассоновский драйв
повторяется от запуска к запуску: числа сняты на CPython 3.11/Windows.
`random.Random` -- Mersenne Twister со стабильной реализацией, `gauss` здесь не
используется, арифметика двойной точности -- поэтому счёт спайков обязан
совпадать всюду. Если на другой платформе разойдётся последний знак у величин с
трасс, допуск пишется в самом ожидании (`tol=`), а не появляется общим
послаблением в коде: послабление сняло бы проверку сразу со всех чисел.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import pytest

from vnl.expectations import check_model, failures
from vnl.patterns import Pattern
from vnl.resolve import load
from vnl.store import from_plain, to_plain

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "examples" / "library"
CATALOG = ROOT / ".vnl" / "patterns"

NAMES = sorted(path.stem for path in LIBRARY.glob("*.vnl"))


def _model(name: str):
    text = (LIBRARY / f"{name}.vnl").read_text(encoding="utf-8")
    return load(text, source=f"examples/library/{name}.vnl", strict=True)


def test_the_library_is_not_empty():
    """Пустая выборка молча сделала бы зелёными все проверки ниже."""
    assert len(NAMES) >= 20, NAMES


@pytest.mark.parametrize("name", NAMES)
def test_pattern_claims_its_numbers(name):
    """У каждого паттерна есть заявленные числа.

    Без этой проверки двадцать третий паттерн приедет без `expect`, сверять у
    него будет нечего, и набор об этом промолчит -- то самое молчание, ради
    которого задача и заводилась.
    """
    model, _ = _model(name)
    assert model.expectations, (
        f"{name}: в файле нет блока expect -- числа шапки никем не проверяются"
    )


@pytest.mark.parametrize("name", NAMES)
def test_pattern_numbers_match_the_run(name):
    model, diagnostics = _model(name)
    assert not [d for d in diagnostics if d.severity == "error"], [
        str(d) for d in diagnostics
    ]
    problems = failures(check_model(model))
    assert not problems, "\n".join(problems)


def test_catalog_cards_show_what_the_sources_say():
    """Карточка в каталоге и исходник в репозитории -- одно и то же.

    `.vnl/patterns/*.json` -- то, что показывает интерфейс; `examples/library`
    -- то, что ревьюят. Разойтись они могут молча: карточка откроется и покажет
    графики, а схема внутри будет другой.

    Хранилище лежит в `.gitignore`: это локальное состояние машины, а не
    содержимое репозитория. Поэтому проверка сверяет то, что в нём есть, а
    отсутствие целиком -- законное состояние чистой выкладки, не отказ.
    """
    if not CATALOG.exists():
        pytest.skip("каталог не заведён (.vnl в .gitignore) -- сверять нечего")

    problems: list[str] = []
    missing: list[str] = []
    for name in NAMES:
        card = CATALOG / f"{name}.json"
        if not card.exists():
            missing.append(name)
            continue
        stored = from_plain(Pattern, json.loads(card.read_text(encoding="utf-8")))
        model, _ = _model(name)
        fresh = Pattern.from_model(model, id=stored.id, name=stored.name)
        if to_plain(stored.body) != to_plain(fresh.body):
            problems.append(
                f"{name}: тело карточки разошлось с examples/library/{name}.vnl"
            )
        if stored.validate():
            problems.append(f"{name}: карточка не готова -- {stored.validate()}")
        if stored.status != "ready":
            problems.append(f"{name}: статус карточки {stored.status!r}, а не ready")
    assert not problems, "\n".join(problems)
    if missing:
        # Не отказ: паттерн кладут в каталог руками (`vnl add --port`), и
        # свежесобранного порта у проверки нет -- придумывать его она не вправе.
        warnings.warn(
            UserWarning(
                "в локальном каталоге нет карточек: " + ", ".join(missing)
            ),
            stacklevel=1,
        )
