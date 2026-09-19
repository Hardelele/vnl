/**
 * Оболочка целиком: что видит человек, который не входил.
 *
 * Здесь настоящий React и настоящий разбор ответов -- иначе главную поломку не
 * поймать. Она была не в отдельной функции, а в том, чем становился экран: на
 * любой 401 приложение подменялось экраном входа, и библиотеку, ради которой
 * стенд показывают, не видел никто. Проверка «вернула ли функция true» такое
 * пропустила бы.
 *
 * Сервер подменён на карту адресов: тест задаёт, какой маршрут открыт, а какой
 * отвечает 401, и смотрит, что вышло на экране. Переход ко входу тоже подменён:
 * настоящей навигации в jsdom нет, а проверять надо именно её -- закрытое
 * действие обязано уводить на вход, а не открывать окно с вопросом.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type { Catalog } from './model/types'
import { catalogController } from './state/catalog'
import { session, whenLeaving } from './state/session'
import { simController } from './state/sim'

const CATALOG: Catalog = {
  schema: 1,
  query: { text: '', levels: [], statuses: [] },
  total: 1,
  matched: 1,
  levels: [{ id: 'L1', name: 'Взаимодействие сигналов', count: 1 }],
  statuses: [{ id: 'ready', name: 'Готов', count: 1 }],
  patterns: [
    {
      id: 'ffi',
      name: 'Feed-forward inhibition',
      level: 'L1',
      levelName: 'Взаимодействие сигналов',
      status: 'ready',
      statusName: 'Готов',
      ports: [],
      counts: { neurons: 3, contacts: 2, ports: 0 },
      scheme: { neurons: [], edges: [] },
      demo: null,
      problems: [],
      createdAt: '',
      updatedAt: '',
    },
  ],
}

const ANONYMOUS = { user: null, login: '/auth/login', logout: null, required: true }
const NO_LOGIN = { user: null, login: null, required: false }

/** Сервер: первый подошедший образец адреса отвечает, остальное -- 404. */
function serve(routes: Array<[string, unknown, number?]>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url)
      for (const [mask, body, status] of routes) {
        if (path.startsWith(mask)) {
          return new Response(JSON.stringify(body), {
            status: status ?? 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
      return new Response(JSON.stringify({ error: `нет маршрута ${path}` }), { status: 404 })
    }),
  )
}

let root: Root | null = null
let host: HTMLElement
/** Куда увели человека. Пусто -- никуда не уводили. */
let went: string[]

async function mount(): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<App />)
  })
  return host
}

/** Щелчок мышью по элементу с такой подписью. */
async function click(label: string): Promise<void> {
  const target = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === label,
  )
  if (!target) throw new Error(`на экране нет кнопки «${label}»`)
  await act(async () => {
    target.click()
  })
}

/** Открыть меню учётной записи: щелчок по значку с именем. */
async function openUserMenu(): Promise<void> {
  const face = host.querySelector('.who-face') as HTMLElement | null
  if (!face) throw new Error('в панели нет кто-вошёл')
  await act(async () => {
    face.click()
  })
}

function loginLinks(): HTMLAnchorElement[] {
  return [...host.querySelectorAll('a')].filter(
    (link) => link.textContent?.trim().startsWith('Войти'),
  )
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  went = []
  whenLeaving((url) => went.push(url))
  // Сторы живут на модуль, а не на тест: без сброса следующий тест начинался бы
  // с чужого ответа сервера.
  session.store.setState({ info: null, loading: false, offline: false })
  catalogController.store.setState({
    catalog: null,
    text: '',
    levels: [],
    statuses: [],
    error: null,
    offline: false,
    denied: false,
    loading: false,
  })
  simController.store.setState({ id: null, error: null, denied: false, built: null })
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  host.remove()
  whenLeaving()
  vi.unstubAllGlobals()
})

describe('библиотека без входа', () => {
  it('не вошедший попадает в каталог, а не на экран входа', async () => {
    serve([
      ['/api/session', ANONYMOUS],
      ['/api/catalog', CATALOG],
    ])

    const screen = await mount()

    // Каталог -- витрина: она показывается всем, и её видно с первого кадра.
    expect(screen.textContent).toContain('Feed-forward inhibition')
    expect(screen.querySelector('.lib')).not.toBeNull()
  })

  it('не вошедшему не предлагают того, чего он не просил', async () => {
    serve([
      ['/api/session', ANONYMOUS],
      ['/api/catalog', CATALOG],
    ])

    const screen = await mount()

    // «Добавить» без сессии нажимать некуда, а кнопка, которая вместо своей
    // работы ведёт на вход, обещает не то, что делает.
    expect(screen.textContent).not.toContain('Добавить')
    // И правило вслух не объявляется: вход есть в панели, этого довольно.
    expect(screen.textContent).not.toContain('после входа')
  })

  it('вход предлагается кнопкой в панели, пока никто не вошёл', async () => {
    serve([
      ['/api/session', ANONYMOUS],
      ['/api/catalog', CATALOG],
    ])

    await mount()

    // Адрес входа берётся из ответа сервера: своих маршрутов интерфейс не знает.
    expect(loginLinks().map((link) => link.getAttribute('href'))).toContain('/auth/login')
  })

  it('при ненастроенном входе кнопки входа нет', async () => {
    serve([
      ['/api/session', NO_LOGIN],
      ['/api/catalog', CATALOG],
    ])

    await mount()

    // `required: false` -- вход на этом сервере не настроен, и кнопка обещала бы
    // несуществующее: на своей машине рубеж это недосягаемость 127.0.0.1.
    expect(loginLinks()).toHaveLength(0)
    expect(host.textContent).toContain('Feed-forward inhibition')
  })

  it('вошедшего панель называет по почте, а выход лежит в его меню', async () => {
    serve([
      [
        '/api/session',
        {
          user: { sub: 'u1', email: 'user@reckue.com', name: 'Пользователь' },
          login: '/auth/login',
          logout: '/auth/logout',
          required: true,
        },
      ],
      ['/api/catalog', CATALOG],
    ])

    await mount()

    expect(host.textContent).toContain('user@reckue.com')
    expect(loginLinks()).toHaveLength(0)
    // Выход -- действие над учётной записью, а не кнопка панели: их будет
    // больше одного, и место под них должно существовать заранее.
    expect(host.querySelector('.who-menu')).toBeNull()

    await openUserMenu()

    expect(host.querySelector('.who-item')?.getAttribute('href')).toBe('/auth/logout')
  })

  it('меню учётной записи закрывается щелчком мимо', async () => {
    // Открытое меню, которое не закрыть, -- ловушка на экране, где всё
    // остальное работает щелчком.
    serve([
      [
        '/api/session',
        {
          user: { sub: 'u1', email: 'user@reckue.com', name: null },
          login: '/auth/login',
          logout: '/auth/logout',
          required: true,
        },
      ],
      ['/api/catalog', CATALOG],
    ])

    await mount()
    await openUserMenu()
    expect(host.querySelector('.who-menu')).not.toBeNull()

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(host.querySelector('.who-menu')).toBeNull()
  })

  it('вместо идентификатора человек видит короткую строку, а не тридцать знаков', async () => {
    // Провайдер при коде авторизации кладёт в токен только `sub`. Сервер
    // спрашивает имя отдельно, но если и там пусто -- показывать целиком
    // `8161ee5a-7705-48c6-bd27-9ab3f2f51e9b` незачем: это полпанели и ноль
    // смысла. Полное значение остаётся в подсказке и в меню.
    serve([
      [
        '/api/session',
        {
          user: { sub: '8161ee5a-7705-48c6-bd27-9ab3f2f51e9b', email: null, name: null },
          login: '/auth/login',
          logout: '/auth/logout',
          required: true,
        },
      ],
      ['/api/catalog', CATALOG],
    ])

    await mount()

    const face = host.querySelector('.who-face') as HTMLElement
    expect(face.textContent).toContain('8161ee5a…')
    expect(face.textContent).not.toContain('9ab3f2f51e9b')
    expect(face.getAttribute('title')).toBe('8161ee5a-7705-48c6-bd27-9ab3f2f51e9b')
  })
})

describe('закрытое действие', () => {
  it('вкладка песочницы остаётся на виду и говорит про вход до щелчка', async () => {
    serve([
      ['/api/session', ANONYMOUS],
      ['/api/catalog', CATALOG],
    ])

    await mount()
    const tab = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Песочница',
    )

    // Недоступной кнопкой этого делать нельзя: то, что песочница есть, человек
    // должен видеть, а про вход узнать до щелчка, а не вместо результата.
    expect(tab?.disabled).toBe(false)
    expect(tab?.getAttribute('title')).toContain('вход')
  })

  it('щелчок по закрытой вкладке уводит на вход, а не открывает окно', async () => {
    serve([
      ['/api/session', ANONYMOUS],
      ['/api/catalog', CATALOG],
    ])

    await mount()
    await click('Песочница')

    expect(went).toEqual(['/auth/login'])
    // Спрашивать «войти?» окном поверх экрана незачем: ответ и так один, а шаг
    // перед тем же переходом лишний. Каталог при этом остаётся на месте.
    expect(host.textContent).toContain('Feed-forward inhibition')
  })

  it('без входа песочницу даже не спрашивают', async () => {
    serve([
      ['/api/session', ANONYMOUS],
      ['/api/catalog', CATALOG],
    ])
    await mount()
    const fetcher = globalThis.fetch as unknown as {
      mock: { calls: string[][] }
      mockClear: () => void
    }
    fetcher.mockClear()

    await click('Песочница')

    // Запрос, которому заранее откажут, не нужен никому: ни серверу, ни тому,
    // кто уже уходит на вход.
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/sandboxes'))).toBe(
      false,
    )
  })

  it('401 в ответ на нажатое уводит на вход, а не ждёт второго нажатия', async () => {
    // Сервер говорит «вход не настроен», а закрытый маршрут всё равно
    // отказывает: так выглядит сессия, кончившаяся у открытой вкладки.
    serve([
      ['/api/session', NO_LOGIN],
      ['/api/catalog', CATALOG],
      ['/api/sandboxes', { error: 'нужен вход', login: '/auth/login' }, 401],
    ])

    await mount()
    await click('Песочница')

    // Адрес пришёл в теле отказа: маршрут входа называет сервер.
    expect(went).toEqual(['/auth/login'])
  })

  it('отказ, которого никто не просил, объясняется подписью, а не уводом', async () => {
    // Каталог читается сам при открытии страницы. Уводить отсюда нельзя: человек
    // ничего не нажимал, а на старом сервере это был бы уход по кругу.
    serve([
      ['/api/session', ANONYMOUS],
      ['/api/catalog', { error: 'нужен вход через Reckue auth', login: '/auth/login' }, 401],
    ])

    await mount()

    expect(went).toEqual([])
    expect(host.textContent).toContain('нужен вход через Reckue auth')
    expect(loginLinks().map((link) => link.getAttribute('href'))).toContain('/auth/login')
  })
})
