"""Каталог типов клеток: примитивы, из которых собирают микросхемы.

Клетка -- не паттерн. У паттерна есть внутренности и порты, его открывают
карточкой и вставляют блоком; у клетки внутренностей нет, зато есть параметры
мембраны, которых у паттерна нет. Смешать их в одном каталоге значило бы, что
слово «блок» означает и то и другое, и человек перестаёт понимать, что он
кладёт на холст.

Встроенный набор -- те же типы, что в примерах (`examples/*.vnl`): пирамида,
корзинчатый PV, SST, VIP и релейная. Они описаны здесь данными, а не разбором
файла, по двум причинам: набор обязан существовать в пустом хранилище, и он
должен быть один и тот же на любой машине, иначе «пирамида» у двух людей
окажется разной клеткой.

Свои типы кладутся в хранилище рядом с паттернами и песочницами и перекрывают
встроенные по идентификатору: поправить порог пирамиды под свою задачу нужно
уметь, не переписывая инструмент.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import ir


@dataclass
class Cell:
    """Тип клетки в каталоге: описание плюс человеческое имя."""

    #: Имя для человека; в модели клетка зовётся `type.id`.
    name: str
    type: ir.CellType
    #: Чем она занята в схеме -- строка для карточки, не семантика.
    note: str = ""
    #: Встроенная клетка или своя. Встроенную нельзя удалить, можно перекрыть.
    builtin: bool = True
    #: Откуда клетка пришла -- файл, из которого её разобрали. След
    #: происхождения, а не ссылка: файл могли переписать или унести, и
    #: перечитывать его каталог не станет. Нужен затем, чтобы через месяц было
    #: понятно, чья это клетка и где лежит её исходное описание.
    source: str | None = None

    @property
    def id(self) -> str:
        return self.type.id

    @property
    def inhibitory(self) -> bool:
        return ir.is_inhibitory_cell(self.type)


def _cell(
    id: str,
    name: str,
    tags: tuple[str, ...],
    transmitter: str,
    note: str,
    **point: float,
) -> Cell:
    return Cell(
        name=name,
        note=note,
        type=ir.CellType(
            id=id,
            tags=tags,
            transmitter=transmitter,
            point_model=ir.PointModel(**point),  # type: ignore[arg-type]
        ),
    )


#: Встроенный набор. Значения взяты из примеров, чтобы схемы из `examples/`
#: и схемы, собранные руками, говорили об одних и тех же клетках.
BUILTIN: tuple[Cell, ...] = (
    _cell(
        "pyr",
        "Пирамидная клетка",
        ("excitatory",),
        "glutamate",
        "Главный возбуждающий выход коры: медленная мембрана и адаптация, "
        "поэтому на длинный вход отвечает всё реже.",
        tau_m=15.0,
        v_threshold=-50.0,
        adaptation=1.5,
    ),
    _cell(
        "pv",
        "Корзинчатый интернейрон PV",
        ("inhibitory",),
        "gaba",
        "Быстрое торможение: короткая мембрана и низкий порог, успевает "
        "ответить на тот же вход раньше пирамиды.",
        tau_m=6.0,
        v_threshold=-52.0,
        refractory=1.0,
    ),
    _cell(
        "sst",
        "Интернейрон SST",
        ("inhibitory",),
        "gaba",
        "Медленное торможение, обычно по дендритам: тормозит не разряд, "
        "а сбор входов.",
        tau_m=10.0,
        v_threshold=-52.0,
    ),
    _cell(
        "vip",
        "Интернейрон VIP",
        ("inhibitory",),
        "gaba",
        "Тормозит тормозные: через него делается растормаживание.",
        tau_m=8.0,
        v_threshold=-52.0,
    ),
    _cell(
        "relay",
        "Релейная клетка",
        ("excitatory",),
        "glutamate",
        "Передаёт вход дальше почти без обработки: ею удобно подавать сигнал "
        "в схему.",
        tau_m=8.0,
        v_threshold=-50.0,
        refractory=4.0,
    ),
)


@dataclass
class Catalog:
    """Встроенные типы плюс свои. Свой тип перекрывает встроенный по имени."""

    cells: list[Cell] = field(default_factory=list)

    def get(self, id: str) -> Cell:
        for cell in self.cells:
            if cell.id == id:
                return cell
        known = ", ".join(cell.id for cell in self.cells)
        raise KeyError(f"нет типа клетки {id!r} (есть: {known})")

    def __len__(self) -> int:
        return len(self.cells)


def catalog(own: list[Cell] | None = None) -> Catalog:
    """Каталог типов: свои поверх встроенных.

    Порядок сохраняется -- встроенные первыми: человек ищет глазами по списку,
    и привычные клетки должны стоять на привычном месте.
    """
    chosen: dict[str, Cell] = {cell.id: cell for cell in BUILTIN}
    for cell in own or []:
        chosen[cell.id] = Cell(
            name=cell.name,
            type=cell.type,
            note=cell.note,
            builtin=False,
            source=cell.source,
        )
    return Catalog(list(chosen.values()))
