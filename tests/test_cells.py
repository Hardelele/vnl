"""Каталог типов клеток: встроенные, свои и то, как они складываются."""

import pytest

from vnl import ir
from vnl.cells import BUILTIN, Cell, CellError, adopt, catalog
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


# --- клетка как объект холста ---------------------------------------------


@pytest.fixture
def ffi():
    """Готовый паттерн из примеров: нужен там, где клетка стоит рядом с блоком."""
    from pathlib import Path

    from vnl.patterns import Pattern, Port
    from vnl.resolve import load

    examples = Path(__file__).resolve().parents[1] / "examples"
    model, _ = load((examples / "ffi.vnl").read_text(encoding="utf-8"))
    return Pattern.from_model(
        model,
        id="ffi",
        name="FFI",
        status="ready",
        ports=[
            Port("in", "in", ir.Site("IN", "soma", 0.5)),
            Port("out", "out", ir.Site("E", "soma", 0.5)),
        ],
    )


def sandbox_project(tmp_path) -> Project:
    return Project(Sandbox(id="s1", name="Проба"), Store(tmp_path))


def test_a_cell_remembers_where_it_was_put(tmp_path):
    """Место -- свойство холста, и класть клетку вслепую в угол незачем."""
    project = sandbox_project(tmp_path)
    project.add_neuron(None, catalog().get("pv").type, position=(120.0, 60.0))

    neuron = next(iter(project.sandbox.neurons.values()))
    assert neuron.position == (120.0, 60.0)


def test_a_cell_gets_a_free_name_of_its_own(tmp_path):
    """Второй экземпляр того же типа не затирает первый."""
    project = sandbox_project(tmp_path)
    table = catalog()
    first = project.add_neuron(None, table.get("pyr").type)
    second = project.add_neuron(None, table.get("pyr").type)

    assert [first.id, second.id] == ["pyr", "pyr2"]


def test_a_name_taken_by_a_block_is_refused_when_the_cell_is_put(tmp_path, ffi):
    """Отказ при добавлении, а не на запуске.

    В собранной сети блок и клетка живут в одном пространстве имён, и
    столкновение всплыло бы в `compose` -- то есть тогда, когда человек нажал
    «Запустить» и ждёт спайков, а не имени.
    """
    from vnl.patterns import PatternError

    project = sandbox_project(tmp_path)
    block = project.insert_pattern(ffi)

    with pytest.raises(PatternError, match="уже занято"):
        project.add_neuron(block.id, catalog().get("pyr").type)


def test_editing_the_threshold_in_a_sandbox_leaves_the_catalog_alone(tmp_path):
    """Каталог -- инвентарь, а не общая с проектом переменная.

    Класть в песочницу ссылку на запись каталога значило бы, что правка порога
    на холсте меняет клетку у всех проектов сразу, а следующая положенная
    клетка приезжает уже испорченной.
    """
    project = sandbox_project(tmp_path)
    table = catalog()
    project.add_neuron("A", table.get("pyr").type)
    project.set_cell("A", "pyr", v_threshold=-41.0)

    assert project.sandbox.cell_types["pyr"].point_model.v_threshold == pytest.approx(-41.0)
    assert table.get("pyr").type.point_model.v_threshold == pytest.approx(-50.0)
    assert catalog().get("pyr").type.point_model.v_threshold == pytest.approx(-50.0)


def test_putting_a_cell_is_one_step_of_undo(tmp_path):
    """«Отменить» убирает клетку целиком, а не её половину."""
    project = sandbox_project(tmp_path)
    project.add_neuron(None, catalog().get("pv").type)
    assert project.can_undo

    project.undo()
    assert project.sandbox.neurons == {}


def test_a_cell_can_be_moved_like_a_block(tmp_path):
    """Сдвиг -- операция холста, и объект у неё любой."""
    project = sandbox_project(tmp_path)
    neuron = project.add_neuron("A", catalog().get("pyr").type)
    project.move("A", (300.0, 140.0))

    assert project.sandbox.neurons["A"].position == (300.0, 140.0)
    assert neuron.position == (300.0, 140.0)


def test_moving_a_cell_does_not_age_the_run(tmp_path):
    """Расстановка в модель не попадает, значит прежний прогон остаётся своим."""
    project = sandbox_project(tmp_path)
    project.add_neuron("A", catalog().get("pyr").type)
    before = project.fingerprint()

    project.move("A", (300.0, 140.0))
    assert project.fingerprint() == before


def test_cells_put_by_hand_stay_without_a_prefix_next_to_a_block(tmp_path, ffi):
    """Клетки блока с приставкой, положенные руками -- без неё."""
    from vnl.compose import compose

    project = sandbox_project(tmp_path)
    project.insert_pattern(ffi, instance_id="ffi")
    project.add_neuron("A", catalog().get("pyr").type)

    names = set(compose(project.sandbox).model.instances)
    assert "A" in names
    assert {"ffi/E", "ffi/I", "ffi/IN"} <= names


def test_an_already_saved_sandbox_is_read_as_it_was(tmp_path):
    """Обратная совместимость: у сохранённых нейронов места ещё нет.

    Смена формы `neurons` не должна ронять чтение старого файла -- проект на
    диске старше этого поля, и открыться он обязан.
    """
    import json

    store = Store(tmp_path)
    path = store.sandbox_path("old")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "id": "old",
                "name": "Старая",
                "instances": [],
                "cell_types": {
                    "relay": {"id": "relay", "tags": [], "transmitter": None}
                },
                # Нейрон старой формы: ни места, ни лишних полей.
                "neurons": {"A": {"id": "A", "cell_type": "relay", "tags": []}},
                "links": [],
                "stimuli": [],
                "recordings": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    sandbox = store.load_sandbox("old")
    assert sandbox.neurons["A"].cell_type == "relay"
    assert sandbox.neurons["A"].position == (0.0, 0.0)


def test_a_cell_with_a_place_survives_a_round_trip(tmp_path):
    """Проект открывается с теми же клетками и на тех же местах."""
    store = Store(tmp_path)
    project = Project(Sandbox(id="s2", name="Проба"), store)
    project.add_neuron("A", catalog().get("pyr").type, position=(40.0, 80.0))
    project.save()

    back = store.load_sandbox("s2")
    assert back.neurons["A"].position == (40.0, 80.0)
    assert back.cell_types["pyr"].point_model.tau_m == pytest.approx(15.0)


# --- импорт своей клетки из .vnl ------------------------------------------


def test_a_cell_declared_in_a_model_lands_in_the_catalog(tmp_path):
    """Своя клетка не второго сорта: объявление `cell` уже даёт готовый тип.

    Разбирать файл второй раз ради каталога незачем -- парсер отдаёт
    `ir.CellType` вместе с морфологией, и класть его в палитру надо тем же
    движением, каким схема попадает в библиотеку (`vnl add`).
    """
    from vnl.cli import main

    source = tmp_path / "own.vnl"
    source.write_text(
        'model "своя клетка"\n'
        "cell fast : inhibitory, gaba { tau_m = 4ms, v_threshold = -54mV }\n",
        encoding="utf-8",
    )

    assert main(["cell", "add", str(source), "--root", str(tmp_path / "store"),
                 "--name", "Быстрая", "--note", "своя"]) == 0

    table = catalog(Store(tmp_path / "store").cells())
    mine = table.get("fast")
    assert mine.name == "Быстрая"
    assert mine.builtin is False
    assert mine.inhibitory is True
    assert mine.source == str(source)
    # Встроенные никуда не делись: своя клетка добавляется, а не подменяет набор.
    assert len(table) == len(BUILTIN) + 1


def test_an_own_cell_overrides_the_builtin_one_through_the_cli(tmp_path):
    """Поправить пирамиду под свою задачу можно, не трогая инструмент."""
    from vnl.cli import main

    source = tmp_path / "pyr.vnl"
    source.write_text(
        'model "своя пирамида"\ncell pyr : excitatory { v_threshold = -45mV }\n',
        encoding="utf-8",
    )
    main(["cell", "add", str(source), "--root", str(tmp_path / "store")])

    table = catalog(Store(tmp_path / "store").cells())
    assert len(table) == len(BUILTIN), "перекрытие, а не добавление"
    assert table.get("pyr").type.point_model.v_threshold == pytest.approx(-45.0)


def test_a_file_without_cell_declarations_is_refused(tmp_path, capsys):
    from vnl.cli import main

    source = tmp_path / "empty.vnl"
    source.write_text('model "без клеток"\n', encoding="utf-8")

    assert main(["cell", "add", str(source), "--root", str(tmp_path / "store")]) == 1
    assert "нет ни одного объявления cell" in capsys.readouterr().err


# --- тип проекта уезжает в каталог (#567) ---------------------------------


def project_type(id: str = "target", threshold: float = -50.0) -> ir.CellType:
    """Тип, каким он приезжает в проект из разобранного паттерна: без имени."""
    return ir.CellType(
        id=id,
        tags=("excitatory",),
        transmitter="glutamate",
        point_model=ir.PointModel(v_threshold=threshold),
    )


def test_a_project_type_becomes_a_catalog_cell_with_a_name_and_a_note():
    """Приёмка #567: у каталожной записи есть то, чего у типа не было."""
    cell = adopt(
        project_type(),
        "Клетка-мишень",
        "Куда сходится схема: на ней и смотрят, сработало ли торможение.",
        catalog(),
    )
    assert cell.id == "target"
    assert cell.name == "Клетка-мишень"
    assert cell.note.startswith("Куда сходится")
    assert cell.builtin is False, "своя, а не встроенная"

    # И она видна в палитре наравне со встроенными.
    table = catalog([cell])
    assert len(table) == len(BUILTIN) + 1
    assert table.get("target").builtin is False


def test_a_catalog_cell_without_a_name_is_refused():
    """Имя обязательно: по одному `target` клетку в списке не выбрать."""
    with pytest.raises(CellError, match="имя"):
        adopt(project_type(), "   ", "объяснение есть", catalog())


def test_a_catalog_cell_without_a_note_is_refused():
    """Объяснение тоже обязательно -- ради него #541 и делался."""
    with pytest.raises(CellError, match="объяснение"):
        adopt(project_type(), "Клетка-мишень", "", catalog())


def test_a_name_taken_by_a_builtin_cell_is_refused_until_it_is_confirmed():
    """Молча подменить пирамиду копией из чужого паттерна нельзя."""
    with pytest.raises(CellError, match="встроенная клетка"):
        adopt(project_type("pyr"), "Своя пирамида", "из чужого блока", catalog())

    # Но перекрытие остаётся возможным -- подтверждённое.
    cell = adopt(
        project_type("pyr", -45.0),
        "Своя пирамида",
        "из чужого блока",
        catalog(),
        replace=True,
    )
    assert catalog([cell]).get("pyr").type.point_model.v_threshold == pytest.approx(
        -45.0
    )


def test_a_name_already_taken_by_an_own_cell_is_refused_too():
    """Своя запись под тем же именем -- такое же столкновение, как встроенная."""
    mine = adopt(project_type(), "Мишень", "первая", catalog())
    with pytest.raises(CellError, match="своя клетка"):
        adopt(project_type(), "Мишень ещё раз", "вторая", catalog([mine]))


def test_the_catalog_keeps_a_copy_and_not_the_project_type(tmp_path):
    """Приёмка #567: правка порога в старом проекте каталожную запись не трогает.

    Держать тот же объект было бы дешевле, но `Project.set_cell` правит
    мембрану на месте, и каталог менялся бы от работы в проекте, о котором он
    ничего не знает.
    """
    store = Store(tmp_path)
    mine = project_type()
    store.save_cell(adopt(mine, "Мишень", "куда сходится схема", catalog()))

    # Так порог правит песочница: по полю точечной модели, на месте.
    mine.point_model.v_threshold = -41.0

    kept = catalog(store.cells()).get("target")
    assert kept.type.point_model.v_threshold == pytest.approx(-50.0)
    assert kept.type is not mine
