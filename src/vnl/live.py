"""Сессия симуляции: время идёт, его останавливают и отматывают.

Симуляция в интерфейсе -- среда с управляемым временем, а не расчёт с отчётом
в конце. Значит у неё должен быть хозяин, который живёт между запросами: сам
двигает время, помнит, где оно сейчас, и умеет вернуть его назад. Движок
(`vnl.sim.lif`) умеет шагать и восстанавливаться из снимка; здесь -- всё
остальное.

Время идёт в фоновом потоке. Иначе «идёт» означало бы «идёт, пока интерфейс
спрашивает», и стоило бы закрыть вкладку, как симуляция замерла бы на месте --
а она должна вести себя как процесс, а не как функция.

Темп задан в модельных миллисекундах за секунду реального времени. Настоящее
время здесь не годится: 400 мс модели пролетели бы за четверть секунды, и
смотреть было бы не на что. По умолчанию 50 мс/с -- те же 400 мс разворачиваются
в восемь секунд, на которых видно и спайк, и его последствия.

Снимки складываются с постоянным шагом модельного времени. Это компромисс:
чаще -- больше памяти, реже -- дольше откат, потому что после восстановления
ближайшего снимка остаток досчитывается. При шаге 20 мс на прогон в 400 мс
приходится два десятка снимков, а досчитывать после отката приходится не
больше 20 мс -- это доли секунды даже на медленной машине.

Приращения. Интерфейс говорит, сколько отсчётов у него уже есть, и получает
только новые. Отдавать каждый раз весь прогон значило бы гонять по сети одно и
то же всё чаще по мере роста трасс -- ровно наоборот тому, что нужно живому
экрану.
"""

from __future__ import annotations

import os
import sys
import threading
import time as clock
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from . import ir
from .api import TIME_DIGITS, TRACE_DIGITS
from .sim.lif import SenseEvent, Simulator, Snapshot

State = Literal["paused", "running", "finished"]

#: Из чего открыта сессия. Разница не в подписи, а в праве доступа: симуляцию
#: паттерна смотрят без входа, симуляцию песочницы -- нет, а по `/api/sim/<id>`
#: этого уже не видно. Значит помнить происхождение должна сама сессия.
Origin = Literal["pattern", "sandbox"]

#: Модельных миллисекунд за секунду реального времени.
DEFAULT_PACE = 50.0
#: Шаг между снимками состояния, мс модельного времени.
SNAPSHOT_EVERY = 20.0
#: Как часто фоновый поток добавляет времени. Реже -- рывками, чаще -- впустую.
TICK_SECONDS = 0.1

#: Сколько живых сессий стенд держит разом (#517). Шестнадцать -- это шестнадцать
#: моделей с трассами и шестнадцать считающих потоков в одном процессе; стенд
#: без воркеров и реплик (`deploy/readme.md`) больше и не потянет. Меняется
#: переменной `VNL_SIM_LIMIT`: на своей машине предел не мешает, а на стенде
#: его подбирают по памяти машины, а не по коду.
MAX_SESSIONS = 16
#: Сколько сессия живёт без единого вопроса о ней, секунд. Четверть часа -- это
#: заведомо больше перерыва на подумать и заведомо меньше рабочего дня с
#: забытой вкладкой. Меняется переменной `VNL_SIM_IDLE`.
IDLE_SECONDS = 900.0
#: Сколько сессия защищена от вытеснения после последнего вопроса о ней.
#: Живую интерфейс опрашивает каждые 150 мс, но на паузе не спрашивает вовсе --
#: человек, остановивший прогон и разглядывающий кадр, для пула выглядит
#: ушедшим. Пять минут -- запас на это разглядывание.
GRACE_SECONDS = 300.0
#: Как часто сторож обходит пул в поисках брошенных сессий.
SWEEP_SECONDS = 30.0
#: Сколько закрытых сессий пул помнит по имени, чтобы объяснить, куда они делись.
GONE_MEMORY = 128


def _setting(name: str, fallback: float) -> float:
    """Число из окружения. Мусор -- это значение по умолчанию, а не падение.

    Служба не должна не подняться из-за опечатки в `VNL_SIM_LIMIT`: предел --
    настройка нагрузки, а не условие работы. Про опечатку говорим в лог, чтобы
    она не осталась незамеченной.
    """
    raw = os.environ.get(name)
    if not raw:
        return fallback
    try:
        return float(raw)
    except ValueError:
        print(f"{name}={raw!r} -- не число, беру {fallback}", file=sys.stderr)
        return fallback


class SessionError(RuntimeError):
    pass


class PoolFull(RuntimeError):
    """Открыть ещё одну сессию сейчас нельзя: все живые кому-то нужны.

    Свой род ошибки, а не `SessionError`: та означает «такой сессии нет» и
    отвечает 404, а это -- «приходите позже» и отвечает 503. Один код на два
    разных ответа заставил бы интерфейс гадать по тексту.
    """


@dataclass
class _Mark:
    time: float
    state: Snapshot


class Session:
    """Одна симуляция со своим временем."""

    def __init__(
        self,
        id: str,
        model: ir.Model,
        source: str = "",
        origin: Origin = "sandbox",
        owner: str | None = None,
        pace: float = DEFAULT_PACE,
        snapshot_every: float = SNAPSHOT_EVERY,
    ) -> None:
        self.id = id
        self.model = model
        #: Откуда она взялась -- паттерн или песочница. Для подписи в интерфейсе.
        self.source = source
        #: То же самое, но для проверки прав: паттерн или песочница. По умолчанию
        #: песочница -- сессия неизвестного происхождения обязана оказаться
        #: закрытой, а не открытой.
        self.origin: Origin = origin
        #: Чью песочницу она считает (#520). У витрины паттерна владельца нет и
        #: быть не должно: карточку открывают по ссылке и без входа. Хранится
        #: у сессии по той же причине, что и происхождение, -- в `/api/sim/<id>`
        #: об этом не сказано ничего, а спросить нужно на каждом запросе.
        self.owner = owner
        self.pace = pace
        self.snapshot_every = snapshot_every
        #: Когда о сессии спрашивали в последний раз -- по монотонным часам,
        #: а не по настенным: перевод времени не должен вытеснять сессии.
        #: Только что открытая считается спрошенной: её и открыли затем, чтобы
        #: смотреть.
        self.touched = clock.monotonic()

        self._lock = threading.RLock()
        self._gate = threading.Condition(self._lock)
        self._closed = False
        self._thread: threading.Thread | None = None

        #: Поток входа: всё, что подали снаружи, с модельным временем подачи.
        #: Живёт у сессии, а не у симулятора, ровно по одной причине -- «Сброс»
        #: строит симулятор заново, а запись опыта переживать сброс обязана
        #: (см. `reset`). Симулятор получает этот самый список, а не копию:
        #: копия означала бы две правды о том, что было подано.
        self._input: list[SenseEvent] = []

        self._build()

    # --- устройство -------------------------------------------------------

    def _build(self) -> None:
        self.simulator = Simulator(self.model, sense=self._input)
        self.state: State = "paused"
        # Снимок нулевого шага: «Сброс» -- это возврат к нему, а не новый объект.
        self._marks: list[_Mark] = [_Mark(0.0, self.simulator.snapshot())]

    @property
    def dt(self) -> float:
        return self.simulator.dt

    @property
    def elapsed(self) -> float:
        """Пройденное модельное время.

        Не то же, что `Simulator.time`: тот показывает момент последнего
        посчитанного отсчёта, то есть на шаг меньше. Таймлайну нужно
        пройденное, иначе после 500 шагов по 0.1 мс он покажет 49.9.
        """
        return self.simulator.step * self.dt

    @property
    def duration(self) -> float:
        return self.model.run.duration

    # --- управление временем ---------------------------------------------

    def start(self) -> None:
        """Пустить время. Продолжает с текущего места, а не считает заново."""
        with self._gate:
            if self.simulator.finished:
                # Дошли до конца: продолжать неоткуда, это дело «Сброса».
                self.state = "finished"
                return
            self.state = "running"
            self._ensure_thread()
            self._gate.notify_all()

    def pause(self) -> None:
        with self._gate:
            if self.state == "running":
                self.state = "paused"
            self._gate.notify_all()

    def reset(self) -> None:
        """Начать сначала -- отдельное действие, а не побочный эффект запуска.

        Поток входа при этом остаётся, и это решение, а не недосмотр. «Сброс»
        возвращает время к нулю, чтобы посчитать ту же схему заново, -- и зерно
        генератора он не выбрасывает: случайный драйв после сброса идёт теми же
        моментами. Поток входа -- такая же запись опыта: сотрите её, и то, ради
        чего всё затевалось, -- повторить опыт с кнопками -- станет невозможно
        ровно тогда, когда это нужнее всего (посмотреть ещё раз то же самое).
        Поэтому после сброса запись переигрывается с начала сама.

        Разобранная альтернатива -- стирать: чистый лист после сброса выглядит
        понятнее, но забирает единственную дорогу к повтору и ничего не даёт
        взамен. Чистый лист и так есть: нажатие кнопки стирает записанное после
        своего момента (`Simulator.sense_at`), так что сброс плюс новое
        нажатие на нуле -- это и есть «начать с чистого входа».
        """
        with self._gate:
            self.state = "paused"
            self._build()
            self._gate.notify_all()

    def sense(self, sensor_id: str, value: float) -> SenseEvent:
        """Подать величину сенсору -- на текущем модельном времени сессии.

        Момент берётся у сессии, а не у часов: для прогона «сейчас» -- это
        ближайший непосчитанный шаг, и записанное с ним нажатие переигрывается
        при любом откате. Поэтому кнопка, нажатая на 137-й миллисекунде,
        остаётся нажатой на 137-й и после десяти перемоток.
        """
        with self._gate:
            event = self.simulator.sense_at(self.elapsed, sensor_id, value)
            self._gate.notify_all()
            return event

    def seek(self, time: float) -> None:
        """Встать на выбранный момент: движок откатывается, а не курсор едет.

        Прежнее будущее после этого стирается: продолжение считается заново из
        настоящего состояния той секунды.
        """
        with self._gate:
            target = max(0.0, min(time, self.duration))
            target_step = int(round(target / self.dt))
            self.simulator.restore(self._mark_before(target).state)
            if target_step > self.simulator.step:
                self.simulator.advance(target_step - self.simulator.step)
            # Перемотка -- не кадр. Снимок берётся до нужного момента, остаток
            # догоняется шагами, и взгляда между ними нет: без этой строчки
            # первый же кадр после перемотки сообщил бы разряд, случившийся
            # где-то посреди догоняемого отрезка, как разряд сейчас (#534).
            # Отрезок при этом тем длиннее, чем больше возили курсором: снимки
            # после точки отката выбрасываются ниже, а новых здесь не берут.
            self.simulator.forget_frame()
            # Снимки после точки отката больше ни к чему не относятся.
            self._marks = [item for item in self._marks if item.time <= self.elapsed]
            self.state = "paused"
            self._gate.notify_all()

    def step(self, milliseconds: float) -> None:
        """Шагнуть по времени от текущего момента -- и это кадр.

        Отдельный вызов от `seek`, хотя оба кончаются одним: время встало на
        другом моменте. Разница не в величине, а в смысле, и она видна ровно в
        одном -- показывается ли разряд, попавший внутрь перехода.

        Шаг вперёд движок не откатывает: он уже стоит там, где надо, и ему
        остаётся досчитать отрезок. Взгляд (`peek`) после этого честно
        рассказывает, что в отрезке случилось, -- в том числе разряд, который
        длится один шаг из десяти и по мгновенному значению не виден никогда.
        Шагают как раз затем, чтобы разглядеть разряд, и обнулять накопленное,
        как при перемотке, значило бы не показать его ни разу.

        Прыжок курсором (`seek`) остаётся не кадром: движок восстанавливается
        из снимка и догоняет отрезок, о котором смотрящий ничего не просил,
        поэтому накопленное там обнуляется (#534).

        Разными вызовами, а не одним с догадкой по величине дельты: догадка
        однажды ошибётся -- щелчок мышью в миллиметре от курсора неотличим от
        шага, -- и человек увидит разряд из чужого отрезка, приняв его за
        свой. Лучше два имени, чем одно правило с исключением.

        Назад -- восстановлением, иначе никак: движок умеет идти только
        вперёд. Разряд при этом не показывается, и это не уступка механике:
        назад смотрят на состояние («какой заряд был миллисекундой раньше»), а
        не на событие, которого в прошлом ещё не случилось.
        """
        with self._gate:
            if milliseconds <= 0:
                self.seek(self.elapsed + milliseconds)
                return
            # Шаг останавливает время: смотрят кадр, а не поток. Пауза ставится
            # до счёта, чтобы фоновый поток не добавил к шагу своего.
            self.state = "paused"
            # Тем же `advance_ms`, что и обычный ход времени: шаг -- это и есть
            # ход времени, только маленький и по требованию. Второй способ
            # добавить времени разошёлся бы с первым на снимках (их берёт
            # `_remember`), и после сотни шагов откатываться стало бы некуда.
            self.advance_ms(milliseconds)
            self._gate.notify_all()

    def advance_ms(self, milliseconds: float) -> int:
        """Добавить модельного времени. Возвращает, сколько шагов удалось сделать."""
        with self._lock:
            steps = max(1, int(round(milliseconds / self.dt)))
            done = self.simulator.advance(steps)
            self._remember()
            if self.simulator.finished:
                self.state = "finished"
            return done

    def close(self) -> None:
        with self._gate:
            self._closed = True
            self._gate.notify_all()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=2)

    @property
    def closed(self) -> bool:
        """Закрыта ли она. Спрашивают снаружи: закрыть её может не только тот,
        кто открывал, -- предел пула и срок простоя тоже закрывают (#517)."""
        return self._closed

    # --- фоновый ход времени ---------------------------------------------

    def _ensure_thread(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._thread = threading.Thread(
            target=self._flow, name=f"vnl-sim-{self.id}", daemon=True
        )
        self._thread.start()

    def _flow(self) -> None:
        while True:
            with self._gate:
                while self.state != "running" and not self._closed:
                    self._gate.wait()
                if self._closed:
                    return
            self.advance_ms(self.pace * TICK_SECONDS)
            clock.sleep(TICK_SECONDS)

    def _remember(self) -> None:
        last = self._marks[-1].time if self._marks else -self.snapshot_every
        if self.elapsed - last >= self.snapshot_every:
            self._marks.append(_Mark(self.elapsed, self.simulator.snapshot()))

    def _mark_before(self, time: float) -> _Mark:
        chosen = self._marks[0]
        for mark in self._marks:
            if mark.time <= time:
                chosen = mark
            else:
                break
        return chosen

    # --- что видит интерфейс ---------------------------------------------

    def update(self, since: int = 0) -> dict[str, Any]:
        """Приращение от известного интерфейсу места.

        Формат -- младший брат `api.run_payload`: те же трассы и спайки, только
        кусочком. Округление тоже общее, иначе одна и та же величина приходила
        бы по-разному в зависимости от того, живая это симуляция или готовый
        прогон.
        """
        with self._lock:
            result = self.simulator.result
            samples = len(result.times)
            # Интерфейс знает больше, чем есть: значит время отмотали назад и
            # его буфер относится к стёртому будущему.
            rewound = since > samples
            start = 0 if rewound else since
            payload = {
                "id": self.id,
                "source": self.source,
                "state": self.state,
                "time": round(self.elapsed, TIME_DIGITS),
                "duration": self.duration,
                "dt": self.dt,
                "pace": self.pace,
                "samples": samples,
                "from": start,
                "rewound": rewound,
                "traces": {
                    key: [round(value, TRACE_DIGITS) for value in values[start:]]
                    for key, values in result.traces.items()
                },
                "spikes": {
                    name: [
                        round(time, TIME_DIGITS)
                        for time in times
                        if round(time / self.dt) >= start
                    ]
                    for name, times in result.spikes.items()
                },
                # Текущее состояние клеток: по нему подсвечивается схема, и
                # ради него не нужна запись -- потенциал есть у всех.
                #
                # Доля заряда считается здесь, а не в браузере: порог, покой и
                # адаптация -- физика, и второй счёт на другой стороне рано или
                # поздно разошёлся бы с первым. К тому же у интерфейса под рукой
                # только номинальный порог типа клетки, а у клетки он свой.
                # Округление общее с трассами: одна и та же величина не должна
                # приходить по-разному.
                "cells": {
                    name: {
                        "v": round(state["v"], TRACE_DIGITS),
                        # Разряд и пик -- за весь отрезок между кадрами, а не за
                        # последний шаг. Шагов в отрезке полсотни, разряд длится
                        # один: спрашивая последний, его не видишь никогда.
                        "spiked": state["fired"],
                        "charge": round(state["charge"], TRACE_DIGITS),
                        "peak": round(state["peak"], TRACE_DIGITS),
                    }
                    for name, state in self.simulator.peek().items()
                },
                "degradation": list(result.degradation),
            }
            if self.model.sensors or self.model.motors:
                payload.update(self._border())
            return payload

    def _border(self) -> dict[str, Any]:
        """Граница с миром в ответе сессии -- тем же куском, что клетки и трассы.

        Одним ответом, а не вторым запросом: интерфейсу нужно нарисовать кнопку
        нажатой и лампочку горящей в тот же кадр, в котором он рисует заливку
        клетки, а два опроса разъехались бы во времени -- и кнопка отставала бы
        от растра на кадр.

        Полей нет вовсе, если в схеме нет ни сенсора, ни мотора. Это не
        экономия байтов: сессия без границы обязана отвечать ровно тем же, чем
        отвечала раньше, иначе «ничего не поменялось» пришлось бы доказывать.

        Три поля отвечают на три разных вопроса. `sensors` -- какая величина
        держится на текущем моменте (после перемотки на 50 мс кнопка, нажатая
        на 100-й, обязана погаснуть, а нажатая только что -- загореться сразу,
        не дожидаясь следующего шага). `motors` -- что сеть отдаёт сейчас.
        `input` -- вся запись поданного целиком: по ней опыт сохраняют и
        повторяют, и приращением её слать незачем -- нажатий за прогон
        единицы, а не тысячи отсчётов.
        """
        return {
            "sensors": {
                name: round(value, TRACE_DIGITS)
                for name, value in self.simulator.held(self.elapsed).items()
            },
            "motors": {
                name: round(value, TRACE_DIGITS)
                for name, value in self.simulator.motors().items()
            },
            "input": [
                {
                    "time": round(event.time, TIME_DIGITS),
                    "sensor": event.sensor,
                    "value": event.value,
                }
                for event in self._input
            ],
        }


class Pool:
    """Открытые сессии. Одна на паттерн или песочницу, пока её не закрыли.

    Предел числа и срок простоя (#517). Сессия -- это модель в памяти, все
    накопленные трассы и фоновый поток, который считает время. Пока стенд стоял
    на своей машине, этого хватало: закрыл вкладку -- и ладно, процесс всё
    равно твой. После #516 симуляцию паттерна открывает любой прохожий, а
    закрытая вкладка сессию не закрывает: `DELETE /api/sim/<id>` никто не
    пошлёт. Пул без предела растёт, пока не кончится память, и считает
    прогоны, на которые никто не смотрит.

    Правил здесь два, и они про разное:

    - **срок простоя** (`idle`). Сессию, о которой давно не спрашивали, сторож
      закрывает сам. Это ответ на брошенную вкладку: она перестаёт жечь ядро,
      даже если на стенд больше никто не пришёл. Одним пределом числа этого не
      добиться -- он срабатывает только когда кто-то открывает новую;
    - **предел числа** (`limit`). Он ограничивает память и число потоков
      сверху, чего срок простоя не делает: пятнадцать минут хватит, чтобы
      открыть сколько угодно сессий.

    Кого вытеснять, решает время последнего вопроса о сессии, а не время её
    открытия и не происхождение. Открытая раньше всех -- не значит брошенная:
    человек мог открыть её первой и смотреть до сих пор. А происхождение
    (паттерн или песочница) нарочно не участвует: заброшенная песочница ничем
    не лучше заброшенной витрины, и живая витрина ничем не хуже живой
    песочницы. Вопрос один -- смотрит ли кто-нибудь, -- и «когда спрашивали»
    и есть единственный доступный на него ответ.

    Сессию, на которую смотрят, предел не убивает: вытесняется только та, о
    которой не спрашивали дольше `grace`. Если таких нет -- пул полон людьми,
    и отказать надо новому (`PoolFull`), а не отобрать у того, кто работает.
    Иначе семнадцатый посетитель гасил бы экран шестнадцатому, и на людном
    стенде симуляция просто перестала бы работать у всех сразу.
    """

    def __init__(
        self,
        limit: int | None = None,
        idle: float | None = None,
        grace: float = GRACE_SECONDS,
        sweep_every: float = SWEEP_SECONDS,
        now: Callable[[], float] = clock.monotonic,
    ) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, Session] = {}
        self._counter = 0
        self.limit = int(_setting("VNL_SIM_LIMIT", MAX_SESSIONS)) if limit is None else limit
        self.idle = _setting("VNL_SIM_IDLE", IDLE_SECONDS) if idle is None else idle
        self.grace = grace
        self._sweep_every = sweep_every
        # Часы отдельным доводом: тест, который ждёт настоящие минуты, проверяет
        # заодно и скорость машины. Правило вытеснения при этом проверяется то
        # самое, а не его упрощённая копия.
        self._now = now
        # Почему сессии больше нет. Без этого вытесненная не отличается от
        # никогда не существовавшей, и интерфейс говорит человеку «сессии нет»
        # там, где правда -- «её закрыли за вас, откройте заново».
        self._gone: dict[str, str] = {}
        self._gone_order: list[str] = []
        self._guard: threading.Thread | None = None
        self._stop = threading.Event()

    def open(
        self,
        model: ir.Model,
        source: str = "",
        origin: Origin = "sandbox",
        **options: Any,
    ) -> Session:
        # Место под новую освобождается до её создания, а не после: иначе в
        # памяти на мгновение оказывалось бы на одну модель больше предела --
        # ровно в тот момент, когда её и не хватает.
        for retired in self._retire(room=True):
            retired.close()
        with self._lock:
            if 0 < self.limit <= len(self._sessions):
                raise PoolFull(
                    "стенд уже считает столько симуляций, сколько может "
                    f"({self.limit}), и все они кому-то нужны прямо сейчас. "
                    "Попробуйте через минуту."
                )
            self._counter += 1
            id = f"sim{self._counter}"
            session = Session(id, model, source=source, origin=origin, **options)
            session.touched = self._now()
            self._sessions[id] = session
            self._ensure_guard()
            return session

    def origin_of(self, id: str) -> Origin | None:
        """Из чего открыта сессия. `None` -- такой сессии нет.

        Отдельно от `get`, потому что спрашивают об этом до всякой работы с
        сессией и на другой вопрос: можно ли пускать сюда без входа. «Нет
        такой» здесь -- не ошибка, а такой же ответ «нельзя».

        Временем последнего вопроса это не считается: спрашивают тут не о
        сессии, а о праве на неё, и запрос, который сейчас же получит отказ,
        не должен отодвигать вытеснение.
        """
        with self._lock:
            session = self._sessions.get(id)
        return session.origin if session else None

    def get(self, id: str) -> Session:
        with self._lock:
            session = self._sessions.get(id)
            if session is not None:
                # Спросили -- значит на неё смотрят. Это и есть та отметка, по
                # которой предел выбирает, кем пожертвовать.
                session.touched = self._now()
        if session is None:
            raise SessionError(self.no_such(id))
        return session

    def no_such(self, id: str) -> str:
        """Почему сессии нет -- одним текстом на все отказы.

        Вытесненная и закрытая по простою называют причину: интерфейс покажет
        её рядом с транспортом, и «пусто» перестанет выглядеть поломкой.
        Незнакомая говорит общее -- рассказывать прохожему, какие сессии тут
        когда-то были, незачем.
        """
        why = self._gone.get(id)
        if why:
            return f"сессии {id!r} больше нет: {why}"
        return f"сессии {id!r} нет: она закрыта или не открывалась"

    def close(self, id: str) -> None:
        session = self.get(id)
        with self._lock:
            self._sessions.pop(id, None)
        session.close()

    def close_all(self) -> None:
        self._stop.set()
        guard = self._guard
        if guard is not None and guard is not threading.current_thread():
            guard.join(timeout=2)
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
            self._guard = None
        for session in sessions:
            session.close()

    def sweep(self) -> int:
        """Закрыть сессии, о которых давно не спрашивали. Сколько закрыл.

        Отдельным методом, а не только внутри сторожа: в тесте ждать настоящие
        минуты нельзя, а проверять надо само правило, а не таймер вокруг него.
        """
        retired = self._retire()
        for session in retired:
            session.close()
        return len(retired)

    # --- вытеснение -------------------------------------------------------

    def _retire(self, room: bool = False) -> list[Session]:
        """Кого пора закрыть. Сами сессии закрывает вызвавший.

        Закрытие вынесено наружу нарочно: `Session.close` дожидается фонового
        потока, а держать на это время замок пула значило бы останавливать
        всех остальных из-за одной уходящей сессии.
        """
        now = self._now()
        out: list[Session] = []
        with self._lock:
            if self.idle > 0:
                for id, session in list(self._sessions.items()):
                    if now - session.touched >= self.idle:
                        out.append(
                            self._forget(
                                id,
                                "её долго не спрашивали, и она закрылась сама. "
                                "Откройте прогон заново.",
                            )
                        )
            while room and 0 < self.limit <= len(self._sessions):
                oldest = min(
                    self._sessions.values(), key=lambda item: item.touched
                )
                if now - oldest.touched < self.grace:
                    # Все до одной нужны кому-то прямо сейчас. Отказ новому
                    # выдаст `open`: отобрать сессию у работающего человека
                    # хуже, чем не дать открыть ещё одну.
                    break
                out.append(
                    self._forget(
                        oldest.id,
                        "её вытеснила новая -- стенд держит ограниченное число "
                        "живых симуляций. Откройте прогон заново.",
                    )
                )
        return out

    def _forget(self, id: str, why: str) -> Session:
        """Убрать сессию из пула, запомнив причину. Зовётся под замком."""
        session = self._sessions.pop(id)
        self._gone[id] = why
        self._gone_order.append(id)
        # Память о причинах ограничена: она нужна ровно до того мгновения,
        # когда интерфейс спросит про свою сессию и получит объяснение.
        while len(self._gone_order) > GONE_MEMORY:
            self._gone.pop(self._gone_order.pop(0), None)
        return session

    def _ensure_guard(self) -> None:
        """Сторож простоя. Зовётся под замком, при открытии первой сессии.

        Один поток на весь пул, а не таймер на сессию: сессий десятки, и
        столько же спящих потоков стоили бы дороже того, что они стерегут.
        Пустой пул сторожа не заводит вовсе -- на своей машине, где симуляцию
        открывают и закрывают руками, лишнего потока в процессе не появится.
        """
        if self.idle <= 0 or self._stop.is_set():
            return
        if self._guard is not None and self._guard.is_alive():
            return
        self._guard = threading.Thread(
            target=self._watch, name="vnl-sim-pool", daemon=True
        )
        self._guard.start()

    def _watch(self) -> None:
        while not self._stop.wait(self._sweep_every):
            try:
                self.sweep()
            except Exception as exc:  # noqa: BLE001 -- сторож падать не должен
                print(f"сторож сессий споткнулся: {exc}", file=sys.stderr)

    def __len__(self) -> int:
        with self._lock:
            return len(self._sessions)
