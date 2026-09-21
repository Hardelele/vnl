/**
 * Симуляция: обращения к сессии на сервере.
 *
 * Здесь ничего не считается. Время идёт на стороне Python, а интерфейс
 * спрашивает, что нового, и говорит, что делать дальше: пустить, остановить,
 * встать на момент. Расчёт в браузере означал бы вторую реализацию физики — и
 * расхождение с той, по которой принимают решения.
 */

import { request } from './catalog'

export type SimState = 'paused' | 'running' | 'finished'

/** Мгновенное состояние клетки: по нему подсвечивается схема. */
export interface CellState {
  v: number
  spiked: boolean
  /**
   * Насколько клетка заряжена: доля пути от покоя до порога. 0 -- покой,
   * 1 -- разряд. Считает сессия (`live.Session.update`) по параметрам этой
   * клетки, а не по общей шкале.
   *
   * Бывает отрицательной -- клетку увели ниже покоя торможением, -- и бывает
   * больше единицы: адаптация поднимает настоящий порог выше номинального.
   * Ни то ни другое не обрезано: именно этим доля и полезна.
   */
  charge: number
  /**
   * До чего клетка доходила с прошлого кадра.
   *
   * Между кадрами движок делает полсотни шагов, а разряд занимает один: по
   * мгновенному значению его не видно никогда. В кадре разряда показывается
   * это число -- см. `momentOf` в `lib/charge`.
   */
  peak: number
}

export interface SimUpdate {
  id: string
  source: string
  state: SimState
  /** Пройденное модельное время, мс. */
  time: number
  duration: number
  dt: number
  pace: number
  /** Сколько отсчётов записано в сессии. */
  samples: number
  /** С какого отсчёта идёт это приращение. */
  from: number
  /** Время отмотали: то, что накоплено в интерфейсе, относится к стёртому будущему. */
  rewound: boolean
  traces: Record<string, number[]>
  spikes: Record<string, number[]>
  cells: Record<string, CellState>
  degradation: string[]
  /**
   * Граница с миром (#561). Полей нет вовсе, когда в схеме нет ни сенсора, ни
   * мотора: сессия без границы отвечает ровно тем же, чем отвечала раньше.
   *
   * `sensors` -- что сеть видит сейчас: удерживаемая величина каждого сенсора.
   * Именно её показывает кнопка, и именно поэтому после перемотки на 50 мс
   * кнопка, нажатая на 100-й, гаснет сама -- сессия сообщает прошлое, а не
   * то, что человек держит пальцем.
   */
  sensors?: Record<string, number | FieldSummary>
  /** Что сеть отдаёт сейчас: величина каждого мотора (единица -- в `Motor.unit`). */
  motors?: Record<string, number>
  /**
   * Вся запись поданного снаружи, целиком и с модельным временем. По ней опыт
   * сохраняют и повторяют: та же запись даёт тот же прогон спайк в спайк.
   * Приращением она не едет -- нажатий за прогон единицы, а не тысячи.
   */
  input?: SenseEvent[]
}

/**
 * Что держится на поле -- счётом, а не кадром (#581).
 *
 * Ответ сессии уходит на каждый кадр показа, и 576 величин в каждом были бы
 * потоком ради картинки, которая меняется только тогда, когда её сменили. Сам
 * кадр спрашивают отдельно -- `readFrames`.
 */
export interface FieldSummary {
  /** Сколько величин у поля всего. */
  values: number
  /** Сколько из них ненулевые: по ним видно, что кадр не пустой. */
  lit: number
  /** Средняя по ненулевым. */
  mean: number
}

/** Держится ли на двери поле, а не одно число. */
export function isField(value: number | FieldSummary | undefined): value is FieldSummary {
  return typeof value === 'object' && value !== null
}

/** Одно поданное значение: когда, какому сенсору и какое. */
export interface SenseEvent {
  /** Модельное время подачи, мс. Настоящие секунды к прогону отношения не имеют. */
  time: number
  sensor: string
  value: number | FieldSummary
}

/** Разбор ответа общий с библиотекой: см. `request`. */
function ask<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>('/api' + path, init)
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return ask<T>(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

/** Что считаем: витрину паттерна или собранную песочницу. */
export type SimTarget = { pattern: string } | { sandbox: string }

export function openSim(target: SimTarget): Promise<SimUpdate> {
  return post<SimUpdate>('/sim', target)
}

export function readSim(id: string, since: number): Promise<SimUpdate> {
  return ask<SimUpdate>(`/sim/${encodeURIComponent(id)}?since=${since}`)
}

export function startSim(id: string, since: number): Promise<SimUpdate> {
  return post<SimUpdate>(`/sim/${encodeURIComponent(id)}/start?since=${since}`)
}

export function pauseSim(id: string, since: number): Promise<SimUpdate> {
  return post<SimUpdate>(`/sim/${encodeURIComponent(id)}/pause?since=${since}`)
}

export function resetSim(id: string): Promise<SimUpdate> {
  return post<SimUpdate>(`/sim/${encodeURIComponent(id)}/reset`)
}

/** Встать на момент: движок откатывается, прежнее будущее стирается. */
export function seekSim(id: string, time: number): Promise<SimUpdate> {
  return post<SimUpdate>(`/sim/${encodeURIComponent(id)}/seek`, { time })
}

/**
 * Шагнуть по времени от текущего момента.
 *
 * Свой вызов, а не `seekSim` с маленькой разницей: сессия показывает разряд,
 * попавший в шаг, и не показывает разряд, попавший в прыжок курсором
 * (`live.Session.step`). Различать их по величине числа значило бы однажды
 * показать разряд из чужого отрезка -- поэтому намерение говорится маршрутом.
 */
export function stepSim(id: string, delta: number): Promise<SimUpdate> {
  return post<SimUpdate>(`/sim/${encodeURIComponent(id)}/step`, { delta })
}

/**
 * Подать величины сенсорам: `{ key: 1 }` -- нажали, `{ key: 0 }` -- отпустили.
 *
 * Словарём, а не одним значением: две кнопки, нажатые разом, обязаны лечь на
 * один и тот же момент модельного времени, а двумя запросами это не выходит --
 * между ними время уходит вперёд.
 *
 * Величина -- безразмерная доля силы от 0 до 1 (`Glossary.value`), а не герцы:
 * во что её превратить, решает род сенсора. Значение вне границ сервер
 * отвергает, а не зажимает.
 *
 * Момент подачи сессия берёт у себя -- «сейчас» для прогона это ближайший
 * непосчитанный шаг. Поэтому нажатие переигрывается при любой перемотке, а
 * отпечаток сети от него не меняется: это вход, а не схема.
 */
export function senseSim(
  id: string,
  values: Record<string, number>,
): Promise<SimUpdate> {
  return post<SimUpdate>(`/sim/${encodeURIComponent(id)}/sensors`, values)
}

/** Что показать полю: встроенный образец по имени или готовый кадр чисел. */
export type Shown = { sample: string; level?: number } | { frame: number[] }

/**
 * Показать полям кадры: `{ 'retina24/eye': { sample: 'T' } }` (#581).
 *
 * Свой вызов, а не `senseSim` с другим значением: показать кнопке кадр или
 * полю одно число -- это не «другой аргумент», а ошибка, и разводятся они
 * там, где видно, какое из двух происходит.
 *
 * Словарём -- по той же причине, что и у подачи величин: два поля, которым
 * показали разом, обязаны лечь на один момент модельного времени.
 *
 * Именем образца, когда он встроенный: по сети едет одно слово вместо 576
 * чисел, а буква получается ровно та, про которую написаны числа в примерах.
 */
export function showSim(
  id: string,
  frames: Record<string, Shown>,
): Promise<SimUpdate> {
  return post<SimUpdate>(`/sim/${encodeURIComponent(id)}/frames`, frames)
}

/**
 * Какие кадры сейчас держатся на полях сессии.
 *
 * Отдельным запросом, а не полем общего ответа: см. `FieldSummary`. Нужен
 * тогда, когда панель открыли поверх уже идущей сессии, -- показать то, что
 * сеть видит, не дожидаясь следующего показа.
 */
export function readFrames(id: string): Promise<Record<string, number[]>> {
  return ask<{ frames: Record<string, number[]> }>(
    `/sim/${encodeURIComponent(id)}/frames`,
  ).then((answer) => answer.frames)
}

export function closeSim(id: string): Promise<void> {
  return ask(`/sim/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => undefined)
}
