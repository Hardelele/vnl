/**
 * Состояние входа: кто вошёл и надо ли вообще входить.
 *
 * Отдельный стор, а не поле в состоянии библиотеки: вход не принадлежит ни
 * одному экрану. Его спрашивает оболочка при запуске, и он же меняется из
 * любого места -- когда сервер отвечает 401 на давно открытой вкладке.
 *
 * Порты параметром -- по той же причине, что и в состоянии библиотеки: тест
 * должен проверять поведение, а не ждать сеть.
 */

import { useSyncExternalStore } from 'react'

import { loadSession, type SessionInfo } from '../model/session'
import { createStore, type Store } from './store'

export interface SessionState {
  info: SessionInfo | null
  loading: boolean
  /** Сервер не ответил. Отличается от «не вошёл»: входить тут некуда. */
  offline: boolean
}

export interface SessionPorts {
  load: () => Promise<SessionInfo>
}

const DEFAULT_PORTS: SessionPorts = { load: () => loadSession() }

const EMPTY: SessionState = { info: null, loading: false, offline: false }

export function createSession(
  ports: SessionPorts = DEFAULT_PORTS,
  store: Store<SessionState> = createStore<SessionState>({ ...EMPTY }),
) {
  return {
    store,

    /** Спросить сервер, кто вошёл. Зовётся при запуске и после возврата. */
    async refresh(): Promise<void> {
      store.setState({ loading: true })
      try {
        store.setState({ info: await ports.load(), offline: false, loading: false })
      } catch {
        // Причина здесь не важна: и «сервер не запущен», и «ответил мусором»
        // означают одно -- состояния входа мы не знаем и врать о нём не будем.
        store.setState({ offline: true, loading: false })
      }
    },

    /**
     * Сервер ответил 401. Значит сессия кончилась, пока вкладка была открыта:
     * помним, что войти надо, и не ждём следующего запроса, чтобы это понять.
     *
     * Перезапрашивать `/api/session` здесь нечего -- ответ известен заранее, а
     * лишний запрос на каждый отказ превратил бы истёкшую сессию в шквал.
     */
    expired(): void {
      const info = store.getState().info
      store.setState({
        info: {
          user: null,
          login: info?.login ?? '/auth/login',
          logout: info?.logout ?? null,
          required: true,
        },
      })
    },
  }
}

export const session = createSession()

export function useSession<S>(select: (state: SessionState) => S): S {
  return useSyncExternalStore(
    session.store.subscribe,
    () => select(session.store.getState()),
    () => select(session.store.getState()),
  )
}

/**
 * Вход нужен, а его нет. `null` у `info` -- «ещё не спросили»: показывать в
 * этот момент экран входа значило бы мигать им на каждой загрузке.
 */
export function needsLogin(state: SessionState): boolean {
  return Boolean(state.info?.required) && !state.info?.user
}
