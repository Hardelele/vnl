"""Источник: буква под сетку 24x24 -> кадр величин (#580).

    vnl run examples/vision.vnl --source eye="python tools/letters.py T"
    vnl run examples/vision.vnl --source eye="python tools/letters.py T O --every 150ms"

Буквы лежат рядом текстом (`tools/letters/alphabet24.txt`) и правятся руками.
Шрифт из системы здесь не участвует нарочно: числа примеров и тестов обязаны
сходиться на всякой машине, а «та же буква» из другого шрифта -- другой опыт.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import vnl_frame

ALPHABET = Path(__file__).with_name("letters") / "alphabet24.txt"


def load(path: Path = ALPHABET) -> dict[str, list[str]]:
    """Файл растров -> буква: строки из '#' и '.'."""
    letters: dict[str, list[str]] = {}
    current: str | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.rstrip()
        if not text or text.startswith("#"):
            continue
        if text.startswith("letter "):
            current = text.split(None, 1)[1].strip()
            letters[current] = []
            continue
        if current is not None:
            letters[current].append(text)
    return letters


def frame(
    rows_text: list[str],
    channels: str,
    color: tuple[float, float, float],
    level: float = 1.0,
) -> list[float]:
    """Растр -> кадр. Светящийся пиксель -- `level`, тёмный -- ноль.

    Единица, а не оттенок: буква здесь -- это форма, и градиент по краю
    добавил бы в опыт величины, которых человек не писал. Понадобится мягкий
    край -- его даст `tools/eye.py` с картинкой буквы, где он честно взялся из
    сглаживания.
    """
    out: list[float] = []
    for line in rows_text:
        for mark in line:
            lit = level if mark not in (".", " ") else 0.0
            if channels == "gray":
                out.append(lit)
            else:
                out.extend(lit * part for part in color)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("letters", nargs="+", help="какие буквы показать")
    parser.add_argument("--channels", default="gray", choices=("gray", "rgb"))
    parser.add_argument(
        "--level",
        type=float,
        default=1.0,
        help="яркость буквы, 0…1: ею проверяют, что поле -- это величины, "
        "а не только форма",
    )
    parser.add_argument(
        "--every",
        default="0",
        help="через сколько миллисекунд показывать следующую букву",
    )
    parser.add_argument(
        "--color",
        default="1,1,1",
        help="цвет буквы для rgb: доли красного, зелёного и синего",
    )
    parser.add_argument("--at", help="кому кадр, если в схеме не одна дверь")
    parser.add_argument("--blank", action="store_true", help="гасить поле между буквами")
    args = parser.parse_args()

    letters = load()
    every = float(str(args.every).rstrip("мсms") or 0)
    color = tuple(float(x) for x in args.color.split(","))
    if len(color) != 3:
        raise SystemExit("цвет пишется тремя долями: --color 1,0.2,0")

    moment = 0.0
    for name in args.letters:
        key = name.upper()
        if key not in letters:
            known = " ".join(sorted(letters))
            raise SystemExit(f"буквы {name!r} нет в растрах; есть: {known}")
        vnl_frame.emit(
            frame(letters[key], args.channels, color, args.level),  # type: ignore[arg-type]
            at=args.at,
            t=moment if (every or moment) else None,
        )
        moment += every
        if args.blank and every:
            # Пустой кадр ровно посередине между буквами: без него вторая
            # буква легла бы поверх первой, и сеть увидела бы их сумму.
            dark = [0.0] * len(letters[key]) * len(letters[key][0]) * (
                1 if args.channels == "gray" else 3
            )
            vnl_frame.emit(dark, at=args.at, t=moment - every / 2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
