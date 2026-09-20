/**
 * Состояние входа: кто вошёл и надо ли вообще входить.
 *
 * Отдельный стор, а не поле в состоянии библиотеки: вход не принадлежит ни
 * одному экрану. Его спрашивает оболочка при запуске, и он же меняется из
 * любого места -- когда сервер отвечает 401 на давно открытой вкладке.
 *
 * Вход здесь -- свойство действий, а не состояние приложения. Библиотека
 * открыта всем, поэтому «не вошёл» не заменяет собой экран: он только решает,
 * предлагать ли вход в панели и доступны ли закрытые действия.
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
     * Сервер ответил 401 на закрытом маршруте. Значит вход нужен, а его нет:
     * помним это и не ждём следующего запроса, чтобы понять то же самое.
     *
     * Перезапрашивать `/api/session` здесь нечего -- ответ известен заранее, а
     * лишний запрос на каждый отказ превратил бы истёкшую сессию в шквал.
     *
     * `login` берётся из тела отказа, если сервер его назвал: знать чужие
     * маршруты наизусть интерфейсу незачем.
     */
    expired(login?: string): void {
      const info = store.getState().info
      store.setState({
        info: {
          user: null,
          login: login ?? info?.login ?? '/auth/login',
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
 * Вход нужен, а его нет -- значит в панели стоит «Войти».
 *
 * `null` у `info` -- «ещё не спросили», и это не «не вошёл»: кнопка входа
 * мигала бы на каждой загрузке страницы. При `required: false` вход на этом
 * сервере не настроен вовсе, и предлагать его нечем.
 */
export function needsLogin(state: SessionState): boolean {
  return Boolean(state.info?.required) && !state.info?.user
}

/**
 * Закрытые действия доступны: вход либо пройден, либо не настроен.
 *
 * Пока `info` пуст, ответ «да». Ответ на `/api/session` приходит сразу за
 * первым кадром, и запирать на это время песочницу значило бы обещать отказ
 * там, где на своей машине его не будет: «нужен вход» мигало бы у каждого
 * локального запуска. Настоящий отказ всё равно приходит от сервера и
 * объясняет себя на месте.
 */
export function canChange(state: SessionState): boolean {
  const info = state.info
  if (!info) return true
  return !info.required || Boolean(info.user)
}

/** Куда уводить за входом. Строка, а не объект: селектор обязан быть стабильным. */
export function loginAt(state: SessionState): string {
  return state.info?.login ?? '/auth/login'
}

/**
 * Тот же адрес, но с указанием, куда вернуть после входа.
 *
 * Сервер принимает `?next=` и возвращает браузер туда, проверив, что это путь
 * внутри приложения (`auth.safe_next`). Сейчас у интерфейса один адрес, и
 * `next` чаще всего окажется корнем -- но как только на экран можно будет
 * попасть по ссылке, вход перестанет терять цель сам, без второй правки.
 */
export function loginFrom(state: SessionState, here: string): string {
  const login = loginAt(state)
  if (!here || here === '/') return login
  const glue = login.includes('?') ? '&' : '?'
  return `${login}${glue}next=${encodeURIComponent(here)}`
}

/**
 * Уход на вход.
 *
 * Отдельной функцией, потому что переход -- решение интерфейса, а не браузера:
 * тест обязан проверять, что человека увели ко входу, а не ждать настоящую
 * навигацию, которой в jsdom нет.
 */
const navigate = (url: string): void => {
  // `replace`, а не `assign`: вход -- это цепочка редиректов, а не место, куда
  // можно вернуться. `assign` оставил бы в истории запись про `/auth/login`, и
  // стрелка «назад» приводила бы ровно на неё, а она запускала бы ту же цепочку
  // заново и снова выбрасывала на авторизацию. Вернуться «через» вход было
  // нельзя в принципе, сколько ни жми (#539).
  window.location.replace(url)
}

let leave = navigate
let leaving = false

/** Подменить переход. Без аргумента -- вернуть настоящий и забыть, что уводили. */
export function whenLeaving(go?: (url: string) => void): void {
  leave = go ?? navigate
  leaving = false
}

/**
 * Увести ко входу. Закрытое действие ведёт туда сразу: спрашивать «войти?»
 * окном поверх экрана значит добавить шаг там, где ответ и так один.
 *
 * Второй раз подряд никуда не уводим: отказов на одно действие приходит
 * несколько, а уход -- один.
 */
export function goToLogin(): void {
  if (leaving) return
  leaving = true
  const here = `${window.location.pathname}${window.location.search}`
  leave(loginFrom(session.store.getState(), here))
}

/** Как звать вошедшего. `null` -- никто не вошёл. */
export function whoLabel(state: SessionState): string | null {
  const user = state.info?.user
  if (!user) return null
  return user.email ?? user.name ?? user.sub
}

/** Куда уводит выход. `null` -- выходить некуда: никто не вошёл. */
export function logoutAt(state: SessionState): string | null {
  return state.info?.user ? state.info.logout ?? null : null
}
