/**
 * Карточка паттерна: выбор связи, драйв на виду и удаление.
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
import type { Contact, Glossary, PatternDetail } from '../../model/types'
import { session, whenLeaving } from '../../state/session'

/** Контакт целиком: в ответе сервера у него есть и динамика, и пластичность. */
function contact(part: Partial<Contact> & { id: string }): Contact {
  return {
    pre: { instance: 'IN', section: 'soma', fraction: 0.5 },
    post: { instance: 'E', section: 'soma', fraction: 0.5 },
    receptor: 'ampa',
    inhibitory: false,
    reversal: 0,
    tauDecay: 2,
    weight: 1,
    delay: 1,
    dynamics: { enabled: false, u: 0.5, tauRec: 0, tauFacil: 0 },
    plasticity: {
      enabled: false,
      rule: 'none',
      aPlus: 0.01,
      aMinus: 0.012,
      tauPlus: 20,
      tauMinus: 20,
      wMax: 5,
      wMin: 0,
      tauEligibility: 500,
      modulator: null,
    },
    ...part,
  }
}

/** Расшифровка подписей: та же, что отдаёт `GET /api/glossary`. */
const GLOSSARY: Glossary = {
  schema: 1,
  receptors: [
    { id: 'ampa', note: 'Быстрое возбуждение.', reversal: 0, tauDecay: 2, inhibitory: false },
    {
      id: 'gaba_a',
      note: 'Быстрое торможение.',
      reversal: -70,
      tauDecay: 6,
      inhibitory: true,
    },
  ],
  cell: {},
  contact: { receptor: 'Чем контакт действует на цель.' },
  port: { in: 'Вход.', out: 'Выход.', mod: 'Модуляция.' },
  drive: 'Чем гонят схему. От рода зависит, повторится ли картина растра.',
  drives: [
    {
      id: 'poisson',
      name: 'пуассоновский',
      note: 'Случайные моменты со средней частотой: 100 Гц -- это в среднем 10 мс.',
      receptor: true,
      template: false,
      params: [],
    },
  ],
  recorded: [
    { id: 'v', name: 'мембранный потенциал', unit: 'мВ' },
    { id: 'g_exc', name: 'возбуждающая проводимость', unit: 'нСм' },
  ],
}

/**
 * `ffi` -- тот же, что лежит в библиотеке: три клетки, тормозный контакт `c3`
 * и пуассоновский драйв в `IN.soma`. Числа настоящие, потому что проверяется
 * именно то, что человек прочтёт на витрине.
 */
const PATTERN: PatternDetail = {
  id: 'ffi',
  name: 'Feed-forward inhibition',
  level: 'L1',
  levelName: 'Взаимодействие сигналов',
  status: 'ready',
  statusName: 'Готов',
  ports: [],
  counts: { neurons: 3, contacts: 3, ports: 0 },
  scheme: {
    neurons: [
      { id: 'IN', inhibitory: false },
      { id: 'E', inhibitory: false },
      { id: 'I', inhibitory: true },
    ],
    edges: [
      { id: 'c1', from: 'IN', to: 'E', kind: 'exc' },
      { id: 'c2', from: 'IN', to: 'I', kind: 'exc' },
      { id: 'c3', from: 'I', to: 'E', kind: 'inh' },
    ],
  },
  demo: {
    stimuli: [
      {
        id: 'drive',
        target: { instance: 'IN', section: 'soma', fraction: 0.5 },
        kind: 'poisson',
        receptor: 'ampa',
        amplitude: 1.5,
        rate: 250,
        times: [],
        protocol: 'пуассоновский, в среднем 250 Гц',
        start: 20,
        stop: 380,
      },
    ],
    recordings: [
      {
        id: 'r4',
        target: { instance: 'E', section: 'soma', fraction: 0.5 },
        var: 'g_exc',
        key: 'E.soma:g_exc',
      },
    ],
    run: { dt: 0.1, duration: 400, level: 'L1', seed: 7 },
  },
  problems: [],
  createdAt: '',
  updatedAt: '',
  body: {
    name: 'ffi',
    source: '',
    run: { dt: 0.1, duration: 400, level: 'L1', seed: 7 },
    cellTypes: {},
    neurons: [
      { id: 'IN', cellType: 'relay', tags: [], inhibitory: false },
      { id: 'E', cellType: 'pyr_l5', tags: [], inhibitory: false },
      { id: 'I', cellType: 'pv', tags: [], inhibitory: true },
    ],
    contacts: [
      contact({
        id: 'c1',
        post: { instance: 'E', section: 'dend.apical[1]', fraction: 0.6 },
        weight: 3,
      }),
      contact({
        id: 'c2',
        post: { instance: 'I', section: 'soma', fraction: 0.5 },
        weight: 1.5,
      }),
      contact({
        id: 'c3',
        pre: { instance: 'I', section: 'soma', fraction: 0.5 },
        receptor: 'gaba_a',
        inhibitory: true,
        reversal: -70,
        tauDecay: 6,
        weight: 0.9,
        delay: 1.4,
      }),
    ],
    modulators: [],
    stimuli: [],
    recordings: [],
  },
}

/**
 * `short_term_depression`: драйв -- пачка из восьми спайков, а контакт с
 * кратковременной динамикой. Ни того, ни другого по схеме не видно.
 */
const BURST: PatternDetail = {
  ...PATTERN,
  id: 'short_term_depression',
  name: 'Short-term depression',
  demo: {
    stimuli: [
      {
        id: 'burst',
        target: { instance: 'IN', section: 'soma', fraction: 0.5 },
        kind: 'spikes',
        receptor: 'ampa',
        amplitude: 3,
        rate: 0,
        times: [50, 70, 90, 110, 130, 150, 170, 190],
        protocol: 'список, 8 импульсов',
        start: 0,
        stop: 300,
      },
    ],
    recordings: [],
    run: { dt: 0.1, duration: 300, level: 'L1', seed: 1 },
  },
  body: {
    ...PATTERN.body,
    contacts: [
      contact({
        id: 'c1',
        post: { instance: 'DEP', section: 'soma', fraction: 0.5 },
        weight: 1.2,
        dynamics: { enabled: true, u: 0.6, tauRec: 400, tauFacil: 0 },
      }),
    ],
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
/** Какой паттерн отдаёт сервер: `ffi` или пачка. */
let served: PatternDetail

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
      if (path.startsWith('/api/glossary')) return json(GLOSSARY)
      if (path.startsWith('/api/patterns/')) return json(served)
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
/** Сколько раз паттерн унесли в песочницу. Экраны переключает оболочка. */
let carried: number
/** Куда увели человека. Пусто -- никуда не уводили. */
let went: string[]

async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  back = 0
  carried = 0
  await act(async () => {
    root!.render(
      <PatternScreen
        id="ffi"
        onBack={() => (back += 1)}
        onToSandbox={() => (carried += 1)}
      />,
    )
  })
}

function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined
}

/** Строка связи по её адресу: «I ⊣ E.soma». */
function linkRow(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button.row')].find((node) =>
    node.querySelector('.row-path')?.textContent?.includes(text),
  )
  if (!found) throw new Error(`нет строки связи «${text}»`)
  return found as HTMLButtonElement
}

/** Панель выбранного: инспектор клетки или связи -- она в колонке одна. */
function panel(): string {
  return host.querySelector('.insp')?.textContent ?? ''
}

/** Текст панели с таким заголовком: «Драйв», «Записи», «Связи». */
function section(title: string): string {
  const found = [...host.querySelectorAll('.panel')].find(
    (node) => node.querySelector('.panel-title')?.textContent === title,
  )
  if (!found) throw new Error(`нет панели «${title}»`)
  return found.textContent ?? ''
}

async function press(node: Element): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
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
  served = PATTERN
  went = []
  whenLeaving((url) => went.push(url))
  serve()
})

afterEach(() => {
  act(() => root?.unmount())
  host.remove()
  root = null
  whenLeaving()
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

describe('дорога в песочницу (#526)', () => {
  it('кнопка настоящая: она уносит паттерн, а не стоит погашенной', async () => {
    // Раньше «В песочницу» стояла `disabled` с подписью «появится вместе с
    // песочницей», а песочница давно была. Проверяется именно действие:
    // кнопка, которую видно и которая ничего не делает, -- та же ложь.
    session.store.setState({ info: SIGNED_IN })
    await mount()

    const go = button('В песочницу')
    expect(go?.disabled).toBe(false)

    await click('В песочницу')

    expect(carried).toBe(1)
    expect(went).toEqual([])
  })

  it('без входа кнопка на виду и уводит ко входу, а не молчит', async () => {
    // Не прячется, как «Удалить»: та меняет библиотеку, а эта ведёт в место, и
    // спрятать её значило бы скрыть, что песочница есть. Ответ на «войти?»
    // один, поэтому окна с вопросом здесь нет -- сразу переход (#518).
    session.store.setState({ info: ANONYMOUS })
    await mount()

    expect(button('В песочницу')?.getAttribute('title')).toContain('вход')

    await click('В песочницу')

    expect(went).toEqual(['/auth/login'])
    expect(carried).toBe(0)
  })

  it('кнопки «Fork» нет и не будет', async () => {
    // Форк значил «правимая копия паттерна», но править тело негде: редактора
    // схем, кроме песочницы, нет. После #531 и #532 всё это делает та же
    // дорога -- блок, правка контактов в снимке, «Разобрать на клетки»,
    // «Сохранить как паттерн». Отдельная кнопка дала бы запись, отличную от
    // оригинала только именем.
    session.store.setState({ info: SIGNED_IN })
    await mount()

    expect(button('Fork')).toBeUndefined()
  })
})

describe('связь выбирается и показана целиком', () => {
  it('щелчок по строке связи показывает рецептор, вес и задержку', async () => {
    // Раньше строка была `div`: три числа в ней стояли, рецептора не было
    // вовсе, а щёлкнуть по ней было нельзя -- при том, что строка клетки
    // рядом, в той же колонке, выбиралась.
    session.store.setState({ info: ANONYMOUS })
    await mount()

    await press(linkRow('I ⊣ E.soma'))

    const said = panel()
    expect(said).toContain('gaba_a')
    expect(said).toContain('0.9 нСм')
    expect(said).toContain('1.4 мс')
    expect(said).toContain('I.soma ⊣ E.soma')
  })

  it('щелчок по связи на схеме выделяет ту же строку', async () => {
    // Одно выделение на экран: схема и список показывают выбранным одно и то
    // же, иначе «выбрано» значило бы разное в двух местах одной карточки.
    session.store.setState({ info: ANONYMOUS })
    await mount()

    // Тормозная связь на схеме -- та же `c3`, что и в строке: ELK в jsdom не
    // грузится, рисуется встроенная расстановка, и связи на месте.
    const edge = host.querySelector('.scheme-link.is-inh')
    expect(edge).not.toBeNull()
    await press(edge!)

    expect(linkRow('I ⊣ E.soma').classList.contains('is-on')).toBe(true)
    expect(host.querySelector('.scheme-link.is-inh')?.classList.contains('is-on')).toBe(
      true,
    )
    expect(panel()).toContain('gaba_a')
  })

  it('адрес показан с участком и долей, если это не середина сомы', async () => {
    session.store.setState({ info: ANONYMOUS })
    await mount()

    await press(linkRow('dend.apical[1]@0.6'))

    expect(panel()).toContain('IN.soma → E.dend.apical[1]@0.6')
  })

  it('рецептор объясняется строкой из общего словаря', async () => {
    session.store.setState({ info: ANONYMOUS })
    await mount()

    const hint = linkRow('I ⊣ E.soma').querySelector('[title]')?.getAttribute('title')
    expect(hint).toContain('Быстрое торможение')
    // Числа -- из полей ответа, а не пересказаны словами.
    expect(hint).toContain('-70 мВ')
  })

  it('связь и клетка не бывают выбраны сразу вдвоём', async () => {
    session.store.setState({ info: ANONYMOUS })
    await mount()

    await press(linkRow('I ⊣ E.soma'))
    expect(panel()).toContain('Связь')
    expect(panel()).not.toContain('Клетка')
  })

  it('динамика контакта названа там, где она есть', async () => {
    // Без неё `short_term_depression` на витрине неотличим от обычной цепочки:
    // адрес, вес и задержка у них совпадают.
    served = BURST
    session.store.setState({ info: ANONYMOUS })
    await mount()

    await press(linkRow('IN → DEP.soma'))

    expect(panel()).toContain('спайк тратит 60% запаса')
    expect(panel()).toContain('восстановление 400 мс')
  })
})

describe('драйв и записи видны', () => {
  it('шум рассказан числами и окном, а не полями JSON', async () => {
    session.store.setState({ info: ANONYMOUS })
    await mount()

    const said = section('Драйв')
    expect(said).toContain('IN.soma')
    // Слова протокола приходят с сервера: он один знает, что у пуассоновского
    // драйва частота средняя, а не метрономная (#553).
    expect(said).toContain('пуассоновский, в среднем 250 Гц, вес 1.5 нСм')
    expect(said).toContain('с 20 по 380 мс')
  })

  it('спайковый драйв -- список моментов, а не шум', async () => {
    served = BURST
    session.store.setState({ info: ANONYMOUS })
    await mount()

    const said = section('Драйв')
    expect(said).toContain('список, 8 импульсов, вес 3 нСм')
    expect(said).toContain('8 моментов: 50, 70, 90, 110, 130, 150, 170, 190 мс')
    expect(said).not.toContain('Гц')
    // Окно во весь прогон -- не окно: `stop` у такого стимула обрезан по
    // длительности, и «по 300 мс» выдало бы обрезку за решение автора.
    expect(said).not.toContain('по 300 мс')
  })

  it('род драйва объяснён наведением, как рецептор рядом (#553)', async () => {
    // «Пуассоновский» -- такой же шифр, как `gaba_a`, и цена непонимания у
    // него выше: от рода зависит, повторится картина или нет.
    session.store.setState({ info: ANONYMOUS })
    await mount()

    const drive = [...host.querySelectorAll('.pat-fact-head span')].find((node) =>
      node.textContent?.startsWith('пуассоновский'),
    ) as HTMLElement
    expect(drive.title).toContain('Случайные моменты со средней частотой')
  })

  it('запись названа словом из словаря, а не ключом трассы', async () => {
    session.store.setState({ info: ANONYMOUS })
    await mount()

    expect(section('Записи')).toContain('возбуждающая проводимость, нСм')
    expect(section('Записи')).toContain('E.soma')
  })
})
