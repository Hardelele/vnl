"""Библиотека: поиск и фильтры по сохранённым паттернам.

Отбор живёт в Python, а не в интерфейсе. Ту же библиотеку теми же словами
спрашивает Claude через MCP, и если фильтр окажется в React, слово «подходит»
станет значить в двух местах разное. Расхождение такого рода замечают не по
ошибке на экране, а по странному ответу через неделю.

В поиск попадают имя и идентификатор паттерна, имена и подписи портов,
идентификаторы нейронов и типов клеток, рецепторы контактов и нейромодуляторы
внутри. Поэтому «pv» находит и паттерн
с таким именем, и микросхему, внутри которой стоит PV-интернейрон: искать блок
по тому, из чего он собран, -- обычное дело, а другого способа для этого нет.

Уровень каталога -- про ступень разбора (`patterns.LEVEL_NAMES`: механизмы,
простейшие схемы, взаимодействие сигналов и так далее), статус -- про
готовность. Фильтры по ним независимы и складываются: выбранные уровни ИЛИ
между собой, но И с выбранными статусами.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping, Sequence

from .patterns import LEVEL_NAMES, Pattern

STATUS_NAMES: dict[str, str] = {
    "draft": "Черновик",
    "ready": "Готов",
}


def _split(values: Sequence[str]) -> tuple[str, ...]:
    """`level=M,L0` и `level=M&level=L0` -- одно и то же.

    Интерфейс собирает строку запроса из набора чипов, командная строка -- из
    одного аргумента. Принимать обе записи дешевле, чем договариваться.
    """
    out: list[str] = []
    for value in values:
        out.extend(part.strip() for part in value.split(",") if part.strip())
    return tuple(out)


@dataclass(frozen=True)
class Query:
    """Что спросили у библиотеки."""

    text: str = ""
    levels: tuple[str, ...] = ()
    statuses: tuple[str, ...] = ()

    @property
    def is_empty(self) -> bool:
        return not (self.text.strip() or self.levels or self.statuses)

    @staticmethod
    def from_params(params: Mapping[str, Sequence[str]]) -> "Query":
        text = " ".join(_split(params.get("q", ()))) if params.get("q") else ""
        return Query(
            text=text.strip(),
            levels=_split(params.get("level", ())),
            statuses=_split(params.get("status", ())),
        )


def haystack(pattern: Pattern) -> str:
    """Всё, по чему паттерн можно найти, одной строкой в нижнем регистре."""
    parts: list[str] = [pattern.id, pattern.name, pattern.level, pattern.level_name]
    for port in pattern.ports:
        parts.extend((port.name, port.note))
    parts.extend(pattern.body.instances)
    for cell_type in pattern.body.cell_types.values():
        parts.append(cell_type.id)
        parts.extend(cell_type.tags)
    # Нейромодулятор -- половина смысла тех паттернов, где он есть: без него
    # «дофамин» не находил бы схему, вся суть которой в дофамине.
    for modulator in pattern.body.modulators.values():
        parts.extend((modulator.id, modulator.transmitter))
    parts.extend(
        contact.receptor for contact in pattern.body.contacts
    )
    return " ".join(part for part in parts if part).lower()


def matches(pattern: Pattern, query: Query) -> bool:
    if query.levels and pattern.level not in query.levels:
        return False
    if query.statuses and pattern.status not in query.statuses:
        return False
    if not query.text:
        return True
    # Слова ищутся все и в любом порядке: «ffi тормоз» должно находить то же,
    # что «тормоз ffi», иначе порядок набора становится частью запроса.
    text = haystack(pattern)
    return all(word in text for word in query.text.lower().split())


def search(patterns: Iterable[Pattern], query: Query) -> list[Pattern]:
    """Отобранное, порядок хранилища сохраняется (новое сверху)."""
    return [pattern for pattern in patterns if matches(pattern, query)]


def facets(patterns: Iterable[Pattern]) -> dict[str, dict[str, int]]:
    """Сколько паттернов за каждым чипом фильтра.

    Считается по всей библиотеке, а не по отобранному: чип, который показывал
    бы ноль ровно потому, что сам не выбран, ничего не сообщает.
    """
    levels = {level: 0 for level in LEVEL_NAMES}
    statuses = {status: 0 for status in STATUS_NAMES}
    for pattern in patterns:
        levels[pattern.level] = levels.get(pattern.level, 0) + 1
        statuses[pattern.status] = statuses.get(pattern.status, 0) + 1
    return {"level": levels, "status": statuses}
