"""Локальный сервер: библиотека и песочницы по HTTP.

Зачем он вообще. До сих пор связь была односторонней: `vnl data` выкладывал
готовый прогон файлом, а интерфейс его читал. Библиотеке этого мало -- ей надо
не только читать хранилище, но и писать в него черновики, а файл, который
пишут с двух сторон, рано или поздно расходится.

Почему на `http.server`, а не на фреймворке. У ядра нет зависимостей, и это
свойство стоит дороже удобной валидации: `pip install -e .` ставит инструмент
целиком, без колёс под нужную версию Python. Ни схем, ни асинхронности здесь
нет, и это не упрощение, а точное описание задачи: один человек, один порт.

Операции лежат в `Api` отдельно от HTTP. Тем же способом их позовёт MCP (#482):
у Claude и у холста должно быть одно состояние, а не две копии правды.

Сервер слушает только `127.0.0.1` и проверяет заголовок `Host`. Порт без
авторизации, открытый наружу, -- это доступ к файлам проекта для всей сети, а
проверка `Host` закрывает ещё и обращение к нему из чужой страницы в браузере.
Адрес меняется флагом `--bind`, и нужно это ровно в одном случае: в контейнере
`127.0.0.1` -- его собственный loopback, до которого опубликованный порт не
доходит. Проверка `Host` остаётся при любом адресе.

Вход. На стенде (`vnl.reckue.com`) сервер стоит за nginx, и тот ходит сюда с
`Host: localhost` -- то есть проверка `Host` там пропускает весь интернет и
рубежом быть перестаёт. Поэтому есть второй, отдельный: вход через Reckue auth
(`vnl/auth.py`). Он включается настройками в окружении, и без них сервер ведёт
себя как прежде -- так запуск на своей машине не требует ни интернета, ни
учётной записи. Проверка `Host` при этом остаётся: она отвечает на другой
вопрос («с этой ли машины запрос»), и одна другую не заменяет.

Что вход закрывает, а что нет. Библиотека -- витрина: каталог, карточку и живую
симуляцию паттерна смотрят и трогают без учётной записи, иначе на схему нельзя
дать ссылку. Вход нужен там, где запрос меняет состояние библиотеки, заходит в
песочницу (чужая работа в процессе, а не витрина) или рассказывает о самом
хранилище. Требование входа записано у маршрута рядом с методом и путём
(`Route.anonymous`), а не условием в обработчике, и по умолчанию маршрут
закрыт: забытый должен оказаться закрытым, а не открытым.

Интерфейс в разработке живёт на Vite (5173) и ходит сюда через его прокси,
поэтому CORS здесь нет: заголовки, разрешающие чужой источник, для локального
инструмента не удобство, а лишняя дверь. Собранный `ui/dist` сервер отдаёт сам,
чтобы для работы хватало одной команды.
"""

from __future__ import annotations

import hmac
import json
import os
import re
import sys
import threading
import time
from dataclasses import dataclass
from html import escape
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from mimetypes import guess_type
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, unquote, urlsplit

from . import __version__, api, auth, cells, ir
from .catalog import Query
from .compose import compose
from .index import Index, IndexUnavailable
from .live import Pool, SessionError
from .patterns import (
    DRAFT_LEVEL,
    LEVEL_NAMES,
    Endpoint,
    PatternError,
    Port,
    Sandbox,
    SandboxRecording,
    SandboxStimulus,
)
from .project import Project
from .store import Store, StoreError

LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}


class Api:
    """Операции над библиотекой. HTTP -- только оболочка вокруг них."""

    def __init__(self, store: Store, index: Index | None = None) -> None:
        self.store = store
        # Индекс метаданных: ускоряет каталог и отвечает на вопросы поверх
        # библиотеки. Его отсутствие -- нормальный режим, а не поломка.
        self.index = index
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
            "index": (
                self.index.state(len(self.store.patterns()))
                if self.index
                else {"connected": False, "reason": "индекс не настроен"}
            ),
        }

    def catalog(self, params: dict[str, list[str]]) -> dict[str, Any]:
        """Каталог: отбор через индекс, если он есть, иначе обходом файлов.

        Через индекс разбираются только подошедшие файлы -- в этом вся выгода.
        Отказ индекса не виден снаружи ничем, кроме скорости: формат ответа и
        правила отбора одни и те же.
        """
        query = Query.from_params(params)
        if self.index is not None:
            try:
                chosen = [
                    self.store.load_pattern(found) for found in self.index.search(query)
                ]
                return api.catalog_payload_of(
                    chosen, self.index.facets(), self.index.size(), query
                )
            except (IndexUnavailable, StoreError) as exc:
                print(f"каталог читается из файлов: {exc}", file=sys.stderr)
        return api.catalog_payload(self.store.patterns(), query)

    def pattern(self, pattern_id: str) -> dict[str, Any]:
        return api.pattern_payload(self.store.load_pattern(pattern_id), body=True)

    def cells(self) -> dict[str, Any]:
        """Каталог типов клеток: встроенные плюс лежащие в хранилище.

        Отдельный маршрут, а не раздел каталога паттернов: у клетки нет ни
        ступени разбора, ни портов, ни статуса готовности, и фильтры
        библиотеки на неё не отвечают. Смешай их -- и слово «блок» стало бы
        значить и микросхему, и клетку.
        """
        return api.cells_payload(cells.catalog(self.store.cells()).cells)

    def glossary(self) -> dict[str, Any]:
        """Расшифровка подписей: рецепторы, мембрана, контакт, порты (#541).

        Отдельно от каталога клеток, хотя спрашивают их вместе: каталог
        меняется (свои клетки кладут и убирают), а этот ответ -- реестр,
        одинаковый на любой машине и на любом проекте. Подмешать его в
        `/api/cells` значило бы, что список клеток частью своей перестаёт быть
        списком клеток.

        Клеток здесь нет намеренно: у встроенной клетки объяснение уже есть --
        `note` в `/api/cells`. Повторить его вторым ответом значило бы завести
        о пирамиде две правды.
        """
        return api.glossary_payload()

    def create_pattern(self, body: dict[str, Any]) -> dict[str, Any]:
        """«Сохранить как паттерн»: проект песочницы ложится в библиотеку.

        Раньше этот же маршрут заводил пустой черновик -- и на этом дорога
        кончалась: наполнить его было нечем, потому что редактора тела схемы
        нет и не будет. Схему собирают в песочнице, и оттуда она сохраняется
        паттерном; второй редактор означал бы две разные правды о том, как
        рисуют схему.

        Маршрут остался тем же: «создать паттерн» -- это по-прежнему POST на
        библиотеку, изменился только источник начинки. Имя, ступень и порты
        приходят из формы: порт -- то, чем блок подключают снаружи, и называет
        его человек, а не сервер.
        """
        sandbox_id = str(body.get("sandbox") or "")
        if not sandbox_id:
            raise PatternError(
                "паттерн собирается в песочнице: нужно сказать, какую сохранять "
                '-- {"sandbox": "<id>"}'
            )
        # Ступень по умолчанию -- там же, где её знает остальной код: литерал
        # здесь означал бы вторую истину, и при смене оси каталога паттерны
        # молча поехали бы не на ту ступень.
        level = str(body.get("level") or DRAFT_LEVEL)
        if level not in LEVEL_NAMES:
            raise PatternError(
                f"уровень {level!r} не из каталога: {', '.join(LEVEL_NAMES)}"
            )
        project = self._project(sandbox_id)
        pattern = project.as_pattern(
            str(body.get("name") or "").strip() or project.sandbox.name,
            self._ports(body.get("ports")),
            level,  # type: ignore[arg-type]
            pattern_id=str(body["id"]) if body.get("id") else None,
            taken=[item.id for item in self.store.patterns()],
        )
        project.save_as_pattern(pattern)
        return api.pattern_payload(pattern, body=True)

    @staticmethod
    def _ports(data: Any) -> list[Port]:
        """Порты из запроса. Вид тот же, что в ответе (`api.pattern_payload`).

        Симметрия не украшение: интерфейс предлагает порты полем `portHints`
        песочницы и возвращает их же, поправив имена, -- а разбирать в запросе
        не то, что отдаётся в ответе, значит заводить два формата одного порта.
        """
        if data is None:
            return []
        if not isinstance(data, list):
            raise PatternError(
                'порты передаются списком: {"ports": [{"name": "вход", '
                '"direction": "in", "site": {"instance": "IN"}}]}'
            )
        ports: list[Port] = []
        for item in data:
            site = item.get("site") if isinstance(item, dict) else None
            if not isinstance(item, dict) or not isinstance(site, dict):
                raise PatternError(
                    'порт пишется как {"name": "вход", "direction": "in", '
                    '"site": {"instance": "IN", "section": "soma"}}'
                )
            if not site.get("instance"):
                raise PatternError(
                    f"у порта {item.get('name') or '?'} не сказано, на какую "
                    "клетку он смотрит"
                )
            ports.append(
                Port(
                    name=str(item.get("name") or "").strip(),
                    direction=str(item.get("direction") or "in"),  # type: ignore[arg-type]
                    site=ir.Site(
                        instance=str(site["instance"]),
                        section=str(site.get("section") or "soma"),
                        fraction=float(site.get("fraction", 0.5)),
                    ),
                    note=str(item.get("note") or ""),
                )
            )
        return ports

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
            model,
            source=f"паттерн «{pattern.name}»",
            origin="pattern",
            **self._pace(body),
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
            origin="sandbox",
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

    # --- кого пускать к симуляции без входа --------------------------------
    #
    # Ответ у обоих один: можно, если речь о паттерне. Паттерн -- витрина, его
    # смотрят и трогают без учётной записи; песочница -- чужая работа. Но у
    # маршрута `/api/sim` различие спрятано в теле, а у `/api/sim/<id>` не видно
    # вовсе, поэтому обе проверки живут тут, рядом с тем, что открывает сессии.

    @staticmethod
    def sim_opens_pattern(body: dict[str, Any]) -> bool:
        """Открывает ли этот запрос симуляцию паттерна, а не песочницы.

        `POST /api/sim` -- один маршрут на оба случая, и по пути их не
        различить. Телу тут верить можно: `open_sim` читает его тем же
        правилом, то есть запрос без `sandbox` песочницу и не запустит.
        """
        return not body.get("sandbox")

    def sim_is_of_pattern(self, sim_id: str, *_: Any) -> bool:
        """Открыта ли эта сессия из паттерна.

        Спрашиваем не путь, а пул: в `/api/sim/<id>` о происхождении сессии
        ничего нет, и догадываться по идентификатору значило бы пускать к
        песочнице всякого, кто его угадал. Незнакомая сессия -- тоже «нельзя»:
        так отказ не отличает «нет такой» от «чужая».
        """
        return self.pool.origin_of(sim_id) == "pattern"

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
        """Конец связи из тела запроса.

        Порт необязателен, и это не послабление: без него адресуется точка --
        отдельная клетка (`{"instance": "X"}`) или узел внутри блока
        (`{"instance": "ffi/I"}`). Имя второго -- то же, каким нейрон зовётся в
        собранной сети, поэтому разбирать его здесь нечем: он приходит готовым.
        """
        if not isinstance(data, dict) or not data.get("instance"):
            raise PatternError(
                f"{what}: нужен конец связи вида "
                '{"instance": "ffi", "port": "in"} — или точка без порта: '
                '{"instance": "ffi/I"}'
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
        """Вставить паттерн блоком. В проект кладётся снимок, а не ссылка.

        `demo: true` -- переход с карточки паттерна (#526): вместе с блоком в
        проект ложится его витрина -- стимулы, записи и параметры прогона --
        настоящими объектами песочницы. Признак в теле, а не отдельный
        маршрут: вставляется в обоих случаях один и тот же паттерн в тот же
        проект, и второй маршрут пришлось бы держать в согласии с первым.

        Умолчание -- «нет», и это не осторожность, а правило: вставка из
        панели «Библиотека» кладёт молчащий блок (`patterns.adopt_demo`
        разбирает, почему у двух дорог разный ответ).
        """
        pattern_id = str(body.get("pattern") or "")
        if not pattern_id:
            raise PatternError("не сказано, что вставлять: нужен pattern")
        project = self._project(sandbox_id)
        position = body.get("position") or [0.0, 0.0]
        project.insert_pattern(
            self.store.load_pattern(pattern_id),
            label=body.get("label"),
            position=(float(position[0]), float(position[1])),
            demo=bool(body.get("demo")),
        )
        return api.sandbox_payload(project)

    def add_neuron(self, sandbox_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Положить на холст отдельную клетку из каталога типов.

        Тип берётся из каталога, а не из тела запроса: параметры мембраны
        правятся потом в панели свойств, и принимать их здесь значило бы
        завести второй способ описать клетку, который рано или поздно разойдётся
        с первым.
        """
        cell_id = str(body.get("cell") or "")
        if not cell_id:
            raise PatternError(
                'не сказано, какую клетку класть: {"cell": "pyr"}'
            )
        try:
            chosen = cells.catalog(self.store.cells()).get(cell_id)
        except KeyError as exc:
            raise PatternError(str(exc).strip("\"'")) from exc
        project = self._project(sandbox_id)
        position = body.get("position") or [0.0, 0.0]
        project.add_neuron(
            str(body["id"]) if body.get("id") else None,
            chosen.type,
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

    def block_params(
        self, sandbox_id: str, block_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        """Подпись блока. На холсте это `label` экземпляра, а не имя паттерна."""
        if body.get("label") is None:
            raise PatternError('нечего менять: ожидалось {"label": "Вход"}')
        project = self._project(sandbox_id)
        project.rename(block_id, str(body["label"]))
        return api.sandbox_payload(project)

    def cell_params(
        self, sandbox_id: str, object_id: str, type_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        """Параметры мембраны. Имена полей -- из `api.POINT_FIELDS`.

        Объект -- блок или отдельная клетка: `Project.set_cell` принимает оба,
        и у блока типы берутся из его снимка, а у клетки -- из общего словаря
        песочницы.
        """
        params: dict[str, Any] = {}
        for name, field in api.POINT_FIELDS.items():
            if body.get(name) is None:
                continue
            params[field] = (
                str(body[name]) if field == "kind" else float(body[name])
            )
        if not params:
            raise PatternError(
                "нечего менять: ожидались " + ", ".join(api.POINT_FIELDS)
            )
        project = self._project(sandbox_id)
        project.set_cell(object_id, type_id, **params)
        return api.sandbox_payload(project)

    def contact_params(
        self, sandbox_id: str, object_id: str, contact_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        """Рецептор, вес и задержка контакта внутри блока (#531).

        Тело разбирается ровно как у `link_params`, и это не повтор ради
        повтора: у связи холста и у контакта блока один и тот же набор полей,
        потому что вещь одна. Разойдись они -- и «вес» пришлось бы посылать
        двумя разными именами в зависимости от того, где связь нарисована.

        Правка задевает снимок этого экземпляра и никого больше: ни соседний
        блок того же паттерна, ни библиотеку, -- за это снимок и хранится.
        """
        params: dict[str, Any] = {}
        for key in ("weight", "delay"):
            if body.get(key) is not None:
                params[key] = float(body[key])
        if body.get("receptor"):
            params["receptor"] = str(body["receptor"])
        if not params:
            raise PatternError("нечего менять: ожидались weight, delay или receptor")
        project = self._project(sandbox_id)
        project.set_contact(object_id, contact_id, **params)
        return api.sandbox_payload(project)

    def move_object(self, sandbox_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Сдвиг по холсту -- для любого объекта: и блока, и отдельной клетки."""
        project = self._project(sandbox_id)
        position = body.get("position") or [0.0, 0.0]
        project.move(str(body.get("id") or ""), (float(position[0]), float(position[1])))
        return api.sandbox_payload(project)

    def arrange(self, sandbox_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Разложить схему: готовые места всем объектам сразу.

        Места приходят посчитанными, а не считаются здесь: раскладывается то,
        что видно на холсте, -- размеры фигур и раскрытие блока живут в
        интерфейсе и на сервер не уходят вовсе. Зато шаг отмены один на всю
        раскладку, и это уже свойство проекта (`Project.arrange`), а не
        интерфейса: двадцать отдельных сдвигов дали бы двадцать шагов истории.
        """
        raw = body.get("places")
        if not isinstance(raw, dict):
            raise PatternError(
                'нечего раскладывать: ожидались места объектов '
                '-- {"places": {"<объект>": [x, y]}}'
            )
        places = {
            str(name): (float(position[0]), float(position[1]))
            for name, position in raw.items()
        }
        project = self._project(sandbox_id)
        project.arrange(places)
        return api.sandbox_payload(project)

    def run_params(self, sandbox_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Длительность, шаг, зерно и уровень -- то, что меняют первым делом."""
        params: dict[str, Any] = {}
        for key in ("dt", "duration"):
            if body.get(key) is not None:
                params[key] = float(body[key])
        if body.get("seed") is not None:
            params["seed"] = int(body["seed"])
        if body.get("level"):
            params["level"] = str(body["level"])
        if not params:
            raise PatternError("нечего менять: ожидались dt, duration, seed или level")
        project = self._project(sandbox_id)
        project.set_run(**params)
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

    def stimulus_params(
        self, sandbox_id: str, stimulus_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        """Правка драйва: создавался он с числами по умолчанию, а не навсегда."""
        params: dict[str, Any] = {}
        for key in ("rate", "amplitude", "start", "stop"):
            if body.get(key) is not None:
                params[key] = float(body[key])
        for key in ("kind", "receptor"):
            if body.get(key):
                params[key] = str(body[key])
        if body.get("times") is not None:
            params["times"] = tuple(float(time) for time in body["times"])
        if not params:
            raise PatternError(
                "нечего менять: ожидались kind, receptor, rate, amplitude, "
                "times, start или stop"
            )
        project = self._project(sandbox_id)
        project.set_stimulus(stimulus_id, **params)
        return api.sandbox_payload(project)

    def recording_params(
        self, sandbox_id: str, recording_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        if not body.get("var"):
            raise PatternError('нечего менять: ожидалось {"var": "v"}')
        project = self._project(sandbox_id)
        project.set_recording(recording_id, str(body["var"]))
        return api.sandbox_payload(project)

    def ungroup(self, sandbox_id: str, object_id: str) -> dict[str, Any]:
        """Разобрать блок на клетки, связи и типы (#532).

        Тела у запроса нет: разбирать блок можно только целиком, и выбирать
        тут нечего -- ни имён, ни мест. Имена раздаёт `free_id` на сервере: он
        один знает, что в проекте уже занято, а столкновение всплыло бы иначе
        только на запуске.
        """
        project = self._project(sandbox_id)
        project.ungroup(object_id)
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


def nobody(*_: Any) -> bool:
    """Закрытый маршрут: без сессии сюда нельзя."""
    return False


def anyone(*_: Any) -> bool:
    """Открытый маршрут: сессия не нужна."""
    return True


@dataclass(frozen=True)
class Route:
    method: str
    path: re.Pattern[str]
    call: Callable[..., Any]
    #: Что обработчику нужно кроме частей пути: `params` или `body`.
    wants: str = ""
    #: Код успешного ответа. 201 там, где появился новый объект.
    ok: int = 200
    #: Кому маршрут отвечает без входа. Стоит рядом с методом и путём нарочно:
    #: требование входа -- свойство маршрута, а не условие внутри обработчика,
    #: иначе следующий добавленный маршрут откроется по недосмотру. По
    #: умолчанию -- `nobody`: забытый маршрут обязан оказаться закрытым.
    #: Функция получает те же аргументы, что уйдут в `call`, -- этим маршрут
    #: вроде `/api/sim/<id>` решает по самой сессии, а не по пути.
    anonymous: Callable[..., bool] = nobody


def routes(service: Api) -> list[Route]:
    """Таблица маршрутов.

    Нарочно плоская и явная: маршрутов десяток, и видеть их все на одном
    экране важнее, чем не повторять `/api/patterns` дважды. Здесь же видно и
    границу входа: `anonymous=anyone` -- открыто всем, отсутствие поля --
    закрыто.

    Граница такая. Библиотеку смотрят и трогают без входа: каталог, карточка и
    живая симуляция паттерна -- это витрина, на которую ссылаются. Вход нужен
    там, где запрос меняет состояние библиотеки, лезет в песочницу (чужая
    работа, а не витрина) или рассказывает о самом хранилище (`/api/health`).
    """
    return [
        Route("GET", re.compile(r"^/api/health$"), service.health),
        Route(
            "GET",
            re.compile(r"^/api/catalog$"),
            service.catalog,
            wants="params",
            anonymous=anyone,
        ),
        Route(
            "POST",
            re.compile(r"^/api/patterns$"),
            service.create_pattern,
            wants="body",
            ok=201,
        ),
        Route(
            "GET",
            re.compile(r"^/api/patterns/([^/]+)$"),
            service.pattern,
            anonymous=anyone,
        ),
        Route("DELETE", re.compile(r"^/api/patterns/([^/]+)$"), service.delete_pattern),
        # Каталог типов клеток закрыт, как и хранилище: встроенный набор
        # секретом не является, но свои клетки -- это уже содержимое `.vnl`,
        # и разделять один список на открытую и закрытую половины значило бы
        # отвечать на один вопрос двумя разными правдами. Палитра живёт в
        # песочнице, а туда без входа и так не заходят.
        Route("GET", re.compile(r"^/api/cells$"), service.cells),
        # Расшифровка подписей открыта: её спрашивает не только панель свойств
        # песочницы, но и карточка паттерна (#546), а за карточкой приходят по
        # ссылке и без входа. Закрытый словарь означал бы, что аноним читает на
        # витрине `g_exc` и `gaba_a`, а вошедший -- «возбуждающая проводимость»
        # и «быстрое торможение»: одна и та же витрина двумя разными языками.
        # Содержимого хранилища здесь нет -- это реестр, одинаковый на любой
        # машине, поэтому в отличие от `/api/cells` открывать его нечем рискнуть.
        Route(
            "GET",
            re.compile(r"^/api/glossary$"),
            service.glossary,
            anonymous=anyone,
        ),
        Route(
            "POST",
            re.compile(r"^/api/sim$"),
            service.open_sim,
            wants="body",
            ok=201,
            anonymous=service.sim_opens_pattern,
        ),
        Route(
            "GET",
            re.compile(r"^/api/sim/([^/]+)$"),
            service.sim,
            wants="params",
            anonymous=service.sim_is_of_pattern,
        ),
        Route(
            "POST",
            re.compile(r"^/api/sim/([^/]+)/start$"),
            service.sim_start,
            wants="params",
            anonymous=service.sim_is_of_pattern,
        ),
        Route(
            "POST",
            re.compile(r"^/api/sim/([^/]+)/pause$"),
            service.sim_pause,
            wants="params",
            anonymous=service.sim_is_of_pattern,
        ),
        Route(
            "POST",
            re.compile(r"^/api/sim/([^/]+)/reset$"),
            service.sim_reset,
            anonymous=service.sim_is_of_pattern,
        ),
        Route(
            "POST",
            re.compile(r"^/api/sim/([^/]+)/seek$"),
            service.sim_seek,
            wants="body",
            anonymous=service.sim_is_of_pattern,
        ),
        Route(
            "DELETE",
            re.compile(r"^/api/sim/([^/]+)$"),
            service.close_sim,
            anonymous=service.sim_is_of_pattern,
        ),
        # Песочницы закрыты все до единой, включая чтение: это чья-то работа в
        # процессе, а не витрина. Поэтому ниже нет ни одного `anonymous`.
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
            "PATCH",
            re.compile(r"^/api/sandboxes/([^/]+)/blocks/([^/]+)$"),
            service.block_params,
            wants="body",
        ),
        Route(
            "POST",
            re.compile(r"^/api/sandboxes/([^/]+)/neurons$"),
            service.add_neuron,
            wants="body",
            ok=201,
        ),
        # Путь говорит «объект», а не «блок»: мембрану правят и у блока, и у
        # отдельной клетки, а маршрут, врущий о том, что принимает, однажды
        # заставит завести второй такой же.
        Route(
            "PATCH",
            re.compile(r"^/api/sandboxes/([^/]+)/objects/([^/]+)/cells/([^/]+)$"),
            service.cell_params,
            wants="body",
        ),
        # Контакт внутри блока. Путь тоже про «объект», хотя контакты бывают
        # только у блока: адрес мембраны и адрес контакта обязаны читаться
        # одинаково, иначе панель свойств одного и того же блока ходила бы по
        # двум разным семействам путей.
        Route(
            "PATCH",
            re.compile(r"^/api/sandboxes/([^/]+)/objects/([^/]+)/contacts/([^/]+)$"),
            service.contact_params,
            wants="body",
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
            service.move_object,
            wants="body",
        ),
        # Раскладка -- не «сдвинуть ещё раз»: у неё один шаг отмены на всю
        # схему, поэтому и маршрут свой, а не `move` в цикле.
        Route(
            "POST",
            re.compile(r"^/api/sandboxes/([^/]+)/arrange$"),
            service.arrange,
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
            "PATCH",
            re.compile(r"^/api/sandboxes/([^/]+)/stimuli/([^/]+)$"),
            service.stimulus_params,
            wants="body",
        ),
        Route(
            "POST",
            re.compile(r"^/api/sandboxes/([^/]+)/recordings$"),
            service.add_recording,
            wants="body",
            ok=201,
        ),
        Route(
            "PATCH",
            re.compile(r"^/api/sandboxes/([^/]+)/recordings/([^/]+)$"),
            service.recording_params,
            wants="body",
        ),
        Route(
            "PATCH",
            re.compile(r"^/api/sandboxes/([^/]+)/run$"),
            service.run_params,
            wants="body",
        ),
        # Разбор блока -- POST, а не DELETE: блок не убирают, его заменяют
        # тем же содержимым в другом виде. DELETE рядом означает совсем другое
        # -- унести вместе со всем, что на блоке висело.
        Route(
            "POST",
            re.compile(r"^/api/sandboxes/([^/]+)/objects/([^/]+)/ungroup$"),
            service.ungroup,
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
    #: Вход через Reckue auth. `None` -- вход не настроен, и тогда сервер
    #: работает как раньше: закрыт тем, что слушает только 127.0.0.1.
    provider: auth.Provider | None = None

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
        params = parse_qs(split.query)

        # Шаги входа доступны без сессии -- иначе войти было бы нельзя.
        if path.startswith("/auth/"):
            self._login_step(method, path, params)
            return
        # `/api/ready` и `/api/session` отвечают здесь, а не маршрутом: они не о
        # библиотеке, а о самой службе и о том, кто пришёл. Открыты оба: первый
        # нужен выкату (ansible ждёт 200 на 127.0.0.1, и закрывать его значило
        # бы завязать проверку здоровья службы на чужой сервис), второй --
        # интерфейсу, чтобы он нарисовал кнопку входа, а не пустоту.
        if path == "/api/ready":
            self._send(200, {"ok": True, "version": __version__})
            return
        if path == "/api/session":
            self._send(200, self._session_payload())
            return

        if not path.startswith("/api/"):
            # Интерфейс отдаётся всем. Редирект на вход отсюда убран нарочно:
            # без сессии человек должен попасть в библиотеку и увидеть кнопку
            # входа, а не упереться в чужую форму раньше, чем в содержимое.
            self._static(path, method)
            return
        for route in self.table:
            if route.method != method:
                continue
            match = route.path.match(path)
            if not match:
                continue
            self._call(route, match, params)
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
            # Права проверяются после разбора аргументов и до работы: решение
            # «пускать ли» у части маршрутов зависит от тела и от того, что за
            # сессией стоит, а не только от пути.
            if not self._entered() and not route.anonymous(*arguments):
                self._refuse()
                return
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

    # --- вход -------------------------------------------------------------
    #
    # Проверка `Host` выше и вход здесь закрывают разное. Первая отвечает на
    # «с этой ли машины пришёл запрос», второй -- на «кто этот человек».
    # На стенде nginx ходит сюда с `Host: localhost`, то есть для приложения
    # весь интернет выглядит как своя машина, и без второго рубежа открытым
    # оказалось бы всё -- песочницы и запись в библиотеку в том числе. Поэтому
    # убрать одно, оставив другое, нельзя.

    def _cookie(self, name: str) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            jar = SimpleCookie()
            jar.load(raw)
        except Exception:  # noqa: BLE001 -- чужой заголовок, разбор не обязан удаться
            return None
        found = jar.get(name)
        return found.value if found else None

    def _session(self) -> auth.Session | None:
        """Кто вошёл, по подписанной куке. `None` -- никто."""
        if self.provider is None:
            return None
        value = self._cookie(auth.SESSION_COOKIE)
        if not value:
            return None
        payload = auth.unseal(value, self.provider.settings.secret)
        if not payload or not payload.get("sub"):
            return None
        return auth.Session(
            sub=str(payload["sub"]),
            email=payload.get("email"),
            name=payload.get("name"),
        )

    def _entered(self) -> bool:
        return self.provider is None or self._session() is not None

    def _session_payload(self) -> dict[str, Any]:
        """Ответ `/api/session`: кто вошёл и куда идти, если никто.

        `login: null` при ненастроенном входе -- это «кнопка входа не нужна», а
        не «войти нельзя»: так интерфейс на своей машине не показывает лишнего.
        """
        if self.provider is None:
            return {"user": None, "login": None, "required": False}
        session = self._session()
        return {
            "user": session.as_payload() if session else None,
            "login": auth.LOGIN_PATH,
            "logout": auth.LOGOUT_PATH,
            "required": True,
        }

    def _refuse(self) -> None:
        """Отказ анониму на закрытом маршруте: код 401 и адрес входа.

        Редирект в ответ на запрос интерфейса выглядел бы для него как успешный
        ответ с HTML вместо JSON, поэтому здесь именно 401: по нему интерфейс
        предлагает войти, а не ломается на разборе. Адрес входа идёт в теле,
        чтобы кнопку не пришлось зашивать в интерфейс второй раз.
        """
        self._send(
            401,
            {"error": "нужен вход через Reckue auth", "login": auth.LOGIN_PATH},
        )

    def _login_step(self, method: str, path: str, params: dict[str, list[str]]) -> None:
        if self.provider is None:
            self._send(404, {"error": "вход через Reckue auth не настроен"})
            return
        if method != "GET":
            self._send(405, {"error": f"{method} к шагам входа"})
            return
        try:
            if path == auth.LOGIN_PATH:
                self._login_start(params)
            elif path == auth.CALLBACK_PATH:
                self._login_finish(params)
            elif path == auth.LOGOUT_PATH:
                self._logout()
            else:
                self._send(404, {"error": f"нет шага входа {path}"})
        except auth.AuthError as exc:
            # Провайдер недоступен или ответил отказом -- это не сбой стенда, а
            # повод показать причину и дать войти заново.
            self._login_error(str(exc))

    def _login_start(self, params: dict[str, list[str]] | None = None) -> None:
        """Начало входа. `?next=` -- куда вернуть человека после него.

        Возврат запоминается в той же подписанной куке, что `state` и
        `code_verifier`, а не передаётся провайдеру: провайдеру незачем знать
        внутренние адреса приложения, а подписанная кука не даёт подменить
        адрес по пути. Значение всё равно проверяется -- см. `auth.safe_next`.
        """
        assert self.provider is not None
        state = auth.new_state()
        verifier = auth.new_verifier()
        url = self.provider.authorize_url(state, verifier)
        payload: dict[str, Any] = {
            "state": state,
            "verifier": verifier,
            "exp": time.time() + auth.FLOW_TTL,
        }
        target = auth.safe_next((params or {}).get("next", [None])[0])
        if target:
            payload["next"] = target
        flow = auth.seal(payload, self.provider.settings.secret)
        self._redirect(
            url,
            cookies=[self._cookie_header(auth.FLOW_COOKIE, flow, auth.FLOW_TTL)],
        )

    def _login_finish(self, params: dict[str, list[str]]) -> None:
        assert self.provider is not None
        secret = self.provider.settings.secret
        given = params.get("error", [None])[0]
        if given:
            raise auth.AuthError(f"Reckue auth отказал: {given}")
        code = params.get("code", [None])[0]
        state = params.get("state", [None])[0]
        if not code or not state:
            raise auth.AuthError("возврат без code или state")
        raw = self._cookie(auth.FLOW_COOKIE)
        flow = auth.unseal(raw, secret) if raw else None
        if not flow:
            raise auth.AuthError("вход начат слишком давно -- попробуйте снова")
        # `state` сверяется постоянным по времени сравнением: он же защита от
        # подсунутого чужого `code` (CSRF на входе).
        if not hmac.compare_digest(str(flow.get("state", "")), state):
            raise auth.AuthError("state не совпал -- вход начат не здесь")
        tokens = self.provider.exchange(code, str(flow["verifier"]))
        claims = self.provider.claims(tokens["id_token"])
        # Имя и почта приходят не в токене, а с `userinfo`: при коде
        # авторизации провайдер кладёт в `id_token` только `sub`. Спрашиваем
        # только если в токене их и правда нет -- лишний поход к провайдеру на
        # каждый вход не нужен.
        if not claims.get("email") and not claims.get("name"):
            access = tokens.get("access_token")
            if access:
                claims = {
                    **claims,
                    **self.provider.userinfo(str(access), str(claims.get("sub"))),
                }
        session = auth.Session.of(claims)
        payload = session.as_payload()
        payload["exp"] = time.time() + self.provider.settings.session_ttl
        payload["idt"] = tokens["id_token"]
        if not self.quiet:
            print(f"вошёл {session.email or session.sub}", file=sys.stderr)
        # Обратно туда, откуда человека увели на вход. Проверяем второй раз: в
        # куке значение своё, но проверка на выходе дешевле, чем доверие к тому,
        # что на входе ничего не изменится.
        self._redirect(
            auth.safe_next(flow.get("next")) or "/",
            cookies=[
                self._cookie_header(
                    auth.SESSION_COOKIE,
                    auth.seal(payload, secret),
                    self.provider.settings.session_ttl,
                ),
                # Кука незавершённого входа больше не нужна: `code` одноразовый.
                self._cookie_header(auth.FLOW_COOKIE, "", 0),
            ],
        )

    def _logout(self) -> None:
        assert self.provider is not None
        hint = None
        raw = self._cookie(auth.SESSION_COOKIE)
        payload = auth.unseal(raw, self.provider.settings.secret) if raw else None
        if payload:
            hint = payload.get("idt")
        self._redirect(
            self.provider.logout_url(hint) or "/",
            cookies=[self._cookie_header(auth.SESSION_COOKIE, "", 0)],
        )

    def _cookie_header(self, name: str, value: str, max_age: int) -> str:
        """Значение `Set-Cookie`.

        `HttpOnly` -- содержимое куки скриптам не нужно, а вынести её в чужой
        скрипт больше нечем. `SameSite=Lax`, а не `Strict`: возврат с
        провайдера -- переход с чужого сайта, и при `Strict` куку входа браузер
        бы не прислал. `Secure` -- по схеме адреса возврата, иначе запуск на
        `http://127.0.0.1` перестал бы работать.
        """
        assert self.provider is not None
        parts = [
            f"{name}={value}",
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            f"Max-Age={max_age}",
        ]
        if self.provider.settings.secure_cookies:
            parts.append("Secure")
        return "; ".join(parts)

    def _redirect(self, url: str, cookies: list[str] | None = None) -> None:
        self.send_response(302)
        self.send_header("Location", url)
        for cookie in cookies or []:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _login_error(self, reason: str) -> None:
        """Страница «войти не удалось».

        Единственное место, где сервер сам рисует HTML: сюда попадает человек в
        браузере, а не интерфейс, и JSON с текстом ошибки он прочитать не
        сможет. Разметка нарочно в три строки -- это сообщение об отказе, а не
        экран приложения.
        """
        body = (
            "<!doctype html><html lang=ru><meta charset=utf-8>"
            "<title>Вход не удался</title>"
            "<body style='font:16px/1.5 system-ui;margin:4rem auto;max-width:34rem'>"
            f"<h1 style='font-size:1.25rem'>Вход не удался</h1><p>{escape(reason)}</p>"
            f"<p><a href='{auth.LOGIN_PATH}'>Попробовать снова</a></p>"
        ).encode("utf-8")
        self.send_response(400)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

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
        self.send_header("Cache-Control", _caching(target, root))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:
        if not self.quiet:
            super().log_message(fmt, *args)


def _caching(target: Path, root: Path) -> str:
    """Что говорить браузеру о сроке годности файла интерфейса.

    Vite складывает в `assets/` файлы, в имени которых стоит хеш содержимого:
    такое имя означает ровно одно содержимое навсегда, и перепрашивать его
    незачем. Всё остальное -- `index.html`, иконка, `favicon` -- лежит под
    постоянными именами и меняется с выкатом, поэтому им `no-cache`: не «не
    храни», а «спроси, не изменилось ли».

    Без этого браузер оставлял себе старый `index.html` и после выката просил
    по нему файлы, которых уже нет, а с сервером говорил старым форматом --
    экран показывал не новую версию, а ошибку.
    """
    try:
        inside = target.relative_to(root)
    except ValueError:  # пути не под корнем сюда не доходят, но гадать не будем
        return "no-cache"
    if inside.parts and inside.parts[0] == "assets":
        return "public, max-age=31536000, immutable"
    return "no-cache"


def create_server(
    root: str | Path,
    port: int = 8765,
    ui: str | Path | None = None,
    quiet: bool = False,
    bind: str = "127.0.0.1",
    provider: auth.Provider | None = None,
) -> ThreadingHTTPServer:
    """Сервер поверх хранилища. `port=0` -- свободный порт, удобно в тестах.

    `bind` менять почти никогда не нужно: по умолчанию сервер слышен только с
    этой машины. Исключение -- контейнер, где `127.0.0.1` означает loopback
    самого контейнера, и опубликованный порт до него не доходит. Там адрес
    расширяют, а «только со своей машины» держат публикацией порта на loopback
    хоста и проверкой `Host` -- она остаётся при любом адресе.

    `provider` -- вход через Reckue auth. По умолчанию берётся из окружения
    (`VNL_OIDC_*`, `VNL_SESSION_SECRET`), и его отсутствие -- рабочий режим для
    своей машины. Явным аргументом его подставляют тесты, где провайдер --
    свой сервер на localhost.
    """
    index = Index.from_env()
    service = Api(Store(root, index=index), index=index)
    ui_path = Path(ui) if ui else None
    if ui_path is not None and not ui_path.exists():
        raise StoreError(f"интерфейса нет по пути {ui_path}")
    if provider is None:
        settings = auth.Settings.from_env(dict(os.environ))
        provider = auth.Provider(settings) if settings else None

    handler = type(
        "BoundHandler",
        (Handler,),
        {
            "service": service,
            "table": routes(service),
            "ui": ui_path,
            "quiet": quiet,
            "provider": provider,
        },
    )
    return ThreadingHTTPServer((bind, port), handler)
