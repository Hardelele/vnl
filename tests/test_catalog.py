"""Поиск и фильтры по библиотеке паттернов."""

from pathlib import Path

import pytest

from vnl import ir
from vnl.catalog import Query, facets, haystack, search
from vnl.patterns import Pattern, Port
from vnl.resolve import load

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


def saved(name: str, source: str, level: str = "L2", status: str = "ready") -> Pattern:
    model, _ = load(example(source))
    return Pattern.from_model(
        model,
        id=name.lower(),
        name=name,
        level=level,
        status=status,
        ports=[Port("in", "in", ir.Site("IN", "soma", 0.5), note="вход схемы")],
    )


@pytest.fixture
def library() -> list[Pattern]:
    return [
        saved("FFI", "ffi", level="L2", status="ready"),
        saved("Растормаживание", "disinhibition", level="L3", status="draft"),
        saved("Депрессия контакта", "depression", level="L1", status="ready"),
    ]


def test_an_empty_query_keeps_everything(library):
    assert Query().is_empty
    assert len(search(library, Query())) == 3


def test_search_ignores_case(library):
    found = search(library, Query(text="растормаживание"))
    assert [item.name for item in found] == ["Растормаживание"]


def test_words_may_come_in_any_order(library):
    direct = search(library, Query(text="депрессия контакта"))
    reverse = search(library, Query(text="контакта депрессия"))
    assert [item.id for item in direct] == [item.id for item in reverse]
    assert [item.name for item in direct] == ["Депрессия контакта"]


def test_search_reaches_what_the_block_is_made_of(library):
    """Блок ищут и по начинке: «pv» -- это тип клетки внутри, а не имя."""
    ffi = next(item for item in library if item.name == "FFI")
    assert "pv" in haystack(ffi)
    assert [item.name for item in search(library, Query(text="pv"))] == ["FFI"]


def test_search_reaches_port_notes(library):
    assert len(search(library, Query(text="вход схемы"))) == 3


def test_chosen_levels_are_an_or(library):
    found = search(library, Query(levels=("L1", "L3")))
    assert {item.level for item in found} == {"L1", "L3"}


def test_level_and_status_are_an_and(library):
    assert search(library, Query(levels=("L3",), statuses=("ready",))) == []
    assert len(search(library, Query(levels=("L3",), statuses=("draft",)))) == 1


def test_text_and_filter_narrow_together(library):
    assert search(library, Query(text="pv", levels=("L1",))) == []
    assert len(search(library, Query(text="pv", levels=("L2",)))) == 1


def test_facets_count_the_whole_library(library):
    counts = facets(library)
    assert counts["level"] == {"L1": 1, "L2": 1, "L3": 1}
    assert counts["status"] == {"draft": 1, "ready": 2}


def test_a_list_may_come_repeated_or_comma_separated():
    commas = Query.from_params({"level": ["L1,L2"]})
    repeats = Query.from_params({"level": ["L1", "L2"]})
    assert commas.levels == repeats.levels == ("L1", "L2")


def test_query_string_is_trimmed():
    query = Query.from_params({"q": ["  ffi  "], "status": ["draft, ready"]})
    assert query.text == "ffi"
    assert query.statuses == ("draft", "ready")
