"""Хранилище библиотеки и песочниц.

Файлы на диске: `patterns/<id>.json` и `sandboxes/<id>.json`. Формат -- точное
отражение структур из `patterns.py`, чтобы чтение возвращало ровно то, что
записали. Это не формат обмена с интерфейсом (тот живёт в `api.py` и отдаёт
округлённое и удобное для чтения), а способ ничего не потерять.

Сериализация идёт по объявленным полям dataclass-ов: добавили поле -- оно
сохраняется само. Заводить рядом вторую руками писанную схему значило бы
обязательно однажды забыть её обновить.

Сохранение атомарное: сначала временный файл, потом замена. Прерванная запись
не оставит половину проекта.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import types
import typing
from dataclasses import fields, is_dataclass
from pathlib import Path
from typing import Any, TypeVar, get_args, get_origin

from . import ir
from .cells import Cell
from .patterns import Pattern, Sandbox

T = TypeVar("T")

PATTERNS_DIR = "patterns"
SANDBOXES_DIR = "sandboxes"
#: Свои типы клеток. Встроенные живут в коде (`vnl.cells`), сюда кладутся те,
#: что завёл человек, -- и перекрывают встроенные по идентификатору.
CELLS_DIR = "cells"


class StoreError(RuntimeError):
    pass


# --- перевод структур в json и обратно ------------------------------------


def to_plain(value: Any) -> Any:
    if is_dataclass(value) and not isinstance(value, type):
        return {
            field.name: to_plain(getattr(value, field.name))
            for field in fields(value)
        }
    if isinstance(value, dict):
        return {str(key): to_plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_plain(item) for item in value]
    if value == float("inf"):
        # JSON не знает бесконечности, а стимул «до конца прогона» её использует.
        return None
    return value


def from_plain(kind: type[T], data: Any) -> T:
    origin = get_origin(kind)

    # `X | None` даёт types.UnionType, а `Optional[X]` -- typing.Union:
    # ловить надо оба, иначе половина полей приезжает словарями.
    if origin is typing.Union or origin is types.UnionType:
        options = [arg for arg in get_args(kind) if arg is not type(None)]
        if data is None:
            return None  # type: ignore[return-value]
        return from_plain(options[0], data)

    if origin in (list, tuple):
        args = [arg for arg in get_args(kind) if arg is not Ellipsis] or [Any]
        items = [
            from_plain(args[min(index, len(args) - 1)], item)
            for index, item in enumerate(data or [])
        ]
        return tuple(items) if origin is tuple else items  # type: ignore[return-value]

    if origin is dict:
        _, value_type = get_args(kind) or (str, Any)
        return {  # type: ignore[return-value]
            key: from_plain(value_type, item) for key, item in (data or {}).items()
        }

    if is_dataclass(kind):
        if data is None:
            raise StoreError(f"ожидался объект {kind.__name__}, а пришло null")
        hints = typing.get_type_hints(kind)
        kwargs = {}
        for field in fields(kind):
            if field.name not in data:
                continue
            kwargs[field.name] = from_plain(hints[field.name], data[field.name])
        return kind(**kwargs)  # type: ignore[return-value]

    if kind is float and data is None:
        return float("inf")  # type: ignore[return-value]
    return data


class Store:
    """Каталог с паттернами и песочницами."""

    def __init__(
        self,
        root: str | os.PathLike[str],
        index: Any | None = None,
    ) -> None:
        self.root = Path(root)
        # Индекс метаданных, если он есть. Хранилище о нём знает ровно одно:
        # после записи надо сказать. Правда остаётся в файлах, поэтому отказ
        # индекса не должен мешать сохранению -- файл уже на диске.
        self.index = index
        (self.root / PATTERNS_DIR).mkdir(parents=True, exist_ok=True)
        (self.root / SANDBOXES_DIR).mkdir(parents=True, exist_ok=True)

    def _tell_index(self, what: str, *args: Any) -> None:
        if self.index is None:
            return
        try:
            getattr(self.index, what)(*args)
        except Exception as exc:  # индекс -- производное, падать из-за него нельзя
            print(f"индекс не обновлён ({what}): {exc}", file=sys.stderr)

    # --- паттерны ---------------------------------------------------------

    def pattern_path(self, pattern_id: str) -> Path:
        return self.root / PATTERNS_DIR / f"{_safe(pattern_id)}.json"

    def save_pattern(self, pattern: Pattern) -> Path:
        path = self.pattern_path(pattern.id)
        _write(path, to_plain(pattern))
        self._tell_index("upsert", pattern)
        return path

    def load_pattern(self, pattern_id: str) -> Pattern:
        path = self.pattern_path(pattern_id)
        if not path.exists():
            raise StoreError(f"паттерна {pattern_id!r} нет в библиотеке")
        return from_plain(Pattern, _read(path))

    def patterns(self) -> list[Pattern]:
        """Вся библиотека, новые сверху."""
        out = [
            from_plain(Pattern, _read(path))
            for path in sorted((self.root / PATTERNS_DIR).glob("*.json"))
        ]
        return sorted(out, key=lambda item: item.updated_at, reverse=True)

    def delete_pattern(self, pattern_id: str) -> None:
        self.pattern_path(pattern_id).unlink(missing_ok=True)
        self._tell_index("forget", pattern_id)

    # --- свои типы клеток -------------------------------------------------

    def cell_path(self, cell_id: str) -> Path:
        return self.root / CELLS_DIR / f"{_safe(cell_id)}.json"

    def save_cell(self, cell: "Cell") -> Path:
        path = self.cell_path(cell.id)
        _write(path, to_plain(cell))
        return path

    def load_cell(self, cell_id: str) -> "Cell":
        path = self.cell_path(cell_id)
        if not path.exists():
            raise StoreError(f"типа клетки {cell_id!r} нет в хранилище")
        return from_plain(Cell, _read(path))

    def cells(self) -> list["Cell"]:
        """Свои типы клеток. Пустой каталог -- обычное дело: есть встроенные."""
        directory = self.root / CELLS_DIR
        if not directory.exists():
            return []
        return [
            from_plain(Cell, _read(path)) for path in sorted(directory.glob("*.json"))
        ]

    def delete_cell(self, cell_id: str) -> None:
        self.cell_path(cell_id).unlink(missing_ok=True)

    # --- песочницы --------------------------------------------------------

    def sandbox_path(self, sandbox_id: str) -> Path:
        return self.root / SANDBOXES_DIR / f"{_safe(sandbox_id)}.json"

    def save_sandbox(self, sandbox: Sandbox) -> Path:
        path = self.sandbox_path(sandbox.id)
        _write(path, to_plain(sandbox))
        return path

    def load_sandbox(self, sandbox_id: str) -> Sandbox:
        path = self.sandbox_path(sandbox_id)
        if not path.exists():
            raise StoreError(f"песочницы {sandbox_id!r} нет")
        return from_plain(Sandbox, _read(path))

    def sandboxes(self) -> list[Sandbox]:
        out = [
            from_plain(Sandbox, _read(path))
            for path in sorted((self.root / SANDBOXES_DIR).glob("*.json"))
        ]
        return sorted(out, key=lambda item: item.updated_at, reverse=True)

    def delete_sandbox(self, sandbox_id: str) -> None:
        self.sandbox_path(sandbox_id).unlink(missing_ok=True)


def _cells_dir(root: Path) -> Path:
    return root / CELLS_DIR


def _safe(identifier: str) -> str:
    """Имя файла из идентификатора: он приходит снаружи и может быть каким угодно."""
    out = "".join(
        char if char.isalnum() or char in "-_" else "_" for char in identifier
    )
    if not out.strip("_"):
        raise StoreError(f"пустой идентификатор: {identifier!r}")
    return out


def _write(path: Path, payload: dict) -> None:
    """Атомарная запись: прерванное сохранение не оставит половину файла."""
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp"
    )
    try:
        with handle as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)
        os.replace(handle.name, path)
    except BaseException:
        Path(handle.name).unlink(missing_ok=True)
        raise


def _read(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)
