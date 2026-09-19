"""Поиск и фильтры по библиотеке паттернов."""

from pathlib import Path

import pytest

from vnl import ir
from vnl.catalog import Query, facets, haystack, search
from vnl.patterns import LEVEL_NAMES, Pattern, Port
from vnl.resolve import load

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    """Имя может быть с подкаталогом: базовый набор лежит в `examples/library`."""
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


def saved(
    name: str,
    source: str,
    level: str = "L1",
    status: str = "ready",
    entry: str = "IN",
) -> Pattern:
    model, _ = load(example(source))
    return Pattern.from_model(
        model,
        id=name.lower(),
        name=name,
        level=level,
        status=status,
        ports=[Port("in", "in", ir.Site(entry, "soma", 0.5), note="вход схемы")],
    )


@pytest.fixture
def library() -> list[Pattern]:
    return [
        # Ступени тут не для красоты: FFI и растормаживание -- про то, как
        # сигналы взаимодействуют (L1), а цепочка вперёд -- простейшая схема
        # (L0). Две схемы на одной ступени и одна на другой -- ровно то
        # состояние, на котором видно, что фильтр по ступеням складывается «ИЛИ».
        saved("FFI", "ffi", level="L1", status="ready"),
        saved("Растормаживание", "disinhibition", level="L1", status="ready"),
        saved(
            "Возбуждение с опережением",
            "library/feedforward_excitation",
            level="L0",
            status="draft",
            entry="A",
        ),
    ]


def test_an_empty_query_keeps_everything(library):
    assert Query().is_empty
    assert len(search(library, Query())) == 3


def test_search_ignores_case(library):
    found = search(library, Query(text="растормаживание"))
    assert [item.name for item in found] == ["Растормаживание"]


def test_words_may_come_in_any_order(library):
    direct = search(library, Query(text="возбуждение опережением"))
    reverse = search(library, Query(text="опережением возбуждение"))
    assert [item.id for item in direct] == [item.id for item in reverse]
    assert [item.name for item in direct] == ["Возбуждение с опережением"]


def test_search_reaches_what_the_block_is_made_of(library):
    """Блок ищут и по начинке: «pv» -- это тип клетки внутри, а не имя."""
    ffi = next(item for item in library if item.name == "FFI")
    assert "pv" in haystack(ffi)
    assert [item.name for item in search(library, Query(text="pv"))] == ["FFI"]


def test_search_reaches_port_notes(library):
    assert len(search(library, Query(text="вход схемы"))) == 3


def test_chosen_levels_are_an_or(library):
    found = search(library, Query(levels=("L0", "L1")))
    assert len(found) == 3
    assert {item.level for item in found} == {"L0", "L1"}
    assert search(library, Query(levels=("L4",))) == []


def test_level_and_status_are_an_and(library):
    assert search(library, Query(levels=("L0",), statuses=("ready",))) == []
    assert len(search(library, Query(levels=("L0",), statuses=("draft",)))) == 1


def test_text_and_filter_narrow_together(library):
    assert search(library, Query(text="pv", levels=("L0",))) == []
    assert len(search(library, Query(text="pv", levels=("L1",)))) == 1


def test_facets_count_the_whole_library(library):
    counts = facets(library)
    # Пустые ступени тоже перечислены: чип, которого нет в ответе, интерфейс не
    # нарисует, и «L4 (0)» превратилось бы в «такой ступени не бывает».
    assert counts["level"] == {
        "L0": 1,
        "L1": 2,
        "L2": 0,
        "L3": 0,
        "L4": 0,
        "L5": 0,
    }
    assert counts["status"] == {"draft": 1, "ready": 2}


def test_facets_keep_the_order_of_the_steps(library):
    """Порядок групп -- порядок ступеней, и первая ступень -- простейшие схемы.

    Порядок задан в одном месте (`patterns.LEVEL_NAMES`) и приезжает в
    интерфейс ответом каталога: своего списка ступеней у интерфейса нет, иначе
    после правки ступеней на сервере он какое-то время подписывал бы группы
    по-старому.
    """
    assert list(facets(library)["level"]) == list(LEVEL_NAMES)
    assert next(iter(LEVEL_NAMES)) == "L0"
    assert LEVEL_NAMES["L0"] == "Простейшие схемы"
    # Ступени для механизмов в библиотеке нет: свойство одного контакта -- не
    # схема, и место ему в палитре примитивов, а не в каталоге.
    assert "M" not in LEVEL_NAMES


def test_a_list_may_come_repeated_or_comma_separated():
    commas = Query.from_params({"level": ["L0,L1"]})
    repeats = Query.from_params({"level": ["L0", "L1"]})
    assert commas.levels == repeats.levels == ("L0", "L1")


def test_query_string_is_trimmed():
    query = Query.from_params({"q": ["  ffi  "], "status": ["draft, ready"]})
    assert query.text == "ffi"
    assert query.statuses == ("draft", "ready")


def test_search_reaches_the_neuromodulator():
    """Паттерн, вся суть которого в дофамине, обязан находиться по слову «дофамин»."""
    pattern = saved("Растормаживание", "disinhibition", level="L1")
    assert "dopamine" in haystack(pattern)
    assert len(search([pattern], Query(text="dopamine"))) == 1


def test_search_reaches_the_receptor():
    pattern = saved("FFI", "ffi")
    assert len(search([pattern], Query(text="gaba_a"))) == 1
