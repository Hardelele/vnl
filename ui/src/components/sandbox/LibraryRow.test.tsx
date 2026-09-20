/**
 * Строка библиотеки: превью читаемого размера и имя целиком.
 *
 * Проверяется то, что видно, а не то, что посчиталось: признаки схемы должны
 * дойти до разметки (квадратная тормозная клетка, плашка на конце торможения,
 * острия у возбуждения), а имя -- дойти до неё неурезанным. Прежняя строка
 * рисовала ту же схему в поле 60x30, где ничего из этого не различалось, и
 * резала имя многоточием (#547).
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LibraryRow } from './LibraryRow'
import type { Pattern } from '../../model/types'

/** FFI: вход возбуждает и цель, и тормозную клетку, а та тормозит цель. */
const FFI: Pattern = {
  id: 'ffi',
  name: 'Торможение с опережением (feedforward inhibition, FFI)',
  level: 'L2',
  levelName: 'Схема',
  status: 'ready',
  statusName: 'Готов',
  ports: [],
  counts: { neurons: 3, contacts: 3, ports: 2 },
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
  demo: null,
  problems: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

let root: Root | null = null
let host: HTMLElement

async function mount(
  pattern: Pattern,
  onInsert = vi.fn(),
  onOpen?: (id: string) => void,
): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <LibraryRow pattern={pattern} onInsert={onInsert} onOpen={onOpen} />,
    )
  })
  return host
}

beforeEach(() => {
  host = document.createElement('div')
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host.remove()
})

describe('строка библиотеки', () => {
  it('имя написано целиком, а не обрезано подсказкой', async () => {
    const view = await mount(FFI)
    const name = view.querySelector('.sb-lib-name')
    expect(name?.textContent).toBe(FFI.name)
    // Многоточие рисует CSS, поэтому ловим не его, а причину: перенос
    // запрещён -- значит строка обрезается. `title` тут не оправдание:
    // подсказки не видно, пока на неё не навели.
    expect(name?.getAttribute('title')).toBe(null)
  })

  it('в превью видно схему, а не три точки', async () => {
    const view = await mount(FFI)
    // Превью отдельным классом от клейма клетки в палитре (`.sb-mini`):
    // у них разный размер, и схеме нужен свой.
    expect(view.querySelector('.sb-preview')).not.toBe(null)
    expect(view.querySelector('.sb-mini')).toBe(null)

    const cells = [...view.querySelectorAll('.thumbnail-cell')]
    expect(cells).toHaveLength(3)
    // Тормозная клетка одна и она квадратная: скругление у неё меньше
    // половины высоты, у остальных -- ровно половина.
    const inhibitory = cells.filter((cell) => cell.classList.contains('is-inh'))
    expect(inhibitory).toHaveLength(1)
    const radius = (cell: Element): number =>
      Number(cell.querySelector('rect')?.getAttribute('rx') ?? 0)
    for (const cell of cells) {
      if (cell.classList.contains('is-inh')) expect(radius(cell)).toBeLessThan(6)
      else expect(radius(cell)).toBeGreaterThan(6)
    }

    // Торможение кончается плашкой, возбуждение -- острием.
    expect(view.querySelectorAll('.thumbnail-link.is-inh line.thumbnail-cap')).toHaveLength(1)
    expect(view.querySelectorAll('.thumbnail-link polygon.thumbnail-cap')).toHaveLength(2)
  })

  it('превью не перехватывает вставку, её делает «+»', async () => {
    const insert = vi.fn()
    const view = await mount(FFI, insert)
    const preview = view.querySelector('.sb-preview') as HTMLElement
    act(() => preview.click())
    expect(insert).not.toHaveBeenCalled()

    const plus = view.querySelector('.sb-plus') as HTMLButtonElement
    act(() => plus.click())
    expect(insert).toHaveBeenCalledWith('ffi')
  })

  it('без дороги на карточку строка остаётся строкой, а не ссылкой', async () => {
    // Погашенная или обманчивая ссылка хуже её отсутствия: обещать переход,
    // которого нет, нельзя.
    const view = await mount(FFI)
    expect(view.querySelector('button.sb-lib-open')).toBe(null)
    expect(view.querySelector('.sb-lib-open.is-flat')).not.toBe(null)
  })

  it('подпись превью говорит про состав, а не повторяет имя рядом', async () => {
    const view = await mount(FFI)
    const label = view.querySelector('.thumbnail')?.getAttribute('aria-label')
    expect(label).toBe('схема: 3 кл., 3 св.')
  })
})

describe('два намерения в одной строке (#566)', () => {
  it('щелчок по строке открывает карточку, а «+» вставляет и не уводит', async () => {
    const insert = vi.fn()
    const open = vi.fn()
    const view = await mount(FFI, insert, open)

    // Открывает вся площадь строки, а не одно имя: цель в полторы строки
    // текста -- это промах мышью, а на касании промах ещё и незаметный.
    const row = view.querySelector('button.sb-lib-open') as HTMLButtonElement
    act(() => (view.querySelector('.sb-preview') as HTMLElement).click())
    expect(open).toHaveBeenCalledWith('ffi')
    expect(insert).not.toHaveBeenCalled()

    open.mockClear()
    act(() => (view.querySelector('.sb-plus') as HTMLButtonElement).click())
    expect(insert).toHaveBeenCalledWith('ffi')
    expect(open).not.toHaveBeenCalled()

    // Разницу видно до щелчка: у обеих дорог своя подсказка, и «+» вынесена
    // из строки отдельной кнопкой, а не спрятана в неё.
    expect(row.getAttribute('title')).toContain('Открыть карточку')
    expect(
      (view.querySelector('.sb-plus') as HTMLElement).getAttribute('title'),
    ).toContain('Вставить')
    expect(row.contains(view.querySelector('.sb-plus'))).toBe(false)
  })
})
