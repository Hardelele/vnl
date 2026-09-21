"""Источник: экран -> кадры величин (#580).

    vnl run examples/vision.vnl --source eye="python tools/screen.py --frames 5 --every 100ms"
    vnl run examples/vision.vnl --source eye="python tools/screen.py --box 0,0,640,480"

Снимок экрана (или его куска) уменьшается до сетки и переводится в линейный
свет -- тем же способом, которым это делает `tools/eye.py` с файлом. Для VNL
разницы между ними нет вовсе: обе программы печатают строки с кадрами, и в
этом весь смысл движка -- дверь не знает, кто за ней стоит.

Один снимок делается мгновенно, несколько -- с паузой по `--every`: пауза
настоящая, в секундах, а момент в кадре -- модельный. Это не путаница, а
честная граница: за дверью время идёт по часам, внутри прогона -- по шагам
интегрирования, и сводит их запись входа.
"""

from __future__ import annotations

import argparse
import time

import vnl_frame


def grab(box: tuple[int, int, int, int] | None):
    """Снимок экрана. Pillow ставится отдельно -- см. `vnl_frame.decode`."""
    try:
        from PIL import ImageGrab
    except ImportError:  # pragma: no cover -- зависит от окружения
        raise SystemExit(
            "нужен Pillow: pip install pillow (он нужен источнику, не самому "
            "vnl -- ядро остаётся без зависимостей)"
        ) from None
    image = ImageGrab.grab(bbox=box)
    return image.convert("RGB")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grid", default="24x24", help="сетка поля, например 24x24")
    parser.add_argument("--channels", default="rgb", choices=("gray", "rgb"))
    parser.add_argument("--frames", type=int, default=1, help="сколько снимков сделать")
    parser.add_argument(
        "--every",
        default="100",
        help="через сколько миллисекунд модельного времени идёт следующий кадр",
    )
    parser.add_argument(
        "--box", help="кусок экрана: слева,сверху,справа,снизу в точках"
    )
    parser.add_argument("--at", help="кому кадр, если в схеме не одна дверь")
    args = parser.parse_args()

    rows, cols = vnl_frame.parse_grid(args.grid)
    every = float(str(args.every).rstrip("мсms") or 0)
    box = None
    if args.box:
        parts = [int(x) for x in args.box.split(",")]
        if len(parts) != 4:
            raise SystemExit("кусок экрана пишется четырьмя числами: 0,0,640,480")
        box = (parts[0], parts[1], parts[2], parts[3])

    moment = 0.0
    for number in range(max(1, args.frames)):
        if number:
            # Пауза по часам -- ровно та, которой кадры отстоят в модели. Так
            # снятое с экрана похоже на то, что видел бы глаз, а не на серию
            # снимков одного и того же мгновения.
            time.sleep(every / 1000.0)
        vnl_frame.emit(
            vnl_frame.frame(grab(box), rows, cols, args.channels),
            at=args.at,
            t=moment,
        )
        moment += every
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
