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
import type { CellState } from '../../model/sim'
import type { SandboxBlock, SandboxNeuron, SandboxState } from '../../model/sandbox'
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
  cell: { tauM: 'За сколько мембрана забывает заряд.' },
  contact: { receptor: 'Чем контакт действует на цель.', weight: 'Сила контакта.' },
  port: { in: 'Вход.', out: 'Выход.', mod: 'Модуляция.' },
  // Роды драйва -- те же, что отдаёт сервер: панель рисует поля по ним (#508).
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

const PROJECT = {
  blocks: [BLOCK],
  neurons: [CELL],
  links: [],
  stimuli: [],
  recordings: [
    { id: 'r1', target: { object: 'X', port: null }, var: 'g_exc' },
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
      'поезд',
    ])
    expect(select.value).toBe('poisson')
  })

  it('род объясняется подсказкой, как рецептор и мембрана', async () => {
    await mountDrive()

    const select = host.querySelector('select') as HTMLSelectElement
    expect(select.title).toContain('в среднем')
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

    // Рода `spikes` в словаре теста нет -- панель показывает то, что в
    // проекте, и не выдумывает полей за сервер.
    const select = host.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('spikes')
    expect(host.textContent).not.toContain('2 момента: 10, 20 мс')
  })
})
