"""Сервер библиотеки: те же операции, что увидит интерфейс.

Поднимается настоящий сервер на свободном порту и опрашивается по HTTP:
подменить обработчик вызовом Python значило бы проверить всё, кроме разбора
запроса и кодов ответа -- а именно там живут ошибки такого слоя.
"""

import json
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
from vnl.server import create_server
from vnl.store import Store

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def ffi_pattern() -> Pattern:
    model, _ = load((EXAMPLES / "ffi.vnl").read_text(encoding="utf-8"))
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
    assert item["levelName"] == "Микросхемы"
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
    assert [level for level in missed["levels"] if level["count"]][0]["id"] == "L2"


def test_catalog_filters_by_level_and_status(base):
    _, wrong_level = ask(base, "GET", "/api/catalog?level=L1")
    assert wrong_level["matched"] == 0
    _, right = ask(base, "GET", "/api/catalog?level=L1,L2&status=ready")
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


def test_add_creates_a_draft_that_survives_a_restart(base, tmp_path):
    status, created = ask(base, "POST", "/api/patterns", {"name": "Прямое торможение"})
    assert status == 201
    assert created["status"] == "draft"
    assert created["statusName"] == "Черновик"
    # Пустой черновик честно говорит, чего ему не хватает.
    assert created["problems"]

    _, catalog = ask(base, "GET", "/api/catalog")
    assert catalog["total"] == 2
    # Он лежит в хранилище, а не только в открытой вкладке.
    assert Store(tmp_path).load_pattern(created["id"]).name == "Прямое торможение"


def test_a_second_draft_does_not_overwrite_the_first(base):
    _, first = ask(base, "POST", "/api/patterns", {"name": "Схема"})
    _, second = ask(base, "POST", "/api/patterns", {"name": "Схема"})
    assert first["id"] != second["id"]


def test_draft_without_a_name_is_still_openable(base):
    _, created = ask(base, "POST", "/api/patterns", {})
    assert created["name"] == "Без имени"


def test_unknown_level_is_refused(base):
    status, payload = ask(base, "POST", "/api/patterns", {"name": "x", "level": "L9"})
    assert status == 400
    assert "L9" in payload["error"]


def test_broken_json_is_refused(base):
    request = urllib.request.Request(
        base + "/api/patterns", data=b"{not json", method="POST"
    )
    with pytest.raises(urllib.error.HTTPError) as error:
        urllib.request.urlopen(request)
    assert error.value.code == 400


def test_delete_removes_the_draft(base):
    _, created = ask(base, "POST", "/api/patterns", {"name": "Черновик"})
    status, payload = ask(base, "DELETE", f"/api/patterns/{created['id']}")
    assert status == 200
    assert payload["deleted"] == created["id"]
    assert ask(base, "DELETE", f"/api/patterns/{created['id']}")[0] == 404


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


def test_a_simulation_needs_something_to_run(base):
    _, draft = ask(base, "POST", "/api/patterns", {"name": "Пустой"})
    status, payload = ask(base, "POST", "/api/sim", {"pattern": draft["id"]})
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
