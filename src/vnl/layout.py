"""Раскладка схемы: где стоят клетки и как идут связи.

Отделено от отрисовки намеренно. Геометрия клетки -- биология (сома, веер
дендритов, аксон), её считаем сами. А вот расстановка клеток и прокладка
связей между конкретными точками -- задача движка раскладки, и решать её
вручную незачем.

Движки:
    elk      -- ELK Layered через Node; порты с FIXED_POS позволяют привести
                связь ровно в ту точку дендрита, где объявлен контакт
    builtin  -- послойная раскладка без зависимостей, запасной вариант
    auto     -- elk, если доступен, иначе builtin

Контракт наружу -- LayoutResult: абсолютные координаты и готовые ломаные.
Рисовальщику остаётся только провести линии.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from . import ir

SOMA_R = 15.0
AXON_LEN = 52.0
DEND_BASE = 34.0
DEND_SCALE = 70.0
MARGIN = 60.0
COLUMN_GAP_X = 230.0
CELL_GAP_Y = 190.0
COMPACT_GAP_Y = 124.0
LABEL_PAD = 20.0

Point = tuple[float, float]


class LayoutError(RuntimeError):
    pass


@dataclass(frozen=True)
class CellGeometry:
    """Геометрия одной клетки в своих координатах: сома в начале координат."""

    instance: str
    cell_type: str
    inhibitory: bool
    dendrites: dict[str, tuple[float, float, float, float]]
    axon_tip: Point

    def point_on(self, section: str, fraction: float) -> Point:
        if section not in self.dendrites:
            return 0.0, 0.0
        x1, y1, x2, y2 = self.dendrites[section]
        return x1 + (x2 - x1) * fraction, y1 + (y2 - y1) * fraction

    def bbox(self) -> tuple[float, float, float, float]:
        xs = [-SOMA_R, SOMA_R, self.axon_tip[0]]
        ys = [-SOMA_R - LABEL_PAD, SOMA_R + LABEL_PAD, self.axon_tip[1]]
        for x1, y1, x2, y2 in self.dendrites.values():
            xs += [x1, x2]
            ys += [y1, y2]
        return min(xs), min(ys), max(xs), max(ys)


@dataclass
class PlacedCell:
    geometry: CellGeometry
    x: float
    y: float

    @property
    def soma(self) -> Point:
        return self.x, self.y

    @property
    def axon_tip(self) -> Point:
        return self.x + self.geometry.axon_tip[0], self.y + self.geometry.axon_tip[1]

    def dendrites(self) -> list[tuple[float, float, float, float]]:
        return [
            (self.x + x1, self.y + y1, self.x + x2, self.y + y2)
            for x1, y1, x2, y2 in self.geometry.dendrites.values()
        ]

    def point_on(self, section: str, fraction: float) -> Point:
        local = self.geometry.point_on(section, fraction)
        return self.x + local[0], self.y + local[1]


@dataclass
class Route:
    """Готовая ломаная от точки выхода до точки контакта."""

    id: str
    points: list[Point]

    @property
    def start(self) -> Point:
        return self.points[0]

    @property
    def end(self) -> Point:
        return self.points[-1]


@dataclass
class LayoutResult:
    cells: dict[str, PlacedCell]
    routes: dict[str, Route]
    width: float
    height: float
    engine: str
    notes: list[str] = field(default_factory=list)


# --- геометрия клетки -----------------------------------------------------


def cell_geometry(model: ir.Model, instance_id: str) -> CellGeometry:
    cell_type = model.cell_type_of(instance_id)
    morph = cell_type.morphology
    branches = [s for s in morph.sections.values() if s.kind == "dend"]
    count = max(len(branches), 1)

    dendrites: dict[str, tuple[float, float, float, float]] = {}
    for index, section in enumerate(branches):
        # веер уводится вверх, чтобы ни одна ветвь не ложилась на горизонталь
        # и не путалась с линией связи
        spread = (0.0 if count == 1 else (index / (count - 1) - 0.5) * 1.4) - 0.3
        angle = math.pi + spread
        length = DEND_BASE + DEND_SCALE * min(section.length / 200.0, 2.0)
        dendrites[section.id] = (
            0.0,
            0.0,
            math.cos(angle) * length,
            math.sin(angle) * length,
        )

    return CellGeometry(
        instance=instance_id,
        cell_type=cell_type.id,
        inhibitory=ir.is_inhibitory_cell(cell_type),
        dendrites=dendrites,
        axon_tip=(AXON_LEN, 0.0),
    )


def _geometries(model: ir.Model) -> dict[str, CellGeometry]:
    return {name: cell_geometry(model, name) for name in model.instances}


@dataclass(frozen=True)
class _Link:
    """Связь, которую надо проложить: из точки одной клетки в точку другой."""

    id: str
    source: str
    source_point: Point  # локальные координаты в геометрии источника
    target: str
    target_point: Point


def _links(model: ir.Model, geometries: dict[str, CellGeometry]) -> list[_Link]:
    links: list[_Link] = []
    for contact in model.contacts:
        links.append(
            _Link(
                id=contact.id,
                source=contact.pre.instance,
                source_point=geometries[contact.pre.instance].axon_tip,
                target=contact.post.instance,
                target_point=geometries[contact.post.instance].point_on(
                    contact.post.section, contact.post.fraction
                ),
            )
        )
    for modulator in model.modulators.values():
        governed = [
            contact
            for contact in model.contacts
            if contact.plasticity.modulator == modulator.id
        ]
        for source in modulator.sources:
            for contact in governed:
                links.append(
                    _Link(
                        id=f"mod:{modulator.id}:{source}:{contact.id}",
                        source=source,
                        source_point=geometries[source].axon_tip,
                        target=contact.post.instance,
                        target_point=geometries[contact.post.instance].point_on(
                            contact.post.section, contact.post.fraction
                        ),
                    )
                )
    return links


# --- запасная раскладка ---------------------------------------------------


def _levels(model: ir.Model) -> dict[str, int]:
    targets = {contact.post.instance for contact in model.contacts}
    roots = [name for name in model.instances if name not in targets]
    if not roots:
        roots = list(model.instances)[:1]

    level = {name: 0 for name in roots}
    for _ in range(len(model.instances) + 1):
        changed = False
        for contact in model.contacts:
            pre, post = contact.pre.instance, contact.post.instance
            if pre in level and level.get(post, -1) < level[pre] + 1:
                level[post] = level[pre] + 1
                changed = True
        if not changed:
            break
    for name in model.instances:
        level.setdefault(name, 0)
    return level


def _builtin_layout(model: ir.Model) -> LayoutResult:
    geometries = _geometries(model)
    level = _levels(model)
    columns: dict[int, list[str]] = {}
    for name in model.instances:
        columns.setdefault(level[name], []).append(name)

    has_morphology = any(geo.dendrites for geo in geometries.values())
    gap_y = CELL_GAP_Y if has_morphology else COMPACT_GAP_Y
    tallest = max(len(names) for names in columns.values())

    cells: dict[str, PlacedCell] = {}
    for column, names in columns.items():
        centering = (tallest - len(names)) / 2 * gap_y
        for row, name in enumerate(names):
            cells[name] = PlacedCell(
                geometry=geometries[name],
                x=column * COLUMN_GAP_X,
                y=row * gap_y + centering,
            )

    routes: dict[str, Route] = {}
    for link in _links(model, geometries):
        start = (
            cells[link.source].x + link.source_point[0],
            cells[link.source].y + link.source_point[1],
        )
        end = (
            cells[link.target].x + link.target_point[0],
            cells[link.target].y + link.target_point[1],
        )
        forward = end[0] > start[0]
        bow = 26.0 if forward else 0.55 * CELL_GAP_Y
        middle = (
            (start[0] + end[0]) / 2,
            (start[1] + end[1]) / 2 + (bow if not forward else -bow),
        )
        routes[link.id] = Route(id=link.id, points=[start, middle, end])

    return _normalize(cells, routes, "builtin")


# --- ELK ------------------------------------------------------------------


def _elk_script() -> Path | None:
    override = os.environ.get("VNL_ELK_SCRIPT")
    if override:
        path = Path(override)
        return path if path.exists() else None
    root = Path(__file__).resolve().parents[2]
    script = root / "tools" / "layout" / "elk-layout.js"
    modules = root / "tools" / "layout" / "node_modules" / "elkjs"
    return script if script.exists() and modules.exists() else None


def elk_available() -> bool:
    return shutil.which("node") is not None and _elk_script() is not None


def _elk_layout(model: ir.Model) -> LayoutResult:
    script = _elk_script()
    if script is None or shutil.which("node") is None:
        raise LayoutError(
            "нужен Node и elkjs: npm install --prefix tools/layout elkjs"
        )

    geometries = _geometries(model)
    links = _links(model, geometries)

    ports_used: dict[str, dict[str, Point]] = {name: {} for name in model.instances}
    for link in links:
        ports_used[link.source][_port_id(link.source, link.source_point)] = (
            link.source_point
        )
        ports_used[link.target][_port_id(link.target, link.target_point)] = (
            link.target_point
        )

    children = []
    origins: dict[str, Point] = {}
    for name, geometry in geometries.items():
        min_x, min_y, max_x, max_y = geometry.bbox()
        origins[name] = (-min_x, -min_y)  # где сома внутри прямоугольника узла
        children.append(
            {
                "id": name,
                "width": max_x - min_x,
                "height": max_y - min_y,
                "layoutOptions": {"elk.portConstraints": "FIXED_POS"},
                "ports": [
                    {
                        "id": port_id,
                        "x": point[0] - min_x,
                        "y": point[1] - min_y,
                        "width": 1,
                        "height": 1,
                    }
                    for port_id, point in ports_used[name].items()
                ],
            }
        )

    graph = {
        "id": "root",
        "layoutOptions": {
            "elk.algorithm": "layered",
            "elk.direction": "RIGHT",
            "elk.edgeRouting": "POLYLINE",
            "elk.layered.spacing.nodeNodeBetweenLayers": "70",
            "elk.spacing.nodeNode": "60",
            "elk.spacing.edgeEdge": "18",
            "elk.spacing.edgeNode": "24",
            "elk.layered.mergeEdges": "false",
            "elk.layered.crossingMinimization.semiInteractive": "true",
        },
        "children": children,
        "edges": [
            {
                "id": link.id,
                "sources": [_port_id(link.source, link.source_point)],
                "targets": [_port_id(link.target, link.target_point)],
            }
            for link in links
        ],
    }

    try:
        completed = subprocess.run(
            ["node", str(script)],
            input=json.dumps(graph),
            capture_output=True,
            text=True,
            timeout=30,
            encoding="utf-8",
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LayoutError(f"не удалось запустить раскладку ELK: {exc}") from exc
    if completed.returncode != 0:
        raise LayoutError(f"ELK вернул ошибку: {completed.stderr.strip()}")

    laid = json.loads(completed.stdout)

    cells: dict[str, PlacedCell] = {}
    for child in laid.get("children", []):
        name = child["id"]
        offset = origins[name]
        cells[name] = PlacedCell(
            geometry=geometries[name],
            x=child["x"] + offset[0],
            y=child["y"] + offset[1],
        )

    routes: dict[str, Route] = {}
    for edge in laid.get("edges", []):
        sections = edge.get("sections") or []
        if not sections:
            continue
        points: list[Point] = []
        for section in sections:
            start = (section["startPoint"]["x"], section["startPoint"]["y"])
            if not points or points[-1] != start:
                points.append(start)
            for bend in section.get("bendPoints", []):
                points.append((bend["x"], bend["y"]))
            points.append((section["endPoint"]["x"], section["endPoint"]["y"]))
        routes[edge["id"]] = Route(id=edge["id"], points=points)

    missing = [link.id for link in links if link.id not in routes]
    if missing:
        raise LayoutError(f"ELK не проложил связи: {', '.join(missing)}")

    return _normalize(cells, routes, "elk")


def _port_id(instance: str, point: Point) -> str:
    return f"{instance}::{point[0]:.2f},{point[1]:.2f}"


# --- общий постпроцесс ----------------------------------------------------


def _normalize(
    cells: dict[str, PlacedCell], routes: dict[str, Route], engine: str
) -> LayoutResult:
    """Сдвинуть всё в положительные координаты и посчитать холст."""
    xs: list[float] = []
    ys: list[float] = []
    for cell in cells.values():
        min_x, min_y, max_x, max_y = cell.geometry.bbox()
        xs += [cell.x + min_x, cell.x + max_x]
        ys += [cell.y + min_y, cell.y + max_y]
    for route in routes.values():
        xs += [x for x, _ in route.points]
        ys += [y for _, y in route.points]

    shift_x, shift_y = MARGIN - min(xs), MARGIN - min(ys)
    for cell in cells.values():
        cell.x += shift_x
        cell.y += shift_y
    for route in routes.values():
        route.points = [(x + shift_x, y + shift_y) for x, y in route.points]

    return LayoutResult(
        cells=cells,
        routes=routes,
        width=max(xs) - min(xs) + MARGIN * 2,
        height=max(ys) - min(ys) + MARGIN * 2,
        engine=engine,
    )


def layout(model: ir.Model, engine: str = "auto") -> LayoutResult:
    if engine not in ("auto", "elk", "builtin"):
        raise LayoutError(f"неизвестный движок раскладки: {engine!r}")
    if engine == "builtin":
        return _builtin_layout(model)
    if engine == "elk":
        return _elk_layout(model)

    if not elk_available():
        result = _builtin_layout(model)
        result.notes.append(
            "раскладка встроенная: не найден Node или elkjs "
            "(npm install --prefix tools/layout elkjs)"
        )
        return result
    try:
        return _elk_layout(model)
    except LayoutError as exc:
        result = _builtin_layout(model)
        result.notes.append(f"раскладка встроенная: ELK не отработал ({exc})")
        return result
