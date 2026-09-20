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
 *
 * Сессия считает ту модель, из которой её собрали, и правка схемы её не
 * догоняет. Поэтому здесь хранится `built` -- отпечаток схемы на момент
 * открытия: по расхождению с текущим видно, что результат уже про другую сеть.
 * Сам результат при этом не выбрасывается -- он остаётся доступным, но
 * помечается устаревшим и не выдаётся за результат новой схемы (#481).
 */

import { useSyncExternalStore } from 'react'

import { OfflineError, isDenied } from '../model/catalog'
import {
  closeSim,
  openSim,
  pauseSim,
  readSim,
  resetSim,
  seekSim,
  senseSim,
  startSim,
  stepSim,
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
  /** Отпечаток схемы, из которой собрана сессия; у витрины паттерна пуст. */
  built: string | null
  state: SimState
  time: number
  duration: number
  dt: number
  /** Сколько отсчётов уже в буфере. */
  samples: number
  traces: Record<string, number[]>
  spikes: Record<string, number[]>
  cells: Record<string, CellState>
  /**
   * Граница с миром на текущем моменте (#561): величина каждого сенсора и
   * каждого мотора. Пусто, пока сессии нет, и пусто у схемы без границы --
   * сессия без неё этих полей не присылает вовсе.
   *
   * Здесь, а не рядом с кнопками: кнопка нажата ровно тогда, когда сессия
   * говорит, что величина держится. Своё «нажато» в панели было бы вторым
   * ответом на тот же вопрос -- и разошлось бы с первым на перемотке, где
   * палец на кнопке, а прогон стоит на моменте до нажатия.
   */
  sensors: Record<string, number>
  motors: Record<string, number>
  degradation: string[]
  busy: boolean
  error: string | null
  offline: boolean
  /** Отказ был «нужен вход»: сессия песочницы чужой не бывает. */
  denied: boolean
}

const EMPTY: SimView = {
  id: null,
  built: null,
  state: 'paused',
  time: 0,
  duration: 0,
  dt: 0.1,
  samples: 0,
  traces: {},
  spikes: {},
  cells: {},
  sensors: {},
  motors: {},
  degradation: [],
  busy: false,
  error: null,
  offline: false,
  denied: false,
}

export interface SimPorts {
  open: (target: SimTarget) => Promise<SimUpdate>
  read: (id: string, since: number) => Promise<SimUpdate>
  start: (id: string, since: number) => Promise<SimUpdate>
  pause: (id: string, since: number) => Promise<SimUpdate>
  reset: (id: string) => Promise<SimUpdate>
  seek: (id: string, time: number) => Promise<SimUpdate>
  step: (id: string, delta: number) => Promise<SimUpdate>
  sense: (id: string, values: Record<string, number>) => Promise<SimUpdate>
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
  step: stepSim,
  sense: senseSim,
  drop: closeSim,
  every: (run, delay) => {
    const timer = setInterval(run, delay)
    return () => clearInterval(timer)
  },
}

export interface SimController {
  store: Store<SimView>
  open: (target: SimTarget, built?: string) => Promise<void>
  start: () => Promise<void>
  pause: () => Promise<void>
  reset: () => Promise<void>
  seek: (time: number) => Promise<void>
  /**
   * Шаг по времени от текущего момента. Отдельно от `seek`, потому что
   * сессия показывает в шаге разряд, а в прыжке курсором -- нет (#537).
   */
  step: (delta: number) => Promise<void>
  /**
   * Подать величины сенсорам: `{ key: 1 }` -- нажали, `{ key: 0 }` -- отпустили.
   *
   * Отдельно от `act`, и единственное отличие -- занятость. `busy` гасит
   * транспорт («Пуск», «Шаг»), а кнопку жмут и отпускают по разу в секунду:
   * через `act` транспорт мигал бы недоступным на каждое нажатие, хотя время
   * идёт как шло -- подача ничего в сессии не останавливает.
   */
  sense: (values: Record<string, number>) => Promise<void>
  close: () => Promise<void>
  forget: () => void
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
      // Полей нет вовсе, когда в схеме нет ни сенсора, ни мотора: сессия без
      // границы отвечает ровно тем же, чем отвечала раньше (`live._border`).
      sensors: update.sensors ?? {},
      motors: update.motors ?? {},
      degradation: update.degradation,
      error: null,
      offline: false,
      denied: false,
    })
    if (update.state === 'running') watch()
    else unwatch()
  }

  const fail = (reason: unknown): void => {
    unwatch()
    store.setState({
      error: reason instanceof Error ? reason.message : String(reason),
      offline: reason instanceof OfflineError,
      denied: isDenied(reason),
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

    async open(target, built) {
      unwatch()
      // Прежняя сессия закрывается, а не забывается: время в ней идёт на
      // сервере, и брошенная она считала бы схему, которой уже нет.
      const previous = store.getState().id
      store.setState({ ...EMPTY, busy: true })
      if (previous) await io.drop(previous).catch(() => undefined)
      try {
        absorb(await io.open(target))
        store.setState({ built: built ?? null, busy: false })
      } catch (reason) {
        fail(reason)
      }
    },

    start: () => act((id) => io.start(id, store.getState().samples)),
    pause: () => act((id) => io.pause(id, store.getState().samples)),
    reset: () => act((id) => io.reset(id)),
    seek: (time) => act((id) => io.seek(id, time)),
    step: (delta) => act((id) => io.step(id, delta)),

    async sense(values) {
      const { id } = store.getState()
      if (!id) return
      try {
        absorb(await io.sense(id, values))
      } catch (reason) {
        fail(reason)
      }
    },

    async close() {
      unwatch()
      const { id } = store.getState()
      store.setState({ ...EMPTY })
      if (id) await io.drop(id).catch(() => undefined)
    },

    /**
     * Забыть отказ. Нужно там, где отказ перестал быть правдой: «в песочнице
     * нечего считать» после вставки блока -- неверное утверждение, а не
     * история, и висеть на экране оно не должно.
     */
    forget(): void {
      store.setState({ error: null, offline: false, denied: false })
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
