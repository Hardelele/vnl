/**
 * Карточка паттерна: удаление и то, чего на ней больше нет.
 *
 * Здесь настоящий React и настоящий разбор ответов, потому что проверяется
 * именно то, что видно на экране: есть ли кнопка, спрашивает ли она, уходит ли
 * карточка после удаления. Проверкой «функция позвала fetch» такое не поймать --
 * прежние «Fork» и «В песочницу» тоже вызывались, только ничего не делали.
 *
 * Раскладку схемы считает ELK, и в jsdom он не грузится. Это не мешает: пока
 * его нет, рисуется встроенная расстановка.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PatternScreen } from './PatternScreen'
import type { SessionInfo } from '../../model/session'
import type { PatternDetail } from '../../model/types'
import { session } from '../../state/session'

const PATTERN: PatternDetail = {
  id: 'ffi',
  name: 'Feed-forward inhibition',
  level: 'L1',
  levelName: 'Взаимодействие сигналов',
  status: 'ready',
  statusName: 'Готов',
  ports: [],
  counts: { neurons: 1, contacts: 0, ports: 0 },
  scheme: { neurons: [{ id: 'IN', inhibitory: false }], edges: [] },
  demo: null,
  problems: [],
  createdAt: '',
  updatedAt: '',
  body: {
    name: 'ffi',
    source: '',
    run: { dt: 0.1, duration: 400, level: 'L1', seed: 7 },
    cellTypes: {},
    neurons: [{ id: 'IN', cellType: 'relay', tags: [], inhibitory: false }],
    contacts: [],
    modulators: [],
    stimuli: [],
    recordings: [],
  },
}

/** Кто вошёл. Кнопка удаления -- свойство сессии, а не экрана. */
const SIGNED_IN: SessionInfo = {
  user: { sub: 'u1', email: null, name: 'Кто-то' },
  login: null,
  logout: '/auth/logout',
  required: true,
}
const ANONYMOUS: SessionInfo = {
  user: null,
  login: '/auth/login',
  logout: null,
  required: true,
}

/** Что записали в хранилище: путь и метод каждого запроса. */
let calls: Array<[string, string]>
let deleteReply: { body: unknown; status: number }

function serve(): void {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      const method = init?.method ?? 'GET'
      calls.push([path, method])
      if (method === 'DELETE' && path.startsWith('/api/patterns/')) {
        return json(deleteReply.body, deleteReply.status)
      }
      if (path.startsWith('/api/patterns/')) return json(PATTERN)
      // Симуляция карточки: пустая сессия на паузе -- её тут не проверяют.
      if (path.startsWith('/api/sim')) {
        return json({
          id: 'sim1',
          state: 'paused',
          time: 0,
          duration: 400,
          dt: 0.1,
          from: 0,
          samples: 0,
          rewound: false,
          source: 'паттерн',
          cells: {},
          spikes: {},
          traces: {},
        })
      }
      return json({ error: `нет маршрута ${path}` }, 404)
    }),
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let root: Root | null = null
let host: HTMLElement
let back: number

async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  back = 0
  await act(async () => {
    root!.render(<PatternScreen id="ffi" onBack={() => (back += 1)} />)
  })
}

function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined
}

async function click(label: string): Promise<void> {
  const found = button(label)
  if (!found) throw new Error(`нет кнопки «${label}»`)
  await act(async () => {
    found.click()
  })
}

beforeEach(() => {
  deleteReply = { body: { deleted: 'ffi' }, status: 200 }
  serve()
})

afterEach(() => {
  act(() => root?.unmount())
  host.remove()
  root = null
  vi.unstubAllGlobals()
})

describe('удаление паттерна', () => {
  it('спрашивает до удаления: действие необратимо', async () => {
    session.store.setState({ info: SIGNED_IN })
    await mount()

    await click('Удалить')

    // Первое нажатие ничего не удаляет -- оно задаёт вопрос.
    expect(calls.some(([, method]) => method === 'DELETE')).toBe(false)
    expect(host.textContent).toContain('насовсем')
  })

  it('отмена оставляет паттерн на месте', async () => {
    session.store.setState({ info: SIGNED_IN })
    await mount()

    await click('Удалить')
    await click('Отмена')

    expect(calls.some(([, method]) => method === 'DELETE')).toBe(false)
    expect(host.textContent).not.toContain('насовсем')
  })

  it('после подтверждения паттерн удаляется и карточка закрывается', async () => {
    session.store.setState({ info: SIGNED_IN })
    await mount()

    await click('Удалить')
    await click('Удалить')

    expect(calls).toContainEqual(['/api/patterns/ffi', 'DELETE'])
    // Возвращаться некуда: паттерна больше нет, а экран удалённого врёт.
    expect(back).toBe(1)
  })

  it('«такого нет» объясняется словами сервера, а карточка остаётся', async () => {
    deleteReply = { body: { error: "паттерна 'ffi' нет в библиотеке" }, status: 404 }
    session.store.setState({ info: SIGNED_IN })
    await mount()

    await click('Удалить')
    await click('Удалить')

    expect(back).toBe(0)
    expect(host.textContent).toContain('нет в библиотеке')
  })

  it('без входа кнопки нет вовсе', async () => {
    // Кнопка, которая вместо своей работы предлагает войти, -- разговор о том,
    // чего человек не просил: вход есть в панели.
    session.store.setState({ info: ANONYMOUS })
    await mount()

    expect(button('Удалить')).toBeUndefined()
  })
})

describe('чего на карточке больше нет', () => {
  it('погашенных «Fork» и «В песочницу» не осталось', async () => {
    // Они стояли `disabled` с подписью «появится вместе с песочницей», а
    // песочница давно есть. Кнопка, которая никогда не нажимается, врёт про
    // возможности (#525); дорога в песочницу идёт через её же панель.
    session.store.setState({ info: SIGNED_IN })
    await mount()

    expect(button('Fork')).toBeUndefined()
    expect(button('В песочницу')).toBeUndefined()
  })
})
