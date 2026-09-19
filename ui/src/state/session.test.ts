import { describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '../model/session'
import {
  canChange,
  createSession,
  goToLogin,
  loginAt,
  loginFrom,
  needsLogin,
  session as singleton,
  whenLeaving,
  whoLabel,
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
  it('до ответа сервера вход не предлагается', () => {
    const { store } = controller()
    // «Ещё не спросили» -- не то же, что «не вошёл»: иначе кнопка входа мигала
    // бы на каждой загрузке страницы.
    expect(needsLogin(store.getState())).toBe(false)
  })

  it('вошедшего пускает и запоминает, кто он', async () => {
    const { session, store } = controller({ load: async () => entered() })
    await session.refresh()
    expect(needsLogin(store.getState())).toBe(false)
    expect(store.getState().info?.user?.email).toBe('user@reckue.com')
  })

  it('не вошедшему предлагает вход по адресу от сервера', async () => {
    const { session, store } = controller({ load: async () => closed() })
    await session.refresh()
    expect(needsLogin(store.getState())).toBe(true)
    expect(loginAt(store.getState())).toBe('/auth/login')
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

  it('вошедшего панель называет по почте', async () => {
    const { session, store } = controller({ load: async () => entered() })
    await session.refresh()
    // Почта, а не `sub`: человека зовут так, как он сам себя узнаёт.
    expect(whoLabel(store.getState())).toBe('user@reckue.com')
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
    expect(loginAt(store.getState())).toBe('/auth/login')
  })

  it('вход помнит, откуда увели', () => {
    const { session, store } = controller()
    session.expired()
    // Корень добавлять незачем: вход и так возвращает туда.
    expect(loginFrom(store.getState(), '/')).toBe('/auth/login')
    expect(loginFrom(store.getState(), '/patterns/ffi')).toBe(
      '/auth/login?next=%2Fpatterns%2Fffi',
    )
  })

  it('к адресу входа с параметрами next приклеивается через амперсанд', () => {
    const { session, store } = controller()
    session.expired('/auth/login?hint=1')
    expect(loginFrom(store.getState(), '/x')).toBe('/auth/login?hint=1&next=%2Fx')
  })

  it('адрес входа из тела отказа сохраняется как есть', () => {
    const { session, store } = controller()
    // Маршрут входа называет сервер. Собирать его здесь значило бы знать чужое
    // устройство наизусть и разойтись с ним при первой правке.
    session.expired('/auth/login?next=/patterns/ffi')
    expect(loginAt(store.getState())).toBe('/auth/login?next=/patterns/ffi')
  })
})

describe('закрытые действия', () => {
  it('на своей машине доступны без входа', async () => {
    const { session, store } = controller({ load: async () => open() })
    await session.refresh()
    // Вход не настроен вовсе: запирать песочницу значило бы запереть локальный
    // запуск, у которого рубеж -- недосягаемость 127.0.0.1.
    expect(canChange(store.getState())).toBe(true)
  })

  it('на стенде без входа недоступны', async () => {
    const { session, store } = controller({ load: async () => closed() })
    await session.refresh()
    expect(canChange(store.getState())).toBe(false)
  })

  it('вошедшему доступны', async () => {
    const { session, store } = controller({ load: async () => entered() })
    await session.refresh()
    expect(canChange(store.getState())).toBe(true)
  })

  it('до ответа сервера отказ не обещается', () => {
    const { store } = controller()
    // Ответ приходит сразу за первым кадром, и запирать на это время песочницу
    // значило бы мигать «нужен вход» при каждом локальном запуске. Настоящий
    // отказ придёт от сервера и объяснит себя на месте.
    expect(canChange(store.getState())).toBe(true)
  })

  it('истёкшая сессия закрывает их снова', async () => {
    const { session, store } = controller({ load: async () => entered() })
    await session.refresh()
    session.expired()
    expect(canChange(store.getState())).toBe(false)
  })
})

describe('уход на вход', () => {
  it('ведёт по адресу, который назвал сервер', () => {
    const went: string[] = []
    whenLeaving((url) => went.push(url))
    try {
      singleton.expired('/auth/login?next=/patterns/ffi')
      goToLogin()
      // Переход, а не окно с вопросом: ответ на «войти?» тут и так один, а шаг
      // перед тем же переходом лишний.
      expect(went).toEqual(['/auth/login?next=/patterns/ffi'])
    } finally {
      whenLeaving()
    }
  })

  it('уводит один раз, сколько бы отказов ни пришло', () => {
    const went: string[] = []
    whenLeaving((url) => went.push(url))
    try {
      // На одно действие сервер успевает отказать не раз: проект, список,
      // опрос симуляции. Уход при этом один -- второй перебил бы первый.
      goToLogin()
      goToLogin()
      expect(went).toHaveLength(1)
    } finally {
      whenLeaving()
    }
  })
})
