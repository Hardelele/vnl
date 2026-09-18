/**
 * Состояние живой симуляции в интерфейсе.
 *
 * Сессия на сервере знает время и физику; здесь копится то, что уже пришло,
 * и идёт опрос, пока время течёт. Опрос прекращается на паузе: спрашивать
 * стоящую симуляцию не о чем.
 *
 * Приращения складываются в конец буфера, но только если сервер подтвердил,
 * что они относятся к тому же прошлому. Пришёл признак отката -- буфер
 * заменяется целиком: дорисовывать новое будущее к старому значило бы
 * показывать график, которого в этой симуляции никогда не было.
 */

import { useSyncExternalStore } from 'react'

import { OfflineError } from '../model/catalog'
import {
  closeSim,
  openSim,
  pauseSim,
  readSim,
  resetSim,
  seekSim,
  startSim,
  type CellState,
  type SimState,
  type SimTarget,
  type SimUpdate,
} from '../model/sim'
import { createStore, type Store } from './store'

/** Как часто спрашивать сессию, пока время идёт. */
export const POLL_MS = 150

export interface SimView {
  id: string | null
  state: SimState
  time: number
  duration: number
  dt: number
  /** Сколько отсчётов уже в буфере. */
  samples: number
  traces: Record<string, number[]>
  spikes: Record<string, number[]>
  cells: Record<string, CellState>
  degradation: string[]
  busy: boolean
  error: string | null
  offline: boolean
}

const EMPTY: SimView = {
  id: null,
  state: 'paused',
  time: 0,
  duration: 0,
  dt: 0.1,
  samples: 0,
  traces: {},
  spikes: {},
  cells: {},
  degradation: [],
  busy: false,
  error: null,
  offline: false,
}

export interface SimPorts {
  open: (target: SimTarget) => Promise<SimUpdate>
  read: (id: string, since: number) => Promise<SimUpdate>
  start: (id: string, since: number) => Promise<SimUpdate>
  pause: (id: string, since: number) => Promise<SimUpdate>
  reset: (id: string) => Promise<SimUpdate>
  seek: (id: string, time: number) => Promise<SimUpdate>
  drop: (id: string) => Promise<void>
  /** Повторяющийся вызов. Параметром -- чтобы тест не ждал настоящие миллисекунды. */
  every: (run: () => void, delay: number) => () => void
}

const DEFAULT_PORTS: SimPorts = {
  open: openSim,
  read: readSim,
  start: startSim,
  pause: pauseSim,
  reset: resetSim,
  seek: seekSim,
  drop: closeSim,
  every: (run, delay) => {
    const timer = setInterval(run, delay)
    return () => clearInterval(timer)
  },
}

export interface SimController {
  store: Store<SimView>
  open: (target: SimTarget) => Promise<void>
  start: () => Promise<void>
  pause: () => Promise<void>
  reset: () => Promise<void>
  seek: (time: number) => Promise<void>
  close: () => Promise<void>
}

export function createSimController(ports: Partial<SimPorts> = {}): SimController {
  const io = { ...DEFAULT_PORTS, ...ports }
  const store = createStore<SimView>({ ...EMPTY })
  let stopPolling: (() => void) | null = null

  const absorb = (update: SimUpdate): void => {
    const previous = store.getState()
    const fresh = update.rewound || update.from === 0
    const traces: Record<string, number[]> = {}
    for (const [key, values] of Object.entries(update.traces)) {
      traces[key] = fresh ? values : [...(previous.traces[key] ?? []), ...values]
    }
    const spikes: Record<string, number[]> = {}
    for (const [name, times] of Object.entries(update.spikes)) {
      spikes[name] = fresh ? times : [...(previous.spikes[name] ?? []), ...times]
    }
    store.setState({
      id: update.id,
      state: update.state,
      time: update.time,
      duration: update.duration,
      dt: update.dt,
      samples: update.samples,
      traces,
      spikes,
      cells: update.cells,
      degradation: update.degradation,
      error: null,
      offline: false,
    })
    if (update.state === 'running') watch()
    else unwatch()
  }

  const fail = (reason: unknown): void => {
    unwatch()
    store.setState({
      error: reason instanceof Error ? reason.message : String(reason),
      offline: reason instanceof OfflineError,
      busy: false,
    })
  }

  const watch = (): void => {
    if (stopPolling) return
    stopPolling = io.every(() => {
      const { id, samples } = store.getState()
      if (!id) return
      io.read(id, samples).then(absorb).catch(fail)
    }, POLL_MS)
  }

  const unwatch = (): void => {
    stopPolling?.()
    stopPolling = null
  }

  /** Действие над сессией: занятость, единый разбор отказа. */
  const act = async (run: (id: string) => Promise<SimUpdate>): Promise<void> => {
    const { id } = store.getState()
    if (!id) return
    store.setState({ busy: true })
    try {
      absorb(await run(id))
      store.setState({ busy: false })
    } catch (reason) {
      fail(reason)
    }
  }

  return {
    store,

    async open(target) {
      unwatch()
      store.setState({ ...EMPTY, busy: true })
      try {
        absorb(await io.open(target))
        store.setState({ busy: false })
      } catch (reason) {
        fail(reason)
      }
    },

    start: () => act((id) => io.start(id, store.getState().samples)),
    pause: () => act((id) => io.pause(id, store.getState().samples)),
    reset: () => act((id) => io.reset(id)),
    seek: (time) => act((id) => io.seek(id, time)),

    async close() {
      unwatch()
      const { id } = store.getState()
      store.setState({ ...EMPTY })
      if (id) await io.drop(id).catch(() => undefined)
    },
  }
}

export const simController = createSimController()

/** Селектор обязан отдавать величину, а не собранный объект: см. `useCatalog`. */
export function useSim<S>(select: (state: SimView) => S): S {
  const { store } = simController
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  )
}
