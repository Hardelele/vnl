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
import type { SandboxState } from './model/sandbox'
import type { Catalog, Pattern, PatternDetail } from './model/types'
import { catalogController } from './state/catalog'
import { sandboxController } from './state/sandbox'
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

/** Что спросили у сервера: путь, метод и разобранное тело запроса. */
let asked: Array<{ path: string; method: string; body: Record<string, unknown> }>

/** Сервер: первый подошедший образец адреса отвечает, остальное -- 404. */
function serve(routes: Array<[string, unknown, number?]>): void {
  asked = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url)
      asked.push({
        path,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : {},
      })
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

/** Щелчок по вкладке левой панели песочницы: «Клетки», «Библиотека», «Объекты».
 *
 * Отдельно от `click`: подпись «Библиотека» есть и на вкладке оболочки сверху,
 * и на вкладке панели слева, и поиск по тексту нашёл бы первую -- то есть увёл
 * бы с экрана песочницы вместо того, чтобы открыть в ней список паттернов.
 */
async function pickTab(label: string): Promise<void> {
  const target = [...host.querySelectorAll('.lib-tab')].find(
    (button) => button.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined
  if (!target) throw new Error(`в панели нет вкладки «${label}»`)
  await act(async () => {
    target.click()
  })
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
  sandboxController.store.setState({ list: [], project: null, error: null, denied: false })
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

/**
 * С карточки паттерна в песочницу (#526).
 *
 * Проверяется дорога целиком -- каталог, карточка, песочница, -- потому что
 * ломается она именно между экранами: кнопка на карточке была, вызов у
 * песочницы был, а пути от одного к другому не было. Тест на отдельный
 * обработчик такое пропустил бы.
 */
describe('дорога с карточки в песочницу (#526)', () => {
  const SIGNED_IN = {
    user: { sub: 'u1', email: 'user@reckue.com', name: null },
    login: '/auth/login',
    logout: '/auth/logout',
    required: true,
  }

  const DETAIL: PatternDetail = {
    // Та же запись, что в каталоге: карточка открывается по щелчку по ней.
    ...(CATALOG.patterns[0] as Pattern),
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
      recordings: [],
      run: { dt: 0.1, duration: 400, level: 'L1', seed: 7 },
    },
    body: {
      name: 'ffi',
      source: '',
      run: { dt: 0.1, duration: 400, level: 'L1', seed: 7 },
      cellTypes: {},
      neurons: [],
      contacts: [],
      modulators: [],
      stimuli: [],
      sensors: [],
      motors: [],
      recordings: [],
    },
  }

  function sandbox(patch: Partial<SandboxState> = {}): SandboxState {
    return {
      schema: 1,
      id: 's1',
      name: 'Проба',
      blocks: [],
      neurons: [],
      cellTypes: [],
      links: [],
      stimuli: [],
      sensors: [],
      motors: [],
      recordings: [],
      run: { dt: 0.1, duration: 500, level: 'L1', seed: 1 },
      dirty: false,
      canUndo: false,
      problems: [],
      warnings: [],
      portHints: [],
      fingerprint: 'abc',
      updatedAt: '',
      ...patch,
    }
  }

  /** Проект после перехода: блок стоит, драйв и записи витрины приехали с ним. */
  const FILLED = sandbox({
    blocks: [
      {
        id: 'ffi',
        patternId: 'ffi',
        label: 'Feed-forward inhibition',
        position: [60, 60],
        ports: [],
        counts: { neurons: 3, contacts: 3 },
        scheme: { neurons: [], edges: [] },
        cells: [],
        contacts: [],
      },
    ],
    stimuli: [
      {
        id: 'ffi.drive',
        target: { instance: 'ffi/IN', port: null, section: 'soma', fraction: 0.5 },
        kind: 'poisson',
        receptor: 'ampa',
        rate: 250,
        amplitude: 1.5,
        times: [],
        start: 20,
        stop: 380,
        protocol: 'пуассоновский, в среднем 250 Гц',
        n: 0,
        freq: 0,
        isi: 0,
        duration: 0,
        bursts: 0,
        burst_period: 0,
        repeats: 1,
        period: 0,
        recovery: 0,
      },
    ],
    recordings: [
      {
        id: 'ffi.r1',
        target: { instance: 'ffi/IN', port: null, section: 'soma', fraction: 0.5 },
        var: 'v',
      },
    ],
    run: { dt: 0.1, duration: 400, level: 'L1', seed: 7 },
    dirty: true,
    canUndo: true,
  })

  function served(): void {
    // Порядок важен: образцы примеряются по очереди, и `/api/sandboxes`
    // перехватил бы вложенные адреса.
    serve([
      ['/api/session', SIGNED_IN],
      ['/api/catalog', CATALOG],
      ['/api/patterns/ffi', DETAIL],
      [
        '/api/glossary',
        {
          schema: 1,
          receptors: [],
          point: [],
          contact: [],
          port: [],
          drive: 'Чем гонят схему.',
          // Что такое драйв вообще -- этим текстом подписана легенда над
          // холстом (#502): без него знак на схеме прочитать нечем.
          stimulus: 'Внешний вход схемы: в паттернах его нет, добавляют сами.',
          recording: 'Щуп на точке схемы: на сеть не влияет.',
          drives: [
            {
              id: 'poisson',
              name: 'пуассоновский',
              note: 'Случайные моменты со средней частотой.',
              receptor: true,
              template: false,
              params: [],
            },
          ],
        },
      ],
      ['/api/cells', { schema: 1, cells: [] }],
      ['/api/sim', { error: 'считать нечего' }, 400],
      ['/api/sandboxes/s1/blocks', FILLED],
      ['/api/sandboxes/s1', sandbox()],
      [
        '/api/sandboxes',
        { schema: 1, sandboxes: [{ id: 's1', name: 'Проба', blocks: 0, links: 0, updatedAt: '' }] },
      ],
    ])
  }

  /** Открыть карточку паттерна: щелчок по плитке каталога. */
  async function openCard(): Promise<void> {
    const card = host.querySelector('button.card') as HTMLButtonElement | null
    if (!card) throw new Error('в каталоге нет плитки паттерна')
    await act(async () => {
      card.click()
    })
  }

  it('паттерн ложится в выбранный проект вместе с витриной карточки', async () => {
    served()
    await mount()
    await openCard()
    await click('В песочницу')

    // Проект за человека не выбирается: экран показывает список и говорит,
    // куда ляжет блок. Молча завести новый значило бы насорить в чужом списке.
    expect(host.textContent).toContain('ляжет в тот проект, который вы откроете')
    expect(asked.some((call) => call.path.endsWith('/blocks'))).toBe(false)

    const row = host.querySelector('button.sb-project') as HTMLButtonElement
    await act(async () => {
      row.click()
    })

    const insert = asked.find((call) => call.path.endsWith('/blocks'))
    expect(insert?.method).toBe('POST')
    // Витрина едет только этой дорогой и только по явному действию человека.
    expect(insert?.body).toMatchObject({ pattern: 'ffi', demo: true })
    // И про это сказано словами: драйв лежит на вкладке «Объекты», куда
    // человек в этот момент ещё не смотрел.
    expect(host.textContent).toContain('вместе с витриной карточки')
    expect(host.textContent).toContain('зерно 7')
  })

  it('в дереве объектов у стимула написан род, а не только адрес (#553)', async () => {
    // Вопрос «почему спайки ложатся пачками» задают, глядя на растр, и ответ
    // обязан быть на том же экране: иначе род драйва виден только тому, кто
    // догадался щёлкнуть по стимулу.
    served()
    await mount()
    await openCard()
    await click('В песочницу')
    const row = host.querySelector('button.sb-project') as HTMLButtonElement
    await act(async () => {
      row.click()
    })

    const drive = [...host.querySelectorAll('.sb-row')].find((node) =>
      node.textContent?.includes('ffi.drive'),
    ) as HTMLElement
    expect(drive.textContent).toContain('пуассоновский, в среднем 250 Гц')
    expect(drive.title).toContain('Случайные моменты')
  })

  it('над холстом стоит легенда знаков и объяснение драйва (#502)', async () => {
    // Схема говорит цветом и формой, и расшифровки у них не было нигде:
    // красная линия с плашкой значит «торможение» только для того, кто это
    // уже знает. А слово «драйв» не было раскрыто вовсе -- при том, что это
    // единственная вещь, от которой собранная сеть оживает.
    served()
    await mount()
    await click('Песочница')
    const row = host.querySelector('button.sb-project') as HTMLButtonElement
    await act(async () => {
      row.click()
    })

    const legend = [...host.querySelectorAll('.sb-legend-item')].map(
      (node) => node.textContent,
    )
    expect(legend).toEqual([
      'возбуждение',
      'торможение',
      'модуляция',
      'драйв',
      'запись',
    ])
    // Текст приходит с сервера тем же словарём, что все прочие объяснения:
    // на тот же вопрос отвечает подсказка самого знака, и два ответа на него
    // разошлись бы.
    expect(host.querySelector('.sb-legend-note')?.textContent).toContain(
      'в паттернах его нет',
    )
  })

  it('из песочницы карточка открывается щелчком по строке библиотеки (#566)', async () => {
    // Обратная дорога уже была, а этой не было: строка панели не вела никуда,
    // и посмотреть, что за паттерн вставляешь, было нельзя.
    served()
    await mount()
    await click('Песочница')
    const row = host.querySelector('button.sb-project') as HTMLButtonElement
    await act(async () => {
      row.click()
    })
    await pickTab('Библиотека')

    const lib = host.querySelector('button.sb-lib-open') as HTMLButtonElement
    expect(lib).not.toBe(null)
    await act(async () => {
      lib.click()
    })

    // Карточка открыта, и первая крошка ведёт туда, откуда пришли, а не в
    // каталог: человек пришёл из проекта и хочет вернуться в проект.
    expect(host.querySelector('.pat-name')?.textContent).toBe(DETAIL.name)
    expect(host.querySelector('.pat-back')?.textContent).toBe('Песочница')
  })

  it('возврат приводит в тот же проект с теми же несохранёнными правками', async () => {
    served()
    await mount()
    await click('Песочница')
    const row = host.querySelector('button.sb-project') as HTMLButtonElement
    await act(async () => {
      row.click()
    })
    // Правка: пусть проект станет несохранённым -- ровно то, что нельзя
    // потерять по дороге на карточку.
    await act(async () => {
      sandboxController.store.setState({ project: FILLED })
    })
    await pickTab('Библиотека')
    const lib = host.querySelector('button.sb-lib-open') as HTMLButtonElement
    await act(async () => {
      lib.click()
    })
    // Возврат -- именно крошкой карточки, а не вкладкой сверху: вкладка
    // уводит «в песочницу вообще», а крошка обязана вернуть туда, откуда
    // пришли.
    const back = host.querySelector('.pat-back') as HTMLButtonElement
    expect(back.textContent).toBe('Песочница')
    await act(async () => {
      back.click()
    })

    // Проект тот же и по-прежнему не сохранён: он живёт в состоянии
    // песочницы и в открытом `Project` на сервере, а уход с экрана его не
    // трогает -- и перечитывать его на возврате никто не пробует.
    expect(sandboxController.store.getState().project).toBe(FILLED)
    expect(host.textContent).toContain('не сохранено')
    // Возврат приводит на ту же вкладку, из которой ушли.
    expect(host.querySelector('.lib-tab.is-on')?.textContent).toBe('Библиотека')
  })

  it('«+» в панели вставляет блок и с экрана не уводит', async () => {
    served()
    await mount()
    await click('Песочница')
    const row = host.querySelector('button.sb-project') as HTMLButtonElement
    await act(async () => {
      row.click()
    })
    await pickTab('Библиотека')

    const plus = host.querySelector('.sb-lib-plus') as HTMLButtonElement
    await act(async () => {
      plus.click()
    })

    const insert = asked.find((call) => call.path.endsWith('/blocks'))
    // Вставка одним нажатием осталась главным действием панели, и витрину она
    // по-прежнему не тащит.
    expect(insert?.body).toMatchObject({ pattern: 'ffi', demo: false })
    expect(host.querySelector('.pat-name')).toBe(null)
  })

  it('без входа кнопка карточки уводит ко входу, а песочницу не трогает', async () => {
    serve([
      ['/api/session', ANONYMOUS],
      ['/api/catalog', CATALOG],
      ['/api/patterns/ffi', DETAIL],
      ['/api/glossary', { schema: 1, receptors: [], point: [], contact: [], port: [] }],
      ['/api/sim', { error: 'считать нечего' }, 400],
    ])
    await mount()
    await openCard()
    await click('В песочницу')

    expect(went).toEqual(['/auth/login'])
    // Запрос, которому заранее откажут, не нужен никому: ни серверу, ни тому,
    // кто уже уходит на вход.
    expect(asked.some((call) => call.path.includes('/api/sandboxes'))).toBe(false)
  })
})
