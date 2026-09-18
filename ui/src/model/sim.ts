/**
 * Симуляция: обращения к сессии на сервере.
 *
 * Здесь ничего не считается. Время идёт на стороне Python, а интерфейс
 * спрашивает, что нового, и говорит, что делать дальше: пустить, остановить,
 * встать на момент. Расчёт в браузере означал бы вторую реализацию физики — и
 * расхождение с той, по которой принимают решения.
 */

import { ApiError, OfflineError } from './catalog'

export type SimState = 'paused' | 'running' | 'finished'

/** Мгновенное состояние клетки: по нему подсвечивается схема. */
export interface CellState {
  v: number
  spiked: boolean
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

async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch('/api' + path, init)
  } catch (reason) {
    throw new OfflineError(reason)
  }
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : {}
  if (!response.ok) {
    const message =
      (payload as { error?: string }).error ??
      `${response.status} ${response.statusText}`
    throw new ApiError(message, response.status)
  }
  return payload as T
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return ask<T>(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

/** Открыть симуляцию демонстрационного запуска паттерна. */
export function openSim(pattern: string): Promise<SimUpdate> {
  return post<SimUpdate>('/sim', { pattern })
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
