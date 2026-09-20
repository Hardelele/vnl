/**
 * Схема с живым зарядом: что написано над клеткой.
 *
 * Здесь настоящий React и настоящая разметка SVG, потому что проверяется именно
 * то, что видно на схеме: над фигурой стоит процент, и у клетки ниже покоя он
 * отмечен. Проверкой «функция вернула 0.33» такое не поймать -- число могло бы
 * не попасть в разметку вовсе.
 *
 * Раскладку считает ELK, и в jsdom он не грузится. Это не мешает: пока его нет,
 * рисуется встроенная расстановка, и фигуры с надписями на месте.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LiveScheme, type LiveSchemeProps } from './LiveScheme'
import type { CellState } from '../../model/sim'
import type { Scheme } from '../../model/types'

const SCHEME: Scheme = {
  neurons: [
    { id: 'IN', inhibitory: false },
    { id: 'E', inhibitory: false },
    { id: 'I', inhibitory: true },
  ],
  edges: [
    { id: 'c1', from: 'IN', to: 'E', kind: 'exc' },
    { id: 'c2', from: 'IN', to: 'I', kind: 'exc' },
    { id: 'c3', from: 'I', to: 'E', kind: 'inh' },
    // Модуляторная линия: её склеивает сервер из модулятора и подопечной
    // связи, и контакта с таким именем в паттерне нет.
    { id: 'mod:dopamine:I:c1', from: 'I', to: 'E', kind: 'mod' },
  ],
}

function cell(charge: number, spiked = false, peak = charge): CellState {
  // Потенциал здесь не важен: долю считает сессия, интерфейс её не пересчитывает.
  // `peak` -- до чего клетка дошла между кадрами; в кадре разряда показывают его.
  return { v: -65 + charge * 15, spiked, charge, peak }
}

let root: Root | null = null
let host: HTMLElement

async function mount(
  cells: Record<string, CellState>,
  props: Partial<LiveSchemeProps> = {},
): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<LiveScheme scheme={SCHEME} cells={cells} {...props} />)
  })
}

/** Связь на схеме по роду: тормозная одна, модуляторная тоже. */
function link(kind: 'exc' | 'inh' | 'mod'): Element {
  const found = host.querySelector(`.scheme-link.is-${kind}`)
  if (!found) throw new Error(`нет связи рода ${kind}`)
  return found
}

/** Надпись о заряде над клеткой -- та, что стоит в её же группе. */
function level(id: string): SVGTextElement | null {
  const group = [...host.querySelectorAll('.scheme-cell')].find((node) =>
    [...node.querySelectorAll('text')].some((text) => text.textContent === id),
  )
  return group?.querySelector('.scheme-level') ?? null
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  host.remove()
})

describe('LiveScheme', () => {
  it('над каждой клеткой стоит её заряд в процентах', async () => {
    await mount({ IN: cell(0), E: cell(0.33), I: cell(0.66) })
    expect(level('IN')?.textContent).toBe('0%')
    expect(level('E')?.textContent).toBe('33%')
    expect(level('I')?.textContent).toBe('66%')
  })

  it('клетка ниже покоя отмечена, а не показана нулём', async () => {
    // Торможение прилетело следом за возбуждением и увело E ниже покоя: именно
    // это и нужно видеть, а обрезка нулём выдала бы «клетка в покое».
    await mount({ IN: cell(0.4), E: cell(-0.2), I: cell(0.8) })
    const below = level('E')
    expect(below?.textContent).toBe('↓20%')
    expect(below?.classList.contains('is-below')).toBe(true)
    expect(level('I')?.classList.contains('is-below')).toBe(false)
  })

  it('на разряде написано сто процентов', async () => {
    await mount({ IN: cell(0), E: cell(1, true), I: cell(0) })
    expect(level('E')?.textContent).toBe('100%')
  })

  it('без ответа сессии надпись не выдумывается', async () => {
    await mount({})
    expect(level('E')).toBeNull()
  })

  it('по связи можно щёлкнуть: выбирается она, а не клетка (#546)', async () => {
    const picked: string[] = []
    await mount({}, { onPickLink: (id) => picked.push(id) })

    await act(async () => {
      link('inh').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(picked).toEqual(['c3'])
  })

  it('выбранная связь отмечена на схеме', async () => {
    await mount({}, { selectedLink: 'c3', onPickLink: () => undefined })
    expect(link('inh').classList.contains('is-on')).toBe(true)
    expect(link('exc').classList.contains('is-on')).toBe(false)
  })

  it('модуляторная линия не выбирается: за ней нет строки', async () => {
    // Её рисует не контакт, а модулятор, и рука над линией, от щелчка по
    // которой ничего не происходит, обещала бы то, чего нет.
    const picked: string[] = []
    await mount({}, { onPickLink: (id) => picked.push(id) })

    await act(async () => {
      link('mod').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(picked).toEqual([])
    expect(link('mod').classList.contains('is-pickable')).toBe(false)
  })

  it('надпись стоит над фигурой, а не в ней', async () => {
    await mount({ IN: cell(0.5), E: cell(0.5), I: cell(0.5) })
    const rect = level('E')?.parentElement?.querySelector('rect')
    const top = Number(rect?.getAttribute('y'))
    expect(Number(level('E')?.getAttribute('y'))).toBeLessThan(top)
  })
})
