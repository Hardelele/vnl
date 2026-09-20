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

import threading
import time as clock
from dataclasses import dataclass, field
from typing import Any, Literal

from . import ir
from .api import TIME_DIGITS, TRACE_DIGITS
from .sim.lif import Simulator, Snapshot

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


class SessionError(RuntimeError):
    pass


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
        self.pace = pace
        self.snapshot_every = snapshot_every

        self._lock = threading.RLock()
        self._gate = threading.Condition(self._lock)
        self._closed = False
        self._thread: threading.Thread | None = None

        self._build()

    # --- устройство -------------------------------------------------------

    def _build(self) -> None:
        self.simulator = Simulator(self.model)
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
        """Начать сначала -- отдельное действие, а не побочный эффект запуска."""
        with self._gate:
            self.state = "paused"
            self._build()
            self._gate.notify_all()

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
            return {
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


class Pool:
    """Открытые сессии. Одна на паттерн или песочницу, пока её не закрыли."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, Session] = {}
        self._counter = 0

    def open(
        self,
        model: ir.Model,
        source: str = "",
        origin: Origin = "sandbox",
        **options: Any,
    ) -> Session:
        with self._lock:
            self._counter += 1
            id = f"sim{self._counter}"
            session = Session(id, model, source=source, origin=origin, **options)
            self._sessions[id] = session
            return session

    def origin_of(self, id: str) -> Origin | None:
        """Из чего открыта сессия. `None` -- такой сессии нет.

        Отдельно от `get`, потому что спрашивают об этом до всякой работы с
        сессией и на другой вопрос: можно ли пускать сюда без входа. «Нет
        такой» здесь -- не ошибка, а такой же ответ «нельзя».
        """
        with self._lock:
            session = self._sessions.get(id)
        return session.origin if session else None

    def get(self, id: str) -> Session:
        with self._lock:
            session = self._sessions.get(id)
        if session is None:
            raise SessionError(f"сессии {id!r} нет: она закрыта или не открывалась")
        return session

    def close(self, id: str) -> None:
        session = self.get(id)
        with self._lock:
            self._sessions.pop(id, None)
        session.close()

    def close_all(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            session.close()

    def __len__(self) -> int:
        with self._lock:
            return len(self._sessions)
