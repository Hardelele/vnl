"""Внешние источники величин: программа, стоящая за дверью (#580).

Сенсор -- дверь снаружи внутрь, и до сих пор за ней стоял человек: кнопка в
интерфейсе или ключ `--sensor` у `vnl run`. Источник -- то же самое место,
занятое программой: захват экрана, чтение картинки, датчик, чужая модель.

Договор нарочно нищий -- **строки в stdout**:

    {"t": 0,   "frame": [0.0, 0.13, ...]}
    {"t": 100, "value": 1, "at": "eye.r[3,7]"}

Одна строка -- одно событие. `frame` -- кадр целиком, `value` -- одна величина,
`at` -- кому она (без него -- тому сенсору, к которому привязан источник),
`t` -- момент модельного времени в миллисекундах.

Почему подпроцесс, а не плагин на Python: источник -- чужая программа, и у неё
своя жизнь. Захват экрана хочет Pillow, датчик -- драйвер, чужая модель --
свой питон с несовместимыми зависимостями. Плагин внутри процесса потащил бы
всё это в окружение VNL, ради которого в `pyproject.toml` стоит пустой
`dependencies`. Труба же не требует ни общего языка, ни общей установки: пиши
на чём угодно, печатай строки.

Почему числа, а не картинка: через границу проходит то же, что проходило
всегда, -- величина от 0 до 1, только много разом. Декодирование PNG,
уменьшение до сетки и перевод в линейный свет живут в программе-источнике
(`tools/eye.py`), и ядро не знает ни про форматы файлов, ни про экран -- как не
знает про кнопку. Знай оно про них, первый же новый формат правил бы симулятор.

Воспроизводимость держится на том же, на чём держалась запись `--sensor`:
пришедшее кладётся в поток входа со штампом модельного времени, и прогон
переигрывается из записи спайк в спайк. Источник при этом читается один раз;
второй запуск той же программы -- другой опыт, а не тот же самый, и делать
вид, что экран за это время не изменился, мы не станем.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from typing import Any, Iterable, Iterator


class SourceError(RuntimeError):
    """Источник не дал того, о чём договаривались."""


@dataclass(frozen=True)
class Reading:
    """Одно, что пришло от источника: кому, когда и какая величина.

    Не `SenseEvent` нарочно: событие потока входа принадлежит прогону и знает
    его время, а показание -- это то, что сказала чужая программа. Между ними
    стоит проверка (есть ли такой сенсор, по размеру ли кадр), и пока она не
    прошла, в запись класть нечего.
    """

    address: str
    time: float | None
    value: float | tuple[float, ...]

    @property
    def is_frame(self) -> bool:
        return not isinstance(self.value, (int, float))

    def story(self) -> str:
        """Показание словами -- для отчёта о том, что пришло."""
        when = "без момента" if self.time is None else f"на {self.time:g} мс"
        if not self.is_frame:
            return f"{self.address} = {float(self.value):g} {when}"
        frame = tuple(self.value)  # type: ignore[arg-type]
        lit = sum(1 for x in frame if x > 0.0)
        return (
            f"{self.address}: кадр из {len(frame)} величин, "
            f"ненулевых {lit} {when}"
        )


def parse_line(line: str, sensor: str, where: str, number: int) -> Reading | None:
    """Строка источника -> показание. Пустая строка и `#` -- не показание.

    Отказ называет номер строки и саму строку: источник -- чужая программа, и
    ошибка в ней ищется по её выводу, а не по нашему коду. «Неверный JSON» без
    строки означал бы разбор чужого stdout глазами.
    """
    text = line.strip()
    if not text or text.startswith("#"):
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SourceError(
            f"{where}: строка {number} -- не JSON ({exc.msg}): {text[:80]!r}"
        ) from exc
    if not isinstance(data, dict):
        raise SourceError(
            f"{where}: строка {number} -- не объект: ожидается "
            '{"frame": [...]} или {"value": 0.5}'
        )
    address = str(data.get("at") or data.get("sensor") or sensor)
    moment = data.get("t")
    time = None if moment is None else float(moment)
    if "frame" in data:
        frame = data["frame"]
        if not isinstance(frame, (list, tuple)):
            raise SourceError(
                f"{where}: строка {number} -- кадр должен быть списком чисел"
            )
        return Reading(address=address, time=time, value=_numbers(frame, where, number))
    if "value" in data:
        return Reading(address=address, time=time, value=float(data["value"]))
    raise SourceError(
        f"{where}: строка {number} -- ни кадра, ни величины: нужен "
        '"frame" или "value"'
    )


def _numbers(frame: Iterable[Any], where: str, number: int) -> tuple[float, ...]:
    try:
        return tuple(float(x) for x in frame)
    except (TypeError, ValueError) as exc:
        raise SourceError(
            f"{where}: строка {number} -- в кадре не число: {exc}"
        ) from exc


def read(lines: Iterable[str], sensor: str, where: str) -> list[Reading]:
    """Вывод источника -> показания по порядку."""
    out: list[Reading] = []
    for number, line in enumerate(lines, start=1):
        reading = parse_line(line, sensor, where, number)
        if reading is not None:
            out.append(reading)
    return out


def stream(command: str, sensor: str, timeout: float = 30.0) -> Iterator[Reading]:
    """Запустить программу и отдавать её показания по мере прихода.

    Генератор, а не список, потому что источник бывает бесконечным: захват
    экрана печатает кадры, пока его не остановят. Тот, кто читает, и решает,
    сколько ему нужно, -- прогон берёт всё до конца, живая сессия взяла бы по
    кадру на шаг.

    Команда идёт через оболочку: её пишет человек, и пишет он её так же, как
    писал бы в терминале, -- с кавычками, путями и своим питоном. Разбирать её
    самим значило бы завести второй, свой синтаксис командной строки.
    """
    process = subprocess.Popen(
        command,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    where = f"источник {sensor!r}"
    assert process.stdout is not None
    try:
        for number, line in enumerate(process.stdout, start=1):
            reading = parse_line(line, sensor, where, number)
            if reading is not None:
                yield reading
    finally:
        # Источник мог и не собираться заканчиваться -- значит кончаем мы. Без
        # этого `vnl run` с захватом экрана висел бы после последнего кадра,
        # ожидая, пока чужая программа сама решит, что опыт закончен.
        if process.poll() is None:
            process.terminate()
        try:
            _, errors = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            _, errors = process.communicate()
            raise SourceError(
                f"{where}: программа не завершилась за {timeout:g} с"
            ) from None
        code = process.returncode
        # Ненулевой код после нашего же terminate -- это мы её и остановили;
        # ругаться на это значило бы ругаться на собственный выстрел.
        if code not in (0, None) and not _was_stopped(code):
            tail = (errors or "").strip().splitlines()
            last = tail[-1] if tail else "без объяснения"
            raise SourceError(f"{where}: код возврата {code}; {last}")


def _was_stopped(code: int) -> bool:
    """Код, который остаётся после `terminate` -- свой на каждой системе."""
    return code < 0 or code in (1, 15, 143, 3221225786, 4294967295)


def collect(command: str, sensor: str, timeout: float = 30.0) -> list[Reading]:
    """Показания источника до конца его вывода -- для `vnl run`.

    Прогон считается от начала до конца и часов не имеет: собрать вход заранее
    -- единственный способ посчитать его так же во второй раз.
    """
    return list(stream(command, sensor, timeout=timeout))
