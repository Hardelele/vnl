"""Командная строка: vnl check | run | view | data | export | graph | add | cell |
index | serve."""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

from . import __version__
from .backends.dot_export import export as dot_export
from .backends.netpyne_export import export as netpyne_export
from .ir import Model, Site
from dataclasses import replace

from .patterns import DRAFT_LEVEL, LEVEL_NAMES, Pattern, Port
from .resolve import Diagnostic, ValidationError, load
from .sim import simulate
from .store import StoreError


def _read(path: str) -> tuple[Model, list[Diagnostic]]:
    text = Path(path).read_text(encoding="utf-8")
    return load(text, source=path, strict=True)


def _print_diagnostics(diagnostics: list[Diagnostic]) -> None:
    for diagnostic in diagnostics:
        print(diagnostic, file=sys.stderr)


def _raster(model: Model, spikes: dict[str, list[float]], width: int = 78) -> str:
    duration = model.run.duration
    label_width = max((len(name) for name in spikes), default=4)
    lines = []
    for name in model.instances:
        row = ["."] * width
        for time in spikes.get(name, []):
            column = min(width - 1, int(time / duration * width))
            row[column] = "|"
        lines.append(f"{name:>{label_width}} {''.join(row)}")
    lines.append(f"{'':>{label_width}} 0{' ' * (width - 8)}{duration:g} мс")
    return "\n".join(lines)


def cmd_check(args: argparse.Namespace) -> int:
    model, diagnostics = _read(args.file)
    _print_diagnostics(diagnostics)
    summary = model.summary()
    print(
        f"{model.name}: "
        + ", ".join(f"{key}={value}" for key, value in summary.items())
    )
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    model, diagnostics = _read(args.file)
    _print_diagnostics(diagnostics)

    if model.run.level == "L2":
        print(
            "уровень L2 считается NEURON: сгенерируйте скрипт через "
            "`vnl export` и запустите его там, где установлен NetPyNE",
            file=sys.stderr,
        )
        return 2

    result = simulate(model)
    if result.degradation:
        print("деградация L2 -> L1:", file=sys.stderr)
        for note in result.degradation:
            print(f"  {note}", file=sys.stderr)

    print(_raster(model, result.spikes))
    print()
    for name, count in result.spike_count().items():
        rate = count / model.run.duration * 1000.0
        print(f"{name}: {count} спайков ({rate:.1f} Гц)")

    if args.traces:
        path = Path(args.traces)
        header = ["t"] + list(result.traces)
        rows = [",".join(header)]
        for index, time in enumerate(result.times):
            rows.append(
                ",".join(
                    [f"{time:.3f}"]
                    + [f"{result.traces[key][index]:.6g}" for key in result.traces]
                )
            )
        path.write_text("\n".join(rows), encoding="utf-8")
        print(f"\nтрассы записаны: {path}")
    return 0


def cmd_view(args: argparse.Namespace) -> int:
    model, diagnostics = _read(args.file)
    _print_diagnostics(diagnostics)

    if model.run.level == "L2":
        print("для просмотра нужен прогон L1: поставьте level = L1", file=sys.stderr)
        return 2

    from .layout import LayoutError, layout
    from .report import render

    result = simulate(model)
    try:
        placement = layout(model, args.layout)
    except LayoutError as exc:
        print(str(exc), file=sys.stderr)
        return 3
    for note in placement.notes:
        print(note, file=sys.stderr)

    out = Path(args.out or Path(args.file).with_suffix(".html"))
    out.write_text(render(model, result, placement), encoding="utf-8")
    print(f"страница: {out} (раскладка: {placement.engine})")
    if args.open:
        webbrowser.open(out.resolve().as_uri())
    return 0


def cmd_data(args: argparse.Namespace) -> int:
    """Прогон в JSON -- то, чем живёт интерфейс."""
    model, diagnostics = _read(args.file)
    _print_diagnostics(diagnostics)

    from .api import dumps, run_payload
    from .sweep import SweepError, run_sweep, summarise

    sweep = None
    if args.sweep:
        try:
            sweep = run_sweep(model, args.sweep)
        except SweepError as exc:
            print(str(exc), file=sys.stderr)
            return 4
        print(f"развёртка {sweep.path}: {len(sweep.variants)} вариантов")
        for row in summarise(sweep, model):
            rates = ", ".join(
                f"{name} {count}" for name, count in row["spikes"].items()
            )
            print(f"  {row['label']:>8s} → {rates}")
        for variant in sweep.variants:
            _print_diagnostics(variant.diagnostics)

    payload = run_payload(model, simulate(model), diagnostics, sweep)
    out = Path(args.out or Path(args.file).with_suffix(".json"))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(dumps(payload, pretty=args.pretty), encoding="utf-8")
    size = out.stat().st_size / 1024
    print(f"данные прогона: {out} ({size:.0f} КБ)")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    model, diagnostics = _read(args.file)
    _print_diagnostics(diagnostics)

    report = netpyne_export(model)
    out = Path(args.out or Path(args.file).with_suffix(".netpyne.py"))
    out.write_text(report.script, encoding="utf-8")
    print(f"скрипт NetPyNE: {out}")
    if report.losses:
        print("\nне перенесено один в один:")
        for loss in report.losses:
            print(f"  - {loss}")
    return 0


def cmd_graph(args: argparse.Namespace) -> int:
    model, _ = _read(args.file)
    dot = dot_export(model)
    if args.out:
        Path(args.out).write_text(dot, encoding="utf-8")
        print(f"граф: {args.out}")
    else:
        print(dot)
    return 0


def _port(spec: str) -> Port:
    """`in=IN.soma`, `out=E.dend.apical[1]@0.6`, `drive:mod=VTA.soma`.

    Порт не выводится из схемы сам: чем блок подключается наружу -- решение
    автора, а не свойство модели. Два одинаковых по форме входа могут значить
    «сюда приходит сигнал» и «сюда приходит управление».
    """
    if "=" not in spec:
        raise ValidationError(
            [Diagnostic("error", spec, "порт пишется как имя=точка, например in=IN.soma")]
        )
    left, target = spec.split("=", 1)
    name, _, direction = left.partition(":")
    direction = direction or name
    if direction not in ("in", "out", "mod"):
        raise ValidationError(
            [
                Diagnostic(
                    "error",
                    spec,
                    f"направление {direction!r} не из in/out/mod; "
                    "если имя порта своё, пишите имя:направление=точка",
                )
            ]
        )

    place, _, fraction = target.partition("@")
    instance, _, section = place.partition(".")
    if not instance:
        raise ValidationError(
            [Diagnostic("error", spec, "не указан нейрон: нужно вида IN.soma")]
        )
    return Port(
        name=name,
        direction=direction,  # type: ignore[arg-type]
        site=Site(
            instance=instance,
            section=section or "soma",
            fraction=float(fraction) if fraction else 0.5,
        ),
    )


def _notes(specs: list[str] | None) -> dict[str, str]:
    """`--note in=вход схемы` -- подпись порта для интерфейса.

    Отдельным флагом, а не хвостом к `--port`: в подписи бывают и пробелы, и
    двоеточия, и разделитель пришлось бы выбирать из того, чего в русском
    тексте не встречается.
    """
    out: dict[str, str] = {}
    for spec in specs or []:
        name, _, text = spec.partition("=")
        if not name or not text:
            raise ValidationError(
                [Diagnostic("error", spec, "подпись пишется как имя=текст")]
            )
        out[name] = text
    return out


def cmd_add(args: argparse.Namespace) -> int:
    """Положить готовую схему в библиотеку.

    Раньше это делалось только из Python, поэтому наполнить библиотеку можно
    было лишь разовым скриптом. Стимулы и записи уезжают в витрину карточки
    сами (`Pattern.from_model`), так что импорт примера сразу даёт паттерн с
    демонстрационным запуском.
    """
    from .store import Store

    model, diagnostics = _read(args.file)
    _print_diagnostics(diagnostics)

    store = Store(args.root)
    notes = _notes(args.note)
    ports = [
        replace(port, note=notes.get(port.name, ""))
        for port in (_port(spec) for spec in (args.port or []))
    ]
    name = args.name or model.name
    taken = [item.id for item in store.patterns()]
    identifier = args.id or Pattern.empty(name, taken=taken).id

    pattern = Pattern.from_model(
        model,
        id=identifier,
        name=name,
        ports=ports,
        level=args.level,
        status="ready" if ports else "draft",
    )
    problems = pattern.validate()
    store.save_pattern(pattern)

    print(f"{pattern.name} -> {store.pattern_path(pattern.id)}")
    for problem in problems:
        print(f"  черновик: {problem}", file=sys.stderr)
    return 0


def cmd_cell(args: argparse.Namespace) -> int:
    """Типы клеток: посмотреть каталог или добавить свои из `.vnl`.

    Импорт нужен затем, чтобы своя клетка не была вторым сортом: объявление
    `cell` в модели уже даёт готовый `ir.CellType` вместе с морфологией, и
    класть её в каталог надо тем же движением, каким схема попадает в
    библиотеку (`vnl add`). Встроенный набор при этом не трогается -- своя
    клетка перекрывает встроенную по идентификатору, а не затирает её.
    """
    from .cells import Cell, catalog
    from .store import Store

    store = Store(args.root)
    if args.action == "list":
        for cell in catalog(store.cells()).cells:
            mark = "встроенная" if cell.builtin else "своя"
            kind = "тормозная" if cell.inhibitory else "возбуждающая"
            print(f"{cell.id:<10} {cell.name}  [{mark}, {kind}]")
        return 0

    if not args.file:
        print("нечего разбирать: vnl cell add <файл.vnl>", file=sys.stderr)
        return 1
    model, diagnostics = _read(args.file)
    _print_diagnostics(diagnostics)
    if not model.cell_types:
        print(f"в {args.file} нет ни одного объявления cell", file=sys.stderr)
        return 1
    if args.name and len(model.cell_types) > 1:
        print(
            f"в {args.file} объявлено {len(model.cell_types)} типов "
            f"({', '.join(model.cell_types)}) — одно имя на всех не подходит",
            file=sys.stderr,
        )
        return 1

    for type_id, cell_type in model.cell_types.items():
        cell = Cell(
            # Человеческого имени в языке нет: `cell pyr_l5 : excitatory` --
            # это идентификатор, а не подпись. Спрашиваем её флагом, а молча
            # придумывать не за что -- пусть в каталоге стоит то же имя.
            name=args.name or type_id,
            type=cell_type,
            note=args.note or "",
            builtin=False,
            source=args.file,
        )
        store.save_cell(cell)
        print(f"{cell.id} -> {store.cell_path(cell.id)}")
    return 0


def cmd_index(args: argparse.Namespace) -> int:
    """Индекс метаданных: пересобрать или посмотреть состояние.

    Пересборка -- единственный способ починить расхождение: индекс производен
    от файлов, и если хранилище правили мимо приложения, правда в файлах.
    """
    import os

    from .index import DSN_ENV, Index, IndexUnavailable
    from .store import Store

    dsn = args.dsn or os.environ.get(DSN_ENV)
    if not dsn:
        print(
            f"нет строки подключения: задайте {DSN_ENV} или --dsn", file=sys.stderr
        )
        return 1

    store = Store(args.root)
    index = Index(dsn)
    try:
        if args.action == "rebuild":
            count = index.rebuild(store.patterns())
            print(f"индекс пересобран: {count} паттернов")
        else:
            files = len(store.patterns())
            state = index.state(files)
            # Недоступный индекс -- отказ, а не «строк неизвестно». `state()`
            # глотает причину нарочно: приложению важно продолжить работу,
            # читая файлы. Диагностической команде -- наоборот: молчаливый ноль
            # здесь означает, что проверка выката проходит на сломанном
            # индексе, и мы узнаём о нём из stderr службы или никогда.
            if not state.get("connected"):
                print(state.get("reason", "индекс недоступен"), file=sys.stderr)
                return 1
            print(f"файлов: {files}, в индексе: {state.get('rows', '?')}")
            if state.get("stale"):
                print("индекс разошёлся с хранилищем: нужен `vnl index rebuild`")
    except IndexUnavailable as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        index.close()
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    # Импорт внутри команды: остальным командам сервер не нужен, а `vnl check`
    # не должен тянуть за собой сокеты.
    from .server import create_server

    server = create_server(
        args.root, port=args.port, ui=args.ui, quiet=args.quiet, bind=args.bind
    )
    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}"
    print(f"хранилище: {Path(args.root).resolve()}")
    print(f"библиотека: {url}/api/catalog")
    if args.ui:
        print(f"интерфейс: {url}")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        # Ctrl+C -- обычный способ остановить локальный инструмент, не сбой.
        print()
    finally:
        # Симуляции считают в своих потоках: их надо остановить самим, а не
        # надеяться, что процесс завершится раньше, чем они успеют навредить.
        server.RequestHandlerClass.service.pool.close_all()  # type: ignore[attr-defined]
        server.server_close()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="vnl", description=__doc__)
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check", help="разобрать и проверить модель")
    check.add_argument("file")
    check.set_defaults(func=cmd_check)

    run = sub.add_parser("run", help="посчитать на уровне L1")
    run.add_argument("file")
    run.add_argument("--traces", help="куда выгрузить трассы в CSV")
    run.set_defaults(func=cmd_run)

    view = sub.add_parser("view", help="посчитать и собрать HTML со схемой и трассами")
    view.add_argument("file")
    view.add_argument("-o", "--out")
    view.add_argument("--open", action="store_true", help="открыть в браузере")
    view.add_argument(
        "--layout",
        choices=("auto", "elk", "builtin"),
        default="auto",
        help="движок раскладки схемы (по умолчанию auto: ELK, если доступен)",
    )
    view.set_defaults(func=cmd_view)

    data = sub.add_parser("data", help="выгрузить прогон в JSON для интерфейса")
    data.add_argument("file")
    data.add_argument("-o", "--out")
    data.add_argument(
        "--pretty", action="store_true", help="читаемый JSON с отступами"
    )
    data.add_argument(
        "--sweep",
        metavar="ПАРАМЕТР=ЗНАЧЕНИЯ",
        help='развернуть параметр, например "c1.delay=0.5,1,2,4"',
    )
    data.set_defaults(func=cmd_data)

    export = sub.add_parser("export", help="сгенерировать скрипт NetPyNE")
    export.add_argument("file")
    export.add_argument("-o", "--out")
    export.set_defaults(func=cmd_export)

    graph = sub.add_parser("graph", help="выгрузить граф в формате DOT")
    graph.add_argument("file")
    graph.add_argument("-o", "--out")
    graph.set_defaults(func=cmd_graph)

    add = sub.add_parser("add", help="положить схему из .vnl в библиотеку")
    add.add_argument("file")
    add.add_argument("--root", default=".vnl", help="каталог хранилища")
    add.add_argument("--name", help="имя паттерна (по умолчанию имя модели)")
    add.add_argument("--id", help="идентификатор (по умолчанию из имени)")
    add.add_argument(
        "--level",
        choices=tuple(LEVEL_NAMES),
        default=DRAFT_LEVEL,
        help=(
            "ступень разбора в каталоге, а не детализация физики: "
            + ", ".join(f"{key} -- {name}" for key, name in LEVEL_NAMES.items())
        ),
    )
    add.add_argument(
        "--port",
        action="append",
        metavar="ИМЯ=ТОЧКА",
        help="порт блока, например in=IN.soma или drive:mod=VTA.soma",
    )
    add.add_argument(
        "--note",
        action="append",
        metavar="ИМЯ=ТЕКСТ",
        help="подпись порта, например in=вход схемы",
    )
    add.set_defaults(func=cmd_add)

    cell = sub.add_parser("cell", help="каталог типов клеток: палитра песочницы")
    cell.add_argument("action", choices=("add", "list"))
    cell.add_argument("file", nargs="?", help="файл .vnl с объявлениями cell")
    cell.add_argument("--root", default=".vnl", help="каталог хранилища")
    cell.add_argument(
        "--name", help="имя для каталога (по умолчанию идентификатор типа)"
    )
    cell.add_argument("--note", help="чем клетка занята в схеме")
    cell.set_defaults(func=cmd_cell)

    index = sub.add_parser("index", help="индекс метаданных библиотеки в Postgres")
    index.add_argument("action", choices=("rebuild", "status"))
    index.add_argument("--root", default=".vnl", help="каталог хранилища")
    index.add_argument(
        "--dsn", help="строка подключения; по умолчанию из VNL_INDEX_DSN"
    )
    index.set_defaults(func=cmd_index)

    serve = sub.add_parser(
        "serve", help="локальный сервер библиотеки паттернов и песочниц"
    )
    serve.add_argument(
        "--root", default=".vnl", help="каталог хранилища (по умолчанию .vnl)"
    )
    serve.add_argument("--port", type=int, default=8765, help="порт (0 -- любой свободный)")
    serve.add_argument(
        "--bind",
        default="127.0.0.1",
        help="адрес, который слушать; менять нужно только в контейнере",
    )
    serve.add_argument("--ui", help="каталог собранного интерфейса, например ui/dist")
    serve.add_argument("--open", action="store_true", help="открыть в браузере")
    serve.add_argument(
        "--quiet", action="store_true", help="не писать строку на каждый запрос"
    )
    serve.set_defaults(func=cmd_serve)

    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except StoreError as exc:
        # Хранилища нет или интерфейс не собран -- это про запуск, а не про модель.
        print(exc, file=sys.stderr)
        return 1
    except ValidationError as exc:
        # Модель не прошла проверку -- это нормальный исход работы, а не сбой
        # программы, поэтому печатаем диагностику, а не трассу стека.
        _print_diagnostics(exc.diagnostics)
        return 1


if __name__ == "__main__":
    sys.exit(main())
