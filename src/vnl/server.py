"""Локальный сервер: библиотека и песочницы по HTTP.

Зачем он вообще. До сих пор связь была односторонней: `vnl data` выкладывал
готовый прогон файлом, а интерфейс его читал. Библиотеке этого мало -- ей надо
не только читать хранилище, но и писать в него черновики, а файл, который
пишут с двух сторон, рано или поздно расходится.

Почему на `http.server`, а не на фреймворке. У ядра нет зависимостей, и это
свойство стоит дороже удобной валидации: `pip install -e .` ставит инструмент
целиком, без колёс под нужную версию Python. Ни схем, ни авторизации, ни
асинхронности здесь нет, и это не упрощение, а точное описание задачи: один
человек, один локальный порт.

Операции лежат в `Api` отдельно от HTTP. Тем же способом их позовёт MCP (#482):
у Claude и у холста должно быть одно состояние, а не две копии правды.

Сервер слушает только `127.0.0.1` и проверяет заголовок `Host`. Порт без
авторизации, открытый наружу, -- это доступ к файлам проекта для всей сети, а
проверка `Host` закрывает ещё и обращение к нему из чужой страницы в браузере.
Адрес меняется флагом `--bind`, и нужно это ровно в одном случае: в контейнере
`127.0.0.1` -- его собственный loopback, до которого опубликованный порт не
доходит. Проверка `Host` остаётся при любом адресе.

Интерфейс в разработке живёт на Vite (5173) и ходит сюда через его прокси,
поэтому CORS здесь нет: заголовки, разрешающие чужой источник, для локального
инструмента не удобство, а лишняя дверь. Собранный `ui/dist` сервер отдаёт сам,
чтобы для работы хватало одной команды.
"""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from mimetypes import guess_type
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, unquote, urlsplit

from . import __version__, api
from .catalog import Query
from .compose import compose
from .live import Pool, SessionError
from .patterns import (
    LEVEL_NAMES,
    Endpoint,
    Pattern,
    PatternError,
    Sandbox,
    SandboxRecording,
    SandboxStimulus,
)
from .project import Project
from .store import Store, StoreError

LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}


class Api:
    """Операции над библиотекой. HTTP -- только оболочка вокруг них."""

    def __init__(self, store: Store) -> None:
        self.store = store
        # Симуляции живут между запросами: время идёт, даже когда никто не
        # спрашивает. Поэтому сессии держит сервер, а не запрос.
        self.pool = Pool()
        # Открытые проекты. В файле лежит песочница, а история правок и отмена
        # живут в `Project` -- значит между запросами он должен жить тоже.
        self._projects: dict[str, Project] = {}
        self._projects_lock = threading.Lock()

    def health(self) -> dict[str, Any]:
        """Живые данные для строки состояния, а не подпись из макета (#483)."""
        return {
            "schema": api.SCHEMA_VERSION,
            "version": __version__,
            "root": str(self.store.root),
            "patterns": len(self.store.patterns()),
            "sandboxes": len(self.store.sandboxes()),
            "simulations": len(self.pool),
        }

    def catalog(self, params: dict[str, list[str]]) -> dict[str, Any]:
        return api.catalog_payload(self.store.patterns(), Query.from_params(params))

    def pattern(self, pattern_id: str) -> dict[str, Any]:
        return api.pattern_payload(self.store.load_pattern(pattern_id), body=True)

    def create_pattern(self, body: dict[str, Any]) -> dict[str, Any]:
        """«Добавить»: пустой черновик, с которого начинается новая схема."""
        name = str(body.get("name") or "").strip() or "Без имени"
        level = str(body.get("level") or "L2")
        if level not in LEVEL_NAMES:
            raise PatternError(
                f"уровень {level!r} не из каталога: {', '.join(LEVEL_NAMES)}"
            )
        taken = [item.id for item in self.store.patterns()]
        pattern = Pattern.empty(name, level, taken)  # type: ignore[arg-type]
        self.store.save_pattern(pattern)
        return api.pattern_payload(pattern, body=True)

    # --- симуляция --------------------------------------------------------

    def open_sim(self, body: dict[str, Any]) -> dict[str, Any]:
        """Открыть симуляцию: витрину паттерна или собранную песочницу.

        Управление временем в карточке и на холсте одно и то же, поэтому и
        сессия одна -- разной остаётся только модель, которую считаем.
        """
        if body.get("sandbox"):
            return self._open_sandbox_sim(str(body["sandbox"]), body)

        pattern_id = str(body.get("pattern") or "")
        if not pattern_id:
            raise PatternError("не сказано, что запускать: нужен pattern или sandbox")
        pattern = self.store.load_pattern(pattern_id)
        model = pattern.demo_model()
        if not model.instances:
            raise PatternError(
                f"в паттерне «{pattern.name}» нет ни одного нейрона: запускать нечего"
            )
        session = self.pool.open(
            model, source=f"паттерн «{pattern.name}»", **self._pace(body)
        )
        return session.update()

    def _open_sandbox_sim(self, sandbox_id: str, body: dict[str, Any]) -> dict[str, Any]:
        project = self._project(sandbox_id)
        built = compose(project.sandbox)
        if built.problems:
            # Причины перечисляются все сразу: чинить схему по одной ошибке за
            # запуск -- это столько запусков, сколько ошибок.
            raise PatternError(
                "схема не готова к запуску: " + "; ".join(built.problems)
            )
        session = self.pool.open(
            built.model,
            source=f"песочница «{project.sandbox.name}»",
            **self._pace(body),
        )
        return session.update()

    @staticmethod
    def _pace(body: dict[str, Any]) -> dict[str, Any]:
        return {"pace": float(body["pace"])} if body.get("pace") else {}

    @staticmethod
    def _since(params: dict[str, list[str]]) -> int:
        """Сколько отсчётов у интерфейса уже есть."""
        raw = (params.get("since") or ["0"])[0]
        try:
            return max(0, int(raw))
        except ValueError as exc:
            raise ValueError(f"since должно быть числом, а не {raw!r}") from exc

    def sim(self, sim_id: str, params: dict[str, list[str]]) -> dict[str, Any]:
        return self.pool.get(sim_id).update(self._since(params))

    def sim_start(self, sim_id: str, params: dict[str, list[str]]) -> dict[str, Any]:
        session = self.pool.get(sim_id)
        session.start()
        return session.update(self._since(params))

    def sim_pause(self, sim_id: str, params: dict[str, list[str]]) -> dict[str, Any]:
        session = self.pool.get(sim_id)
        session.pause()
        return session.update(self._since(params))

    def sim_reset(self, sim_id: str) -> dict[str, Any]:
        session = self.pool.get(sim_id)
        session.reset()
        return session.update()

    def sim_seek(self, sim_id: str, body: dict[str, Any]) -> dict[str, Any]:
        session = self.pool.get(sim_id)
        try:
            moment = float(body.get("time"))  # type: ignore[arg-type]
        except (TypeError, ValueError) as exc:
            raise ValueError("нужно время в мс: {\"time\": 120.0}") from exc
        session.seek(moment)
        return session.update()

    def close_sim(self, sim_id: str) -> dict[str, Any]:
        self.pool.close(sim_id)
        return {"closed": sim_id}

    # --- песочница --------------------------------------------------------

    def _project(self, sandbox_id: str) -> Project:
        """Открытый проект. История и отмена живут в нём, а не в файле."""
        with self._projects_lock:
            project = self._projects.get(sandbox_id)
            if project is None:
                project = Project(self.store.load_sandbox(sandbox_id), self.store)
                self._projects[sandbox_id] = project
            return project

    @staticmethod
    def _endpoint(data: Any, what: str) -> Endpoint:
        if not isinstance(data, dict) or not data.get("instance"):
            raise PatternError(
                f"{what}: нужен конец связи вида "
                '{"instance": "ffi", "port": "in"}'
            )
        return Endpoint(
            instance=str(data["instance"]),
            port=data.get("port") or None,
            section=str(data.get("section") or "soma"),
            fraction=float(data.get("fraction", 0.5)),
        )

    def sandboxes(self) -> dict[str, Any]:
        return {
            "schema": api.SCHEMA_VERSION,
            "sandboxes": [
                {
                    "id": sandbox.id,
                    "name": sandbox.name,
                    "blocks": len(sandbox.instances),
                    "links": len(sandbox.links),
                    "updatedAt": sandbox.updated_at,
                }
                for sandbox in self.store.sandboxes()
            ],
        }

    def create_sandbox(self, body: dict[str, Any]) -> dict[str, Any]:
        name = str(body.get("name") or "").strip() or "Песочница"
        taken = [item.id for item in self.store.sandboxes()]
        sandbox = Sandbox.empty(name, taken)
        self.store.save_sandbox(sandbox)
        project = Project(sandbox, self.store)
        with self._projects_lock:
            self._projects[sandbox.id] = project
        return api.sandbox_payload(project)

    def sandbox(self, sandbox_id: str) -> dict[str, Any]:
        return api.sandbox_payload(self._project(sandbox_id))

    def add_block(self, sandbox_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Вставить паттерн блоком. В проект кладётся снимок, а не ссылка."""
        pattern_id = str(body.get("pattern") or "")
        if not pattern_id:
            raise PatternError("не сказано, что вставлять: нужен pattern")
        project = self._project(sandbox_id)
        position = body.get("position") or [0.0, 0.0]
        project.insert_pattern(
            self.store.load_pattern(pattern_id),
            label=body.get("label"),
            position=(float(position[0]), float(position[1])),
        )
        return api.sandbox_payload(project)

    def connect(self, sandbox_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Связь между блоками -- настоящий контакт между внутренними точками."""
        project = self._project(sandbox_id)
        params = {
            key: float(body[key])
            for key in ("weight", "delay")
            if body.get(key) is not None
        }
        if body.get("receptor"):
            params["receptor"] = str(body["receptor"])
        project.connect(
            self._endpoint(body.get("source"), "источник"),
            self._endpoint(body.get("target"), "цель"),
            link_id=body.get("id"),
            **params,
        )
        return api.sandbox_payload(project)

    def link_params(
        self, sandbox_id: str, link_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        project = self._project(sandbox_id)
        params: dict[str, Any] = {}
        for key in ("weight", "delay"):
            if body.get(key) is not None:
                params[key] = float(body[key])
        if body.get("receptor"):
            params["receptor"] = str(body["receptor"])
        if not params:
            raise PatternError("нечего менять: ожидались weight, delay или receptor")
        project.set_parameters(link_id, **params)
        return api.sandbox_payload(project)

    def move_block(self, sandbox_id: str, body: dict[str, Any]) -> dict[str, Any]:
        project = self._project(sandbox_id)
        position = body.get("position") or [0.0, 0.0]
        project.move(str(body.get("id") or ""), (float(position[0]), float(position[1])))
        return api.sandbox_payload(project)

    def add_stimulus(self, sandbox_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Драйв проекта. Без него собранная сеть молчит и смотреть не на что."""
        project = self._project(sandbox_id)
        sandbox = project.sandbox
        target = self._endpoint(body.get("target"), "цель стимула")
        stimulus = SandboxStimulus(
            id=str(body.get("id") or f"drive{len(sandbox.stimuli) + 1}"),
            target=target,
            kind=str(body.get("kind") or "poisson"),
            rate=float(body.get("rate", 250.0)),
            amplitude=float(body.get("amplitude", 1.5)),
            start=float(body.get("start", 0.0)),
            stop=float(body.get("stop", sandbox.run.duration)),
        )
        project.stimulate(stimulus)
        return api.sandbox_payload(project)

    def add_recording(self, sandbox_id: str, body: dict[str, Any]) -> dict[str, Any]:
        project = self._project(sandbox_id)
        sandbox = project.sandbox
        recording = SandboxRecording(
            id=str(body.get("id") or f"r{len(sandbox.recordings) + 1}"),
            target=self._endpoint(body.get("target"), "цель записи"),
            var=str(body.get("var") or "v"),
        )
        project.record(recording)
        return api.sandbox_payload(project)

    def remove_object(self, sandbox_id: str, object_id: str) -> dict[str, Any]:
        project = self._project(sandbox_id)
        project.remove(object_id)
        return api.sandbox_payload(project)

    def undo(self, sandbox_id: str) -> dict[str, Any]:
        project = self._project(sandbox_id)
        project.undo()
        return api.sandbox_payload(project)

    def save_sandbox(self, sandbox_id: str) -> dict[str, Any]:
        project = self._project(sandbox_id)
        project.save()
        return api.sandbox_payload(project)

    def delete_pattern(self, pattern_id: str) -> dict[str, Any]:
        # Читаем перед удалением, чтобы «такого нет» отличалось от «удалено».
        self.store.load_pattern(pattern_id)
        self.store.delete_pattern(pattern_id)
        return {"deleted": pattern_id}


@dataclass(frozen=True)
class Route:
    method: str
    path: re.Pattern[str]
    call: Callable[..., Any]
    #: Что обработчику нужно кроме частей пути: `params` или `body`.
    wants: str = ""
    #: Код успешного ответа. 201 там, где появился новый объект.
    ok: int = 200


def routes(service: Api) -> list[Route]:
    """Таблица маршрутов.

    Нарочно плоская и явная: маршрутов десяток, и видеть их все на одном
    экране важнее, чем не повторять `/api/patterns` дважды.
    """
    return [
        Route("GET", re.compile(r"^/api/health$"), service.health),
        Route("GET", re.compile(r"^/api/catalog$"), service.catalog, wants="params"),
        Route(
            "POST",
            re.compile(r"^/api/patterns$"),
            service.create_pattern,
            wants="body",
            ok=201,
        ),
        Route("GET", re.compile(r"^/api/patterns/([^/]+)$"), service.pattern),
        Route("DELETE", re.compile(r"^/api/patterns/([^/]+)$"), service.delete_pattern),
        Route("POST", re.compile(r"^/api/sim$"), service.open_sim, wants="body", ok=201),
        Route("GET", re.compile(r"^/api/sim/([^/]+)$"), service.sim, wants="params"),
        Route(
            "POST",
            re.compile(r"^/api/sim/([^/]+)/start$"),
            service.sim_start,
            wants="params",
        ),
        Route(
            "POST",
            re.compile(r"^/api/sim/([^/]+)/pause$"),
            service.sim_pause,
            wants="params",
        ),
        Route("POST", re.compile(r"^/api/sim/([^/]+)/reset$"), service.sim_reset),
        Route("POST", re.compile(r"^/api/sim/([^/]+)/seek$"), service.sim_seek, wants="body"),
        Route("DELETE", re.compile(r"^/api/sim/([^/]+)$"), service.close_sim),
        Route("GET", re.compile(r"^/api/sandboxes$"), service.sandboxes),
        Route(
            "POST",
            re.compile(r"^/api/sandboxes$"),
            service.create_sandbox,
            wants="body",
            ok=201,
        ),
        Route("GET", re.compile(r"^/api/sandboxes/([^/]+)$"), service.sandbox),
        Route(
            "POST",
            re.compile(r"^/api/sandboxes/([^/]+)/blocks$"),
            service.add_block,
            wants="body",
            ok=201,
        ),
        Route(
            "POST",
            re.compile(r"^/api/sandboxes/([^/]+)/links$"),
            service.connect,
            wants="body",
            ok=201,
        ),
        Route(
            "PATCH",
            re.compile(r"^/api/sandboxes/([^/]+)/links/([^/]+)$"),
            service.link_params,
            wants="body",
        ),
        Route(
            "POST",
            re.compile(r"^/api/sandboxes/([^/]+)/move$"),
            service.move_block,
            wants="body",
        ),
        Route(
            "POST",
            re.compile(r"^/api/sandboxes/([^/]+)/stimuli$"),
            service.add_stimulus,
            wants="body",
            ok=201,
        ),
        Route(
            "POST",
            re.compile(r"^/api/sandboxes/([^/]+)/recordings$"),
            service.add_recording,
            wants="body",
            ok=201,
        ),
        Route(
            "DELETE",
            re.compile(r"^/api/sandboxes/([^/]+)/objects/([^/]+)$"),
            service.remove_object,
        ),
        Route("POST", re.compile(r"^/api/sandboxes/([^/]+)/undo$"), service.undo),
        Route(
            "POST", re.compile(r"^/api/sandboxes/([^/]+)/save$"), service.save_sandbox
        ),
    ]


class Handler(BaseHTTPRequestHandler):
    """Разбор запроса, ответ в JSON и статика собранного интерфейса."""

    protocol_version = "HTTP/1.1"
    server_version = f"vnl/{__version__}"

    # Подставляются в `create_server`.
    service: Api
    table: list[Route]
    ui: Path | None = None
    quiet: bool = False

    def do_GET(self) -> None:
        self._handle("GET")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_DELETE(self) -> None:
        self._handle("DELETE")

    def do_PATCH(self) -> None:
        self._handle("PATCH")

    # --- разбор -----------------------------------------------------------

    def _handle(self, method: str) -> None:
        if not self._host_is_local():
            self._send(403, {"error": "запрос не с этой машины"})
            return
        split = urlsplit(self.path)
        path = unquote(split.path)
        if not path.startswith("/api/"):
            self._static(path, method)
            return
        for route in self.table:
            if route.method != method:
                continue
            match = route.path.match(path)
            if not match:
                continue
            self._call(route, match, parse_qs(split.query))
            return
        self._send(404, {"error": f"нет маршрута {method} {path}"})

    def _call(
        self, route: Route, match: re.Match[str], params: dict[str, list[str]]
    ) -> None:
        try:
            arguments: list[Any] = list(match.groups())
            if route.wants == "params":
                arguments.append(params)
            elif route.wants == "body":
                arguments.append(self._body())
            payload = route.call(*arguments)
        except (StoreError, SessionError) as exc:
            self._send(404, {"error": str(exc)})
        except (PatternError, ValueError) as exc:
            # Неготовая схема и неверный запрос -- нормальный исход, а не сбой:
            # такую причину интерфейс показывает рядом с объектом (#481).
            self._send(400, {"error": str(exc)})
        else:
            self._send(route.ok, payload)

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"тело запроса не разобрано как JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError("тело запроса должно быть объектом JSON")
        return data

    def _host_is_local(self) -> bool:
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        return host in LOCAL_HOSTS or not host

    # --- ответ ------------------------------------------------------------

    def _send(self, status: int, payload: Any) -> None:
        body = api.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Библиотека меняется этим же сервером, кэш здесь только мешает.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _static(self, path: str, method: str) -> None:
        if self.ui is None:
            self._send(404, {"error": "интерфейс не собран: vnl serve --ui ui/dist"})
            return
        if method != "GET":
            self._send(405, {"error": f"{method} к статике"})
            return
        root = self.ui.resolve()
        target = (root / path.lstrip("/")).resolve()
        if root != target and root not in target.parents:
            self._send(403, {"error": "путь за пределами интерфейса"})
            return
        if target.is_dir() or not target.exists():
            # Роутинг у интерфейса свой, поэтому неизвестный путь -- это его
            # экран, а не отсутствующий файл.
            target = root / "index.html"
        if not target.exists():
            self._send(404, {"error": f"нет файла {path}"})
            return
        body = target.read_bytes()
        kind = guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:
        if not self.quiet:
            super().log_message(fmt, *args)


def create_server(
    root: str | Path,
    port: int = 8765,
    ui: str | Path | None = None,
    quiet: bool = False,
    bind: str = "127.0.0.1",
) -> ThreadingHTTPServer:
    """Сервер поверх хранилища. `port=0` -- свободный порт, удобно в тестах.

    `bind` менять почти никогда не нужно: по умолчанию сервер слышен только с
    этой машины. Исключение -- контейнер, где `127.0.0.1` означает loopback
    самого контейнера, и опубликованный порт до него не доходит. Там адрес
    расширяют, а «только со своей машины» держат публикацией порта на loopback
    хоста и проверкой `Host` -- она остаётся при любом адресе.
    """
    service = Api(Store(root))
    ui_path = Path(ui) if ui else None
    if ui_path is not None and not ui_path.exists():
        raise StoreError(f"интерфейса нет по пути {ui_path}")

    handler = type(
        "BoundHandler",
        (Handler,),
        {
            "service": service,
            "table": routes(service),
            "ui": ui_path,
            "quiet": quiet,
        },
    )
    return ThreadingHTTPServer((bind, port), handler)
