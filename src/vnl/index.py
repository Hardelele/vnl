"""Индекс метаданных библиотеки в Postgres.

Правда остаётся в файлах. Паттерн лежит в `patterns/<id>.json`, его читают
глазами, кладут в git и копируют архиватором -- для библиотеки микросхем это
свойство дороже любой базы. Здесь только то, что из файлов выводится: имя,
уровень, статус, счётчики, имена портов, типы клеток и рецепторы внутри и
строка, по которой идёт поиск.

Отсюда правило, которое делает всю затею безопасной: **если базу удалить,
ничего не потеряно**. Она пересобирается обходом каталога (`vnl index
rebuild`), а приложение обязано работать и без неё -- тогда каталог читает
файлы, как читал раньше. Поэтому драйвер Postgres -- необязательный экстра, а
не зависимость ядра: `pip install -e .` по-прежнему ставит инструмент целиком,
и на своей машине он остаётся самодостаточным.

Что база даёт взамен. Каталог перестаёт разбирать все файлы, чтобы ответить на
запрос: сперва спрашиваем, какие id подходят, и разбираем только их. И
появляются вопросы поверх библиотеки, на которые обход отвечать не умеет:
где используется `gaba_b`, в каких песочницах стоит этот паттерн, что менялось
за неделю.

Чего база не решает -- конкурентную запись. Файл сохраняется целиком, и при
двух писателях последний затрёт чужое; лечится это блокировкой и проверкой
версии при сохранении, а не индексом.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Iterable

from .catalog import Query, haystack
from .patterns import Pattern

#: Переменная окружения со строкой подключения. Пароль в коде не живёт.
DSN_ENV = "VNL_INDEX_DSN"

SCHEMA = """
create table if not exists patterns (
    id          text primary key,
    name        text not null,
    level       text not null,
    status      text not null,
    neurons     integer not null,
    contacts    integer not null,
    ports       integer not null,
    port_names  text[] not null default '{}',
    cell_types  text[] not null default '{}',
    receptors   text[] not null default '{}',
    updated_at  text not null,
    -- Та же строка, по которой ищет `catalog.haystack`: семантика отбора
    -- одна на файловый обход и на базу, иначе «подходит» разойдётся.
    haystack    text not null
);

create index if not exists patterns_level_status on patterns (level, status);
"""


class IndexUnavailable(RuntimeError):
    """Индекс недоступен. Это не повод падать: каталог умеет и без него."""


@dataclass(frozen=True)
class Row:
    """Строка индекса -- ровно то, что выводится из файла паттерна."""

    id: str
    name: str
    level: str
    status: str
    neurons: int
    contacts: int
    ports: int
    port_names: list[str]
    cell_types: list[str]
    receptors: list[str]
    updated_at: str
    haystack: str


def row_of(pattern: Pattern) -> Row:
    """Что от паттерна попадает в индекс.

    Тела, витрины и позиций здесь нет намеренно: всё, что нельзя вывести из
    файла заново, в индексе означало бы вторую правду.
    """
    return Row(
        id=pattern.id,
        name=pattern.name,
        level=pattern.level,
        status=pattern.status,
        neurons=len(pattern.body.instances),
        contacts=len(pattern.body.contacts),
        ports=len(pattern.ports),
        port_names=[port.name for port in pattern.ports],
        cell_types=sorted(pattern.body.cell_types),
        receptors=sorted({contact.receptor for contact in pattern.body.contacts}),
        updated_at=pattern.updated_at,
        haystack=haystack(pattern),
    )


def where_of(query: Query) -> tuple[str, list[Any]]:
    """Отбор из `catalog.Query` в условие SQL.

    Условия те же, что в `catalog.matches`: слова ищутся все и в любом порядке,
    уровни складываются через ИЛИ между собой и через И со статусами.
    """
    clauses: list[str] = []
    params: list[Any] = []
    if query.levels:
        clauses.append("level = any(%s)")
        params.append(list(query.levels))
    if query.statuses:
        clauses.append("status = any(%s)")
        params.append(list(query.statuses))
    for word in query.text.lower().split():
        clauses.append("haystack like %s")
        params.append(f"%{word}%")
    return (" and ".join(clauses) if clauses else "true"), params


class Index:
    """Соединение с индексом. Создаётся лениво: без базы инструмент работает."""

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        self._connection: Any = None

    @staticmethod
    def from_env() -> "Index | None":
        dsn = os.environ.get(DSN_ENV)
        return Index(dsn) if dsn else None

    def _connect(self) -> Any:
        if self._connection is not None and not self._connection.closed:
            return self._connection
        try:
            import psycopg
        except ImportError as exc:  # pragma: no cover -- зависит от установки
            raise IndexUnavailable(
                "драйвер Postgres не установлен: pip install 'vnl[index]'"
            ) from exc
        try:
            self._connection = psycopg.connect(self.dsn, autocommit=True)
        except Exception as exc:
            raise IndexUnavailable(f"индекс недоступен: {exc}") from exc
        return self._connection

    def close(self) -> None:
        if self._connection is not None and not self._connection.closed:
            self._connection.close()
        self._connection = None

    # --- запись -----------------------------------------------------------

    def ensure_schema(self) -> None:
        with self._connect().cursor() as cursor:
            cursor.execute(SCHEMA)

    def upsert(self, pattern: Pattern) -> None:
        row = row_of(pattern)
        with self._connect().cursor() as cursor:
            cursor.execute(
                """
                insert into patterns (id, name, level, status, neurons, contacts,
                                      ports, port_names, cell_types, receptors,
                                      updated_at, haystack)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                    name = excluded.name,
                    level = excluded.level,
                    status = excluded.status,
                    neurons = excluded.neurons,
                    contacts = excluded.contacts,
                    ports = excluded.ports,
                    port_names = excluded.port_names,
                    cell_types = excluded.cell_types,
                    receptors = excluded.receptors,
                    updated_at = excluded.updated_at,
                    haystack = excluded.haystack
                """,
                (
                    row.id,
                    row.name,
                    row.level,
                    row.status,
                    row.neurons,
                    row.contacts,
                    row.ports,
                    row.port_names,
                    row.cell_types,
                    row.receptors,
                    row.updated_at,
                    row.haystack,
                ),
            )

    def forget(self, pattern_id: str) -> None:
        with self._connect().cursor() as cursor:
            cursor.execute("delete from patterns where id = %s", (pattern_id,))

    def rebuild(self, patterns: Iterable[Pattern]) -> int:
        """Собрать индекс заново. Единственный способ починить расхождение."""
        self.ensure_schema()
        count = 0
        with self._connect().cursor() as cursor:
            cursor.execute("delete from patterns")
        for pattern in patterns:
            self.upsert(pattern)
            count += 1
        return count

    # --- чтение -----------------------------------------------------------

    def search(self, query: Query) -> list[str]:
        """Идентификаторы подходящих паттернов, новые сверху."""
        where, params = where_of(query)
        with self._connect().cursor() as cursor:
            cursor.execute(
                f"select id from patterns where {where} order by updated_at desc",
                params,
            )
            return [row[0] for row in cursor.fetchall()]

    def facets(self) -> dict[str, dict[str, int]]:
        """Счётчики чипов одним запросом вместо обхода всей библиотеки."""
        out: dict[str, dict[str, int]] = {"level": {}, "status": {}}
        with self._connect().cursor() as cursor:
            for column in ("level", "status"):
                cursor.execute(
                    f"select {column}, count(*) from patterns group by {column}"
                )
                out[column] = {name: int(number) for name, number in cursor.fetchall()}
        return out

    def size(self) -> int:
        with self._connect().cursor() as cursor:
            cursor.execute("select count(*) from patterns")
            row = cursor.fetchone()
            return int(row[0]) if row else 0

    def state(self, files: int) -> dict[str, Any]:
        """Живое состояние индекса для `/api/health`.

        Число строк сравнивается с числом файлов: расхождение значит, что
        кто-то правил хранилище мимо приложения, и нужен `vnl index rebuild`.
        Молча подстраиваться нельзя -- это скрыло бы потерю.
        """
        try:
            rows = self.size()
        except IndexUnavailable as exc:
            return {"connected": False, "reason": str(exc)}
        return {"connected": True, "rows": rows, "stale": rows != files}
