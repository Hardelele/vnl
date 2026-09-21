/**
 * Строка поля: что уходит в сессию и что написано в строке (#583).
 *
 * Сетки рисуются картинкой (`rasterImage`), и в jsdom холста нет — значит
 * проверяется не пиксель, а то, ради чего строка стоит: какие числа она
 * говорит, что отправляет «Показать» и «Снять», и чего нет у схемы без полей.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FieldRow, pixelsOf } from './FieldRow'
import type { SandboxField } from '../../model/sandbox'

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
    members: Array.from(
      { length: 16 },
      (_, index) => `retina24/R[${Math.floor(index / 4)},${index % 4}]`,
    ),
  },
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

function draw(props: Partial<React.ComponentProps<typeof FieldRow>> = {}): void {
  act(() => {
    root?.render(
      <FieldRow
        fields={[FIELD]}
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

function press(label: string): void {
  const button = [...host.querySelectorAll('button')].find(
    (node) => node.textContent === label,
  )
  act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('строка поля', () => {
  it('схеме без полей не показывается вовсе', () => {
    draw({ fields: [] })
    // Не пустая строка с надписью «полей нет»: это ответ на незаданный вопрос,
    // ровно как у полосы кнопок в схеме без дверей.
    expect(host.querySelector('.fr')).toBeNull()
  })

  it('свёрнута в одну строку: крупных сеток нет, пока не раскроют', () => {
    draw()
    expect(host.querySelector('.fr-line')).not.toBeNull()
    expect(host.querySelector('.fr-wide')).toBeNull()
    press('›')
    expect(host.querySelector('.fr-wide')).not.toBeNull()
  })

  it('говорит, сколько клеток слоя отозвалось', () => {
    draw({
      elapsed: 100,
      spikes: {
        'retina24/R[1,1]': [80, 95],
        'retina24/R[1,2]': [97],
        // Разряд был давно: в окно он не попадает, и клетка молчит сейчас.
        'retina24/R[0,0]': [10],
      },
    })
    expect(host.textContent).toContain('2 / 16')
  })

  it('«Показать» отправляет имя образца, а не 576 чисел', async () => {
    draw()
    await act(async () => undefined) // список образцов пришёл
    press('Показать')
    expect(shown).toEqual([['retina24/eye', { sample: 'T' }]])
  })

  it('«Снять» -- это кадр из нулей, а не особое действие', () => {
    draw()
    press('Снять')
    const [, what] = shown[0] as [string, { frame: number[] }]
    expect(what.frame).toHaveLength(16)
    expect(what.frame.every((value) => value === 0)).toBe(true)
  })

  it('без сессии показывать некуда, и кнопки не нажимаются', () => {
    draw({ live: false })
    const acts = [...host.querySelectorAll('button.fr-act')]
    expect(acts.length).toBeGreaterThan(0)
    expect(acts.every((node) => (node as HTMLButtonElement).disabled)).toBe(true)
  })

  it('два поля -- переключатель, а не второй блок', () => {
    draw({ fields: [FIELD, { ...FIELD, id: 'retina24/eye2' }] })
    expect(host.querySelectorAll('.fr-line')).toHaveLength(1)
    const which = host.querySelector('.fr-which') as HTMLSelectElement | null
    expect(which?.options.length).toBe(2)
  })

  it('раскрытая строка подписывает обе сетки', () => {
    const frame = new Array(16).fill(0)
    frame[5] = 1
    frame[6] = 1
    draw({ frames: { 'retina24/eye': frame } })
    press('›')
    expect(host.textContent).toContain('подано: 2 из 16')
    expect(host.textContent).toContain('ответило: 0 из 16')
  })
})

describe('кадр в яркости', () => {
  it('у цветного пикселя яркость -- среднее по каналам', () => {
    expect(pixelsOf([1, 0, 0, 0, 0, 0], 2, 3)).toEqual([1 / 3, 0])
  })

  it('короткий кадр не выдумывает свет там, где его не прислали', () => {
    expect(pixelsOf([1], 3, 1)).toEqual([1, 0, 0])
  })
})
