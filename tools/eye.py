"""Источник: файл картинки -> кадр величин (#580).

    vnl run examples/vision.vnl --source eye="python tools/eye.py photo.jpg"
    vnl run examples/vision.vnl --source eye="python tools/eye.py a.png b.png --every 200ms"

PNG, JPEG и всё прочее, что читает Pillow, уменьшается до сетки и переводится
в линейный свет. Ядро VNL про форматы файлов не знает и знать не должно: через
дверь входят числа от 0 до 1.
"""

from __future__ import annotations

import argparse

import vnl_frame


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", help="картинки по порядку")
    parser.add_argument("--grid", default="24x24", help="сетка поля, например 24x24")
    parser.add_argument("--channels", default="rgb", choices=("gray", "rgb"))
    parser.add_argument(
        "--every",
        default="0",
        help="через сколько миллисекунд показывать следующую картинку",
    )
    parser.add_argument("--at", help="кому кадр, если в схеме не одна дверь")
    args = parser.parse_args()

    rows, cols = vnl_frame.parse_grid(args.grid)
    every = float(str(args.every).rstrip("мсms") or 0)
    moment = 0.0
    for path in args.files:
        image = vnl_frame.decode(path)
        vnl_frame.emit(
            vnl_frame.frame(image, rows, cols, args.channels),
            at=args.at,
            t=moment if (every or moment) else None,
        )
        moment += every
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
