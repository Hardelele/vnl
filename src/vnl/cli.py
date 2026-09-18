"""Командная строка: vnl check | run | view | export | graph."""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

from . import __version__
from .backends.netpyne_export import export as netpyne_export
from .ir import Model
from .resolve import Diagnostic, ValidationError, load
from .sim import simulate


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
    try:
        model, diagnostics = _read(args.file)
    except ValidationError as exc:
        _print_diagnostics(exc.diagnostics)
        return 1
    _print_diagnostics(diagnostics)
    summary = model.summary()
    print(
        f"{model.name}: "
        + ", ".join(f"{key}={value}" for key, value in summary.items())
    )
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    try:
        model, diagnostics = _read(args.file)
    except ValidationError as exc:
        _print_diagnostics(exc.diagnostics)
        return 1
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
    try:
        model, diagnostics = _read(args.file)
    except ValidationError as exc:
        _print_diagnostics(exc.diagnostics)
        return 1
    _print_diagnostics(diagnostics)

    if model.run.level == "L2":
        print("для просмотра нужен прогон L1: поставьте level = L1", file=sys.stderr)
        return 2

    from .report import render

    result = simulate(model)
    out = Path(args.out or Path(args.file).with_suffix(".html"))
    out.write_text(render(model, result), encoding="utf-8")
    print(f"страница: {out}")
    if args.open:
        webbrowser.open(out.resolve().as_uri())
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    try:
        model, diagnostics = _read(args.file)
    except ValidationError as exc:
        _print_diagnostics(exc.diagnostics)
        return 1
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
    try:
        model, _ = _read(args.file)
    except ValidationError as exc:
        _print_diagnostics(exc.diagnostics)
        return 1

    lines = [f"digraph {model.name} {{", "  rankdir=LR;", "  node [shape=circle];"]
    for instance in model.instances.values():
        cell_type = model.cell_types[instance.cell_type]
        inhibitory = "inhibitory" in cell_type.tags or cell_type.transmitter == "gaba"
        shape = "square" if inhibitory else "circle"
        lines.append(
            f'  {instance.id} [shape={shape}, label="{instance.id}\\n{cell_type.id}"];'
        )
    for contact in model.contacts:
        inhibitory = contact.receptor.startswith("gaba")
        arrow = "tee" if inhibitory else "normal"
        label = f"{contact.post.section}@{contact.post.fraction:g}"
        lines.append(
            f'  {contact.pre.instance} -> {contact.post.instance} '
            f'[arrowhead={arrow}, label="{label}"];'
        )
    lines.append("}")
    dot = "\n".join(lines)
    if args.out:
        Path(args.out).write_text(dot, encoding="utf-8")
        print(f"граф: {args.out}")
    else:
        print(dot)
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
    view.set_defaults(func=cmd_view)

    export = sub.add_parser("export", help="сгенерировать скрипт NetPyNE")
    export.add_argument("file")
    export.add_argument("-o", "--out")
    export.set_defaults(func=cmd_export)

    graph = sub.add_parser("graph", help="выгрузить граф в формате DOT")
    graph.add_argument("file")
    graph.add_argument("-o", "--out")
    graph.set_defaults(func=cmd_graph)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
