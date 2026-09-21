"""Встроенные кадры: то, что можно показать полю, ничего не загружая (#581).

Поле сенсоров умеет принимать любой кадр (#580), но чтобы на него посмотреть,
нужно этот кадр откуда-то взять -- нарисовать, сфотографировать, найти файл.
Для первого взгляда это лишняя работа, поэтому набор образцов лежит прямо в
пакете: буквы и цифры под сетку 24x24.

Растры хранятся текстом (`data/alphabet24.txt`) и правятся руками:

    letter T
    ........................
    ....#################...
    ..........#####.........

Шрифт из системы в этом не участвует нарочно. «Та же буква» из другого шрифта
-- другой кадр, а числа примеров и тестов («буква T зажигает 158 клеток из
576») обязаны сходиться на всякой машине.

Живёт это в пакете, а не рядом с программой-источником, потому что читателей
теперь двое: `tools/letters.py` печатает кадр в stdout для `vnl run`, а сервер
отдаёт тот же кадр интерфейсу. Второй набор букв, лежащий отдельно, разошёлся
бы с первым молча -- и «T» на экране перестала бы быть той «T», про которую
написаны числа.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

#: Набор букв: имя файла с растрами рядом с модулем.
ALPHABET = Path(__file__).with_name("data") / "alphabet24.txt"

#: Значок света в растре. Всё остальное -- темнота.
LIT = "#"


@dataclass(frozen=True)
class Sample:
    """Один образец: имя, сетка и сам растр строками."""

    id: str
    rows: tuple[str, ...]

    @property
    def grid(self) -> tuple[int, int]:
        return len(self.rows), len(self.rows[0]) if self.rows else 0

    @property
    def lit(self) -> int:
        """Сколько величин в кадре ненулевые -- по нему и узнают букву."""
        return sum(row.count(LIT) for row in self.rows)

    def frame(
        self,
        channels: int = 1,
        level: float = 1.0,
        color: tuple[float, float, float] = (1.0, 1.0, 1.0),
    ) -> list[float]:
        """Растр -> кадр величин для поля с таким числом каналов.

        Светящийся пиксель -- `level`, тёмный -- ноль. Единица, а не оттенок:
        образец -- это форма, и градиент по краю добавил бы в опыт величины,
        которых никто не писал. Мягкий край даёт картинка, где он честно
        взялся из сглаживания.
        """
        out: list[float] = []
        for row in self.rows:
            for mark in row:
                value = level if mark == LIT else 0.0
                if channels <= 1:
                    out.append(value)
                else:
                    out.extend(
                        value * color[index % len(color)]
                        for index in range(channels)
                    )
        return out


def _read(path: Path = ALPHABET) -> dict[str, Sample]:
    found: dict[str, list[str]] = {}
    current: str | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.rstrip()
        if not text or text.startswith("#"):
            continue
        if text.startswith("letter "):
            current = text.split(None, 1)[1].strip()
            found[current] = []
            continue
        if current is not None:
            found[current].append(text)
    return {name: Sample(id=name, rows=tuple(rows)) for name, rows in found.items()}


_CACHE: dict[str, Sample] | None = None


def catalog() -> dict[str, Sample]:
    """Все образцы по имени. Читаются один раз: файл не меняется на ходу."""
    global _CACHE
    if _CACHE is None:
        _CACHE = _read()
    return _CACHE


def get(name: str) -> Sample:
    """Образец по имени. Неизвестное имя -- отказ со списком известных."""
    found = catalog().get(str(name).upper())
    if found is None:
        known = " ".join(sorted(catalog()))
        raise KeyError(f"нет образца {name!r}; есть: {known}")
    return found


def payload() -> list[dict[str, object]]:
    """Список образцов для интерфейса: что есть и какой оно формы.

    Сами кадры сюда не кладутся: их 36 по 576 величин, то есть двадцать тысяч
    чисел ради списка в выпадающем меню. Кадр приходит тогда, когда образец
    выбрали, -- и приходит он не в браузер, а прямо в сессию, по имени.
    """
    # Буквы раньше цифр: список открывают, чтобы выбрать букву, и «0» первым
    # читается как «ничего не выбрано», хотя это законный образец.
    order = sorted(
        catalog().values(), key=lambda item: (item.id.isdigit(), item.id)
    )
    return [
        {
            "id": sample.id,
            "grid": list(sample.grid),
            "lit": sample.lit,
        }
        for sample in order
    ]
