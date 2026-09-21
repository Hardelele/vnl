"""Источник: буква под сетку 24x24 -> кадр величин (#580).

    vnl run examples/vision.vnl --source eye="python tools/letters.py T"
    vnl run examples/vision.vnl --source eye="python tools/letters.py T O --every 150ms"

Растры лежат в самом пакете (`vnl.samples`) и правятся руками: их читает не
только эта программа, но и сервер, когда показывает букву полю из интерфейса
(#581). Два набора букв разошлись бы молча, и «T» на экране перестала бы быть
той «T», про которую написаны числа.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import vnl_frame

# Исходники рядом с программой главнее установленного пакета, и это не
# придирка: `pip install -e` в этой машине может смотреть в другое рабочее
# дерево (их у проекта несколько), и тогда буква пришла бы из чужой ветки.
# Программа в репозитории обязана работать с тем репозиторием, в котором
# лежит.
_LOCAL = Path(__file__).resolve().parents[1] / "src"
if (_LOCAL / "vnl" / "samples.py").exists():
    sys.path.insert(0, str(_LOCAL))
    for _name in [n for n in sys.modules if n == "vnl" or n.startswith("vnl.")]:
        del sys.modules[_name]

from vnl import samples  # noqa: E402  -- после подмены пути, см. выше


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("letters", nargs="*", help="какие буквы показать")
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
    parser.add_argument(
        "--blank", action="store_true", help="гасить поле между буквами"
    )
    parser.add_argument(
        "--list", action="store_true", help="перечислить, какие образцы есть"
    )
    args = parser.parse_args()

    if args.list:
        for item in samples.payload():
            print(f"{item['id']}: сетка {item['grid'][0]}x{item['grid'][1]}, "
                  f"светится {item['lit']}")
        return 0

    if not args.letters:
        raise SystemExit("скажите, какую букву показать, например: letters.py T")
    every = float(str(args.every).rstrip("мсms") or 0)
    color = tuple(float(x) for x in args.color.split(","))
    if len(color) != 3:
        raise SystemExit("цвет пишется тремя долями: --color 1,0.2,0")
    channels = 1 if args.channels == "gray" else 3

    moment = 0.0
    for name in args.letters:
        try:
            sample = samples.get(name)
        except KeyError as exc:
            raise SystemExit(str(exc)) from None
        vnl_frame.emit(
            sample.frame(channels=channels, level=args.level, color=color),
            at=args.at,
            t=moment if (every or moment) else None,
        )
        moment += every
        if args.blank and every:
            # Пустой кадр ровно посередине между буквами: без него вторая
            # буква легла бы поверх первой, и сеть увидела бы их сумму.
            rows, cols = sample.grid
            vnl_frame.emit([0.0] * rows * cols * channels, at=args.at, t=moment - every / 2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
