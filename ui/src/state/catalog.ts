/**
 * Состояние экрана библиотеки: что набрано, что выбрано, что пришло.
 *
 * Логика отделена от разметки не ради слоёв, а ради двух вещей, которые иначе
 * не проверить: набор в поиске не должен посылать запрос на каждую букву, а
 * медленный ответ на старый запрос не должен затирать свежий. И то и другое
 * ловится тестом только там, где нет ни DOM, ни таймеров React.
 *
 * Сам отбор по-прежнему делает сервер (`vnl/catalog.py`): здесь только строка
 * запроса и набор выбранных чипов.
 */

import { useSyncExternalStore } from 'react'

import {
  OfflineError,
  createDraft,
  deletePattern,
  loadCatalog,
  type CatalogQuery,
} from '../model/catalog'
import type { Catalog, CatalogLevel, PatternDetail, PatternStatus } from '../model/types'
import { createStore, type Store } from './store'

/** Пауза после набора: ждём, пока человек допишет слово, а не букву. */
export const TYPING_PAUSE = 200

export interface CatalogState {
  /** Набранное в поиске -- сразу, без ожидания ответа сервера. */
  text: string
  levels: CatalogLevel[]
  statuses: PatternStatus[]
  catalog: Catalog | null
  /** Идёт запрос. Первый показывает скелет, последующие -- только что список несвежий. */
  loading: boolean
  error: string | null
  /** Сервер не запущен: причина поправимая, и говорить о ней надо иначе. */
  offline: boolean
}

export interface CatalogPorts {
  load: (query: CatalogQuery) => Promise<Catalog>
  add: (name: string, level: CatalogLevel) => Promise<PatternDetail>
  drop: (id: string) => Promise<void>
  /** Отложенный вызов -- параметром, чтобы тест не ждал настоящие миллисекунды. */
  schedule: (run: () => void, delay: number) => () => void
}

const DEFAULT_PORTS: CatalogPorts = {
  load: (query) => loadCatalog(query),
  add: (name, level) => createDraft(name, level),
  drop: (id) => deletePattern(id),
  schedule: (run, delay) => {
    const timer = setTimeout(run, delay)
    return () => clearTimeout(timer)
  },
}

const EMPTY: CatalogState = {
  text: '',
  levels: [],
  statuses: [],
  catalog: null,
  loading: false,
  error: null,
  offline: false,
}

export interface CatalogController {
  store: Store<CatalogState>
  /** Спросить библиотеку сейчас же. */
  refresh: () => Promise<void>
  search: (text: string) => void
  toggleLevel: (level: CatalogLevel) => void
  toggleStatus: (status: PatternStatus) => void
  /** Переключатель «Все / Готов / Черновик»: выбран ровно один, `null` -- все. */
  pickStatus: (status: PatternStatus | null) => void
  clearFilters: () => void
  addDraft: (name: string, level?: CatalogLevel) => Promise<PatternDetail | null>
  remove: (id: string) => Promise<void>
  /** Отменить отложенный запрос: экран закрыли, ответ уже никому не нужен. */
  dispose: () => void
}

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

export function createCatalogController(
  ports: Partial<CatalogPorts> = {},
): CatalogController {
  const { load, add, drop, schedule } = { ...DEFAULT_PORTS, ...ports }
  const store = createStore<CatalogState>({ ...EMPTY })

  // Номер запроса: ответ принимается только если он на последний вопрос.
  // Иначе быстрый ответ на «ff» лёг бы поверх ответа на «ffi».
  let issued = 0
  let cancelPending: (() => void) | null = null

  const query = (): CatalogQuery => {
    const { text, levels, statuses } = store.getState()
    return { text, levels, statuses }
  }

  const refresh = async (): Promise<void> => {
    const mine = ++issued
    store.setState({ loading: true })
    try {
      const catalog = await load(query())
      if (mine !== issued) return
      store.setState({ catalog, error: null, offline: false, loading: false })
    } catch (reason) {
      if (mine !== issued) return
      store.setState({
        error: reason instanceof Error ? reason.message : String(reason),
        offline: reason instanceof OfflineError,
        loading: false,
      })
    }
  }

  const later = (): void => {
    cancelPending?.()
    cancelPending = schedule(() => {
      cancelPending = null
      void refresh()
    }, TYPING_PAUSE)
  }

  return {
    store,
    refresh,

    search(text) {
      store.setState({ text })
      later()
    },

    // Чип нажали -- спрашиваем сразу: это одно движение, а не набор текста.
    toggleLevel(level) {
      store.setState({ levels: toggle(store.getState().levels, level) })
      void refresh()
    },

    toggleStatus(status) {
      store.setState({ statuses: toggle(store.getState().statuses, status) })
      void refresh()
    },

    pickStatus(status) {
      store.setState({ statuses: status ? [status] : [] })
      void refresh()
    },

    clearFilters() {
      store.setState({ text: '', levels: [], statuses: [] })
      void refresh()
    },

    async addDraft(name, level = 'L2') {
      try {
        const created = await add(name, level)
        await refresh()
        return created
      } catch (reason) {
        store.setState({
          error: reason instanceof Error ? reason.message : String(reason),
          offline: reason instanceof OfflineError,
        })
        return null
      }
    },

    async remove(id) {
      try {
        await drop(id)
      } catch (reason) {
        store.setState({
          error: reason instanceof Error ? reason.message : String(reason),
          offline: reason instanceof OfflineError,
        })
      }
      await refresh()
    },

    dispose() {
      cancelPending?.()
      cancelPending = null
      issued += 1
    },
  }
}

/** Общий на экран контроллер: библиотека одна, и спрашивать её дважды незачем. */
export const catalogController = createCatalogController()

/**
 * Подписка на состояние библиотеки.
 *
 * `select` обязан возвращать либо само состояние, либо величину из него.
 * Селектор, собирающий новый объект, на каждый вызов даёт новую ссылку, React
 * считает это изменением и уходит в бесконечную перерисовку -- собирайте такой
 * объект в `useMemo` уже в компоненте.
 */
export function useCatalog<S>(select: (state: CatalogState) => S): S {
  const { store } = catalogController
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  )
}
