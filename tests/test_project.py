"""Операции над проектом: отмена, устаревание прогона, несохранённое."""

from pathlib import Path

import pytest

from vnl import ir
from vnl.compose import compose
from vnl.patterns import (
    Endpoint,
    Link,
    Pattern,
    PatternError,
    Port,
    Sandbox,
    SandboxRecording,
    SandboxStimulus,
)
from vnl.project import Project
from vnl.resolve import load
from vnl.sim import simulate
from vnl.store import Store, to_plain

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def example(name: str) -> str:
    return (EXAMPLES / f"{name}.vnl").read_text(encoding="utf-8")


@pytest.fixture
def ffi() -> Pattern:
    model, _ = load(example("ffi"))
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


@pytest.fixture
def project(tmp_path, ffi) -> Project:
    store = Store(tmp_path)
    store.save_pattern(ffi)
    sandbox = Sandbox(id="s1", name="Рабочая", run=ir.RunSpec(duration=200.0, seed=7))
    return Project(sandbox, store)


def running_project(project: Project, ffi: Pattern) -> Project:
    """Готовая к запуску схема: блок, драйв, запись."""
    project.insert_pattern(ffi, instance_id="a")
    project.stimulate(
        SandboxStimulus(
            id="drive", target=Endpoint("a", "in"), rate=250.0, amplitude=1.5
        )
    )
    project.record(SandboxRecording(id="r1", target=Endpoint("a", "out")))
    return project


# --- отмена ---------------------------------------------------------------


def test_undo_returns_the_previous_state(project, ffi):
    project.insert_pattern(ffi, instance_id="a")
    project.insert_pattern(ffi, instance_id="b")
    assert len(project.sandbox.instances) == 2

    label = project.undo()
    assert "FFI" in (label or "")
    assert [block.id for block in project.sandbox.instances] == ["a"]


def test_a_batch_is_undone_in_one_step(project, ffi):
    """Пачка правок Claude отменяется целиком, а не по одному нейрону."""
    with project.batch("Claude собрал цепочку") as work:
        work.insert_pattern(ffi, instance_id="a")
        work.insert_pattern(ffi, instance_id="b")
        work.connect(Endpoint("a", "out"), Endpoint("b", "in"), link_id="a_to_b")

    assert len(project.sandbox.instances) == 2 and len(project.sandbox.links) == 1

    assert project.undo() == "Claude собрал цепочку"
    assert project.sandbox.instances == [] and project.sandbox.links == []
    assert not project.can_undo


def test_undo_on_empty_history_is_quiet(project):
    assert project.undo() is None


def test_ten_steps_back_and_forward_return_the_same_project(project, ffi):
    """Приёмка #570: десять действий, десять «назад», десять «вперёд».

    Сравнивается не число объектов, а весь проект целиком (`to_plain`): вернуть
    десять блоков, потеряв по дороге их места или связи, -- это не «вернуть».
    """
    start = to_plain(project.sandbox)
    for index in range(10):
        project.insert_pattern(ffi, instance_id=f"b{index}")
    done = to_plain(project.sandbox)

    for _ in range(10):
        project.undo()
    assert to_plain(project.sandbox) == start
    assert not project.can_undo and project.can_redo

    for _ in range(10):
        project.redo()
    assert to_plain(project.sandbox) == done
    assert project.can_undo and not project.can_redo


def test_a_new_action_burns_the_forward_stack(project, ffi):
    """Новое действие после отката гасит «вперёд» -- общее правило редакторов.

    Иначе «вперёд» склеило бы две разные истории проекта: вернуло бы схему,
    которой в нём никогда не было.
    """
    project.insert_pattern(ffi, instance_id="a")
    project.insert_pattern(ffi, instance_id="b")
    project.undo()
    assert project.can_redo

    project.insert_pattern(ffi, instance_id="c")
    assert not project.can_redo
    assert [block.id for block in project.sandbox.instances] == ["a", "c"]


def test_redo_on_empty_stack_is_quiet(project, ffi):
    assert project.redo() is None
    project.insert_pattern(ffi, instance_id="a")
    assert project.redo() is None


def test_undo_and_redo_name_the_step(project, ffi):
    """Подсказка кнопки называет действие, которое отменится (#570)."""
    project.insert_pattern(ffi, instance_id="a")
    assert project.undo_label is not None and "FFI" in project.undo_label
    assert project.redo_label is None

    project.undo()
    assert project.undo_label is None
    assert project.redo_label is not None and "FFI" in project.redo_label


def test_a_batch_comes_back_whole(project, ffi):
    """Возврат так же одношаговый, как отмена: пакет возвращается целиком."""
    with project.batch("Claude собрал цепочку") as work:
        work.insert_pattern(ffi, instance_id="a")
        work.insert_pattern(ffi, instance_id="b")
        work.connect(Endpoint("a", "out"), Endpoint("b", "in"), link_id="a_to_b")
    whole = to_plain(project.sandbox)

    project.undo()
    assert project.sandbox.instances == [] and project.sandbox.links == []

    assert project.redo() == "Claude собрал цепочку"
    assert to_plain(project.sandbox) == whole


def test_the_forward_stack_does_not_grow_without_bound(project, ffi):
    """Стопка возврата держит столько же шагов, сколько история: `HISTORY_LIMIT`.

    Снимки полные, и без предела возврат удвоил бы память вдвое против
    названного числа -- а предел на память называют один раз, а не на половину
    того, что в ней лежит.
    """
    for index in range(80):
        project.insert_pattern(ffi, instance_id=f"b{index}")
    for _ in range(80):
        project.undo()
    assert len(project.future) <= 50


def test_moving_a_figure_comes_back_too(project, ffi):
    """Отпечаток сети от отмены и возврата не меняется: место -- не физика."""
    project.insert_pattern(ffi, instance_id="a")
    before = project.fingerprint()
    project.move("a", (120.0, 40.0))

    project.undo()
    assert project.sandbox.instance("a").position == (0.0, 0.0)
    project.redo()
    assert project.sandbox.instance("a").position == (120.0, 40.0)
    assert project.fingerprint() == before


def test_history_does_not_grow_without_bound(project, ffi):
    for index in range(80):
        project.insert_pattern(ffi, instance_id=f"b{index}")
    assert len(project.history) <= 50


# --- несохранённое --------------------------------------------------------


def test_dirty_reflects_real_changes(project, ffi):
    assert not project.dirty

    project.insert_pattern(ffi, instance_id="a")
    assert project.dirty

    project.save()
    assert not project.dirty

    project.undo()
    assert project.dirty, "откат — тоже изменение относительно сохранённого"


def test_saving_a_pattern_is_not_saving_the_sandbox(project, ffi):
    project.insert_pattern(ffi, instance_id="a")
    pattern, _ = project.extract(["a"], "Кусок")
    project.save_as_pattern(pattern)

    assert project.dirty, "песочница так и осталась несохранённой"
    assert project.store is not None
    assert project.store.load_pattern(pattern.id).name == "Кусок"


# --- запуск и устаревание -------------------------------------------------


def test_run_refuses_a_broken_schema(project, ffi):
    project.insert_pattern(ffi, instance_id="a")
    project.connect(Endpoint("a", "out"), Endpoint("ghost", "in"), link_id="bad")

    assert project.check(), "проблемы должны быть видны до запуска"
    with pytest.raises(PatternError, match="не готова"):
        project.run()


def test_run_gives_a_result_tied_to_this_state(project, ffi):
    run = running_project(project, ffi).run()

    assert run.result.spike_count()["a/IN"] > 0
    assert not project.run_is_stale


def test_changing_the_schema_marks_the_result_stale(project, ffi):
    running_project(project, ffi).run()
    assert not project.run_is_stale

    project.insert_pattern(ffi, instance_id="b")
    assert project.run_is_stale, "результат уже про другую сеть"


def test_moving_a_block_does_not_stale_the_result(project, ffi):
    """Рисование не определяет физику: сдвиг по холсту результат не старит."""
    running_project(project, ffi).run()
    project.move("a", (120.0, 40.0))

    assert not project.run_is_stale
    assert project.dirty, "но сохранить проект всё же нужно"


# --- раскладка (#543) ------------------------------------------------------


def test_arranging_is_one_step_of_undo(project, ffi):
    """«Отменить» возвращает прежние места целиком, а не по одному узлу."""
    project.insert_pattern(ffi, instance_id="a", position=(60.0, 60.0))
    project.insert_pattern(ffi, instance_id="b", position=(280.0, 60.0))
    project.add_neuron("x", ir.CellType("relay"), position=(60.0, 200.0))
    steps = len(project.history)

    project.arrange({"a": (12.0, 30.0), "b": (252.0, 30.0), "x": (492.0, 49.0)})

    assert [project.sandbox.instance("a").position] == [(12.0, 30.0)]
    assert project.sandbox.neurons["x"].position == (492.0, 49.0)
    assert len(project.history) == steps + 1, "раскладка -- одно действие"

    project.undo()

    assert project.sandbox.instance("a").position == (60.0, 60.0)
    assert project.sandbox.instance("b").position == (280.0, 60.0)
    assert project.sandbox.neurons["x"].position == (60.0, 200.0)


def test_arranging_does_not_stale_the_result(project, ffi):
    """Место на физику не влияет: прогон от раскладки стареть не должен."""
    running_project(project, ffi).run()
    before = project.fingerprint()

    project.arrange({"a": (12.0, 30.0)})

    assert project.fingerprint() == before
    assert not project.run_is_stale
    assert project.dirty, "но сохранить проект всё же нужно"


def test_arranging_only_moves_what_is_on_the_canvas(project, ffi):
    """Имя не с холста -- отказ, и без следа в истории."""
    project.insert_pattern(ffi, instance_id="a", position=(60.0, 60.0))
    steps = len(project.history)

    with pytest.raises(PatternError, match="нет объектов"):
        project.arrange({"a": (10.0, 10.0), "нетакого": (20.0, 20.0)})

    assert project.sandbox.instance("a").position == (60.0, 60.0)
    assert len(project.history) == steps, "отказ не оставляет шага отмены"


def test_arranging_touches_nothing_but_places(project, ffi):
    """Раскладка не трогает ни связей, ни параметров, ни стимулов."""
    running_project(project, ffi)
    project.insert_pattern(ffi, instance_id="b")
    project.connect(Endpoint("a", "out"), Endpoint("b", "in"), link_id="x")
    before = to_plain(project.sandbox)

    project.arrange({"a": (12.0, 30.0), "b": (252.0, 30.0)})
    after = to_plain(project.sandbox)

    for block in after["instances"]:
        block["position"] = dict(zip("xy", (0, 0)))
    for block in before["instances"]:
        block["position"] = dict(zip("xy", (0, 0)))
    assert after == before


# --- операции -------------------------------------------------------------


def test_removing_a_block_takes_its_links_and_stimuli(project, ffi):
    running_project(project, ffi)
    project.insert_pattern(ffi, instance_id="b")
    project.connect(Endpoint("a", "out"), Endpoint("b", "in"), link_id="a_to_b")

    project.remove("a")

    assert [block.id for block in project.sandbox.instances] == ["b"]
    assert project.sandbox.links == [], "висячая связь осталась бы битой"
    assert project.sandbox.stimuli == []


def test_parameters_change_through_the_project(project, ffi):
    project.insert_pattern(ffi, instance_id="a")
    project.insert_pattern(ffi, instance_id="b")
    link = project.connect(Endpoint("a", "out"), Endpoint("b", "in"), link_id="x")

    project.set_parameters("x", weight=4.0, delay=2.5)
    assert (link.weight, link.delay) == (4.0, 2.5)

    with pytest.raises(PatternError, match="нет параметров"):
        project.set_parameters("x", colour="red")

    project.undo()
    assert project.sandbox.links[0].weight != 4.0


def test_fork_leaves_the_library_alone(project, ffi):
    project.insert_pattern(ffi, instance_id="a")
    forked = project.fork("a", name="FFI медленный")
    forked.body.contacts[0].delay = 9.0
    project.save_as_pattern(forked)

    assert project.store is not None
    assert project.store.load_pattern("ffi").body.contacts[0].delay != 9.0
    assert len(project.sandbox.instances) == 1, "fork не трогает песочницу"


# --- настройки блока, клетки, стимула и прогона ----------------------------


def test_renaming_a_block_touches_the_instance_not_the_pattern(project, ffi):
    """Подпись на холсте -- у экземпляра: одноимённые блоки надо различать."""
    project.insert_pattern(ffi, instance_id="a")
    project.insert_pattern(ffi, instance_id="b")

    project.rename("a", "Вход")

    assert project.sandbox.instance("a").label == "Вход"
    assert project.sandbox.instance("b").label == "FFI", "сосед не переименован"
    assert project.sandbox.instance("a").snapshot.name == "FFI"
    assert project.store is not None
    assert project.store.load_pattern("ffi").name == "FFI"

    with pytest.raises(PatternError, match="пустой"):
        project.rename("a", "   ")


def test_cell_parameters_change_only_inside_this_block(project, ffi):
    """У каждого блока снимок свой, поэтому порог правится поблочно."""
    project.insert_pattern(ffi, instance_id="a")
    project.insert_pattern(ffi, instance_id="b")

    project.set_cell("a", "pyr_l5", v_threshold=-45.0, tau_m=20.0, adaptation=3.0)

    first = project.sandbox.instance("a").snapshot.body.cell_types["pyr_l5"]
    second = project.sandbox.instance("b").snapshot.body.cell_types["pyr_l5"]
    assert (first.point_model.v_threshold, first.point_model.tau_m) == (-45.0, 20.0)
    assert second.point_model.v_threshold == -50.0, "второй блок не задет"
    assert project.store is not None
    library = project.store.load_pattern("ffi").body.cell_types["pyr_l5"]
    assert library.point_model.v_threshold == -50.0, "библиотека тоже не задета"


def test_a_changed_cell_makes_the_result_stale(project, ffi):
    """Порог -- это физика: прежний прогон после правки уже про другую сеть."""
    running_project(project, ffi).run()
    assert not project.run_is_stale

    project.set_cell("a", "pyr_l5", v_threshold=-40.0)
    assert project.run_is_stale


def test_a_lower_threshold_gives_more_spikes(project, ffi):
    """Правка должна доходить до симулятора, а не только до файла."""
    before = running_project(project, ffi).run().result.spike_count()["a/E"]

    project.set_cell("a", "pyr_l5", v_threshold=-58.0)
    after = project.run().result.spike_count()["a/E"]

    assert after > before


def test_cell_parameters_are_checked_before_they_break_the_run(project, ffi):
    project.insert_pattern(ffi, instance_id="a")

    with pytest.raises(PatternError, match="нет параметров"):
        project.set_cell("a", "pyr_l5", colour="red")
    with pytest.raises(PatternError, match="больше нуля"):
        project.set_cell("a", "pyr_l5", tau_m=0.0)
    with pytest.raises(PatternError, match="рефрактерность"):
        project.set_cell("a", "pyr_l5", refractory=-1.0)
    with pytest.raises(PatternError, match="несколько типов"):
        project.set_cell("a")
    with pytest.raises(PatternError, match="нет типа клетки"):
        project.set_cell("a", "нет такого")


def test_the_kind_of_point_model_is_editable_from_the_sandbox(project, ffi):
    """Вид модели -- такое же поле типа клетки, как порог (#527).

    До этого `adex` можно было написать файлом, но не собрать на холсте:
    половина движка человеку была недоступна.
    """
    project.insert_pattern(ffi, instance_id="a")

    project.set_cell("a", "pyr_l5", kind="adex")

    point = project.sandbox.instance("a").snapshot.body.cell_types["pyr_l5"].point_model
    assert point.kind == "adex"
    # Числа второго вида приехали вместе с ним и правятся так же.
    project.set_cell("a", "pyr_l5", tau_w=60.0, w_increment=0.2)
    assert (point.tau_w, point.w_increment) == (60.0, 0.2)


def test_the_sandbox_refuses_what_the_language_refuses(project, ffi):
    """Холст не собирает того, чего потом не примет файл (#527).

    Слова отказа -- те же самые: и разбор, и правка спрашивают один список
    (`ir.point_model_problems`), поэтому «почему нельзя» человек читает один
    раз и в одних выражениях.
    """
    project.insert_pattern(ffi, instance_id="a")
    project.set_cell("a", "pyr_l5", kind="adex")
    point = project.sandbox.instance("a").snapshot.body.cell_types["pyr_l5"].point_model

    with pytest.raises(PatternError, match="ток ничего не помнит"):
        project.set_cell("a", "pyr_l5", tau_w=0.0)
    with pytest.raises(PatternError, match="не выше v_t"):
        project.set_cell("a", "pyr_l5", v_threshold=-30.0)
    with pytest.raises(PatternError, match="не реализована"):
        project.set_cell("a", "pyr_l5", kind="хиджкин")
    assert (point.tau_w, point.v_threshold, point.kind) == (144.0, -50.0, "adex"), (
        "отказ оставляет мембрану такой, какой она была"
    )

    # А у `lif` ноль в `tau_w` проезжает -- ровно как в языке: там это число
    # не читается вовсе, и отбивать его значило бы быть строже файла.
    project.set_cell("a", "pyr_l5", kind="lif")
    project.set_cell("a", "pyr_l5", tau_w=0.0)
    assert point.tau_w == 0.0


def test_stimulus_parameters_are_editable_after_it_is_created(project, ffi):
    """Драйв создаётся с числами по умолчанию, а не с высеченными в камне."""
    running_project(project, ffi)
    quiet = project.run().result.spike_count()["a/IN"]

    project.set_stimulus("drive", rate=20.0)
    assert project.sandbox.stimuli[0].rate == 20.0
    assert project.run().result.spike_count()["a/IN"] < quiet

    with pytest.raises(PatternError, match="род стимула"):
        project.set_stimulus("drive", kind="барабан")
    with pytest.raises(PatternError, match="отрицательной"):
        project.set_stimulus("drive", rate=-1.0)
    with pytest.raises(PatternError, match="раньше"):
        project.set_stimulus("drive", start=300.0, stop=100.0)
    with pytest.raises(PatternError, match="стимула"):
        project.set_stimulus("нет такого", rate=1.0)


def test_recording_changes_what_is_written(project, ffi):
    running_project(project, ffi)
    project.set_recording("r1", "g_exc")

    run = project.run()
    assert "a/E.soma:g_exc" in run.result.traces

    with pytest.raises(PatternError, match="записать"):
        project.set_recording("r1", "температура")


def test_run_parameters_are_editable_and_checked(project, ffi):
    running_project(project, ffi)
    project.set_run(duration=100.0, dt=0.2, seed=42)

    run = project.run()
    assert project.sandbox.run.seed == 42
    assert len(run.result.times) == 500

    with pytest.raises(PatternError, match="шаг"):
        project.set_run(dt=0.0)
    with pytest.raises(PatternError, match="длительность"):
        project.set_run(duration=-5.0)
    with pytest.raises(PatternError, match="отсчётов"):
        project.set_run(duration=1e9, dt=0.01)
    with pytest.raises(PatternError, match="уровень"):
        project.set_run(level="L9")


def test_a_changed_seed_gives_another_realisation(project, ffi):
    """Зерно правится не для красоты: другое зерно -- другой шум стимула."""
    running_project(project, ffi)
    first = project.run().result.spikes["a/IN"]

    project.set_run(seed=99)
    assert project.run().result.spikes["a/IN"] != first


def test_settings_are_undone_one_step_each(project, ffi):
    running_project(project, ffi)
    project.set_run(duration=100.0)
    project.rename("a", "Вход")

    assert project.undo() == "переименован a"
    assert project.sandbox.instance("a").label == "FFI"
    assert project.sandbox.run.duration == 100.0

    assert project.undo() == "параметры прогона"
    assert project.sandbox.run.duration == 200.0


# --- проект -> паттерн библиотеки ------------------------------------------
#
# Здесь единственная дорога из песочницы в библиотеку: редактора тела схемы нет
# и не будет, поэтому проверять надо не «объект записался», а «записался
# паттерн, который открывается и считается» (#525).


def test_ports_are_suggested_from_the_built_network(project, ffi):
    """Догадка о портах: кто ни с кем не связан с одной из сторон.

    Имена в собранной сети с приставкой блока, и порт ссылается на ту же точку:
    иначе он смотрел бы на клетку, которой в теле паттерна нет.
    """
    running_project(project, ffi)
    project.insert_pattern(ffi, instance_id="b")
    project.connect(Endpoint("a", "out"), Endpoint("b", "in"), link_id="a_to_b")

    hints = {(port.direction, port.site.instance) for port in project.port_hints()}
    # Внутри ffi: IN -> E, IN -> I, I -> E. Значит вход -- IN первого блока,
    # выход -- E второго; E первого уже стреляет в b, а IN второго получает.
    assert hints == {("in", "a/IN"), ("out", "b/E")}


def test_a_lonely_cell_is_both_an_input_and_an_output(project):
    """Клетка без связей -- и вход, и выход. Это честнее, чем выбрать одно."""
    project.add_neuron("one", ir.CellType(id="relay"))
    hints = project.port_hints()
    assert [port.direction for port in hints] == ["in", "out"]
    assert {port.site.instance for port in hints} == {"one"}


def test_the_saved_pattern_carries_the_body_and_the_demo(project, ffi):
    """Тело -- собранная сеть, витрина -- драйв и записи песочницы.

    Без витрины паттерн ляжет в библиотеку мёртвым: карточка откроется, а
    запускать в ней будет нечего -- сеть без драйва молчит. А в теле драйву не
    место: вставленный блок не должен тащить чужие стимулы в чужую сеть.
    """
    running_project(project, ffi)
    pattern = project.as_pattern("Цепочка", project.port_hints(), level="L1")

    assert pattern.level == "L1"
    assert set(pattern.body.instances) == {"a/IN", "a/E", "a/I"}
    assert pattern.body.stimuli == [] and pattern.body.recordings == []
    assert pattern.demo is not None
    assert [stim.id for stim in pattern.demo.stimuli] == ["drive"]
    assert [rec.id for rec in pattern.demo.recordings] == ["r1"]
    assert pattern.demo.run.duration == 200.0 and pattern.demo.run.seed == 7

    # И главное: то, что сохранили, считается.
    model = pattern.demo_model()
    assert model.stimuli and model.instances
    assert pattern.validate() == [] and pattern.status == "ready"


def test_the_demo_keeps_the_run_even_without_a_drive(project, ffi):
    """Прогон -- часть витрины и без стимулов.

    Иначе карточка покажет «прогон 0 мс» и время в ней никуда не пойдёт: у
    паттерна без `demo` неоткуда взять ни длительность, ни шаг.
    """
    project.insert_pattern(ffi, instance_id="a")
    pattern = project.as_pattern("Без драйва", project.port_hints())

    assert pattern.demo is not None
    assert pattern.demo.stimuli == []
    assert pattern.demo.run.duration == 200.0


def test_saving_leaves_the_sandbox_alone(project, ffi):
    """Сохранение паттерна -- не правка проекта: отменять тут нечего."""
    running_project(project, ffi)
    before = len(project.history)

    project.as_pattern("Копия", project.port_hints())

    assert len(project.history) == before
    assert [block.id for block in project.sandbox.instances] == ["a"]


def test_a_port_is_named_by_the_caller_and_keeps_its_site(project, ffi):
    """Имя порта -- дело человека, точка -- дело схемы."""
    running_project(project, ffi)
    pattern = project.as_pattern(
        "Цепочка",
        [Port("вход", "in", ir.Site("a/IN", "soma", 0.5), note="сюда драйв")],
    )

    port = pattern.port("вход")
    assert port.site.instance == "a/IN"
    assert port.note == "сюда драйв"


def test_a_pattern_without_ports_is_refused(project, ffi):
    """Блок без портов не подключить, и решать за автора нельзя."""
    running_project(project, ffi)
    with pytest.raises(PatternError, match="портов"):
        project.as_pattern("Никак", [])


def test_a_port_into_nowhere_names_what_there_is(project, ffi):
    running_project(project, ffi)
    with pytest.raises(PatternError, match="a/IN"):
        project.as_pattern("Мимо", [Port("x", "in", ir.Site("нету", "soma", 0.5))])


def test_two_ports_cannot_share_a_name(project, ffi):
    running_project(project, ffi)
    ports = [
        Port("one", "in", ir.Site("a/IN", "soma", 0.5)),
        Port("one", "out", ir.Site("a/E", "soma", 0.5)),
    ]
    with pytest.raises(PatternError, match="дважды"):
        project.as_pattern("Двойник", ports)


def test_an_unknown_direction_is_refused(project, ffi):
    running_project(project, ffi)
    with pytest.raises(PatternError, match="направление"):
        project.as_pattern(
            "Куда", [Port("x", "вбок", ir.Site("a/IN", "soma", 0.5))]  # type: ignore[arg-type]
        )


def test_a_nameless_pattern_is_refused(project, ffi):
    running_project(project, ffi)
    with pytest.raises(PatternError, match="имя"):
        project.as_pattern("   ", project.port_hints())


def test_an_uncomputable_project_is_not_saved(project):
    """Несчитаемая схема в библиотеке -- это и есть мёртвый паттерн."""
    with pytest.raises(PatternError, match="нечего"):
        project.as_pattern("Пусто", [Port("x", "in", ir.Site("нет", "soma", 0.5))])


def test_an_identifier_does_not_overwrite_a_namesake(project, ffi):
    """Одноимённый паттерн не должен затирать чужой."""
    running_project(project, ffi)
    first = project.as_pattern("Схема", project.port_hints())
    project.save_as_pattern(first)

    taken = [item.id for item in project.store.patterns()]
    second = project.as_pattern("Схема", project.port_hints(), taken=taken)
    assert second.id != first.id


def test_removing_a_block_takes_what_hung_on_its_insides(project, ffi):
    """Связь ведут в `ffi/I`, а убирают блок `ffi` -- уйти должно и то и другое.

    Сравнение имён напрямую тут не работает: `a/I` не равно `a`, и связь
    осталась бы висеть, а песочница перестала бы считаться с жалобой на объект,
    которого уже не видно.
    """
    project.insert_pattern(ffi, instance_id="a")
    project.add_neuron("X", ir.CellType(id="relay", tags=("excitatory",)))
    project.connect(Endpoint("X"), Endpoint("a/I"), link_id="inside")
    project.record(SandboxRecording(id="r1", target=Endpoint("a/E")))

    project.remove("a")

    assert project.sandbox.links == [], "связь смотрела внутрь убранного блока"
    assert project.sandbox.recordings == []
    assert project.check() == [], "оставшаяся клетка считается"


def test_a_link_into_a_block_does_not_touch_the_neighbouring_instance(project, ffi):
    """Приставка разводит экземпляры и в адресе: `a/I` -- не `b/I`."""
    project.insert_pattern(ffi, instance_id="a")
    project.insert_pattern(ffi, instance_id="b")
    project.add_neuron("X", ir.CellType(id="relay", tags=("excitatory",)))
    project.connect(Endpoint("X"), Endpoint("b/I"), link_id="inside")

    project.remove("a")

    assert [link.id for link in project.sandbox.links] == ["inside"]


def test_opening_a_block_is_not_a_change_of_physics(project, ffi):
    """Раскрытие блока отпечаток не меняет -- потому что его здесь и нет.

    Это показ, а не схема: операции «раскрыть» в проекте не существует, блок и
    так считается насквозь. Отпечаток считается по собранной модели, и
    единственное, что о блоке в ней есть, -- его развёрнутые нейроны.
    """
    project.insert_pattern(ffi, instance_id="a")
    before = project.fingerprint()

    project.move("a", (120.0, 40.0))
    project.rename("a", "Вход")

    assert project.fingerprint() == before
    assert not hasattr(project, "open_block"), "раскрытие -- дело интерфейса"


# --- параметры контакта внутри блока (#531) --------------------------------


@pytest.fixture
def delay() -> Pattern:
    """«Задержка проведения» из библиотеки: один источник, два приёмника.

    Настоящий паттерн, а не собранный здесь: весь его смысл в двух контактах
    одного источника с `delay = 1 мс` и `delay = 10 мс`, и проверять правку
    задержки надо ровно на них.
    """
    model, _ = load(
        (EXAMPLES / "library" / "synaptic_delay.vnl").read_text(encoding="utf-8")
    )
    return Pattern.from_model(
        model,
        id="synaptic_delay",
        name="Задержка проведения",
        status="ready",
        ports=[
            Port("in", "in", ir.Site("IN", "soma", 0.5)),
            Port("near", "out", ir.Site("NEAR", "soma", 0.5)),
            Port("far", "out", ir.Site("FAR", "soma", 0.5)),
        ],
    )


def first_spikes(project: Project) -> dict[str, float]:
    """Момент первого разряда каждой клетки собранной сети."""
    spikes = project.run().result.spikes
    return {name: times[0] for name, times in spikes.items() if times}


def test_contact_parameters_change_only_inside_this_block(project, delay):
    """Снимок у каждого экземпляра свой -- как уже устроен порог."""
    project.save_as_pattern(delay)  # чтобы было чему остаться нетронутым
    project.insert_pattern(delay, instance_id="a")
    project.insert_pattern(delay, instance_id="b")

    project.set_contact("a", "c2", delay=4.0, weight=3.3, receptor="nmda")

    edited = project.sandbox.instance("a").snapshot.body.contacts[1]
    assert (edited.delay, edited.weight, edited.receptor) == (4.0, 3.3, "nmda")

    neighbour = project.sandbox.instance("b").snapshot.body.contacts[1]
    assert neighbour.delay == 10.0, "второй блок того же паттерна не задет"
    assert project.store is not None
    library = project.store.load_pattern("synaptic_delay").body.contacts[1]
    assert library.delay == 10.0, "библиотека тоже не задета"


def test_a_changed_contact_moves_the_spike_by_exactly_that_much(project, delay):
    """Правка обязана доходить до симулятора, а не только до файла.

    Проверяется не «стало другое число», а величина сдвига: задержка контакта
    -- это время от спайка источника до открытия проводимости, и разница
    первых разрядов NEAR и FAR равна разнице задержек. Урезали задержку на
    6 мс -- ровно на столько должен съехать и разрыв.
    """
    project.insert_pattern(delay, instance_id="a")
    project.stimulate(
        SandboxStimulus(
            id="drive",
            target=Endpoint("a", "in"),
            kind="spikes",
            amplitude=3.0,
            times=(20.0, 60.0, 100.0, 140.0, 180.0),
        )
    )
    project.set_run(duration=340.0)

    before = first_spikes(project)
    gap_before = before["a/FAR"] - before["a/NEAR"]
    assert round(gap_before, 3) == 9.0, "1 мс против 10 мс -- разрыв 9 мс"

    project.set_contact("a", "c2", delay=4.0)

    after = first_spikes(project)
    assert round(after["a/FAR"] - after["a/NEAR"], 3) == 3.0
    assert round(before["a/FAR"] - after["a/FAR"], 3) == 6.0
    assert after["a/NEAR"] == before["a/NEAR"], "ближний приёмник не задет"


def test_a_changed_contact_makes_the_result_stale(project, delay):
    """Задержка -- это физика: прежний прогон после правки уже про другую сеть."""
    project.insert_pattern(delay, instance_id="a")
    project.stimulate(
        SandboxStimulus(
            id="drive", target=Endpoint("a", "in"), kind="spikes", times=(20.0,)
        )
    )
    project.run()
    assert not project.run_is_stale

    project.set_contact("a", "c1", weight=3.0)
    assert project.run_is_stale


def test_a_contact_is_undone_in_one_step(project, delay):
    project.insert_pattern(delay, instance_id="a")

    project.set_contact("a", "c2", delay=4.0)
    project.undo()

    assert project.sandbox.instance("a").snapshot.body.contacts[1].delay == 10.0


def test_contact_parameters_are_checked_the_same_way_as_a_link(project, delay, ffi):
    """Связь и контакт -- одна вещь: то, что не примут у одной, не примут и у другого.

    Своя таблица допустимого на каждой стороне означала бы, что задержка,
    отвергнутая у связи холста, спокойно проедет внутрь блока.
    """
    project.insert_pattern(delay, instance_id="a")
    project.insert_pattern(ffi, instance_id="f")
    project.connect(Endpoint("f", "out"), Endpoint("a", "in"), link_id="x")
    steps = len(project.history)

    for bad, complaint in (
        ({"delay": -1.0}, "задержка"),
        ({"weight": -2.0}, "вес"),
        ({"receptor": "барабан"}, "рецептор"),
    ):
        with pytest.raises(PatternError, match=complaint):
            project.set_contact("a", "c1", **bad)
        with pytest.raises(PatternError, match=complaint):
            project.set_parameters("x", **bad)

    with pytest.raises(PatternError, match="нет параметров"):
        project.set_contact("a", "c1", colour="red")
    with pytest.raises(PatternError, match="нет контакта"):
        project.set_contact("a", "c9")
    with pytest.raises(PatternError, match="нет блока"):
        project.set_contact("нет такого", "c1", delay=1.0)

    assert len(project.history) == steps, "отказ не оставляет шага отмены"


# --- разбор блока на части (#532) ------------------------------------------


@pytest.fixture
def modulated() -> Pattern:
    """Паттерн с нейромодулятором: у разбора есть и такая половина."""
    model, _ = load(
        (EXAMPLES / "library" / "neuromodulated_plasticity.vnl").read_text(
            encoding="utf-8"
        )
    )
    return Pattern.from_model(
        model,
        id="neuromodulated_plasticity",
        name="Нейромодулируемая пластичность",
        status="ready",
        ports=[
            Port("in", "in", ir.Site("IN", "soma", 0.5)),
            Port("reward", "mod", ir.Site("VTA", "soma", 0.5)),
            Port("out", "out", ir.Site("E", "soma", 0.5)),
        ],
    )


def test_ungroup_replaces_the_block_with_its_parts(project, ffi):
    """FFI разбирается на три клетки, три связи и свои типы."""
    project.insert_pattern(ffi, instance_id="a", position=(300.0, 80.0))

    names = project.ungroup("a")

    sandbox = project.sandbox
    assert names == ["IN", "E", "I"], "имена без приставки блока"
    assert sandbox.instances == [], "коробки больше нет"
    assert sorted(sandbox.neurons) == ["E", "I", "IN"]
    assert [(link.source.instance, link.target.instance) for link in sandbox.links] == [
        ("IN", "E"),
        ("IN", "I"),
        ("I", "E"),
    ]
    assert sorted(sandbox.cell_types) == ["pv", "pyr_l5", "relay"]
    # Точка на клетке сохранена целиком: контакт FFI приходит на дендрит, и
    # потерять это значило бы посчитать после разбора другую сеть.
    assert sandbox.links[0].target.section == "dend.apical[1]"
    assert sandbox.links[0].target.fraction == 0.6
    assert project.check() == []


def test_ungroup_scatters_the_cells_around_the_block(project, ffi):
    """Стопка в одной точке выглядит как одна клетка -- её пришлось бы растаскивать."""
    project.insert_pattern(ffi, instance_id="a", position=(300.0, 80.0))

    project.ungroup("a")

    places = [neuron.position for neuron in project.sandbox.neurons.values()]
    assert len(set(places)) == 3, "клетки не легли друг на друга"
    assert all(abs(x - 300.0) <= 200.0 and abs(y - 80.0) <= 200.0 for x, y in places)


def test_ungroup_puts_the_cells_where_they_were_drawn(project, ffi):
    """Места приходят от того, кто блок нарисовал, -- сетка им не мешает.

    Внутри коробки схема разложена слоями, и после разбора она обязана стоять
    так же (#554). Считает раскладку интерфейс: размеры фигур и раскрытие блока
    живут только там.
    """
    project.insert_pattern(ffi, instance_id="a", position=(300.0, 80.0))

    project.ungroup("a", {"IN": (10.0, 20.0), "E": (250.0, 20.0)})

    places = {name: cell.position for name, cell in project.sandbox.neurons.items()}
    assert places["IN"] == (10.0, 20.0)
    assert places["E"] == (250.0, 20.0)
    # Клетка, которую не назвали, легла по запасной сетке, а не в ноль.
    assert places["I"] not in {(0.0, 0.0), (10.0, 20.0), (250.0, 20.0)}


def test_ungroup_keeps_the_run_spike_for_spike(project, ffi):
    """Разбор -- смена вида, а не схемы: при том же зерне сеть считается та же.

    Сравниваются моменты каждого разряда, а не их число: сдвиг на один шаг
    означал бы, что разбор поменял задержку или порядок доставки, и по одному
    только счётчику это прошло бы незамеченным.
    """
    running_project(project, ffi)
    before = project.run().result.spikes

    project.ungroup("a")
    after = project.run().result.spikes

    assert set(after) == {name.removeprefix("a/") for name in before}
    for name, times in after.items():
        assert times == before[f"a/{name}"], f"{name} спайкает иначе"


def test_ungroup_keeps_the_drive_and_the_recording_on_the_same_cell(project, ffi):
    """Порта после разбора нет, а драйв обязан бить туда же, куда бил."""
    running_project(project, ffi)
    project.connect(Endpoint("a", "out"), Endpoint("a/I"), link_id="inner")

    project.ungroup("a")

    sandbox = project.sandbox
    assert sandbox.stimuli[0].target == Endpoint("IN", None, "soma", 0.5)
    assert sandbox.recordings[0].target == Endpoint("E", None, "soma", 0.5)
    inner = next(link for link in sandbox.links if link.id == "inner")
    assert (inner.source.instance, inner.target.instance) == ("E", "I")
    assert project.check() == [], "ни один конец не повис"


def test_ungroup_does_not_overwrite_the_cells_already_lying_there(project, ffi):
    """Имена решаются при разборе, а не в `compose` на запуске.

    В `compose` столкновение всплыло бы жалобой «имя занято блоком», и чинить
    его было бы нечем: в песочнице к тому времени два объекта с одним именем.
    """
    relay = ir.CellType(id="relay", tags=("excitatory",))
    project.add_neuron("IN", relay)
    project.add_neuron("E", relay)
    project.insert_pattern(ffi, instance_id="a")

    names = project.ungroup("a")

    assert names == ["IN2", "E2", "I"], "занятые имена обойдены"
    assert project.sandbox.neurons["IN"].cell_type == "relay"
    assert project.check() == []


def test_ungroup_copies_the_cell_types_deeply(project, ffi):
    """Иначе правка мембраны после разбора испортила бы соседний блок."""
    project.insert_pattern(ffi, instance_id="a")
    project.insert_pattern(ffi, instance_id="b")

    project.ungroup("a")
    project.set_cell("E", "pyr_l5", v_threshold=-41.0)

    neighbour = project.sandbox.instance("b").snapshot.body.cell_types["pyr_l5"]
    assert neighbour.point_model.v_threshold == -50.0, "соседний блок не задет"
    assert project.store is not None
    library = project.store.load_pattern("ffi").body.cell_types["pyr_l5"]
    assert library.point_model.v_threshold == -50.0, "библиотека тоже"


def test_ungroup_keeps_a_namesake_type_apart(project, ffi):
    """Одноимённый, но другой тип разводится именем, а не подменяет чужой."""
    project.add_neuron(
        "X", ir.CellType(id="pyr_l5", tags=("excitatory",), point_model=ir.PointModel())
    )
    project.insert_pattern(ffi, instance_id="a")

    project.ungroup("a")

    assert "pyr_l5_2" in project.sandbox.cell_types
    assert project.sandbox.neurons["X"].cell_type == "pyr_l5"
    assert project.sandbox.neurons["E"].cell_type == "pyr_l5_2"
    assert project.check() == []


def test_ungroup_carries_the_modulator_with_its_sources(project, modulated):
    """Модулятор блока -- часть его механизма, а не украшение схемы."""
    project.insert_pattern(modulated, instance_id="m")

    project.ungroup("m")

    sandbox = project.sandbox
    assert "dopamine" in sandbox.modulators
    assert sandbox.modulators["dopamine"].sources == ("VTA",)
    governed = [link for link in sandbox.links if link.plasticity.modulator]
    assert governed and all(
        link.plasticity.modulator == "dopamine" for link in governed
    )
    assert project.check() == []


def test_undo_returns_the_block_whole(project, ffi):
    """Один шаг на всю операцию: отмена возвращает блок, а не рассыпанные клетки."""
    project.insert_pattern(ffi, instance_id="a")
    before = project.fingerprint()

    project.ungroup("a")
    assert project.undo() == "разобран a"

    assert [block.id for block in project.sandbox.instances] == ["a"]
    assert project.sandbox.neurons == {} and project.sandbox.links == []
    assert project.fingerprint() == before


def test_ungrouped_cells_are_edited_like_ordinary_ones(project, ffi):
    """После разбора это обычные объекты песочницы: порог, вес, задержка."""
    running_project(project, ffi)
    project.ungroup("a")

    project.set_cell("E", "pyr_l5", v_threshold=-58.0)
    link = next(link for link in project.sandbox.links if link.target.instance == "I")
    project.set_parameters(link.id, weight=4.0, delay=2.5)

    assert project.sandbox.cell_types["pyr_l5"].point_model.v_threshold == -58.0
    assert (link.weight, link.delay) == (4.0, 2.5)
    assert project.check() == []


def test_ungroup_refuses_what_is_not_a_block(project, ffi):
    project.add_neuron("X", ir.CellType(id="relay", tags=("excitatory",)))
    steps = len(project.history)

    with pytest.raises(PatternError, match="нет блока"):
        project.ungroup("X")
    assert len(project.history) == steps, "отказ не оставляет шага отмены"


# --- рецептор по медиатору источника (#540) --------------------------------


def inhibitory_cell(id: str = "sst") -> ir.CellType:
    return ir.CellType(id=id, tags=("inhibitory",), transmitter="gaba")


def excitatory_cell(id: str = "relay") -> ir.CellType:
    return ir.CellType(id=id, tags=("excitatory",), transmitter="glutamate")


def test_a_link_from_an_inhibitory_cell_is_inhibitory(project):
    """Связь от ГАМК-клетки создаётся тормозной, а не быстрой возбуждающей.

    Ровно та ловушка, из-за которой заведена #540: человек вёл связь от
    клетки, которую холст рисует красной и квадратной, и получал `ampa`.
    """
    project.add_neuron("SST", inhibitory_cell())
    project.add_neuron("PYR", excitatory_cell("pyr"))

    link = project.connect(Endpoint("SST"), Endpoint("PYR"))

    assert link.receptor == "gaba_a"
    assert not [
        note for note in project.warnings() if link.id in note
    ], "умолчание не спорит само с собой"


def test_a_link_from_an_excitatory_cell_stays_ampa(project):
    project.add_neuron("IN", excitatory_cell())
    project.add_neuron("PYR", excitatory_cell("pyr"))

    assert project.connect(Endpoint("IN"), Endpoint("PYR")).receptor == "ampa"


def test_an_unknown_transmitter_gets_ampa(project):
    """Медиатора нет -- угадывать сверх таблицы нечего."""
    project.add_neuron("X", ir.CellType(id="mystery"))
    project.add_neuron("Y", ir.CellType(id="mystery2"))

    assert project.connect(Endpoint("X"), Endpoint("Y")).receptor == "ampa"


def test_the_named_receptor_wins(project):
    """Умолчание -- не запрет: `gaba_b` вместо `gaba_a` осмысленный выбор."""
    project.add_neuron("SST", inhibitory_cell())
    project.add_neuron("PYR", excitatory_cell("pyr"))

    link = project.connect(Endpoint("SST"), Endpoint("PYR"), receptor="gaba_b")

    assert link.receptor == "gaba_b"


def test_a_link_from_a_block_port_asks_the_cell_behind_it(project, ffi):
    """Порт блока -- ярлык внутренней точки, и медиатор спрашивается у неё.

    У `ffi` выход смотрит на пирамиду (`E`), поэтому связь возбуждающая; а
    связь из корзинчатой клетки того же блока (`a/I`) -- тормозная, хотя
    объект холста для обеих один и тот же.
    """
    project.insert_pattern(ffi, instance_id="a")
    project.add_neuron("X", excitatory_cell())

    assert project.connect(Endpoint("a", "out"), Endpoint("X")).receptor == "ampa"
    assert project.connect(Endpoint("a/I"), Endpoint("X")).receptor == "gaba_a"


def test_a_saved_sandbox_is_not_rewritten(project):
    """Старая связь остаётся как есть: про неё говорит предупреждение.

    Умолчание касается только создаваемой связи. Переписать чужую схему задним
    числом -- значит поменять результат прогона, который человек уже видел.
    """
    project.add_neuron("SST", inhibitory_cell())
    project.add_neuron("PYR", excitatory_cell("pyr"))
    project.sandbox.links.append(
        Link("old", Endpoint("SST"), Endpoint("PYR"), receptor="ampa")
    )

    assert project.sandbox.links[0].receptor == "ampa"
    assert any("old" in note for note in project.warnings()), project.warnings()


# --- переход с карточки: витрина едет вместе с блоком (#526) --------------


def test_the_library_insert_still_brings_a_silent_block(project, ffi):
    """Правило прежнее: вставка из панели «Библиотека» драйва не тащит.

    Блок, приехавший в чужую сеть со своим стимулом, спорил бы с тем входом,
    ради которого его и ставят. Проверяется здесь, рядом с переходом с
    карточки, чтобы два ответа на один вопрос разошлись заметно.
    """
    project.insert_pattern(ffi, instance_id="a")

    assert project.sandbox.stimuli == [] and project.sandbox.recordings == []
    assert any("спайкать" in note for note in project.warnings()), project.warnings()


def test_the_demo_travels_with_the_block_from_the_card(project, ffi):
    """Переход с карточки: витрина ложится настоящими объектами проекта.

    Цель -- внутренний узел блока (`a/IN`), а не порт: витрина нацелена на
    клетки, и половина её (драйв на `I.soma`) ярлыка-порта не имеет вовсе.
    """
    project.insert_pattern(ffi, instance_id="a", demo=True)

    drive = project.sandbox.stimuli[0]
    assert drive.id == "a.drive"
    assert drive.target.instance == "a/IN" and drive.target.port is None
    assert drive.kind == "poisson" and drive.rate == 250.0
    assert drive.amplitude == 1.5 and (drive.start, drive.stop) == (20.0, 380.0)

    assert [rec.target.instance for rec in project.sandbox.recordings] == [
        "a/IN",
        "a/E",
        "a/I",
        "a/E",
        "a/E",
    ]
    # Прогон -- паттерна, а не прежний проектный: драйв идёт до 380-й мс, и на
    # двухсотмиллисекундном прогоне картина была бы не та, что на карточке.
    assert project.sandbox.run.duration == 400.0 and project.sandbox.run.seed == 7
    assert not project.warnings(), "драйв есть -- жаловаться не на что"


def test_the_demo_does_not_get_into_the_body_of_the_block(project, ffi):
    """Витрина едет экспериментом проекта, а не частью схемы.

    Снимок блока остаётся тем же, что при обычной вставке: сохрани человек
    проект паттерном, стимулы снова отделятся от конструкции.
    """
    block = project.insert_pattern(ffi, instance_id="a", demo=True)

    assert block.snapshot.body.stimuli == []
    assert block.snapshot.body.recordings == []
    assert not compose(project.sandbox).model.contacts[0].id.startswith("drive")


def test_undo_takes_the_demo_back_with_the_block(project, ffi):
    """Один шаг истории на весь переход, а не три.

    Иначе первое «Отменить» оставило бы драйв, целящийся в исчезнувший блок.
    """
    project.insert_pattern(ffi, instance_id="a", demo=True)
    project.undo()

    assert project.sandbox.instances == []
    assert project.sandbox.stimuli == [] and project.sandbox.recordings == []
    assert project.sandbox.run.duration == 200.0, "прогон вернулся проектный"


def test_two_cards_bring_two_drives_that_can_be_told_apart(project, ffi):
    """Имя стимула -- с приставкой блока: в дереве объектов они лежат вместе."""
    project.insert_pattern(ffi, instance_id="a", demo=True)
    project.insert_pattern(ffi, instance_id="b", demo=True)

    assert [stim.id for stim in project.sandbox.stimuli] == ["a.drive", "b.drive"]
    assert [stim.target.instance for stim in project.sandbox.stimuli] == [
        "a/IN",
        "b/IN",
    ]


def test_the_brought_demo_runs_the_same_as_the_card(project, ffi):
    """Приёмка задачи: та же картина, что на карточке, при том же зерне.

    Считается дважды -- витриной паттерна (`demo_model`, как её считает
    карточка) и собранной песочницей, -- и счётчики спайков сверяются по
    именам с точностью до приставки блока. Сверять надо именно спайки: они и
    есть то, ради чего человек переходит с карточки, а совпадение чисел в
    полях ещё не значит, что сеть ведёт себя так же.
    """
    project.insert_pattern(ffi, instance_id="a", demo=True)

    card = simulate(ffi.demo_model()).spike_count()
    yard = simulate(compose(project.sandbox).model).spike_count()

    assert card, "на карточке сеть спайкает -- иначе сверять нечего"
    assert {name.split("/", 1)[-1]: count for name, count in yard.items()} == card


# --- имя, копия и удаление выбранного (#563) -------------------------------


def wired(project: Project, ffi: Pattern) -> Project:
    """Клетка `X` со связью, стимулом и записью -- и блок рядом."""
    project.insert_pattern(ffi, instance_id="a")
    project.add_neuron("X", ir.CellType(id="relay", tags=("excitatory",)))
    project.connect(Endpoint("X"), Endpoint("a", "in"), link_id="l1")
    project.stimulate(SandboxStimulus(id="drive", target=Endpoint("X"), rate=250.0))
    project.record(SandboxRecording(id="r1", target=Endpoint("X")))
    return project


def test_renaming_a_cell_keeps_its_links_drives_and_recordings(project, ffi):
    """Приёмка #563: имя клетки правится, а всё, что на неё смотрело, остаётся.

    Развилка решена в пользу переименования-операции: имя клетки -- её адрес в
    собранной сети, и вторая, «человеческая» подпись разошлась бы с тем, чем
    клетка подписана на растре.
    """
    wired(project, ffi)

    project.rename_neuron("X", "вход")

    sandbox = project.sandbox
    assert set(sandbox.neurons) == {"вход"}
    assert sandbox.neurons["вход"].id == "вход"
    assert sandbox.links[0].source.instance == "вход"
    assert sandbox.stimuli[0].target.instance == "вход"
    assert sandbox.recordings[0].target.instance == "вход"
    assert project.check() == [], "сеть после переименования собирается"


def test_renaming_a_cell_leaves_the_neighbouring_block_alone(project, ffi):
    """`a/I` -- имя нейрона блока, и клеткой `a` оно не становится."""
    project.insert_pattern(ffi, instance_id="a")
    project.add_neuron("X", ir.CellType(id="relay", tags=("excitatory",)))
    project.connect(Endpoint("X"), Endpoint("a/I"), link_id="inside")

    project.rename_neuron("X", "Y")

    assert project.sandbox.links[0].target.instance == "a/I"


def test_renaming_a_cell_is_one_step_of_undo(project, ffi):
    wired(project, ffi)

    project.rename_neuron("X", "вход")
    project.undo()

    assert set(project.sandbox.neurons) == {"X"}
    assert project.sandbox.links[0].source.instance == "X"


def test_a_cell_cannot_take_a_name_that_is_already_on_the_canvas(project, ffi):
    """Отказ не оставляет за собой шага отмены, который нечего отменять."""
    project.insert_pattern(ffi, instance_id="a")
    project.add_neuron("X", ir.CellType(id="relay", tags=("excitatory",)))
    steps = len(project.history)

    with pytest.raises(PatternError, match="занято"):
        project.rename_neuron("X", "a")

    assert set(project.sandbox.neurons) == {"X"}
    assert len(project.history) == steps


def test_a_cell_name_has_no_block_separator_in_it(project):
    """`ffi/E` -- имя нейрона внутри блока, и придумать его клетке нельзя."""
    project.add_neuron("X", ir.CellType(id="relay", tags=("excitatory",)))

    with pytest.raises(PatternError, match="не бывает"):
        project.rename_neuron("X", "a/I")


def test_renaming_the_project_keeps_the_fingerprint(project, ffi):
    """Имя проекта -- подпись, а не сеть: прогон от него не стареет."""
    project.insert_pattern(ffi, instance_id="a")
    before = project.fingerprint()

    project.rename_project("Опыт 3")

    assert project.sandbox.name == "Опыт 3"
    assert project.sandbox.id == "s1", "идентификатор остаётся адресом"
    assert project.fingerprint() == before


def test_an_empty_project_name_is_refused(project):
    with pytest.raises(PatternError, match="имя"):
        project.rename_project("   ")


def test_duplicating_a_cell_gives_a_second_one_of_the_same_type(project, ffi):
    """Приёмка #563: копия со своим именем и теми же параметрами мембраны.

    Тип у копии тот же самый, а не его двойник: параметры мембраны висят на
    типе, и правка порога обязана задевать обеих.
    """
    wired(project, ffi)
    project.set_cell("X", "relay", v_threshold=-44.0)

    chosen = project.duplicate("X")

    assert chosen == "X2"
    assert project.sandbox.neurons[chosen].cell_type == "relay"
    assert project.sandbox.cell_types["relay"].point_model.v_threshold == -44.0
    assert project.sandbox.neurons[chosen].position != project.sandbox.neurons["X"].position

    project.set_cell(chosen, "relay", v_threshold=-40.0)
    assert project.sandbox.cell_types["relay"].point_model.v_threshold == -40.0


def test_a_copy_gets_neither_links_nor_drives(project, ffi):
    """Связь без второго конца бессмысленна, а драйв удвоил бы вход в схему."""
    wired(project, ffi)

    chosen = project.duplicate("X")

    assert [link.id for link in project.sandbox.links] == ["l1"]
    assert [stim.target.instance for stim in project.sandbox.stimuli] == ["X"]
    assert [rec.target.instance for rec in project.sandbox.recordings] == ["X"]
    assert chosen not in {stim.target.instance for stim in project.sandbox.stimuli}


def test_duplicating_changes_the_network(project, ffi):
    """Сеть другая: клеток стало больше, и прежний прогон уже не про неё."""
    wired(project, ffi)
    before = project.fingerprint()

    project.duplicate("X")

    assert project.fingerprint() != before


def test_duplicating_a_block_copies_its_snapshot_and_not_the_library(project, ffi):
    """У копии блока снимок свой: два экземпляра расходятся свободно."""
    project.insert_pattern(ffi, instance_id="a")
    project.set_cell("a", "pyr_l5", v_threshold=-44.0)

    chosen = project.duplicate("a")

    assert chosen == "a2"
    assert project.sandbox.instance(chosen).snapshot.body.cell_types[
        "pyr_l5"
    ].point_model.v_threshold == -44.0

    project.set_cell(chosen, "pyr_l5", v_threshold=-40.0)
    assert project.sandbox.instance("a").snapshot.body.cell_types[
        "pyr_l5"
    ].point_model.v_threshold == -44.0, "сосед не поехал"


def test_a_copy_of_a_numbered_cell_continues_the_row(project):
    """`relay2` даёт `relay3`, а не `relay22`."""
    project.add_neuron("relay", ir.CellType(id="relay", tags=("excitatory",)))
    project.add_neuron("relay2", ir.CellType(id="relay", tags=("excitatory",)))

    assert project.duplicate("relay2") == "relay3"


def test_duplicating_is_one_step_of_undo(project, ffi):
    wired(project, ffi)

    project.duplicate("X")
    project.undo()

    assert set(project.sandbox.neurons) == {"X"}


def test_duplicating_something_that_is_not_there_is_refused(project):
    steps = len(project.history)

    with pytest.raises(PatternError):
        project.duplicate("нет такого")

    assert len(project.history) == steps


def test_a_drive_is_removed_by_its_own_name(project, ffi):
    """«Убрать стимул» убирает стимул, а не то, во что он бьёт.

    Раньше `remove` спрашивал только цель (`touches`), и кнопка в панели
    свойств молча не делала ничего: `drive` ничьей целью не является.
    """
    wired(project, ffi)

    project.remove("drive")

    assert project.sandbox.stimuli == []
    assert set(project.sandbox.neurons) == {"X"}, "цель осталась на месте"
    assert [rec.id for rec in project.sandbox.recordings] == ["r1"]


def test_a_recording_is_removed_by_its_own_name(project, ffi):
    wired(project, ffi)

    project.remove("r1")

    assert project.sandbox.recordings == []
    assert [stim.id for stim in project.sandbox.stimuli] == ["drive"]
