/**
 * Панель свойств: порты блока (#533) и живые числа выбранной клетки (#535).
 *
 * Проверяется настоящая разметка, а не «функция вернула true»: кнопки тут и
 * есть весь интерфейс модуляторного входа. Пока их не было, `gate` и
 * `dopamine` у `disinhibition` были мертвы -- подать на них было нечего и
 * посмотреть на них было нечего, хотя сервер оба действия принимает.
 *
 * У выбранной клетки проверяется то же: числа должны попасть в разметку, а не
 * остаться в переменной. Прежде панель показывала один потенциал в
 * милливольтах, и «далеко ли клетке до разряда» по нему не читалось.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Properties } from './Properties'
import { boardController, readButtons } from '../../state/board'
import type { CellState } from '../../model/sim'
import type {
  SandboxBlock,
  SandboxDrive,
  SandboxNeuron,
  SandboxState,
} from '../../model/sandbox'
import type { CellKind, Glossary, PatternPort, PointModel } from '../../model/types'

/** Расшифровка -- ровно та, что приходит с сервера: своей здесь нет. */
const GLOSSARY: Glossary = {
  schema: 1,
  receptors: [
    {
      id: 'ampa',
      note: 'Быстрое возбуждение.',
      reversal: 0,
      tauDecay: 2,
      inhibitory: false,
    },
    {
      id: 'gaba_a',
      note: 'Быстрое торможение.',
      reversal: -70,
      tauDecay: 6,
      inhibitory: true,
    },
  ],
  cell: {
    tauM: 'За сколько мембрана забывает заряд.',
    kind: 'Какую мембрану считать: lif или adex.',
    tauW: 'Только adex: за сколько рассасывается ток адаптации.',
  },
  // Виды точечной модели -- те же, что отдаёт `ir.POINT_MODELS` (#527).
  models: [
    { id: 'lif', note: 'Линейная до порога.' },
    { id: 'adex', note: 'С разгоном у порога и током адаптации.' },
  ],
  contact: { receptor: 'Чем контакт действует на цель.', weight: 'Сила контакта.' },
  port: { in: 'Вход.', out: 'Выход.', mod: 'Модуляция.' },
  // Роды драйва -- те же, что отдаёт сервер: панель рисует поля по ним (#508).
  stimulus: 'Внешний вход схемы: в паттернах его нет, драйв добавляют сами.',
  recording: 'Щуп на точке: собирает величину в дорожку, на сеть не влияет.',
  drive: 'Чем гонят схему. От рода зависит, повторится ли картина растра.',
  drives: [
    {
      id: 'poisson',
      name: 'пуассоновский',
      note: 'Случайные моменты со средней частотой: 100 Гц -- это в среднем 10 мс.',
      receptor: true,
      template: false,
      params: [
        {
          name: 'rate',
          label: 'Средняя частота',
          unit: 'Гц',
          default: 250,
          step: 10,
          form: 'number',
          note: 'Средняя частота событий.',
        },
        {
          name: 'amplitude',
          label: 'Вес',
          unit: 'нСм',
          default: 1.5,
          step: 0.1,
          form: 'number',
          note: 'Сколько проводимости открывает один импульс.',
        },
      ],
    },
    {
      id: 'spikes',
      name: 'список спайков',
      note: 'Ровно заданные моменты: картина повторяется всегда.',
      receptor: true,
      template: false,
      params: [
        {
          name: 'times',
          label: 'Моменты',
          unit: 'мс',
          default: 0,
          step: 1,
          form: 'times',
          note: 'Моменты импульсов через пробел или запятую.',
        },
        {
          name: 'amplitude',
          label: 'Вес',
          unit: 'нСм',
          default: 1.5,
          step: 0.1,
          form: 'number',
          note: 'Сколько проводимости открывает один импульс.',
        },
      ],
    },
    {
      id: 'train',
      name: 'поезд',
      note: 'Ровный гребень: n импульсов через равные промежутки.',
      receptor: true,
      template: true,
      params: [
        {
          name: 'n',
          label: 'Импульсов',
          unit: '',
          default: 8,
          step: 1,
          form: 'int',
          note: 'Сколько импульсов в поезде.',
        },
        {
          name: 'freq',
          label: 'Частота',
          unit: 'Гц',
          default: 20,
          step: 1,
          form: 'number',
          note: 'Частота внутри поезда.',
        },
        {
          name: 'amplitude',
          label: 'Вес',
          unit: 'нСм',
          default: 1.5,
          step: 0.1,
          form: 'number',
          note: 'Сколько проводимости открывает один импульс.',
        },
      ],
    },
  ],
  recorded: [
    { id: 'v', name: 'мембранный потенциал', unit: 'мВ' },
    { id: 'g_exc', name: 'возбуждающая проводимость', unit: 'нСм' },
  ],
  // Граница с миром: тем же реестром и теми же полями, что роды драйва (#560).
  sensor: 'Дверь снаружи внутрь: величина от 0 до 1.',
  sensors: [
    {
      id: 'rate',
      name: 'частота',
      note: 'Величина превращается в поток импульсов.',
      trigger: 'level',
      emits: 'events',
      receptor: true,
      // Числа рода -- те же, что в `protocols.SENSOR_KINDS`: панель рисует
      // поля по реестру, а не по списку в коде.
      params: [
        {
          name: 'to',
          label: 'Частота при 1',
          unit: 'Гц',
          default: 100,
          step: 10,
          form: 'number',
          note: 'Во сколько герц превращается величина 1.',
        },
      ],
    },
  ],
  motor: 'Дверь изнутри наружу: одно число сейчас.',
  motors: [
    {
      id: 'rate',
      name: 'частота',
      note: 'Разряды за окно, переведённые в герцы.',
      unit: 'Гц',
      params: [
        {
          name: 'window',
          label: 'Окно',
          unit: 'мс',
          default: 50,
          step: 10,
          form: 'number',
          note: 'За какой отрезок назад считаются разряды.',
        },
      ],
    },
  ],
  value: { min: 0, max: 1 },
}

/** Каталог клеток -- ради `note`: текст написан в `vnl/cells.py`. */
const PALETTE: CellKind[] = [
  {
    id: 'pyr',
    name: 'Пирамидная клетка',
    note: 'Главный возбуждающий выход коры.',
    tags: ['excitatory'],
    transmitter: 'glutamate',
    inhibitory: false,
    builtin: true,
    source: null,
    pointModel: {
      kind: 'lif',
      vRest: -65,
      vReset: -65,
      vThreshold: -50,
      tauM: 15,
      rIn: 100,
      refractory: 2,
      adaptation: 1.5,
      tauAdaptation: 100,
      deltaT: 2,
      vPeak: -40,
      tauW: 144,
      wCoupling: 4,
      wIncrement: 0.0805,
    },
    morphology: { name: 'point', isPoint: true, sections: [] },
  },
]

const POINT: PointModel = {
  kind: 'lif',
  vRest: -65,
  vReset: -65,
  vThreshold: -50,
  tauM: 10,
  rIn: 100,
  refractory: 2,
  adaptation: 0,
  tauAdaptation: 100,
  deltaT: 2,
  vPeak: -40,
  tauW: 144,
  wCoupling: 4,
  wIncrement: 0.0805,
}

function port(name: string, direction: PatternPort['direction'], cell: string): PatternPort {
  return { name, direction, site: { instance: cell, section: 'soma', fraction: 0.5 }, note: '' }
}

/** Порты настоящие -- те же, что у `disinhibition` в библиотеке. */
const BLOCK: SandboxBlock = {
  id: 'dis',
  patternId: 'disinhibition',
  label: 'Растормаживание',
  position: [0, 0],
  ports: [
    port('in', 'in', 'IN'),
    port('tonic', 'in', 'SST'),
    port('gate', 'mod', 'VIP'),
    port('dopamine', 'mod', 'VTA'),
    port('out', 'out', 'PYR'),
  ],
  counts: { neurons: 5, contacts: 3 },
  scheme: { neurons: [], edges: [] },
  cells: [{ type: 'pyr', neurons: ['PYR'], inhibitory: false, pointModel: POINT }],
  // Контакты снимка: адрес точками внутри блока, без приставки экземпляра --
  // правится снимок, а не собранная сеть, где тот же контакт зовётся `dis/c1`.
  contacts: [
    {
      id: 'c1',
      pre: { instance: 'IN', section: 'soma', fraction: 0.5 },
      post: { instance: 'PYR', section: 'soma', fraction: 0.5 },
      receptor: 'ampa',
      inhibitory: false,
      weight: 2.2,
      delay: 1,
    },
    {
      id: 'c2',
      pre: { instance: 'SST', section: 'soma', fraction: 0.5 },
      post: { instance: 'PYR', section: 'soma', fraction: 0.5 },
      receptor: 'gaba_a',
      inhibitory: true,
      weight: 3,
      delay: 10,
    },
  ],
}

/** Клетка, положенная на холст руками: приставки блока у неё нет. */
const CELL: SandboxNeuron = {
  id: 'X',
  cellType: 'pyr',
  position: [100, 100],
  inhibitory: false,
  pointModel: POINT,
}

/** Сенсор и мотор проекта: дверь снаружи внутрь и дверь изнутри наружу. */
const SENSOR = {
  id: 'sensor1',
  kind: 'rate',
  story: 'частота, 100 Гц при 1',
  to: 100,
  position: [0, 200] as [number, number],
}

const MOTOR = {
  id: 'motor1',
  kind: 'rate',
  story: 'частота за окно 50 мс',
  unit: 'Гц',
  window: 50,
  source: { instance: 'X', port: null, section: 'soma', fraction: 0.5 },
  position: [400, 200] as [number, number],
}

const PROJECT = {
  // Имя проекта: кнопки помнятся по нему (#562), и свойства двери спрашивают
  // их именно по нему.
  id: 's1',
  blocks: [BLOCK],
  neurons: [CELL],
  sensors: [SENSOR],
  motors: [MOTOR],
  links: [
    {
      id: 'l1',
      source: { instance: 'sensor1', port: null, section: 'soma', fraction: 0.5 },
      target: { instance: 'X', port: null, section: 'soma', fraction: 0.5 },
      receptor: 'ampa',
      inhibitory: false,
      weight: 1,
      delay: 1,
    },
  ],
  stimuli: [],
  recordings: [
    // Адрес записи -- тот же конец связи, что у связи и у стимула: `instance`
    // плюс порт. У клетки порта нет, и `null` тут не пропуск.
    {
      id: 'r1',
      target: { instance: 'X', port: null, section: 'soma', fraction: 0.5 },
      var: 'g_exc',
    },
  ],
} as unknown as SandboxState

let root: Root | null = null
let host: HTMLElement

async function mount(
  props: Partial<Parameters<typeof Properties>[0]> = {},
): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <Properties
        selection={{ kind: 'block', id: 'dis' }}
        project={PROJECT}
        cells={{}}
        spikes={{}}
        elapsed={0}
        glossary={GLOSSARY}
        palette={PALETTE}
        {...props}
      />,
    )
  })
}

/** Значение живого числа по его подписи: заряд, потенциал, разряды. */
function vital(label: string): string | null {
  const found = [...host.querySelectorAll('.insp-cell')].find(
    (node) => node.querySelector('.insp-label')?.textContent === label,
  )
  return found?.querySelector('.insp-value')?.textContent ?? null
}

function cellState(charge: number, spiked = false, peak = charge): CellState {
  // Потенциал и доля приходят из сессии: интерфейс их не пересчитывает.
  return { v: -65 + charge * 15, spiked, charge, peak }
}

/** Подписи полей ввода в панели: по ним и проверяется состав правимого. */
function fields(): string[] {
  return [...host.querySelectorAll('.sb-field > span')].map(
    (node) => node.textContent ?? '',
  )
}

/** Подписи кнопок действия: драйв, запись и «убрать блок» идут одним списком. */
function actions(): string[] {
  return [...host.querySelectorAll('.sb-actions button')].map(
    (node) => node.textContent ?? '',
  )
}

beforeEach(() => {
  root = null
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

describe('порты блока в панели свойств', () => {
  it('драйв вешается и на вход, и на модулятор', async () => {
    await mount()

    // `gate` и `dopamine` -- это VIP и VTA: обычные клетки, которые принимают
    // стимул наравне с IN. Без драйва на `gate` растормаживания не увидеть.
    expect(actions()).toEqual(
      expect.arrayContaining([
        'Драйв на in',
        'Драйв на tonic',
        'Драйв на модулятор gate',
        'Драйв на модулятор dopamine',
      ]),
    )
  })

  it('записывается и выход, и модулятор', async () => {
    await mount()

    expect(actions()).toEqual(
      expect.arrayContaining([
        'Записывать out',
        'Записывать модулятор gate',
        'Записывать модулятор dopamine',
      ]),
    )
  })

  it('модуляторный вход в подписи отличается от обычного', async () => {
    await mount()

    // На блоке с четырьмя входами по подписи должно быть понятно, куда бьёшь:
    // драйв на `gate` снимает тормоз, драйв на `in` возбуждает.
    expect(actions()).not.toContain('Драйв на gate')
    expect(actions()).not.toContain('Записывать модулятор out')
  })
})

describe('разбор блока в панели свойств (#532)', () => {
  it('«Разобрать на клетки» стоит рядом с «Убрать блок», а не вместо него', async () => {
    await mount()

    // Разобрать -- не то же, что убрать: блок не уносится, а заменяется своим
    // же содержимым. Одна кнопка на оба действия означала бы, что «убрать» то
    // теряет схему, то нет.
    expect(actions()).toEqual(
      expect.arrayContaining(['Разобрать на клетки', 'Убрать блок']),
    )
  })

  it('у отдельной клетки разбирать нечего', async () => {
    await mount({ selection: { kind: 'neuron', id: 'X' } })

    expect(actions()).not.toContain('Разобрать на клетки')
  })
})

describe('контакты блока в панели свойств (#531)', () => {
  it('у контакта правятся те же три поля, что у связи песочницы', async () => {
    await mount()

    // Не второй набор полей: связь и контакт -- одна вещь с разными адресами.
    // Пока контакты были только числом в сводке, задержку проведения нельзя
    // было потрогать там, где она живёт.
    expect(fields()).toEqual(
      expect.arrayContaining(['Рецептор', 'Вес, нСм', 'Задержка, мс']),
    )
  })

  it('в сводке контакта видна задержка и его адрес внутри снимка', async () => {
    await mount()

    const summaries = [...host.querySelectorAll('.sb-group summary')].map(
      (node) => node.textContent ?? '',
    )
    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.stringContaining('IN → PYR'),
        expect.stringContaining('SST → PYR'),
      ]),
    )
    expect(summaries.some((text) => text.includes('10 мс'))).toBe(true)
  })

  it('числа контакта показаны из снимка, а не пересчитаны панелью', async () => {
    await mount()

    const delays = [...host.querySelectorAll('input[type=number]')]
      .map((node) => (node as HTMLInputElement).value)
    expect(delays).toEqual(expect.arrayContaining(['2.2', '1', '3', '10']))
  })

  it('сказано прямо, что правка задевает только этот блок', async () => {
    await mount()

    // Ровно как уже сказано про тип клетки: у экземпляра свой снимок, и знать
    // об этом надо до правки, а не после прогона.
    const notes = [...host.querySelectorAll('.sb-note')].map(
      (node) => node.textContent ?? '',
    )
    expect(notes.some((text) => text.includes('только этот блок'))).toBe(true)
  })
})

describe('выбранная клетка в панели свойств', () => {
  it('показывает заряд, потенциал и разряды за прогон', async () => {
    await mount({
      selection: { kind: 'neuron', id: 'X' },
      cells: { X: cellState(0.54) },
      spikes: { X: [10, 30, 70] },
      elapsed: 100,
    })

    // Тот же процент, что стоит над клеткой на холсте: одна функция, одно
    // округление -- иначе фигура и панель разошлись бы в том же кадре.
    expect(vital('заряд')).toBe('54%')
    expect(vital('потенциал')).toBe('-56.9 мВ')
    expect(vital('разряды')).toBe('3 · 30 Гц')
  })

  it('клетка ниже покоя отмечена, а не показана нулём', async () => {
    await mount({
      selection: { kind: 'neuron', id: 'X' },
      cells: { X: cellState(-0.18) },
    })

    expect(vital('заряд')).toBe('↓18% · ниже покоя')
  })

  it('в кадре разряда показан пик, а не сброс', async () => {
    // Между кадрами движок делает полсотни шагов, разряд занимает один:
    // правило кадра общее с карточкой паттерна (`momentOf`), своей ветки для
    // песочницы нет -- иначе разряд здесь пропал бы.
    await mount({
      selection: { kind: 'neuron', id: 'X' },
      cells: { X: cellState(0, true, 1) },
    })

    expect(vital('заряд')).toBe('100%')
  })

  it('после перемотки показан настоящий заряд, а не сто процентов', async () => {
    // Перемотка -- не кадр: сервер начинает накопленное заново от достигнутого
    // состояния (#534). Клетка, разрядившаяся где-то в перемотанном отрезке,
    // приходит с `spiked: false`, и показать её надо покоем.
    await mount({
      selection: { kind: 'neuron', id: 'X' },
      cells: { X: cellState(0, false, 0) },
      spikes: { X: [50.4] },
      elapsed: 105,
    })

    expect(vital('заряд')).toBe('0%')
    expect(vital('разряды')).toBe('1 · 10 Гц')
  })

  it('без ответа сессии числа не выдумываются', async () => {
    await mount({ selection: { kind: 'neuron', id: 'X' } })

    expect(vital('заряд')).toBe('—')
    expect(vital('потенциал')).toBe('—')
    expect(vital('разряды')).toBe('—')
  })
})

describe('подписи расшифровываются подсказкой (#541)', () => {
  /** Поле по его подписи: у каждого свой `title`, и искать надо по имени. */
  function field(label: string): HTMLElement | null {
    return (
      [...host.querySelectorAll('.sb-field')].find(
        (node) => node.querySelector('span')?.textContent === label,
      ) ?? null
    ) as HTMLElement | null
  }

  it('список рецепторов приходит с сервера, а не из словаря в браузере', async () => {
    await mount({
      selection: { kind: 'link', id: 'l1' },
      project: {
      ...PROJECT,
      links: [
        {
          id: 'l1',
          source: { instance: 'X', port: null, section: 'soma', fraction: 0.5 },
          target: { instance: 'Y', port: null, section: 'soma', fraction: 0.5 },
          receptor: 'gaba_a',
          inhibitory: true,
          weight: 1,
          delay: 1,
        },
      ],
      } as unknown as SandboxState,
    })

    const select = field('Рецептор')?.querySelector('select') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual([
      'ampa',
      'gaba_a',
    ])

    // Объяснение и там, где выбирают, и там, где значение уже выбрано: в
    // закрытом списке видно одно значение, и расшифровать надо его.
    const chosen = [...select.options].find((option) => option.value === 'gaba_a')
    expect(chosen?.title).toContain('Быстрое торможение')
    expect(select.title).toContain('Быстрое торможение')
    // Числа -- из полей ответа, а не пересказанные словами.
    expect(select.title).toContain('-70 мВ')
    expect(select.title).toContain('6 мс')
  })

  it('единицы у веса объясняются, а не предлагаются к угадыванию', async () => {
    // Контакт внутри блока: те же три поля, что у связи холста, -- и те же
    // объяснения, потому что вещь одна.
    await mount({ selection: { kind: 'block', id: 'dis' } })

    expect(field('Вес, нСм')?.title).toBe('Сила контакта.')
  })

  it('параметр мембраны объясняется тем же ключом, каким берётся число', async () => {
    await mount({ selection: { kind: 'neuron', id: 'X' } })

    expect(field('τ мембраны, мс')?.title).toBe('За сколько мембрана забывает заряд.')
    // Про что объяснения нет -- поле остаётся полем, а не показывает пустую
    // подсказку: расшифровка приходит с сервера и может его не знать.
    expect(field('Порог, мВ')?.title).toBe('')
  })

  it('клетка на холсте объясняется своим же `note`', async () => {
    await mount({ selection: { kind: 'neuron', id: 'X' } })

    const row = [...host.querySelectorAll('.row')].find((node) =>
      node.textContent?.includes('pyr'),
    ) as HTMLElement
    expect(row.title).toContain('Главный возбуждающий выход коры')
  })

  it('направление порта названо словами', async () => {
    await mount()

    const mod = [...host.querySelectorAll('.row-dim')].find(
      (node) => node.textContent === 'mod',
    ) as HTMLElement
    expect(mod.title).toBe('Модуляция.')
  })

  it('величина записи выбирается из реестра сервера, а не из списка в коде', async () => {
    // Имена величин уже написаны в `ir.RECORDED` -- по ним подписаны оси
    // графика и колонки CSV. Свой список здесь значил бы, что новая величина
    // появляется в симуляторе и не появляется в поле выбора (#546).
    await mount({ selection: { kind: 'recording', id: 'r1' } })

    const select = host.querySelector('select') as HTMLSelectElement
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'мембранный потенциал',
      'возбуждающая проводимость',
    ])
    expect(select.value).toBe('g_exc')
  })
})

describe('род драйва и его поля (#508)', () => {
  /** Драйв в проекте: род и числа задаются тестом, остальное -- как у сервера. */
  function withDrive(drive: Record<string, unknown>): SandboxState {
    return {
      ...PROJECT,
      stimuli: [
        {
          id: 'drive1',
          target: { instance: 'X', port: null },
          kind: 'poisson',
          receptor: 'ampa',
          rate: 250,
          amplitude: 1.5,
          times: [],
          protocol: 'пуассоновский, в среднем 250 Гц',
          start: 0,
          stop: 500,
          n: 0,
          freq: 0,
          isi: 0,
          duration: 0,
          bursts: 0,
          burst_period: 0,
          repeats: 1,
          period: 0,
          recovery: 0,
          ...drive,
        },
      ],
    } as unknown as SandboxState
  }

  async function mountDrive(drive: Record<string, unknown> = {}): Promise<void> {
    await mount({
      selection: { kind: 'stimulus', id: 'drive1' },
      project: withDrive(drive),
    })
  }

  it('список родов приходит с сервера, а не из списка в коде', async () => {
    await mountDrive()

    const select = host.querySelector('select') as HTMLSelectElement
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'пуассоновский',
      'список спайков',
      'поезд',
    ])
    expect(select.value).toBe('poisson')
  })

  it('род объясняется подсказкой, как рецептор и мембрана', async () => {
    await mountDrive()

    const select = host.querySelector('select') as HTMLSelectElement
    expect(select.title).toContain('в среднем')
  })

  it('объяснён и сам род, и поле, в котором его выбирают (#553)', async () => {
    // Два разных вопроса: «что значит пуассоновский» и «что вообще такое род
    // драйва». Один ответ на оба оставил бы без ответа тот, который задают
    // чаще: в закрытом списке видно одно значение.
    await mountDrive()

    const label = [...host.querySelectorAll('.sb-field')].find(
      (node) => node.querySelector('span')?.textContent === 'Род',
    )
    expect(label?.querySelector('span')?.getAttribute('title')).toContain(
      'повторится ли картина растра',
    )
  })

  it('каждый род в списке объяснён своим текстом, а не общим', async () => {
    await mountDrive()

    // Первый список в панели -- род; второй, рецептор, объяснён своим (#541).
    const select = host.querySelector('select') as HTMLSelectElement
    const options = [...select.options]
    expect(options.map((option) => option.title)).toEqual([
      expect.stringContaining('в среднем'),
      expect.stringContaining('повторяется всегда'),
      expect.stringContaining('Ровный гребень'),
    ])
  })

  it('число протокола объясняется так же, как параметр мембраны', async () => {
    await mountDrive({ kind: 'train', n: 8, freq: 20, protocol: 'поезд, 8 импульсов, 20 Гц' })

    const field = [...host.querySelectorAll('.sb-field')].find(
      (node) => node.querySelector('span')?.textContent === 'Импульсов',
    ) as HTMLElement
    expect(field.title).toContain('Сколько импульсов')
  })

  it('у пуассоновского драйва частота названа средней', async () => {
    await mountDrive()

    expect(fields()).toContain('Средняя частота, Гц')
    expect(fields()).not.toContain('Частота, Гц')
  })

  it('поля поезда -- те, что у поезда, а не те, что у шума', async () => {
    await mountDrive({ kind: 'train', n: 8, freq: 20, protocol: 'поезд, 8 импульсов, 20 Гц' })

    expect(fields()).toContain('Импульсов')
    expect(fields()).toContain('Частота, Гц')
    expect(fields()).not.toContain('Средняя частота, Гц')
  })

  it('шаблон печатает себя списком моментов', async () => {
    await mountDrive({
      kind: 'train',
      n: 50,
      freq: 100,
      times: [0, 10, 20, 30, 40, 50, 60, 70, 80, 490],
      protocol: 'поезд, 50 импульсов, 100 Гц',
    })

    const said = host.textContent ?? ''
    expect(said).toContain('поезд, 50 импульсов, 100 Гц')
    expect(said).toContain('10 моментов: 0, 10, 20, 30, 40, 50, 60, 70 … 490 мс')
  })

  it('у списка спайков моменты правятся, а не показываются дважды', async () => {
    await mountDrive({
      kind: 'spikes',
      times: [10, 20],
      protocol: 'список, 2 импульса',
    })

    // Поле моментов у этого рода есть -- значит вторая, только читаемая
    // строка с теми же числами была бы спором панели с самой собой.
    expect(fields()).toContain('Моменты, мс')
    expect(host.textContent).not.toContain('2 момента: 10, 20 мс')
  })

  it('род, которого нет в словаре, всё равно виден в поле', async () => {
    // Панель показывает то, что в проекте: `select` с чужим значением
    // показал бы вместо него первый пункт, то есть соврал бы про род, а
    // следующая правка молча перевела бы драйв на него.
    await mountDrive({ kind: 'tbs', protocol: 'theta-burst, 10 пачек' })

    const select = host.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('tbs')
    expect([...select.options].map((option) => option.textContent)[0]).toBe('tbs')
  })
})

describe('имя и копия объекта в панели свойств (#563)', () => {
  it('у клетки правится имя -- то самое, которым она зовётся в сети', async () => {
    // Не «подпись» рядом с адресом, а сам адрес: им подписан столбец растра,
    // и вторая, человеческая подпись разошлась бы с ним на том же экране.
    await mount({ selection: { kind: 'neuron', id: 'X' } })

    expect(fields()).toContain('Имя')
    const input = [...host.querySelectorAll('.sb-field')].find(
      (node) => node.querySelector('span')?.textContent === 'Имя',
    )?.querySelector('input')
    expect(input?.value).toBe('X')
  })

  it('клетку можно продублировать и убрать прямо отсюда', async () => {
    await mount({ selection: { kind: 'neuron', id: 'X' } })

    // «Убрать запись» -- из свёрнутой группы её же записи (#565): она стоит
    // выше, потому что показана там, куда смотрит, -- у своей клетки.
    expect(actions()).toEqual([
      'Убрать запись',
      'Драйв на X',
      'Записывать X',
      // Граница с миром -- там же, где драйв и запись: вопрос один, чем эту
      // клетку гонят и что с неё снимают (#562).
      'Сенсор на X',
      'Мотор с X',
      'Дублировать клетку',
      'Убрать клетку',
    ])
  })

  it('у блока правится подпись, а не адрес, и копия у него тоже есть', async () => {
    // Подпись и адрес -- разные вещи: подпись правят, за адрес держатся связи.
    // Поэтому у блока поле зовётся «Название», а у клетки «Имя».
    await mount()

    expect(fields()).toContain('Название')
    expect(fields()).not.toContain('Имя')
    expect(actions()).toContain('Дублировать блок')
    expect(actions()).toContain('Убрать блок')
  })
})

describe('стимул и запись в свойствах своей клетки (#565)', () => {
  /** Драйв, бьющий в названную точку: поля те же, что приходят с сервера. */
  function drive(id: string, instance: string, patch = {}): SandboxDrive {
    return {
      id,
      target: { instance, port: null, section: 'soma', fraction: 0.5 },
      kind: 'poisson',
      receptor: 'ampa',
      rate: 250,
      amplitude: 1.5,
      times: [],
      protocol: 'пуассоновский, в среднем 250 Гц',
      start: 0,
      stop: 500,
      n: 0,
      freq: 0,
      isi: 0,
      duration: 0,
      bursts: 0,
      burst_period: 0,
      repeats: 1,
      period: 0,
      recovery: 0,
      ...patch,
    }
  }

  /** Проект с драйвами, целящимися в клетку `X` и внутрь блока `dis`. */
  function withDrives(drives: SandboxDrive[]): SandboxState {
    return { ...PROJECT, stimuli: drives } as SandboxState
  }

  it('единственный драйв клетки раскрыт: род, числа и окно видны сразу', async () => {
    // Приёмка задачи: выбрана клетка с драйвом -- и всё правится на месте, без
    // перехода на строку стимула в дереве объектов.
    await mount({
      selection: { kind: 'neuron', id: 'X' },
      project: withDrives([drive('drive1', 'X')]),
    })

    const group = host.querySelector('details.sb-group')
    expect(group?.hasAttribute('open')).toBe(true)
    expect(group?.textContent).toContain('пуассоновский, в среднем 250 Гц')
    expect(fields()).toContain('Род')
    expect(fields()).toContain('Средняя частота, Гц')
    expect(fields()).toContain('Начало, мс')
    expect(fields()).toContain('Конец, мс')
  })

  it('двух драйвов уже не разворачивает: две простыни подряд не читаются', async () => {
    await mount({
      selection: { kind: 'neuron', id: 'X' },
      project: withDrives([drive('drive1', 'X'), drive('drive2', 'X')]),
    })

    const groups = [...host.querySelectorAll('details.sb-group')]
    const opened = groups.filter((node) => node.hasAttribute('open'))
    expect(groups.length).toBeGreaterThanOrEqual(2)
    expect(opened.map((node) => node.querySelector('.mono')?.textContent)).not.toContain(
      'drive1',
    )
  })

  it('чужой драйв в свойствах клетки не показан', async () => {
    // Выделение одно на экран, и «принадлежит» тут значит ровно одно: цель.
    await mount({
      selection: { kind: 'neuron', id: 'X' },
      project: {
        ...withDrives([drive('drive1', 'dis/PYR')]),
        recordings: [],
      } as SandboxState,
    })

    expect(host.textContent).not.toContain('drive1')
    expect(host.textContent).toContain('Драйва и записей здесь нет')
  })

  it('блоку принадлежит и драйв на порт, и драйв на внутренний узел', async () => {
    // `ffi.in` и `ffi/IN` -- одна точка, названная с двух сторон: разводить их
    // значило бы объявить драйв на порт и драйв на узел разными вещами.
    await mount({
      project: withDrives([
        drive('d1', 'dis', { target: { instance: 'dis', port: 'in', section: 'soma', fraction: 0.5 } }),
        drive('d2', 'dis/SST'),
        drive('d3', 'X'),
      ]),
    })

    const marks = [...host.querySelectorAll('details.sb-group .sb-kind')].map(
      (node) => node.textContent,
    )
    expect(marks).toContain('d1')
    expect(marks).toContain('d2')
    expect(marks).not.toContain('d3')
  })

  it('на внутренний узел блока драйв вешается прямо из списка', async () => {
    // Раньше драйв вешали только на порт, хотя сервер принимает любой конец
    // связи: на тормозный нейрон блока подать было нечего (#530, #565).
    await mount({
      project: {
        ...PROJECT,
        blocks: [
          {
            ...BLOCK,
            scheme: {
              neurons: [{ id: 'PYR', inhibitory: false }, { id: 'SST', inhibitory: true }],
              edges: [],
            },
          },
        ],
      } as unknown as SandboxState,
    })

    const buttons = [...host.querySelectorAll('.sb-inner .sb-plus')].map(
      (node) => node.getAttribute('title'),
    )
    expect(buttons).toEqual(['Драйв на dis/PYR', 'Драйв на dis/SST'])
  })
})

describe('вид точечной модели в панели свойств (#527)', () => {
  /** Клетка с нужным видом мембраны: остальное -- как приходит с сервера. */
  function withKind(point: Partial<PointModel>): SandboxState {
    return {
      ...PROJECT,
      neurons: [{ ...CELL, pointModel: { ...POINT, ...point } }],
      blocks: [
        {
          ...BLOCK,
          cells: [
            {
              type: 'pyr',
              neurons: ['PYR'],
              inhibitory: false,
              pointModel: { ...POINT, ...point },
            },
          ],
        },
      ],
    } as unknown as SandboxState
  }

  it('вид выбирается списком с сервера, а не угадывается по числам', async () => {
    await mount({ selection: { kind: 'neuron', id: 'X' }, project: withKind({}) })

    const select = host.querySelector('select') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual(['lif', 'adex'])
    expect(select.value).toBe('lif')
    // Объяснено и само поле, и выбранный вид -- два разных вопроса (#541):
    // «что такое вид модели вообще» висит на подписи, «что значит lif» -- на
    // самом списке, где виден только выбранный пункт.
    const label = [...host.querySelectorAll('.sb-field')].find(
      (node) => node.querySelector('span')?.textContent === 'Вид модели',
    )
    expect(label?.querySelector('span')?.getAttribute('title')).toContain(
      'Какую мембрану считать',
    )
    expect(select.title).toContain('Линейная до порога')
    const adex = [...select.options].find((option) => option.value === 'adex')
    expect(adex?.title).toContain('разгоном у порога')
  })

  it('у lif лишних полей не появляется', async () => {
    await mount({ selection: { kind: 'neuron', id: 'X' }, project: withKind({}) })

    const labels = fields()
    expect(labels).toContain('Порог, мВ')
    expect(labels.some((label) => label.startsWith('τ_w'))).toBe(false)
    expect(labels.some((label) => label.startsWith('Δ_t'))).toBe(false)
  })

  it('у adex видны и правятся его собственные числа', async () => {
    await mount({
      selection: { kind: 'neuron', id: 'X' },
      project: withKind({ kind: 'adex' }),
    })

    const labels = fields()
    expect(labels).toEqual(
      expect.arrayContaining([
        'Δ_t разгона, мВ',
        'v_peak разряда, мВ',
        'τ_w тока адаптации, мс',
        'a — ток за потенциалом, нСм',
        'b — ток на разряд, нА',
      ]),
    )
    // Числа те, что в проекте, а не подставленные панелью.
    const tauW = [...host.querySelectorAll('.sb-field')].find(
      (node) => node.querySelector('span')?.textContent === 'τ_w тока адаптации, мс',
    )
    expect((tauW?.querySelector('input') as HTMLInputElement).value).toBe('144')
  })

  it('поля второго вида объясняются тем же ключом, каким берутся числа', async () => {
    await mount({
      selection: { kind: 'neuron', id: 'X' },
      project: withKind({ kind: 'adex' }),
    })

    const tauW = [...host.querySelectorAll('.sb-field')].find(
      (node) => node.querySelector('span')?.textContent === 'τ_w тока адаптации, мс',
    ) as HTMLElement
    expect(tauW.title).toContain('ток адаптации')
  })

  it('сказано, что правка задевает всех клеток этого типа', async () => {
    // Смена вида -- правка типа клетки, а не одного нейрона: в IR мембрана
    // висит на типе. Знать это надо до правки, а не после прогона.
    await mount({ selection: { kind: 'neuron', id: 'X' }, project: withKind({}) })

    const notes = [...host.querySelectorAll('.sb-note')].map((node) => node.textContent)
    expect(notes.join(' ')).toContain('все клетки этого типа')
  })

  it('тип клетки внутри блока правится тем же набором полей', async () => {
    // Вторая копия полей разошлась бы с первой на первом же новом параметре:
    // у клетки поле появилось бы, у блока нет.
    await mount({
      selection: { kind: 'block', id: 'dis' },
      project: withKind({ kind: 'adex' }),
    })

    expect(fields()).toEqual(
      expect.arrayContaining(['Вид модели', 'τ_w тока адаптации, мс']),
    )
    // В свёрнутой строке типа стоит вид: «-50 мВ» у lif и у adex значат разное.
    const kinds = [...host.querySelectorAll('.sb-group .sb-kind')].map(
      (node) => node.textContent,
    )
    expect(kinds).toContain('adex · -50 мВ')
  })
})

describe('свойства двери наружу (#571)', () => {
  it('сенсор показывает род, числа рода и куда смотрит', async () => {
    // Прежде выбрать сенсор было нельзя вовсе: у него не было ни фигуры, ни
    // ветки в панели, и род с числами задавал только сервер умолчаниями.
    await mount({ selection: { kind: 'sensor', id: 'sensor1' } })

    expect(host.querySelector('.panel-title')?.textContent).toBe('Сенсор')
    expect(host.textContent).toContain('частота, 100 Гц при 1')
    // Род -- из реестра сервера, как у драйва.
    const kind = host.querySelector('select') as HTMLSelectElement
    expect([...kind.options].map((option) => option.textContent)).toEqual(['частота'])
    // Поля рисуются по реестру родов, а не перечислены в панели.
    const labels = [...host.querySelectorAll('.sb-field span')].map(
      (node) => node.textContent,
    )
    expect(labels).toContain('Частота при 1, Гц')
    const value = host.querySelector('.sb-field input') as HTMLInputElement
    expect(value.value).toBe('100')
    // Куда смотрит -- его связи: второго списка целей у сенсора нет.
    expect(host.textContent).toContain('Куда смотрит')
    expect(host.textContent).toContain('→ X')
  })

  it('одинокий сенсор говорит, что величина никуда не идёт', async () => {
    const alone = { ...PROJECT, links: [] } as unknown as SandboxState
    await mount({ selection: { kind: 'sensor', id: 'sensor1' }, project: alone })

    expect(host.textContent).toContain('Ни к чему не подключён')
  })

  it('мотор показывает, на какую клетку смотрит, и в чём его величина', async () => {
    await mount({ selection: { kind: 'motor', id: 'motor1' } })

    expect(host.querySelector('.panel-title')?.textContent).toBe('Мотор')
    expect(host.querySelector('.row-path')?.textContent).toBe('X →')
    expect(host.textContent).toContain('частота за окно 50 мс')
    expect(host.textContent).toContain('отдаёт Гц')
    const labels = [...host.querySelectorAll('.sb-field span')].map(
      (node) => node.textContent,
    )
    expect(labels).toContain('Окно, мс')
  })
})

describe('привязка видна со стороны двери (#576)', () => {
  beforeEach(() => {
    localStorage.clear()
    boardController.forget()
  })

  it('у сенсора видно привязанные к нему кнопки', async () => {
    // Жалоба владельца: выбрал сенсор на холсте, а в его свойствах про кнопки
    // ни слова -- привязка была видна ровно с одной стороны.
    boardController.keep('s1', [
      { id: 'btn1', name: 'Газ', sensor: 'sensor1', motor: null, key: 'KeyG' },
      { id: 'btn2', name: 'Чужая', sensor: 'другой', motor: null, key: null },
    ])
    await mount({ selection: { kind: 'sensor', id: 'sensor1' } })

    expect(host.textContent).toContain('Газ')
    expect(host.textContent).toContain('клавиша G')
    // Кнопка соседней двери здесь ни при чём.
    expect(host.textContent).not.toContain('Чужая')
  })

  it('кнопка заводится прямо из свойств сенсора', async () => {
    await mount({ selection: { kind: 'sensor', id: 'sensor1' } })

    expect(host.textContent).toContain('Кнопок к этой двери не привязано')
    const make = [...host.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === 'Сделать кнопку',
    ) as HTMLButtonElement
    await act(async () => {
      make.click()
    })

    // Кнопка легла в тот же список, из которого её читает полоса под холстом,
    // и пережила бы перезагрузку: она в браузере, а не в схеме.
    expect(readButtons('s1')).toEqual([
      { id: 'btn1', name: 'sensor1', sensor: 'sensor1', motor: null, key: null },
    ])
    expect(host.textContent).toContain('нажимают рукой')
  })

  it('петля заводится со стороны сенсора: мотор выбирают тут же', async () => {
    await mount({ selection: { kind: 'sensor', id: 'sensor1' } })

    const pair = host.querySelector('.sb-pair') as HTMLSelectElement
    expect([...pair.options].map((one) => one.value)).toEqual(['', 'motor1'])
    await act(async () => {
      pair.value = 'motor1'
      pair.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const make = [...host.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === 'Сделать кнопку-петлю',
    ) as HTMLButtonElement
    await act(async () => {
      make.click()
    })

    expect(readButtons('s1')).toEqual([
      { id: 'btn1', name: 'sensor1', sensor: 'sensor1', motor: 'motor1', key: null },
    ])
    expect(host.textContent).toContain('петля: motor1 зажигает, sensor1 получает 1')
  })

  it('у мотора то же самое, и встречная дверь -- сенсор', async () => {
    await mount({ selection: { kind: 'motor', id: 'motor1' } })

    const pair = host.querySelector('.sb-pair') as HTMLSelectElement
    expect([...pair.options].map((one) => one.value)).toEqual(['', 'sensor1'])
    const make = [...host.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === 'Сделать кнопку',
    ) as HTMLButtonElement
    await act(async () => {
      make.click()
    })

    expect(readButtons('s1')).toEqual([
      { id: 'btn1', name: 'motor1', sensor: null, motor: 'motor1', key: null },
    ])
    expect(host.textContent).toContain('лампочка')
  })

  it('вторая кнопка той же двери получает номер, а не тождественное имя', async () => {
    // Имя не адрес, и повторы законны -- за кнопку держится `id`. Но две
    // одинаковые строки в списке привязок не говорят, чем они различаются.
    boardController.keep('s1', [
      { id: 'btn1', name: 'sensor1', sensor: 'sensor1', motor: null, key: null },
    ])
    await mount({ selection: { kind: 'sensor', id: 'sensor1' } })

    const make = [...host.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === 'Сделать кнопку',
    ) as HTMLButtonElement
    await act(async () => {
      make.click()
    })

    expect(readButtons('s1').map((one) => one.name)).toEqual(['sensor1', 'sensor1 2'])
  })

  it('встречной двери в схеме нет -- и поля выбора нет', async () => {
    // Пустой список «ни одного мотора» спрашивал бы о том, чего не бывает.
    const alone = { ...PROJECT, motors: [] } as unknown as SandboxState
    await mount({ selection: { kind: 'sensor', id: 'sensor1' }, project: alone })

    expect(host.querySelector('.sb-pair')).toBeNull()
  })
})
