"""Общее для программ-источников: картинка -> кадр величин 0..1 (#580).

Это не часть VNL, а то, что стоит **за** его дверью. Ядро знает только строки
в stdout (`vnl.sources`), и всё, что касается форматов файлов, экрана и
цветовых пространств, живёт здесь, где зависимость на Pillow никому не мешает.

Кадр -- плоский список величин: пиксели идут строками сверху вниз, каналы
внутри пикселя чередуются (r, g, b, r, g, b, ...). Тот же порядок объявлен в
`ir.Sensor` -- он и есть договор между полем и любым источником.
"""

from __future__ import annotations

import json
import sys

#: sRGB -> линейный свет, по стандарту. Таблицей, а не формулой на пиксель:
#: значений всего 256, а пикселей -- миллионы.
#:
#: Перевод нужен потому, что байт в PNG -- не количество света, а число,
#: заранее сжатое под глаз: 128 -- это не половина яркости, а примерно
#: пятая часть. Сенсор же меряет свет, и без этого перевода серая половина
#: картинки давала бы вдвое более частый поток импульсов, чем должна.
LINEAR: tuple[float, ...] = tuple(
    (value / 255.0 / 12.92)
    if value / 255.0 <= 0.04045
    else (((value / 255.0 + 0.055) / 1.055) ** 2.4)
    for value in range(256)
)

#: Веса яркости для линейного RGB (Rec. 709). Зелёного в яркости больше всего
#: -- так устроен глаз, и так же считают все, кто сводит цвет к одному числу.
LUMA = (0.2126, 0.7152, 0.0722)

#: Во сколько раз крупнее сетки уменьшаем перед переводом в линейный свет.
#:
#: Усреднять надо линейный свет, а не байты sRGB: среднее из чёрного и белого
#: -- половина света, а не 128. Но переводить в линейное каждый пиксель
#: четырёхмегапиксельной фотографии на чистом Python -- десятки секунд, поэтому
#: сначала Pillow уменьшает картинку в четыре раза грубее сетки (там ошибка
#: усреднения мала, потому что соседние пиксели близки), а дальше в линейном
#: свете усредняем сами.
OVERSAMPLE = 4


def decode(path: str):
    """Файл -> картинка RGB. PNG, JPEG и всё прочее, что читает Pillow."""
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover -- зависит от окружения
        raise SystemExit(
            "нужен Pillow: pip install pillow (он нужен источнику, не самому "
            "vnl -- ядро остаётся без зависимостей)"
        ) from None
    with Image.open(path) as image:
        return image.convert("RGB")


def frame(image, rows: int, cols: int, channels: str = "rgb") -> list[float]:
    """Картинка -> кадр поля `rows`x`cols` с каналами `rgb` или `gray`."""
    from PIL import Image

    fine = image.resize(
        (cols * OVERSAMPLE, rows * OVERSAMPLE), Image.Resampling.BOX
    )
    pixels = fine.load()
    out: list[float] = []
    area = OVERSAMPLE * OVERSAMPLE
    for row in range(rows):
        for col in range(cols):
            red = green = blue = 0.0
            for dy in range(OVERSAMPLE):
                for dx in range(OVERSAMPLE):
                    r, g, b = pixels[col * OVERSAMPLE + dx, row * OVERSAMPLE + dy]
                    red += LINEAR[r]
                    green += LINEAR[g]
                    blue += LINEAR[b]
            red, green, blue = red / area, green / area, blue / area
            if channels == "gray":
                out.append(
                    LUMA[0] * red + LUMA[1] * green + LUMA[2] * blue
                )
            else:
                out.extend((red, green, blue))
    return out


def parse_grid(text: str) -> tuple[int, int]:
    """`24x24` -> `(24, 24)`."""
    rows, sign, cols = str(text).lower().partition("x")
    if not sign or not rows.isdigit() or not cols.isdigit():
        raise SystemExit(f"сетка {text!r} непонятна; пишется как 24x24")
    return int(rows), int(cols)


def emit(values: list[float], at: str | None = None, t: float | None = None) -> None:
    """Напечатать кадр строкой -- ровно так, как его ждёт `vnl run --source`."""
    line: dict[str, object] = {"frame": [round(x, 6) for x in values]}
    if at is not None:
        line["at"] = at
    if t is not None:
        line["t"] = t
    sys.stdout.write(json.dumps(line, ensure_ascii=False) + "\n")
    # Без этого кадры копились бы в буфере трубы, и источник, который печатает
    # их по ходу дела, доходил бы до читателя пачкой в конце.
    sys.stdout.flush()
