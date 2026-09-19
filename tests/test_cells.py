"""Каталог типов клеток: встроенные, свои и то, как они складываются."""

import pytest

from vnl import ir
from vnl.cells import BUILTIN, Cell, catalog
from vnl.project import Project
from vnl.patterns import Sandbox
from vnl.store import Store


def own(id: str, name: str, threshold: float) -> Cell:
    return Cell(
        name=name,
        type=ir.CellType(
            id=id,
            tags=("excitatory",),
            transmitter="glutamate",
            point_model=ir.PointModel(v_threshold=threshold),
        ),
        builtin=False,
    )


def test_the_builtin_set_exists_without_any_storage():
    """Пустое хранилище -- не пустой каталог: собирать схему можно сразу."""
    table = catalog()
    assert len(table) == len(BUILTIN)
    assert {cell.id for cell in table.cells} == {"pyr", "pv", "sst", "vip", "relay"}


def test_inhibitory_cells_are_marked_as_such():
    table = catalog()
    assert table.get("pv").inhibitory is True
    assert table.get("sst").inhibitory is True
    assert table.get("pyr").inhibitory is False


def test_every_builtin_cell_explains_itself():
    """Без пояснения список типов — это список слов, по которым не выбрать."""
    for cell in BUILTIN:
        assert cell.name and cell.note
        assert cell.builtin is True


def test_an_own_cell_joins_the_builtin_ones():
    table = catalog([own("fast", "Быстрая", -54.0)])
    assert len(table) == len(BUILTIN) + 1
    assert table.get("fast").builtin is False


def test_an_own_cell_overrides_the_builtin_one_by_id():
    """Поправить порог пирамиды под свою задачу нужно уметь без правки кода."""
    table = catalog([own("pyr", "Своя пирамида", -45.0)])
    assert len(table) == len(BUILTIN), "перекрытие, а не добавление"
    chosen = table.get("pyr")
    assert chosen.name == "Своя пирамида"
    assert chosen.builtin is False
    assert chosen.type.point_model.v_threshold == pytest.approx(-45.0)


def test_builtin_cells_keep_their_place_in_the_list():
    """Человек ищет глазами: привычная клетка должна стоять на привычном месте."""
    table = catalog([own("fast", "Быстрая", -54.0)])
    assert [cell.id for cell in table.cells][: len(BUILTIN)] == [
        cell.id for cell in BUILTIN
    ]


def test_an_unknown_cell_is_named_not_guessed():
    with pytest.raises(KeyError, match="нет типа клетки"):
        catalog().get("нет такой")


def test_an_own_cell_survives_a_round_trip(tmp_path):
    store = Store(tmp_path)
    store.save_cell(own("fast", "Быстрая", -54.0))

    back = store.load_cell("fast")
    assert back.name == "Быстрая"
    assert back.type.point_model.v_threshold == pytest.approx(-54.0)
    assert [cell.id for cell in store.cells()] == ["fast"]


def test_an_empty_store_has_no_own_cells(tmp_path):
    assert Store(tmp_path).cells() == []


def test_a_cell_from_the_catalog_can_be_put_into_a_sandbox(tmp_path):
    """Приёмка: клетку кладут на холст, и она попадает в собранную сеть."""
    from vnl.compose import compose

    project = Project(Sandbox(id="s1", name="Проба"), Store(tmp_path))
    table = catalog()
    project.add_neuron("A", table.get("pyr").type)
    project.add_neuron("B", table.get("pv").type)

    built = compose(project.sandbox)
    assert sorted(built.model.instances) == ["A", "B"]
    # У отдельной клетки нет приставки блока: она и есть объект схемы.
    assert all("/" not in name for name in built.model.instances)
