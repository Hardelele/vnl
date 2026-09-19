import { describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '../model/session'
import {
  createSession,
  needsLogin,
  type SessionPorts,
  type SessionState,
} from './session'
import { createStore } from './store'

function entered(): SessionInfo {
  return {
    user: { sub: 'user-1', email: 'user@reckue.com', name: 'Пользователь' },
    login: '/auth/login',
    logout: '/auth/logout',
    required: true,
  }
}

function closed(): SessionInfo {
  return { user: null, login: '/auth/login', logout: '/auth/logout', required: true }
}

function open(): SessionInfo {
  return { user: null, login: null, required: false }
}

function controller(ports: Partial<SessionPorts> = {}) {
  // Тип указан явно: без него `info: null` вывелось бы как `never`, и тест
  // не смог бы прочитать поля пришедшего ответа.
  const store = createStore<SessionState>({ info: null, loading: false, offline: false })
  const load = ports.load ?? vi.fn(async () => closed())
  return { session: createSession({ load }, store), store, load }
}

describe('состояние входа', () => {
  it('до ответа сервера экран входа не показывается', () => {
    const { store } = controller()
    // «Ещё не спросили» -- не то же, что «не вошёл»: иначе экран входа мигал бы
    // на каждой загрузке страницы.
    expect(needsLogin(store.getState())).toBe(false)
  })

  it('вошедшего пускает и запоминает, кто он', async () => {
    const { session, store } = controller({ load: async () => entered() })
    await session.refresh()
    expect(needsLogin(store.getState())).toBe(false)
    expect(store.getState().info?.user?.email).toBe('user@reckue.com')
  })

  it('не вошедшему показывает экран входа с адресом входа', async () => {
    const { session, store } = controller({ load: async () => closed() })
    await session.refresh()
    expect(needsLogin(store.getState())).toBe(true)
    expect(store.getState().info?.login).toBe('/auth/login')
  })

  it('на своей машине вход не требуется', async () => {
    const { session, store } = controller({ load: async () => open() })
    await session.refresh()
    // Ненастроенный вход не должен закрывать локальный запуск.
    expect(needsLogin(store.getState())).toBe(false)
    expect(store.getState().info?.login).toBeNull()
  })

  it('молчащий сервер -- это не «не вошёл»', async () => {
    const { session, store } = controller({
      load: async () => {
        throw new Error('сеть')
      },
    })
    await session.refresh()
    // Входить некуда, и кнопка входа обещала бы несуществующее.
    expect(store.getState().offline).toBe(true)
    expect(needsLogin(store.getState())).toBe(false)
  })

  it('401 закрывает стенд, не спрашивая сервер заново', async () => {
    const load = vi.fn(async () => entered())
    const { session, store } = controller({ load })
    await session.refresh()
    expect(needsLogin(store.getState())).toBe(false)

    session.expired()

    expect(needsLogin(store.getState())).toBe(true)
    // Адрес входа сохраняется из прошлого ответа: он не меняется.
    expect(store.getState().info?.login).toBe('/auth/login')
    // Лишнего запроса нет -- иначе истёкшая сессия дала бы шквал обращений.
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('401 до первого ответа сервера тоже закрывает стенд', () => {
    const { session, store } = controller()
    session.expired()
    expect(needsLogin(store.getState())).toBe(true)
    expect(store.getState().info?.login).toBe('/auth/login')
  })
})
