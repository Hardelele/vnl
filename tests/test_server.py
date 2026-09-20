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
from vnl.compose import compose
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


def test_a_sandbox_without_drive_warns_but_is_not_refused(base):
    """Схеме нечем спайкать: предупреждение есть, запрета нет (#506).

    Проверяется через HTTP целиком, потому что важно именно разделение полей:
    `problems` остаётся пустым (иначе запуск был бы закрыт), а прогон
    открывается и доходит до конца -- молчащая сеть тут правильный ответ
    модели, непонятен он только человеку.
    """
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Без драйва"})
    sandbox = project["id"]
    _, with_block = ask(
        base, "POST", f"/api/sandboxes/{sandbox}/blocks", {"pattern": "ffi"}
    )

    assert with_block["problems"] == [], "схема собирается: запрещать нечего"
    assert any("нечем спайкать" in note for note in with_block["warnings"]), (
        with_block["warnings"]
    )

    # Запуск при этом не закрыт: предупреждение -- подпись, а не отказ.
    status, _ = ask(base, "POST", "/api/sim", {"sandbox": sandbox})
    assert status == 201

    _, driven = ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/stimuli",
        {"target": {"instance": with_block["blocks"][0]["id"], "port": "in"}},
    )
    assert driven["warnings"] == [], "драйв есть -- предупреждению не о чем говорить"
    assert driven["problems"] == []


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


def test_a_block_is_taken_apart_into_cells_and_links(base):
    """Разбор -- смена вида, а не схемы: ответ отдаёт песочницу целиком (#532)."""
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first, second = (block["id"] for block in project["blocks"])
    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/stimuli",
        {"target": {"instance": first, "port": "in"}},
    )
    _, before = ask(base, "GET", f"/api/sandboxes/{sandbox}")

    status, after = ask(
        base, "POST", f"/api/sandboxes/{sandbox}/objects/{first}/ungroup"
    )
    assert status == 200
    assert [block["id"] for block in after["blocks"]] == [second]
    assert sorted(neuron["id"] for neuron in after["neurons"]) == ["E", "I", "IN"]
    assert len(after["links"]) == 3
    assert after["problems"] == []
    # Драйв бил в порт `in`, то есть в IN, -- туда же он бьёт и теперь.
    assert after["stimuli"][0]["target"]["instance"] == "IN"
    assert after["stimuli"][0]["target"]["port"] is None
    # Тормозная клетка осталась тормозной: тип приехал вместе с ней.
    assert next(item for item in after["neurons"] if item["id"] == "I")["inhibitory"]

    _, undone = ask(base, "POST", f"/api/sandboxes/{sandbox}/undo")
    assert [block["id"] for block in undone["blocks"]] == [first, second]
    assert undone["neurons"] == [] and len(undone["links"]) == 0
    assert undone["fingerprint"] == before["fingerprint"], "отмена вернула ту же сеть"


def test_ungroup_refuses_what_is_not_a_block(base):
    sandbox = sandbox_with_two_blocks(base)
    ask(base, "POST", f"/api/sandboxes/{sandbox}/neurons", {"cell": "pyr"})

    assert ask(base, "POST", f"/api/sandboxes/{sandbox}/objects/pyr/ungroup")[0] == 400
    assert ask(base, "POST", f"/api/sandboxes/{sandbox}/objects/нет/ungroup")[0] == 400


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


def test_arranging_moves_everything_in_one_step(base):
    """«Разложить»: места приходят готовыми, а «Отменить» возвращает их все.

    Считает раскладку интерфейс -- размеры фигур и раскрытие блока живут
    только там, -- а сервер отвечает, как на любую операцию песочницы, полным
    состоянием проекта.
    """
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first, second = (block["id"] for block in project["blocks"])
    before = {block["id"]: block["position"] for block in project["blocks"]}

    status, laid = ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/arrange",
        {"places": {first: [12, 30], second: [252, 30]}},
    )
    assert status == 200
    assert {block["id"]: block["position"] for block in laid["blocks"]} == {
        first: [12, 30],
        second: [252, 30],
    }
    assert laid["fingerprint"] == project["fingerprint"], "место физику не меняет"
    assert laid["dirty"] is True

    _, undone = ask(base, "POST", f"/api/sandboxes/{sandbox}/undo")
    assert {block["id"]: block["position"] for block in undone["blocks"]} == before


def test_arranging_an_unknown_object_says_what_is_wrong(base):
    sandbox = sandbox_with_two_blocks(base)
    status, answer = ask(
        base, "POST", f"/api/sandboxes/{sandbox}/arrange", {"places": {"нетакого": [0, 0]}}
    )
    assert status == 400
    assert "нет объектов" in answer["error"]


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
        f"/api/sandboxes/{sandbox}/objects/{first}/cells/pyr_l5",
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
        f"/api/sandboxes/{sandbox}/objects/{first}/cells/pyr_l5",
        {"vThreshold": -44.0, "adaptation": 2.5},
    )
    assert status == 200
    edited, untouched = changed["blocks"]
    assert threshold(edited, "pyr_l5") == -44.0
    assert threshold(untouched, "pyr_l5") == -50.0, "второй экземпляр не задет"

    bad = f"/api/sandboxes/{sandbox}/objects/{second}/cells/pyr_l5"
    assert ask(base, "PATCH", bad, {"tauM": 0})[0] == 400
    assert ask(base, "PATCH", bad, {})[0] == 400


def threshold(block, type_id: str) -> float:
    cell = next(item for item in block["cells"] if item["type"] == type_id)
    return cell["pointModel"]["vThreshold"]


def test_a_block_carries_the_contacts_of_its_snapshot(base):
    """Чтобы контакт правился, нужен его адрес, рецептор, вес и задержка (#531).

    Раньше у блока ехали только `scheme` и `counts`: по ним видно, кто с кем
    связан, но не за что взяться. Поля те же, что у связи песочницы, -- связь и
    контакт одна вещь с разными адресами.
    """
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    contacts = project["blocks"][0]["contacts"]

    assert [contact["id"] for contact in contacts] == ["c1", "c2", "c3"]
    inhibitory = next(item for item in contacts if item["id"] == "c3")
    assert inhibitory["pre"]["instance"] == "I", "адрес -- точка снимка, без приставки"
    assert inhibitory["post"]["instance"] == "E"
    assert inhibitory["receptor"] == "gaba_a"
    assert inhibitory["inhibitory"] is True, "тормозность считает сервер"
    assert (inhibitory["weight"], inhibitory["delay"]) == (0.9, 1.4)

    link = {"id", "source", "target", "receptor", "inhibitory", "weight", "delay"}
    assert set(contacts[0]) - {"pre", "post"} == link - {"source", "target"}


def test_a_contact_is_changed_one_block_at_a_time(base):
    """Снимок у экземпляра свой, поэтому задержка правится поблочно."""
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first, second = (block["id"] for block in project["blocks"])
    before = project["fingerprint"]

    status, changed = ask(
        base,
        "PATCH",
        f"/api/sandboxes/{sandbox}/objects/{first}/contacts/c3",
        {"delay": 4.0, "weight": 2.5, "receptor": "gaba_b"},
    )
    assert status == 200
    edited, untouched = changed["blocks"]
    assert contact_of(edited, "c3")["delay"] == 4.0
    assert contact_of(edited, "c3")["weight"] == 2.5
    assert contact_of(edited, "c3")["receptor"] == "gaba_b"
    assert contact_of(untouched, "c3")["delay"] == 1.4, "второй экземпляр не задет"
    assert changed["fingerprint"] != before, "задержка -- это физика"
    assert ask(base, "GET", "/api/patterns/ffi?body=1")[1]["body"]["contacts"][2][
        "delay"
    ] == 1.4, "библиотека не задета"

    _, undone = ask(base, "POST", f"/api/sandboxes/{sandbox}/undo")
    assert contact_of(undone["blocks"][0], "c3")["delay"] == 1.4
    assert undone["fingerprint"] == before, "отмена вернула прежнюю сеть"


def test_a_bad_contact_is_refused_the_same_way_as_a_bad_link(base):
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first = project["blocks"][0]["id"]
    at = f"/api/sandboxes/{sandbox}/objects/{first}/contacts/c1"

    assert ask(base, "PATCH", at, {})[0] == 400
    assert ask(base, "PATCH", at, {"delay": -1})[0] == 400
    assert ask(base, "PATCH", at, {"weight": -1})[0] == 400
    assert ask(base, "PATCH", at, {"receptor": "барабан"})[0] == 400
    bad = f"/api/sandboxes/{sandbox}/objects/{first}/contacts/c9"
    assert ask(base, "PATCH", bad, {"delay": 2})[0] == 400
    # У отдельной клетки контактов нет: маршрут про объект, но контакт бывает
    # только у блока, и отказ обязан это сказать, а не промолчать.
    nowhere = f"/api/sandboxes/{sandbox}/objects/нет/contacts/c1"
    assert ask(base, "PATCH", nowhere, {"delay": 2})[0] == 400


def contact_of(block, contact_id: str):
    return next(item for item in block["contacts"] if item["id"] == contact_id)


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
# --- каталог типов клеток и клетка на холсте --------------------------------


def test_the_cell_catalog_answers_without_any_storage(base):
    """Пустое хранилище -- не пустая палитра: класть на холст есть что сразу.

    Пустая библиотека паттернов -- просто пустая библиотека, работать можно.
    Пустой каталог клеток означал бы, что на холст нельзя положить ничего.
    """
    status, payload = ask(base, "GET", "/api/cells")
    assert status == 200
    ids = [cell["id"] for cell in payload["cells"]]
    assert {"pyr", "pv", "sst", "vip", "relay"} <= set(ids)

    pv = next(cell for cell in payload["cells"] if cell["id"] == "pv")
    # Тормозность считает сервер: от неё зависит фигура на холсте, и вторая
    # реализация этого слова разошлась бы с первой незаметно.
    assert pv["inhibitory"] is True
    assert pv["builtin"] is True
    assert pv["name"] and pv["note"], "по одному идентификатору клетку не выбрать"
    assert pv["pointModel"]["vThreshold"] == pytest.approx(-52.0)
    assert pv["morphology"]["isPoint"] is True


def test_a_cell_is_put_on_the_canvas_with_its_place(base):
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Клетки"})
    status, changed = ask(
        base,
        "POST",
        f"/api/sandboxes/{project['id']}/neurons",
        {"cell": "pyr", "id": "E", "position": [60, 40]},
    )
    assert status == 201
    assert [neuron["id"] for neuron in changed["neurons"]] == ["E"]
    assert changed["neurons"][0]["position"] == [60, 40]
    assert changed["neurons"][0]["inhibitory"] is False
    assert changed["neurons"][0]["pointModel"]["tauM"] == pytest.approx(15.0)
    # Ответ -- полное состояние проекта, как у всех операций песочницы.
    assert changed["canUndo"] is True
    assert changed["blocks"] == []


def test_an_unknown_cell_is_named_not_guessed(base):
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Клетки"})
    status, payload = ask(
        base, "POST", f"/api/sandboxes/{project['id']}/neurons", {"cell": "нет такой"}
    )
    assert status == 400
    assert "нет типа клетки" in payload["error"]


def test_a_cell_cannot_take_the_name_of_a_block(base):
    """Столкновение имён -- отказ при добавлении, а не сюрприз на запуске."""
    sandbox = sandbox_with_two_blocks(base)
    _, project = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    first = project["blocks"][0]["id"]

    status, payload = ask(
        base, "POST", f"/api/sandboxes/{sandbox}/neurons", {"cell": "pyr", "id": first}
    )
    assert status == 400
    assert "занято" in payload["error"]


def test_putting_a_cell_is_one_step_of_undo(base):
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Клетки"})
    ask(base, "POST", f"/api/sandboxes/{project['id']}/neurons", {"cell": "pyr"})
    _, undone = ask(base, "POST", f"/api/sandboxes/{project['id']}/undo")
    assert undone["neurons"] == []
    assert undone["canUndo"] is False


def test_a_cell_is_moved_by_the_same_route_as_a_block(base):
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Клетки"})
    ask(
        base,
        "POST",
        f"/api/sandboxes/{project['id']}/neurons",
        {"cell": "pyr", "id": "E"},
    )
    _, before = ask(base, "GET", f"/api/sandboxes/{project['id']}")

    status, moved = ask(
        base,
        "POST",
        f"/api/sandboxes/{project['id']}/move",
        {"id": "E", "position": [220, 90]},
    )
    assert status == 200
    assert moved["neurons"][0]["position"] == [220, 90]
    assert moved["fingerprint"] == before["fingerprint"], "холст физику не меняет"


def test_the_threshold_of_a_cell_is_edited_by_its_own_object(base):
    """Путь говорит «объект»: мембрану правят и у блока, и у отдельной клетки."""
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Клетки"})
    ask(
        base,
        "POST",
        f"/api/sandboxes/{project['id']}/neurons",
        {"cell": "pyr", "id": "E"},
    )
    status, changed = ask(
        base,
        "PATCH",
        f"/api/sandboxes/{project['id']}/objects/E/cells/pyr",
        {"vThreshold": -44.0},
    )
    assert status == 200
    assert changed["neurons"][0]["pointModel"]["vThreshold"] == pytest.approx(-44.0)

    # Каталог при этом прежний: песочница держит копию типа, а не ссылку.
    _, palette = ask(base, "GET", "/api/cells")
    pyr = next(cell for cell in palette["cells"] if cell["id"] == "pyr")
    assert pyr["pointModel"]["vThreshold"] == pytest.approx(-50.0)


def test_two_cells_alone_make_a_working_scheme(base, tmp_path):
    """Приёмка задачи: схема из двух клеток без единого паттерна библиотеки.

    Возбуждающая и тормозная кладутся из палитры, соединяются точками на себе
    (порта у клетки нет и быть не может), на одну идёт драйв, со второй
    пишется потенциал -- и на таймлайне есть спайки.
    """
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Две клетки"})
    sandbox = project["id"]

    ask(base, "POST", f"/api/sandboxes/{sandbox}/neurons",
        {"cell": "pyr", "id": "E", "position": [80, 60]})
    ask(base, "POST", f"/api/sandboxes/{sandbox}/neurons",
        {"cell": "pv", "id": "I", "position": [320, 60]})

    # Конец связи -- точка на самой клетке, а не порт: у клетки портов нет.
    status, linked = ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/links",
        # Вес назначен явно: одиночный контакт по умолчанию слабоват, чтобы
        # довести корзинчатую клетку до порога, а приёмка -- про спайки.
        {"source": {"instance": "E"}, "target": {"instance": "I"}, "weight": 6.0},
    )
    assert status == 201
    assert linked["links"][0]["source"]["port"] is None

    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/stimuli",
        {"target": {"instance": "E"}, "kind": "poisson", "rate": 600.0},
    )
    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/recordings",
        {"target": {"instance": "I"}, "var": "v"},
    )

    _, ready = ask(base, "GET", f"/api/sandboxes/{sandbox}")
    assert ready["problems"] == [], "схема из двух клеток должна считаться"
    assert ready["blocks"] == [], "ни одного паттерна библиотеки не вставлено"

    status, session = ask(base, "POST", "/api/sim", {"sandbox": sandbox, "pace": 0.0})
    assert status == 201
    ask(base, "POST", f"/api/sim/{session['id']}/start")
    for _ in range(200):
        _, frame = ask(base, "GET", f"/api/sim/{session['id']}")
        if frame["spikes"].get("I"):
            break
        time.sleep(0.05)
    spikes = {name: len(times) for name, times in frame["spikes"].items()}
    assert spikes.get("E", 0) > 0, f"возбуждающая клетка молчит: {spikes}"
    assert spikes.get("I", 0) > 0, f"торможение не завелось от связи: {spikes}"
    # Приставки нет ни у одной: это клетки холста, а не нейроны блока.
    assert all("/" not in name for name in frame["spikes"])

    # Проект сохраняется и открывается с диска с теми же клетками и местами.
    _, saved = ask(base, "POST", f"/api/sandboxes/{sandbox}/save")
    assert saved["dirty"] is False
    reopened = Store(tmp_path).load_sandbox(sandbox)
    assert {
        neuron.id: neuron.position for neuron in reopened.neurons.values()
    } == {"E": (80.0, 60.0), "I": (320.0, 60.0)}


def test_a_link_goes_straight_into_a_neuron_inside_a_block(base, tmp_path):
    """Приёмка #530: блок -- не чёрный ящик.

    В песочнице стоит FFI и рядом клетка из палитры. Связь ведётся из клетки
    прямо в тормозный `I` внутри блока, минуя порт `in`: порт -- названный
    автором ярлык частой точки, а не единственная дверь. Схема считается,
    спайки видны, в собранной модели есть контакт `X -> ffi/I`, а проект
    открывается с диска с той же связью.
    """
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Не ящик"})
    sandbox = project["id"]

    _, added = ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/blocks",
        {"pattern": "ffi", "position": [320, 60]},
    )
    block = added["blocks"][0]
    # Идентификатор читается глазами: он от `pattern.id`, а не от имени.
    assert block["id"] == "ffi"
    assert {neuron["id"] for neuron in block["scheme"]["neurons"]} == {"IN", "E", "I"}
    inhibitory = {n["id"]: n["inhibitory"] for n in block["scheme"]["neurons"]}
    # Тормозность приходит с сервера: от неё зависит фигура на холсте, и вторая
    # реализация этого слова разошлась бы с первой незаметно.
    assert inhibitory == {"IN": False, "E": False, "I": True}

    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/neurons",
        {"cell": "pyr", "id": "X", "position": [60, 60]},
    )

    # Конец связи -- внутренний узел: имя из собранной сети и пустой порт.
    status, linked = ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/links",
        {
            "source": {"instance": "X"},
            "target": {"instance": "ffi/I"},
            "weight": 9.0,
        },
    )
    assert status == 201
    link = linked["links"][0]
    assert link["target"] == {
        "instance": "ffi/I",
        "port": None,
        "section": "soma",
        "fraction": 0.5,
    }

    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/stimuli",
        {"target": {"instance": "X"}, "kind": "poisson", "rate": 800.0},
    )
    _, ready = ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/recordings",
        {"target": {"instance": "ffi/I"}, "var": "v"},
    )
    assert ready["problems"] == [], "связь мимо порта не должна мешать сборке"

    status, session = ask(base, "POST", "/api/sim", {"sandbox": sandbox, "pace": 0.0})
    assert status == 201
    ask(base, "POST", f"/api/sim/{session['id']}/start")
    for _ in range(200):
        _, frame = ask(base, "GET", f"/api/sim/{session['id']}")
        if frame["spikes"].get("ffi/I"):
            break
        time.sleep(0.05)
    spikes = {name: len(times) for name, times in frame["spikes"].items()}
    assert spikes.get("X", 0) > 0, f"клетка снаружи молчит: {spikes}"
    assert spikes.get("ffi/I", 0) > 0, f"торможение внутри блока молчит: {spikes}"

    # Проект сохраняется и открывается заново -- связь смотрит туда же, и в
    # собранной из файла модели это обычный контакт.
    _, saved = ask(base, "POST", f"/api/sandboxes/{sandbox}/save")
    assert saved["dirty"] is False
    reopened = Store(tmp_path).load_sandbox(sandbox)
    assert reopened.links[0].target.instance == "ffi/I"
    assert reopened.links[0].target.port is None
    built = compose(reopened)
    assert built.problems == []
    assert ("X", "ffi/I") in {
        (contact.pre.instance, contact.post.instance) for contact in built.model.contacts
    }


def test_removing_a_block_takes_the_links_into_its_insides(base):
    """Убрали блок -- ушла и связь, которую вели в его внутренний узел."""
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Уборка"})
    sandbox = project["id"]
    ask(base, "POST", f"/api/sandboxes/{sandbox}/blocks", {"pattern": "ffi"})
    ask(base, "POST", f"/api/sandboxes/{sandbox}/neurons", {"cell": "pyr", "id": "X"})
    ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/links",
        {"source": {"instance": "X"}, "target": {"instance": "ffi/I"}},
    )

    _, after = ask(base, "DELETE", f"/api/sandboxes/{sandbox}/objects/ffi")

    assert after["blocks"] == []
    assert after["links"] == [], "связь смотрела внутрь убранного блока"


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


def test_a_link_drawn_from_an_inhibitory_cell_comes_out_inhibitory(base):
    """Интерфейс рецептор не шлёт -- значит, его выбирает сервер (#540).

    Через HTTP целиком, потому что проверяется именно то, чем пользуется
    холст: тело запроса на связь состоит из двух концов и больше ни из чего.
    """
    _, project = ask(base, "POST", "/api/sandboxes", {"name": "Тормоз"})
    sandbox = project["id"]
    ask(base, "POST", f"/api/sandboxes/{sandbox}/neurons", {"cell": "sst"})
    ask(base, "POST", f"/api/sandboxes/{sandbox}/neurons", {"cell": "pyr"})

    _, linked = ask(
        base,
        "POST",
        f"/api/sandboxes/{sandbox}/links",
        {"source": {"instance": "sst"}, "target": {"instance": "pyr"}},
    )

    link = linked["links"][0]
    assert (link["receptor"], link["inhibitory"]) == ("gaba_a", True)
    assert not [note for note in linked["warnings"] if link["id"] in note]

    # Рецептор остаётся свободным: правка проходит, но о споре сказано вслух.
    _, changed = ask(
        base,
        "PATCH",
        f"/api/sandboxes/{sandbox}/links/{link['id']}",
        {"receptor": "ampa"},
    )
    assert changed["links"][0]["receptor"] == "ampa"
    assert changed["problems"] == [], "запрета нет: нарочные сочетания бывают"
    assert any(
        "тормозный" in note and "ampa" in note for note in changed["warnings"]
    ), changed["warnings"]


def test_the_glossary_explains_the_labels_on_the_screen(base):
    """Расшифровка подписей приходит с сервера, а не из словаря в браузере (#541).

    Проверяется не текст, а то, что объяснение есть у каждого пункта списка и
    что ключи мембраны -- те же, по которым берутся её числа: разойдись они, и
    подсказка однажды объяснит соседнее поле.
    """
    _, glossary = ask(base, "GET", "/api/glossary")

    receptors = {item["id"]: item for item in glossary["receptors"]}
    assert set(receptors) == set(ir.RECEPTORS)
    assert all(item["note"] for item in receptors.values())
    assert (receptors["gaba_a"]["inhibitory"], receptors["gaba_a"]["reversal"]) == (
        True,
        -70.0,
    )
    assert receptors["ampa"]["inhibitory"] is False

    _, cells_payload = ask(base, "GET", "/api/cells")
    point = cells_payload["cells"][0]["pointModel"]
    assert set(glossary["cell"]) == set(point), "подсказка обязана лечь на поле"

    assert set(glossary["contact"]) == {"receptor", "weight", "delay"}
    assert set(glossary["port"]) == {"in", "out", "mod"}


def test_a_builtin_cell_carries_its_own_explanation(base):
    """Тексты клеток уже написаны -- их не надо заводить заново (#541)."""
    _, payload = ask(base, "GET", "/api/cells")
    notes = {item["id"]: item["note"] for item in payload["cells"]}

    assert "дендрит" in notes["sst"].lower()
    assert all(notes[cell] for cell in ("pyr", "pv", "sst", "vip", "relay"))
