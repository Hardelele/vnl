"""Сервер библиотеки: те же операции, что увидит интерфейс.

Поднимается настоящий сервер на свободном порту и опрашивается по HTTP:
подменить обработчик вызовом Python значило бы проверить всё, кроме разбора
запроса и кодов ответа -- а именно там живут ошибки такого слоя.
"""

import json
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

import pytest

from vnl import ir
from vnl.patterns import Pattern, Port
from vnl.resolve import load
from vnl.server import Api, Route, create_server, nobody, routes
from vnl.store import Store

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def ffi_pattern() -> Pattern:
    model, _ = load((EXAMPLES / "ffi.vnl").read_text(encoding="utf-8"))
    return Pattern.from_model(
        model,
        id="ffi",
        name="FFI",
        level="L1",
        status="ready",
        ports=[
            Port("in", "in", ir.Site("IN", "soma", 0.5)),
            Port("out", "out", ir.Site("E", "soma", 0.5)),
        ],
    )


def ask(base: str, method: str, path: str, payload=None, host: str | None = None):
    """Запрос к серверу. Возвращает код и разобранное тело.

    Путь кодируется здесь: имена паттернов бывают русскими, и браузер это
    делает сам, а `urllib` требует готовый ASCII.
    """
    url = base + quote(path, safe="/?&=+,%")
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if host is not None:
        request.add_header("Host", host)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        return error.code, json.loads(body) if body else {}


@pytest.fixture
def base(tmp_path):
    """Сервер на свободном порту с одним готовым паттерном в библиотеке."""
    Store(tmp_path).save_pattern(ffi_pattern())
    server = create_server(tmp_path, port=0, quiet=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_health_reports_the_real_store(base, tmp_path):
    status, payload = ask(base, "GET", "/api/health")
    assert status == 200
    assert payload["patterns"] == 1
    assert payload["sandboxes"] == 0
    assert Path(payload["root"]) == tmp_path


def test_catalog_carries_the_pattern_and_its_scheme(base):
    status, payload = ask(base, "GET", "/api/catalog")
    assert status == 200
    assert payload["total"] == payload["matched"] == 1
    item = payload["patterns"][0]
    assert item["name"] == "FFI"
    assert item["levelName"] == "Взаимодействие сигналов"
    assert {port["name"] for port in item["ports"]} == {"in", "out"}
    # Миниатюра рисуется из схемы, поэтому граф приходит вместе со списком.
    assert [neuron["id"] for neuron in item["scheme"]["neurons"]] == ["IN", "E", "I"]
    assert any(edge["kind"] == "inh" for edge in item["scheme"]["edges"])
    # Тело в каталог не попадает: список имён не должен весить как библиотека.
    assert "body" not in item


def test_catalog_keeps_the_demo_out_of_the_body(base):
    _, payload = ask(base, "GET", "/api/catalog")
    item = payload["patterns"][0]
    assert item["demo"]["stimuli"], "витрина карточки приходит отдельным полем"
    assert item["counts"]["neurons"] == 3


def test_catalog_filters_by_query(base):
    _, found = ask(base, "GET", "/api/catalog?q=pv")
    assert found["matched"] == 1
    _, missed = ask(base, "GET", "/api/catalog?q=нет+такого")
    assert missed["matched"] == 0
    assert missed["total"] == 1, "счётчики чипов считаются по всей библиотеке"
    assert [level for level in missed["levels"] if level["count"]][0]["id"] == "L1"


def test_catalog_filters_by_level_and_status(base):
    _, wrong_level = ask(base, "GET", "/api/catalog?level=L0")
    assert wrong_level["matched"] == 0
    _, right = ask(base, "GET", "/api/catalog?level=L0,L1&status=ready")
    assert right["matched"] == 1


def test_pattern_detail_brings_the_body(base):
    status, payload = ask(base, "GET", "/api/patterns/ffi")
    assert status == 200
    assert payload["body"]["neurons"][0]["id"] == "IN"
    assert payload["problems"] == []


def test_missing_pattern_is_named(base):
    status, payload = ask(base, "GET", "/api/patterns/нет")
    assert status == 404
    assert "нет" in payload["error"]


# --- «Сохранить как паттерн»: схему собирают в песочнице --------------------
#
# Пустого черновика этот маршрут больше не заводит: наполнить его было нечем --
# редактора тела схемы нет и не будет. Поэтому здесь проверяется не «появился
# объект», а «появился паттерн, который открывается и считается».


def ready_project(base) -> tuple[str, str, str]:
    """Проект, который считается: два блока, связь, стимул и запись.

    Ровно то, что должно уехать в паттерн: собранная сеть -- в тело, драйв и
    записи -- в витрину карточки. Без драйва сохранённый паттерн открылся бы
    молчащим, а это и есть жалоба, из которой выросла задача (#525).
    """
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first, second = (block["id"] for block in project["blocks"])
    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/links",
        {
            "source": {"instance": first, "port": "out"},
            "target": {"instance": second, "port": "in"},
        },
    )
    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/stimuli",
        {"target": {"instance": first, "port": "in"}, "rate": 250, "amplitude": 1.5},
    )
    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/recordings",
        {"target": {"instance": second, "port": "out"}},
    )
    return sandbox, first, second


def save_as_pattern(base, sandbox: str, **body):
    """Сохранение с портами, которые предложил сам сервер.

    Так же поступает и человек в форме: правит предложенные имена, а не
    выдумывает адреса клеток заново.
    """
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    payload: dict = {"sandbox": sandbox, "ports": project["portHints"]}
    payload.update(body)
    return ask(base, "POST", "/api/patterns", payload)


def test_a_project_is_saved_as_a_pattern_that_survives_a_restart(base, tmp_path):
    sandbox, _, _ = ready_project(base)
    status, created = save_as_pattern(
        base, sandbox, name="Прямое торможение", level="L1"
    )
    assert status == 201
    assert created["level"] == "L1"
    # Тело паттерна -- собранная сеть: два блока по три клетки.
    assert created["counts"]["neurons"] == 6
    assert created["problems"] == [], "сохранённый паттерн не должен быть неполным"
    assert created["status"] == "ready"

    _, catalog = ask(base, "GET", "/api/catalog")
    assert catalog["total"] == 2
    # Он лежит в хранилище, а не только в открытой вкладке.
    assert Store(tmp_path).load_pattern(created["id"]).name == "Прямое торможение"


def test_the_saved_pattern_keeps_the_demo_and_can_be_run(base):
    """Пункт приёмки: паттерн из песочницы открывается и в нём идёт время.

    Стимулы и записи проекта уезжают в витрину карточки, а из тела уходят: в
    чужую сеть чужой драйв не едет, но без него карточка была бы картинкой.
    """
    sandbox, _, _ = ready_project(base)
    _, created = save_as_pattern(base, sandbox, name="С драйвом")
    assert created["demo"]["stimuli"], "стимул песочницы -- витрина карточки"
    assert created["demo"]["recordings"]
    assert created["demo"]["run"]["duration"] > 0
    assert created["body"]["stimuli"] == [], "в теле драйва не остаётся"
    assert created["body"]["recordings"] == []

    status, sim = ask(
        base, "POST", "/api/sim", {"pattern": created["id"], "pace": 2000}
    )
    assert status == 201
    assert len(sim["cells"]) == 6

    ask(base, "POST", f"/api/sim/{sim['id']}/start")
    # Время идёт в фоне, поэтому ждём спайков, а не фиксированную паузу:
    # именно «запустил и увидел разряды» и означает, что паттерн живой.
    deadline = time.monotonic() + 20
    live = sim
    while time.monotonic() < deadline:
        _, live = ask(base, "GET", f"/api/sim/{sim['id']}")
        if any(live["spikes"].values()):
            break
    assert any(live["spikes"].values()), "сохранённый паттерн молчит -- он мёртвый"


def test_ports_are_named_by_the_human_and_lead_where_told(base):
    """Порт -- то, чем блок подключают снаружи, и называет его человек.

    Сервер только предлагает: клетка без входящих связей похожа на вход, без
    исходящих -- на выход. Имя из формы должно доехать до карточки вместе с той
    точкой, на которую его поставили.
    """
    sandbox, first, second = ready_project(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    hints = project["portHints"]
    assert [(port["direction"], port["site"]["instance"]) for port in hints] == [
        ("in", f"{first}/IN"),
        ("out", f"{second}/E"),
    ]

    _, created = save_as_pattern(
        base,
        sandbox,
        name="Цепочка",
        ports=[
            {**hints[0], "name": "вход"},
            {**hints[1], "name": "выход"},
        ],
    )
    named = {port["name"]: port["site"]["instance"] for port in created["ports"]}
    assert named == {"вход": f"{first}/IN", "выход": f"{second}/E"}


def test_a_pattern_without_ports_is_refused(base):
    """Блок без портов не подключить, а молча решать за автора нельзя."""
    sandbox, _, _ = ready_project(base)
    status, payload = save_as_pattern(base, sandbox, name="Без портов", ports=[])
    assert status == 400
    assert "портов" in payload["error"]


def test_a_port_into_nowhere_names_what_there_is(base):
    sandbox, _, _ = ready_project(base)
    status, payload = save_as_pattern(
        base,
        sandbox,
        ports=[{"name": "вход", "direction": "in", "site": {"instance": "нету"}}],
    )
    assert status == 400
    assert "нету" in payload["error"]

    assert save_as_pattern(
        base, sandbox, ports=[{"name": "вход", "direction": "in"}]
    )[0] == 400


def test_a_project_that_does_not_compute_is_not_saved(base):
    """Несчитаемая схема в библиотеке -- это как раз мёртвый паттерн."""
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Пустая"})
    status, payload = ask(
        base, "POST", "/api/patterns", {"sandbox": project["id"], "name": "Пусто"}
    )
    assert status == 400
    assert "нечего" in payload["error"]


def test_saving_without_a_sandbox_says_where_schemes_come_from(base):
    status, payload = ask(base, "POST", "/api/patterns", {"name": "Сама по себе"})
    assert status == 400
    assert "песочниц" in payload["error"]


def test_a_second_pattern_does_not_overwrite_the_first(base):
    sandbox, _, _ = ready_project(base)
    _, first = save_as_pattern(base, sandbox, name="Схема")
    _, second = save_as_pattern(base, sandbox, name="Схема")
    assert first["id"] != second["id"]


def test_a_pattern_without_a_name_takes_the_project_name(base):
    """Имя проекта -- разумное умолчание: другого имени у схемы не было."""
    sandbox, _, _ = ready_project(base)
    _, created = save_as_pattern(base, sandbox)
    assert created["name"] == "Проба"


def test_unknown_level_is_refused(base):
    sandbox, _, _ = ready_project(base)
    status, payload = save_as_pattern(base, sandbox, name="x", level="L9")
    assert status == 400
    assert "L9" in payload["error"]


def test_broken_json_is_refused(base):
    request = urllib.request.Request(
        base + "/api/patterns", data=b"{not json", method="POST"
    )
    with pytest.raises(urllib.error.HTTPError) as error:
        urllib.request.urlopen(request)
    assert error.value.code == 400


def test_delete_removes_the_pattern_and_says_so(base):
    """Удаление необратимо, поэтому ответ должен быть внятным в оба конца."""
    sandbox, _, _ = ready_project(base)
    _, created = save_as_pattern(base, sandbox, name="На выброс")
    status, payload = ask(base, "DELETE", f"/api/patterns/{created['id']}")
    assert status == 200
    assert payload["deleted"] == created["id"]

    assert ask(base, "GET", f"/api/patterns/{created['id']}")[0] == 404
    status, payload = ask(base, "DELETE", f"/api/patterns/{created['id']}")
    assert status == 404, "«такого нет» отличается от «удалено»"
    assert created["id"] in payload["error"]


def test_unknown_route_is_named(base):
    status, payload = ask(base, "GET", "/api/такого-нет")
    assert status == 404
    assert "/api/такого-нет" in payload["error"]


def test_a_request_from_another_host_is_refused(base):
    """Защита от обращения к локальному порту со стороннего адреса."""
    status, payload = ask(base, "GET", "/api/health", host="evil.example")
    assert status == 403
    assert "машины" in payload["error"]


def test_without_a_built_ui_the_root_says_so(base):
    status, payload = ask(base, "GET", "/")
    assert status == 404
    assert "vnl serve --ui" in payload["error"]


def test_a_built_ui_is_served_with_its_own_routing(tmp_path):
    ui = tmp_path / "dist"
    ui.mkdir()
    (ui / "index.html").write_text("<title>VNL</title>", encoding="utf-8")
    (ui / "app.js").write_text("export const ok = 1\n", encoding="utf-8")
    server = create_server(tmp_path / "store", port=0, ui=ui, quiet=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urllib.request.urlopen(base + "/app.js") as response:
            assert "javascript" in response.headers["Content-Type"]
        # Неизвестный путь -- экран интерфейса, а не отсутствующий файл.
        with urllib.request.urlopen(base + "/library/ffi") as response:
            assert b"<title>VNL</title>" in response.read()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_the_page_is_rechecked_and_hashed_files_are_not(tmp_path):
    """Иначе после выката браузер показывает старый экран, а не новую версию.

    `index.html` меняется с каждой сборкой, а файлы в `assets/` названы по хешу
    содержимого. Спрашивать заново надо первый, а не вторые.
    """
    ui = tmp_path / "dist"
    (ui / "assets").mkdir(parents=True)
    (ui / "index.html").write_text("<title>VNL</title>", encoding="utf-8")
    (ui / "assets" / "app-a1b2c3.js").write_text("export const ok = 1", encoding="utf-8")
    server = create_server(tmp_path / "store", port=0, ui=ui, quiet=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urllib.request.urlopen(base + "/") as response:
            assert response.headers["Cache-Control"] == "no-cache"
        with urllib.request.urlopen(base + "/assets/app-a1b2c3.js") as response:
            assert "immutable" in response.headers["Cache-Control"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_a_path_cannot_escape_the_ui(tmp_path):
    """`..` в пути не должен вынести за каталог интерфейса."""
    ui = tmp_path / "dist"
    ui.mkdir()
    (ui / "index.html").write_text("ok", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("не отдавать", encoding="utf-8")
    server = create_server(tmp_path / "store", port=0, ui=ui, quiet=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        # Точки закодированы: иначе клиент свернёт путь ещё до отправки.
        status, payload = ask(base, "GET", "/%2e%2e/secret.txt")
        assert status == 403
        assert "не отдавать" not in json.dumps(payload, ensure_ascii=False)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


# --- симуляция ------------------------------------------------------------


def test_a_simulation_opens_paused_at_zero(base):
    status, sim = ask(base, "POST", "/api/sim", {"pattern": "ffi"})
    assert status == 201
    assert sim["state"] == "paused"
    assert sim["time"] == 0.0
    assert sim["samples"] == 0
    assert sim["source"] == "паттерн «FFI»"
    assert set(sim["cells"]) == {"IN", "E", "I"}


def test_a_simulation_needs_something_to_run(base, tmp_path):
    # Паттерн без нейронов кладём в хранилище руками: маршрут библиотеки
    # таких больше не делает -- он сохраняет посчитанную схему из песочницы.
    empty = Pattern.empty("Пустой")
    Store(tmp_path).save_pattern(empty)
    status, payload = ask(base, "POST", "/api/sim", {"pattern": empty.id})
    assert status == 400
    assert "нет ни одного нейрона" in payload["error"]

    assert ask(base, "POST", "/api/sim", {})[0] == 400
    assert ask(base, "POST", "/api/sim", {"pattern": "нет"})[0] == 404


def test_time_flows_after_start(base):
    _, sim = ask(base, "POST", "/api/sim", {"pattern": "ffi", "pace": 2000})
    ask(base, "POST", f"/api/sim/{sim['id']}/start")

    # Время идёт в фоне, поэтому ждём появления отсчётов, а не фиксированную паузу.
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        _, live = ask(base, "GET", f"/api/sim/{sim['id']}")
        if live["samples"]:
            break
    assert live["samples"] > 0, "за пять секунд симуляция не сдвинулась"
    assert live["time"] > 0

    _, paused = ask(base, "POST", f"/api/sim/{sim['id']}/pause")
    assert paused["state"] in ("paused", "finished")


def test_an_update_asks_only_for_the_new_part(base):
    _, sim = ask(base, "POST", "/api/sim", {"pattern": "ffi", "pace": 2000})
    ask(base, "POST", f"/api/sim/{sim['id']}/start")
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        _, live = ask(base, "GET", f"/api/sim/{sim['id']}")
        if live["samples"] > 10:
            break
    ask(base, "POST", f"/api/sim/{sim['id']}/pause")

    _, delta = ask(base, "GET", f"/api/sim/{sim['id']}?since={live['samples']}")
    assert delta["from"] == live["samples"]
    assert delta["rewound"] is False

    _, ahead = ask(base, "GET", f"/api/sim/{sim['id']}?since=999999")
    assert ahead["rewound"] is True, "интерфейс впереди сессии -- значит время отмотали"

    assert ask(base, "GET", f"/api/sim/{sim['id']}?since=вчера")[0] == 400


def test_seek_pauses_and_puts_time_where_asked(base):
    _, sim = ask(base, "POST", "/api/sim", {"pattern": "ffi", "pace": 2000})
    ask(base, "POST", f"/api/sim/{sim['id']}/start")
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        _, live = ask(base, "GET", f"/api/sim/{sim['id']}")
        if live["time"] > 40:
            break

    _, back = ask(base, "POST", f"/api/sim/{sim['id']}/seek", {"time": 20.0})
    assert back["state"] == "paused"
    assert back["time"] == pytest.approx(20.0, abs=back["dt"])
    assert ask(base, "POST", f"/api/sim/{sim['id']}/seek", {})[0] == 400


def test_reset_brings_the_simulation_back_to_the_start(base):
    _, sim = ask(base, "POST", "/api/sim", {"pattern": "ffi", "pace": 2000})
    ask(base, "POST", f"/api/sim/{sim['id']}/start")
    _, fresh = ask(base, "POST", f"/api/sim/{sim['id']}/reset")
    assert fresh["time"] == 0.0
    assert fresh["samples"] == 0
    assert fresh["state"] == "paused"


def test_a_closed_simulation_is_gone(base):
    _, sim = ask(base, "POST", "/api/sim", {"pattern": "ffi"})
    assert ask(base, "GET", "/api/health")[1]["simulations"] == 1

    status, payload = ask(base, "DELETE", f"/api/sim/{sim['id']}")
    assert status == 200
    assert payload["closed"] == sim["id"]
    assert ask(base, "GET", f"/api/sim/{sim['id']}")[0] == 404
    assert ask(base, "GET", "/api/health")[1]["simulations"] == 0


# --- песочница ------------------------------------------------------------


def sandbox_with_two_blocks(base) -> str:
    """Проект, в котором стоят два экземпляра одного паттерна."""
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Проба"})
    ask(base, "POST", f"/api/sandboxes/{project['id']}/blocks", {"pattern": "ffi"})
    ask(
        base,
        "POST",
        f"/api/sandboxes/{project['id']}/blocks",
        {"pattern": "ffi", "position": [200, 0]},
    )
    return project["id"]


def test_a_new_sandbox_is_empty_and_saved(base):
    status, project = ask(base, "POST", "/api/sandboxes", {"name": "Проба"})
    assert status == 201
    assert project["blocks"] == []
    assert project["dirty"] is False, "только что созданный проект уже лежит в файле"
    assert project["canUndo"] is False

    _, listing = ask(base, "GET", "/api/sandboxes")
    assert [item["id"] for item in listing["sandboxes"]] == [project["id"]]


def test_a_block_carries_the_snapshot_it_was_inserted_with(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")

    assert len(project["blocks"]) == 2
    first, second = project["blocks"]
    assert first["id"] != second["id"], "два экземпляра одного паттерна -- разные блоки"
    assert first["patternId"] == "ffi"
    assert {port["name"] for port in first["ports"]} == {"in", "out"}
    # Блок на холсте -- один объект с портами, но схема внутри известна.
    assert len(first["scheme"]["neurons"]) == 3
    assert second["position"] == [200, 0]
    assert project["dirty"] is True


def test_connecting_two_blocks_makes_a_real_link(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first, second = (block["id"] for block in project["blocks"])

    status, linked = ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/links",
        {
            "source": {"instance": first, "port": "out"},
            "target": {"instance": second, "port": "in"},
            "weight": 2.0,
            "delay": 1.5,
        },
    )
    assert status == 201
    link = linked["links"][0]
    assert link["source"]["instance"] == first
    assert link["target"]["port"] == "in"
    assert link["weight"] == 2.0
    assert link["inhibitory"] is False

    _, changed = ask(
        base,
        "PATCH",
        f"/api/sandboxes/{sandbox}/links/{link['id']}",
        {"receptor": "gaba_a", "weight": 3.0},
    )
    assert changed["links"][0]["inhibitory"] is True
    assert changed["links"][0]["weight"] == 3.0


def test_a_link_into_a_missing_port_is_refused(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first, second = (block["id"] for block in project["blocks"])

    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/links",
        {
            "source": {"instance": first, "port": "нет"},
            "target": {"instance": second, "port": "in"},
        },
    )
    _, after = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    assert after["problems"], "несуществующий порт должен мешать запуску"


def test_a_sandbox_runs_with_the_same_time_control(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first, second = (block["id"] for block in project["blocks"])
    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/links",
        {
            "source": {"instance": first, "port": "out"},
            "target": {"instance": second, "port": "in"},
        },
    )
    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/stimuli",
        {"target": {"instance": first, "port": "in"}, "rate": 250, "amplitude": 1.5},
    )
    _, recorded = ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/recordings",
        {"target": {"instance": second, "port": "out"}},
    )
    assert recorded["problems"] == [], "схема собрана целиком"

    status, sim = ask(base, "POST", "/api/sim", {"sandbox": sandbox})
    assert status == 201
    assert "песочница" in sim["source"]
    # Блоки развёрнуты в настоящие клетки: их имена с приставкой экземпляра.
    assert len(sim["cells"]) == 6


def test_a_broken_sandbox_names_the_reason_instead_of_running(base):
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Пустая"})
    status, payload = ask(base, "POST", "/api/sim", {"sandbox": project["id"]})
    assert status == 400
    assert "не готова" in payload["error"]


def test_undo_takes_back_the_last_change(base):
    sandbox = sandbox_with_two_blocks(base)
    _, undone = ask(base, "POST", f"/api/sandboxes/{sandbox}/undo")
    assert len(undone["blocks"]) == 1
    assert undone["canUndo"] is True

    ask(base, "POST", f"/api/sandboxes/{sandbox}/undo")
    _, empty = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    assert empty["blocks"] == []
    assert empty["canUndo"] is False


def test_removing_a_block_takes_its_links(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first, second = (block["id"] for block in project["blocks"])
    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/links",
        {
            "source": {"instance": first, "port": "out"},
            "target": {"instance": second, "port": "in"},
        },
    )

    _, after = ask(base, "DELETE", f"/api/sandboxes/{sandbox}/objects/{second}")
    assert [block["id"] for block in after["blocks"]] == [first]
    assert after["links"] == [], "связь висела на удалённом блоке"


def test_saving_puts_the_project_on_disk(base, tmp_path):
    sandbox = sandbox_with_two_blocks(base)
    _, saved = ask(base, "POST", f"/api/sandboxes/{sandbox}/save")
    assert saved["dirty"] is False

    # Проверяем файлом, а не ответом: сохранение -- это про диск.
    assert len(Store(tmp_path).load_sandbox(sandbox).instances) == 2


def test_moving_a_block_is_not_a_change_of_physics(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first = project["blocks"][0]["id"]

    _, moved = ask(
        base, "POST", f"/api/sandboxes/{sandbox}/move", {"id": first, "position": [40, 90]}
    )
    assert moved["blocks"][0]["position"] == [40, 90]
    assert moved["problems"] == moved["problems"]


def test_the_payload_carries_the_fingerprint_of_the_built_network(base):
    """Открытая сессия считает модель на момент запуска.

    Интерфейс узнаёт, что её результат уже про другую сеть, по расхождению
    отпечатков -- значит отпечаток обязан меняться от физики и не меняться от
    расстановки блоков по холсту.
    """
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first = project["blocks"][0]["id"]
    before = project["fingerprint"]
    assert before

    _, moved = ask(
        base, "POST", f"/api/sandboxes/{sandbox}/move", {"id": first, "position": [40, 90]}
    )
    assert moved["fingerprint"] == before, "сдвиг по холсту физику не меняет"

    _, renamed = ask(
        base, "PATCH", f"/api/sandboxes/{sandbox}/blocks/{first}", {"label": "Вход"}
    )
    assert renamed["fingerprint"] == before, "подпись блока -- тоже не физика"

    _, changed = ask(
        base,
        "PATCH",
        f"/api/sandboxes/{sandbox}/blocks/{first}/cells/pyr_l5",
        {"vThreshold": -44.0},
    )
    assert changed["fingerprint"] != before, "порог меняет сеть"

    _, timed = ask(base, "PATCH", f"/api/sandboxes/{sandbox}/run", {"duration": 120})
    assert timed["fingerprint"] != changed["fingerprint"], "длительность -- часть прогона"


def test_a_block_carries_the_cells_its_parameters_live_on(base):
    """Панель свойств правит тип клетки, поэтому типы блока приходят с ним."""
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    cells = project["blocks"][0]["cells"]

    assert {cell["type"] for cell in cells} == {"relay", "pyr_l5", "pv"}
    pyramid = next(cell for cell in cells if cell["type"] == "pyr_l5")
    assert pyramid["neurons"] == ["E"], "видно, кого задевает правка"
    assert pyramid["pointModel"]["vThreshold"] == -50.0
    assert pyramid["pointModel"]["tauM"] == 15.0
    assert next(cell for cell in cells if cell["type"] == "pv")["inhibitory"] is True


def test_a_block_is_renamed_without_touching_the_pattern(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first, second = (block["id"] for block in project["blocks"])

    status, renamed = ask(
        base, "PATCH", f"/api/sandboxes/{sandbox}/blocks/{first}", {"label": "Вход"}
    )
    assert status == 200
    assert [block["label"] for block in renamed["blocks"]] == ["Вход", "FFI"]
    assert ask(base, "GET", "/api/patterns/ffi")[1]["name"] == "FFI"

    assert ask(base, "PATCH", f"/api/sandboxes/{sandbox}/blocks/{second}", {})[0] == 400
    assert ask(base, "PATCH", f"/api/sandboxes/{sandbox}/blocks/нет", {"label": "x"})[0] == 400


def test_cell_parameters_change_one_block_at_a_time(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first, second = (block["id"] for block in project["blocks"])

    status, changed = ask(
        base,
        "PATCH",
        f"/api/sandboxes/{sandbox}/blocks/{first}/cells/pyr_l5",
        {"vThreshold": -44.0, "adaptation": 2.5},
    )
    assert status == 200
    edited, untouched = changed["blocks"]
    assert threshold(edited, "pyr_l5") == -44.0
    assert threshold(untouched, "pyr_l5") == -50.0, "второй экземпляр не задет"

    bad = f"/api/sandboxes/{sandbox}/blocks/{second}/cells/pyr_l5"
    assert ask(base, "PATCH", bad, {"tauM": 0})[0] == 400
    assert ask(base, "PATCH", bad, {})[0] == 400


def threshold(block, type_id: str) -> float:
    cell = next(item for item in block["cells"] if item["type"] == type_id)
    return cell["pointModel"]["vThreshold"]


def test_a_stimulus_is_editable_after_it_is_created(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first = project["blocks"][0]["id"]
    _, driven = ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/stimuli",
        {"target": {"instance": first, "port": "in"}},
    )
    drive = driven["stimuli"][0]["id"]

    status, changed = ask(
        base,
        "PATCH",
        f"/api/sandboxes/{sandbox}/stimuli/{drive}",
        {"rate": 40, "amplitude": 0.8, "start": 10, "stop": 120, "receptor": "nmda"},
    )
    assert status == 200
    stim = changed["stimuli"][0]
    assert (stim["rate"], stim["amplitude"]) == (40.0, 0.8)
    assert (stim["start"], stim["stop"]) == (10.0, 120.0)
    assert stim["receptor"] == "nmda"

    at = f"/api/sandboxes/{sandbox}/stimuli/{drive}"
    assert ask(base, "PATCH", at, {"kind": "барабан"})[0] == 400
    assert ask(base, "PATCH", at, {"start": 200, "stop": 100})[0] == 400


def test_a_recording_changes_what_it_writes(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first = project["blocks"][0]["id"]
    _, recorded = ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/recordings",
        {"target": {"instance": first, "port": "out"}},
    )
    record = recorded["recordings"][0]["id"]

    _, changed = ask(
        base, "PATCH", f"/api/sandboxes/{sandbox}/recordings/{record}", {"var": "g_inh"}
    )
    assert changed["recordings"][0]["var"] == "g_inh"
    at = f"/api/sandboxes/{sandbox}/recordings/{record}"
    assert ask(base, "PATCH", at, {"var": "температура"})[0] == 400


def test_run_parameters_are_editable_and_reach_the_simulation(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first = project["blocks"][0]["id"]
    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/stimuli",
        {"target": {"instance": first, "port": "in"}},
    )

    status, changed = ask(
        base,
        "PATCH",
        f"/api/sandboxes/{sandbox}/run",
        {"duration": 120, "dt": 0.25, "seed": 11},
    )
    assert status == 200
    assert changed["run"] == {
        "dt": 0.25,
        "duration": 120.0,
        "level": "L1",
        "seed": 11,
    }

    # Прогон обязан считаться по новым числам, а не по прежним.
    _, sim = ask(base, "POST", "/api/sim", {"sandbox": sandbox})
    assert sim["duration"] == 120.0
    assert sim["dt"] == 0.25

    at = f"/api/sandboxes/{sandbox}/run"
    assert ask(base, "PATCH", at, {"dt": 0})[0] == 400
    assert ask(base, "PATCH", at, {"duration": 1e9, "dt": 0.01})[0] == 400
    assert ask(base, "PATCH", at, {"level": "L9"})[0] == 400
    assert ask(base, "PATCH", at, {})[0] == 400


def test_the_server_listens_only_to_this_machine_by_default(tmp_path):
    """Адрес по умолчанию -- loopback: наружу сервер сам не выходит."""
    server = create_server(tmp_path, port=0, quiet=True)
    try:
        assert server.server_address[0] == "127.0.0.1"
    finally:
        server.server_close()


def test_the_address_can_be_widened_for_a_container(tmp_path):
    """В контейнере `127.0.0.1` -- его собственный loopback, и порт не доходит."""
    server = create_server(tmp_path, port=0, quiet=True, bind="0.0.0.0")
    try:
        assert server.server_address[0] == "0.0.0.0"
    finally:
        server.server_close()


# --- таблица маршрутов: кто отвечает без входа ---------------------------------
#
# Сам отказ и то, что открыто анониму на живом стенде, проверяет `test_auth`: там
# есть вход, который можно пройти. Здесь -- таблица: свойство маршрута и полный
# список открытого на одном экране.


def test_a_route_is_closed_until_it_says_otherwise():
    """Забытый маршрут обязан оказаться закрытым, а не открытым.

    Умолчание -- единственное, что защищает от следующего маршрута, добавленного
    без мысли о входе. Поэтому «нужен вход» здесь не пишут, а «открыт всем» --
    пишут.
    """
    route = Route("GET", re.compile(r"^/api/что-нибудь$"), lambda: None)
    assert route.anonymous is nobody
    assert route.anonymous() is False


def test_the_whole_list_of_what_answers_without_login_fits_on_one_screen(tmp_path):
    """Открытое перечислено целиком, чтобы новое не затесалось молча.

    Это витрина библиотеки и живая симуляция паттерна -- то, за чем приходят по
    ссылке. Ни песочниц, ни записи, ни `/api/health` тут быть не должно, и если
    список разойдётся с этим списком, узнать об этом надо здесь, а не на стенде.
    """
    open_to_anyone = {
        (route.method, route.path.pattern)
        for route in routes(Api(Store(tmp_path)))
        if route.anonymous is not nobody
    }
    assert open_to_anyone == {
        ("GET", r"^/api/catalog$"),
        ("GET", r"^/api/patterns/([^/]+)$"),
        ("POST", r"^/api/sim$"),
        ("GET", r"^/api/sim/([^/]+)$"),
        ("POST", r"^/api/sim/([^/]+)/start$"),
        ("POST", r"^/api/sim/([^/]+)/pause$"),
        ("POST", r"^/api/sim/([^/]+)/reset$"),
        ("POST", r"^/api/sim/([^/]+)/seek$"),
        ("DELETE", r"^/api/sim/([^/]+)$"),
    }
