"""Поле в интерфейсе: образцы, кадр в сессию и слой за полем (#581).

После #580 картинку можно было показать сети только из командной строки.
Здесь проверяется путь, которым она доходит до человека: встроенный образец
лежит в пакете, сессия принимает кадр, а проект знает, какой слой стоит за
полем, -- без этого рисовать отклик нечем.

Отдельный файл, а не продолжение `test_vision.py`: там язык и прогон, здесь
дорога до экрана. Ломаются они по-разному.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from vnl import api, samples
from vnl.compose import compose
from vnl.live import Session
from vnl.patterns import Pattern, Port, Sandbox
from vnl.project import Project
from vnl.resolve import load
from vnl.sim import Simulator

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"
TOOLS = ROOT / "tools"


def retina() -> Pattern:
    """Блок «Сетчатка 24x24» из исходника библиотеки, с выходными портами."""
    model, _ = load(
        (EXAMPLES / "library" / "retina24.vnl").read_text(encoding="utf-8"),
        source="examples/library/retina24.vnl",
        strict=True,
    )
    ports = [
        Port(name=f"out[{row},{col}]", direction="out", site=site)
        for row in range(24)
        for col in range(24)
        for site in [
            api.ir.Site(instance=f"R[{row},{col}]", section="soma", fraction=0.5)
        ]
    ]
    return Pattern.from_model(
        model, id="retina24", name="Сетчатка 24x24", ports=ports, status="ready"
    )


def sandbox_with_retina() -> Project:
    project = Project(Sandbox(id="проба", name="проба"))
    project.insert_pattern(retina(), position=(0.0, 0.0))
    return project


# --- встроенные образцы ----------------------------------------------------


def test_the_alphabet_lives_in_the_package():
    # В пакете, а не рядом с программой-источником: читателей теперь двое --
    # `tools/letters.py` и сервер, когда показывает букву полю.
    assert samples.ALPHABET.exists()
    assert "T" in samples.catalog()


def test_a_sample_says_its_grid_and_how_much_of_it_is_lit():
    sample = samples.get("T")
    assert sample.grid == (24, 24)
    # То же число, что в шапке примера и в растре: буква -- часть опыта.
    assert sample.lit == 158


def test_a_sample_turns_into_a_frame_of_the_field():
    frame = samples.get("T").frame()
    assert len(frame) == 576
    assert sum(1 for value in frame if value > 0) == 158
    colour = samples.get("T").frame(channels=3, color=(1.0, 0.0, 0.0))
    assert len(colour) == 1728
    # Каналы чередуются -- тот же порядок, что объявлен у поля.
    assert max(colour[0::3]) == 1.0 and max(colour[1::3]) == 0.0


def test_a_dimmed_sample_is_the_same_form_at_a_lower_value():
    frame = samples.get("T").frame(level=0.5)
    assert max(frame) == 0.5
    assert sum(1 for value in frame if value > 0) == 158


def test_an_unknown_sample_is_refused_with_the_list():
    with pytest.raises(KeyError) as failure:
        samples.get("Ж")
    assert "есть:" in str(failure.value)


def test_the_catalog_carries_no_frames():
    # 36 образцов по 576 величин -- двадцать тысяч чисел ради выпадающего
    # списка. Кадр приходит тогда, когда образец выбрали.
    line = samples.payload()[0]
    assert set(line) == {"id", "grid", "lit"}


def test_the_source_program_reads_the_same_letters():
    done = subprocess.run(
        [sys.executable, str(TOOLS / "letters.py"), "T"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=TOOLS,
    )
    assert done.returncode == 0, done.stderr
    frame = json.loads(done.stdout.splitlines()[0])["frame"]
    # Тот же набор, что у сервера: второй разошёлся бы с первым молча.
    assert frame == samples.get("T").frame()


# --- поле доезжает до проекта ---------------------------------------------


def test_a_block_carries_its_layer_into_the_project():
    model = compose(sandbox_with_retina().sandbox).model
    # Клетки слоя переезжают обычным порядком, а вот что они сетка -- знает
    # только эта запись; без неё рисовать отклик было бы нечем.
    assert model.populations["retina24/R"].size == 576
    assert model.instances["retina24/R[3,7]"].cell_type


def test_the_project_says_which_fields_it_has_and_what_stands_behind_them():
    state = api.sandbox_payload(sandbox_with_retina())
    (field,) = state["fields"]
    assert field["id"] == "retina24/eye"
    assert field["grid"] == [24, 24]
    assert field["size"] == 576
    assert field["layer"]["id"] == "retina24/R"
    assert field["layer"]["members"][0] == "retina24/R[0,0]"
    # Своих дверей у проекта нет вовсе: поле приехало внутри блока, и в списке
    # заведённых на холсте его нет по определению.
    assert state["sensors"] == []


def test_a_field_tells_the_interface_it_is_a_field():
    model, _ = load(
        (EXAMPLES / "vision.vnl").read_text(encoding="utf-8"), strict=True
    )
    payload = api.model_payload(model)
    (sensor,) = payload["sensors"]
    assert sensor["field"] is True
    assert sensor["grid"] == [24, 24]
    assert payload["populations"][0]["grid"] == [24, 24]


# --- кадр в живую сессию ---------------------------------------------------


def vision_session() -> Session:
    model, _ = load(
        (EXAMPLES / "vision.vnl").read_text(encoding="utf-8"), strict=True
    )
    return Session("t", model=model)


def test_a_session_takes_a_frame_and_the_layer_answers():
    session = vision_session()
    try:
        session.show("eye", samples.get("T").frame())
        session.step(60.0)
        answer = session.update()
        awake = [
            name
            for name, cell in answer["cells"].items()
            if name.startswith("R[") and (cell["spiked"] or cell["peak"] >= 1)
        ]
        # Столько же, сколько светящихся величин в кадре: клетка на пиксель.
        assert len(awake) == 158
    finally:
        session.close()


def test_a_session_answers_about_a_field_by_counting_it():
    session = vision_session()
    try:
        session.show("eye", samples.get("T").frame())
        session.step(10.0)
        # Не кадром: ответ уходит на каждый кадр показа, и 576 величин в нём
        # были бы потоком ради картинки, которая меняется по требованию.
        assert session.update()["sensors"]["eye"] == {
            "values": 576,
            "lit": 158,
            "mean": 1.0,
        }
    finally:
        session.close()


def test_the_frame_itself_comes_when_asked():
    session = vision_session()
    try:
        session.show("eye", samples.get("T").frame())
        frame = session.frames()["eye"]
        assert len(frame) == 576
        assert sum(1 for value in frame if value > 0) == 158
    finally:
        session.close()


def test_rewinding_keeps_the_frame_that_was_shown_before_it():
    session = vision_session()
    try:
        session.show("eye", samples.get("T").frame())
        session.step(120.0)
        session.seek(40.0)
        # Кадр показан на нуле -- значит на сороковой он держится: запись
        # входа переигрывается, как переигрывается нажатие кнопки.
        assert sum(1 for value in session.frames()["eye"] if value > 0) == 158
    finally:
        session.close()


def test_the_same_shown_frame_replays_spike_for_spike():
    frame = samples.get("T").frame()
    runs = []
    for _ in range(2):
        session = vision_session()
        try:
            session.show("eye", frame)
            session.step(80.0)
            runs.append(session.update()["spikes"])
        finally:
            session.close()
    assert runs[0] == runs[1]


def test_a_number_offered_to_a_whole_field_is_refused():
    model, _ = load(
        (EXAMPLES / "vision.vnl").read_text(encoding="utf-8"), strict=True
    )
    sim = Simulator(model)
    with pytest.raises(Exception) as failure:
        sim.sense_at(0.0, "eye", 1.0)
    # Одно число на имя поля легло бы в первый пиксель из 576 -- почти
    # наверняка не то, что имели в виду.
    assert "576 величин" in str(failure.value)


# --- те же операции по HTTP ------------------------------------------------
#
# Настоящий сервер на свободном порту, как в `test_server.py`: подменить
# обработчик вызовом Python значило бы проверить всё, кроме разбора запроса и
# кода ответа, -- а именно там живут ошибки этого слоя.


@pytest.fixture
def base(tmp_path):
    import threading

    from vnl.server import create_server
    from vnl.store import Store

    Store(tmp_path).save_pattern(retina())
    server = create_server(tmp_path, port=0, quiet=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def call(base: str, method: str, path: str, payload=None):
    import urllib.error
    import urllib.request
    from urllib.parse import quote

    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        base + quote(path, safe="/?&=+,%"), data=data, method=method
    )
    if data:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=20) as answer:
            body = answer.read().decode("utf-8")
            return answer.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        return error.code, json.loads(body) if body else {}


def test_the_samples_are_open_like_the_catalog(base):
    status, payload = call(base, "GET", "/api/samples")
    assert status == 200
    names = {item["id"] for item in payload["samples"]}
    assert {"T", "O", "I"} <= names


def test_showing_a_sample_by_name_makes_the_layer_answer(base):
    _, opened = call(base, "POST", "/api/sim", {"pattern": "retina24"})
    sim = opened["id"]
    status, shown = call(
        base, "POST", f"/api/sim/{sim}/frames", {"eye": {"sample": "T"}}
    )
    assert status == 200, shown
    assert shown["sensors"]["eye"]["lit"] == 158
    _, stepped = call(base, "POST", f"/api/sim/{sim}/step", {"delta": 60})
    awake = [
        name
        for name, cell in stepped["cells"].items()
        if cell["spiked"] or cell["peak"] >= 1
    ]
    assert len(awake) == 158


def test_a_ready_frame_travels_as_numbers(base):
    _, opened = call(base, "POST", "/api/sim", {"pattern": "retina24"})
    sim = opened["id"]
    frame = [0.0] * 576
    frame[5] = 1.0
    status, shown = call(base, "POST", f"/api/sim/{sim}/frames", {"eye": {"frame": frame}})
    assert status == 200
    assert shown["sensors"]["eye"]["lit"] == 1
    _, held = call(base, "GET", f"/api/sim/{sim}/frames")
    assert held["frames"]["eye"][5] == 1.0


def test_a_sample_of_another_grid_is_refused_instead_of_stretched(base):
    _, opened = call(base, "POST", "/api/sim", {"pattern": "retina24"})
    sim = opened["id"]
    # Образец 24x24 на поле другой сетки -- другая картинка, и растянуть его
    # молча значило бы показать сети не то, что выбрал человек. Здесь сетки
    # совпадают, поэтому проверяем обратную сторону: кадр не по размеру.
    status, refused = call(
        base, "POST", f"/api/sim/{sim}/frames", {"eye": {"frame": [1.0] * 100}}
    )
    assert status >= 400
    assert "576" in refused["error"]


def test_showing_into_a_door_that_does_not_exist_says_which_are_there(base):
    _, opened = call(base, "POST", "/api/sim", {"pattern": "retina24"})
    sim = opened["id"]
    status, refused = call(
        base, "POST", f"/api/sim/{sim}/frames", {"глаз": {"sample": "T"}}
    )
    assert status >= 400
    assert "eye" in refused["error"]
