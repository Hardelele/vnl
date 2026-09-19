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

export function closeSim(id: string): Promise<void> {
  return ask(`/sim/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => undefined)
}
