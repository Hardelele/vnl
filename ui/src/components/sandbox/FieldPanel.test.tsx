/**
 * Панель поля: показать картинку и увидеть отклик (#581).
 *
 * Здесь настоящий React и настоящая разметка: проверяется поведение панели --
 * что уходит в сессию на «Показать» и «Погасить», какие числа она пишет под
 * сетками и когда её нет вовсе.
 *
 * Сами сетки рисуются на canvas, и в jsdom холста нет: пиксели проверяются
 * там, где они считаются, -- в чистых `pixelsOf`, `lightOf` и `awakeOf`.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FieldPanel, awakeOf, firedIn, lightOf, pixelsOf } from './FieldPanel'
import type { SandboxField } from '../../model/sandbox'
import type { CellState } from '../../model/sim'

vi.mock('../../model/samples', () => ({
  readSamples: () =>
    Promise.resolve([
      { id: 'T', grid: [24, 24], lit: 158 },
      { id: 'O', grid: [24, 24], lit: 212 },
    ]),
}))

const FIELD: SandboxField = {
  id: 'retina24/eye',
  story: 'поле 4x4, яркость -- 16 величин; частота, 100 Гц при 1',
  grid: [4, 4],
  channels: [],
  size: 16,
  layer: {
    id: 'retina24/R',
    grid: [4, 4],
    members: Array.from({ length: 16 }, (_, index) =>
      `retina24/R[${Math.floor(index / 4)},${index % 4}]`,
    ),
  },
}

function cell(charge: number, peak = charge): CellState {
  return { v: -65, spiked: peak >= 1, charge, peak }
}

let root: Root | null = null
let host: HTMLElement
let shown: Array<[string, unknown]>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  shown = []
})

afterEach(() => {
  act(() => root?.unmount())
  host.remove()
  root = null
})

function draw(
  props: Partial<React.ComponentProps<typeof FieldPanel>> = {},
): void {
  act(() => {
    root?.render(
      <FieldPanel
        fields={[FIELD]}
        cells={{}}
        spikes={{}}
        elapsed={100}
        live
        frames={{}}
        onShow={(field, what) => shown.push([field, what])}
        {...props}
      />,
    )
  })
}

describe('панель поля', () => {
  it('схеме без полей не показывается вовсе', () => {
    draw({ fields: [] })
    // Не пустая панель с надписью «полей нет»: это был бы ответ на незаданный
    // вопрос -- ровно как у полосы кнопок в схеме без дверей.
    expect(host.querySelector('.field-panel')).toBeNull()
  })

  it('называет поле и рассказывает, что это такое', () => {
    draw()
    expect(host.textContent).toContain('retina24/eye')
    expect(host.textContent).toContain('поле 4x4')
  })

  it('«Показать» отправляет в сессию имя образца, а не 576 чисел', async () => {
    draw()
    await act(async () => undefined) // список образцов пришёл
    const show = [...host.querySelectorAll('button')].find(
      (node) => node.textContent === 'Показать',
    )
    act(() => show?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(shown).toEqual([['retina24/eye', { sample: 'T' }]])
  })

  it('«Погасить» -- это кадр из нулей, а не особое действие', () => {
    draw()
    const dark = [...host.querySelectorAll('button')].find(
      (node) => node.textContent === 'Погасить',
    )
    act(() => dark?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(shown).toHaveLength(1)
    const [, what] = shown[0] as [string, { frame: number[] }]
    expect(what.frame).toHaveLength(16)
    expect(what.frame.every((value) => value === 0)).toBe(true)
  })

  it('без сессии показывать некуда, и кнопки не нажимаются', () => {
    draw({ live: false })
    const buttons = [...host.querySelectorAll('button')]
    expect(buttons.every((node) => (node as HTMLButtonElement).disabled)).toBe(true)
  })

  it('пишет, сколько подано и сколько ответило', () => {
    const frame = new Array(16).fill(0)
    frame[5] = 1
    frame[6] = 1
    draw({
      frames: { 'retina24/eye': frame },
      elapsed: 100,
      spikes: {
        'retina24/R[1,1]': [80, 95],
        'retina24/R[1,2]': [97],
        // Разряд был давно: в окно он не попадает, и клетка молчит сейчас.
        'retina24/R[0,0]': [10],
      },
      cells: { 'retina24/R[0,0]': cell(0.4) },
    })
    expect(host.textContent).toContain('подано: 2 из 16')
    expect(host.textContent).toContain('ответило: 2 из 16')
  })

  it('полю без слоя говорит, что отклик смотреть на схеме', () => {
    draw({ fields: [{ ...FIELD, layer: null }] })
    expect(host.textContent).toContain('Поле льёт не в слой')
  })
})

describe('числа панели', () => {
  it('ответ считается по растру за окно, а не по мгновенному состоянию', () => {
    // Разряд занимает один шаг из полусотни, приходящихся на кадр показа:
    // по мгновенному значению сетка мигала бы целиком.
    expect(firedIn([95], 100)).toBe(true)
    expect(firedIn([10], 100)).toBe(false)
    expect(firedIn([140], 100)).toBe(false)
    expect(firedIn(undefined, 100)).toBe(false)
  })

  it('клетка на пути к порогу светится, но тусклее разряда', () => {
    expect(lightOf(cell(0.4), [95], 100)).toBe(1)
    expect(lightOf(cell(0.4), [], 100)).toBeCloseTo(0.4)
    expect(lightOf(undefined, undefined, 100)).toBe(0)
  })

  it('ответившими считаются разрядившиеся за окно', () => {
    const spikes = { a: [90], b: [10], c: [99] }
    expect(awakeOf(spikes, ['a', 'b', 'c', 'd'], 100)).toBe(2)
  })

  it('у цветного пикселя яркость -- среднее по каналам', () => {
    expect(pixelsOf([1, 0, 0, 0, 0, 0], 2, 3)).toEqual([1 / 3, 0])
  })

  it('короткий кадр не выдумывает свет там, где его не прислали', () => {
    expect(pixelsOf([1], 3, 1)).toEqual([1, 0, 0])
  })
})
