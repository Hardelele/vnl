"""Индекс метаданных: что в него попадает, как он отбирает и что без него.

База здесь не нужна: проверяется то, что в базу уходит, и то, что приложение
переживает её отсутствие. Запросы к живому Postgres -- отдельный прогон, он
включается переменной `VNL_INDEX_DSN` и в обычном прогоне пропускается.
"""

import os
from pathlib import Path

import pytest

from vnl import ir
from vnl.catalog import Query, matches, search
from vnl.index import Index, IndexUnavailable, row_of, where_of
from vnl.patterns import Pattern, Port
from vnl.resolve import load
from vnl.server import Api
from vnl.store import Store

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def saved(
    name: str,
    source: str,
    level: str = "L1",
    status: str = "ready",
    entry: str = "IN",
) -> Pattern:
    model, _ = load((EXAMPLES / f"{source}.vnl").read_text(encoding="utf-8"))
    return Pattern.from_model(
        model,
        id=name.lower(),
        name=name,
        level=level,
        status=status,
        ports=[Port("in", "in", ir.Site(entry, "soma", 0.5), note="вход схемы")],
    )


@pytest.fixture
def ffi() -> Pattern:
    return saved("FFI", "ffi")


def test_the_row_holds_only_what_files_can_give_back(ffi):
    row = row_of(ffi)
    assert row.id == "ffi"
    assert row.neurons == 3 and row.contacts == 3 and row.ports == 1
    assert row.port_names == ["in"]
    assert "pv" in row.cell_types
    assert "gaba_a" in row.receptors
    # Ни тела, ни витрины, ни позиций: всё, что нельзя вывести заново, в
    # индексе означало бы вторую правду.
    assert not hasattr(row, "body")
    assert not hasattr(row, "demo")


def test_the_search_string_is_the_same_one_the_files_use(ffi):
    from vnl.catalog import haystack

    assert row_of(ffi).haystack == haystack(ffi)


def test_an_empty_query_selects_everything():
    where, params = where_of(Query())
    assert where == "true"
    assert params == []


def test_filters_become_conditions():
    where, params = where_of(Query(levels=("L1", "L2"), statuses=("ready",)))
    assert where == "level = any(%s) and status = any(%s)"
    assert params == [["L1", "L2"], ["ready"]]


def test_every_word_becomes_its_own_condition():
    """Слова ищутся все и в любом порядке -- как и при обходе файлов."""
    where, params = where_of(Query(text="Прямое Торможение"))
    assert where == "haystack like %s and haystack like %s"
    assert params == ["%прямое%", "%торможение%"]


def test_the_conditions_repeat_the_file_rules(ffi):
    """Правило отбора одно. Если разойдутся -- «подходит» станет значить разное."""
    checks = [
        Query(text="pv"),
        Query(text="ffi торможение"),
        Query(levels=("L1",)),
        Query(levels=("L2",), statuses=("ready",)),
        Query(statuses=("draft",)),
    ]
    for query in checks:
        by_files = matches(ffi, query)
        row = row_of(ffi)
        by_index = (
            (not query.levels or row.level in query.levels)
            and (not query.statuses or row.status in query.statuses)
            and all(word in row.haystack for word in query.text.lower().split())
        )
        assert by_files == by_index, query


class Broken:
    """Индекс, который не отвечает. Ровно то, что бывает с чужой машиной."""

    def search(self, query):
        raise IndexUnavailable("соединение потеряно")

    def facets(self):
        raise IndexUnavailable("соединение потеряно")

    def size(self):
        raise IndexUnavailable("соединение потеряно")

    def upsert(self, pattern):
        raise IndexUnavailable("соединение потеряно")

    def forget(self, pattern_id):
        raise IndexUnavailable("соединение потеряно")

    def state(self, files):
        return {"connected": False, "reason": "соединение потеряно"}


class Fake:
    """Индекс, который отвечает. Позволяет проверить путь через базу без базы."""

    def __init__(self, patterns):
        self.rows = [row_of(pattern) for pattern in patterns]

    def search(self, query):
        chosen = [row for row in self.rows if self._ok(row, query)]
        return [row.id for row in chosen]

    @staticmethod
    def _ok(row, query):
        return (
            (not query.levels or row.level in query.levels)
            and (not query.statuses or row.status in query.statuses)
            and all(word in row.haystack for word in query.text.lower().split())
        )

    def facets(self):
        counts: dict[str, dict[str, int]] = {"level": {}, "status": {}}
        for row in self.rows:
            counts["level"][row.level] = counts["level"].get(row.level, 0) + 1
            counts["status"][row.status] = counts["status"].get(row.status, 0) + 1
        return counts

    def size(self):
        return len(self.rows)


def test_a_broken_index_is_not_a_broken_catalog(tmp_path, ffi, capsys):
    store = Store(tmp_path)
    store.save_pattern(ffi)
    service = Api(store, index=Broken())

    payload = service.catalog({})

    assert payload["total"] == 1, "каталог прочитан из файлов"
    assert payload["patterns"][0]["id"] == "ffi"
    assert "файлов" in capsys.readouterr().err, "отказ индекса назван, а не скрыт"


def test_a_broken_index_does_not_break_saving(tmp_path, ffi, capsys):
    """Файл -- правда. Индекс не смог записаться -- это не повод терять паттерн."""
    store = Store(tmp_path, index=Broken())
    store.save_pattern(ffi)

    assert store.load_pattern("ffi").name == "FFI"
    assert "индекс не обновлён" in capsys.readouterr().err


def test_through_the_index_only_the_chosen_files_are_read(tmp_path, ffi):
    other = saved(
        "Возбуждение с опережением",
        "library/feedforward_excitation",
        level="L0",
        entry="A",
    )
    store = Store(tmp_path)
    store.save_pattern(ffi)
    store.save_pattern(other)
    service = Api(store, index=Fake([ffi, other]))

    payload = service.catalog({"level": ["L0"]})

    assert payload["matched"] == 1
    assert payload["patterns"][0]["id"] == "возбуждение с опережением"
    assert payload["total"] == 2, "всего в библиотеке -- из индекса, а не из отбора"


def test_the_index_and_the_files_agree(tmp_path, ffi):
    other = saved(
        "Возбуждение с опережением",
        "library/feedforward_excitation",
        level="L0",
        entry="A",
    )
    store = Store(tmp_path)
    store.save_pattern(ffi)
    store.save_pattern(other)
    fake = Fake([ffi, other])

    for query in (Query(), Query(text="pv"), Query(levels=("L1",))):
        by_index = sorted(fake.search(query))
        by_files = sorted(item.id for item in search(store.patterns(), query))
        assert by_index == by_files, query


@pytest.mark.skipif(
    not os.environ.get("VNL_INDEX_TEST_DSN"),
    reason="живой Postgres: задайте VNL_INDEX_TEST_DSN",
)
def test_a_live_index_round_trip(tmp_path, ffi):
    """Прогон против настоящей базы.

    Переменная отдельная от рабочей (`VNL_INDEX_DSN`) намеренно: тест
    пересобирает таблицу с нуля и в конце оставляет её пустой. Направь его на
    рабочий индекс -- и каталог останется без строк до следующей пересборки.
    """
    index = Index(os.environ["VNL_INDEX_TEST_DSN"])
    try:
        index.rebuild([ffi])
        assert index.size() == 1
        assert index.search(Query(text="pv")) == ["ffi"]
        assert index.search(Query(levels=("L1",))) == []
        index.forget("ffi")
        assert index.size() == 0
    finally:
        index.close()
