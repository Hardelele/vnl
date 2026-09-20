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
import type { PatternPort, PointModel } from '../../model/types'

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
  recordings: [],
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
