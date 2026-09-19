/**
 * Клетка на холсте: фигура, точка подключения и связь между двумя клетками.
 *
 * Здесь настоящий React и настоящая разметка SVG, потому что проверяется
 * именно то, что видно: форма фигуры (тормозная квадратная, возбуждающая
 * скруглённая) и то, что конец связи у клетки идёт без порта. Проверкой
 * «функция вернула true» такое не поймать -- значение могло бы вовсе не
 * попасть в разметку.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Canvas } from './Canvas'
import type { SandboxLink, SandboxNeuron } from '../../model/sandbox'

const POINT = {
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

function neuron(id: string, inhibitory: boolean, x: number): SandboxNeuron {
  return { id, cellType: id, position: [x, 100], inhibitory, pointModel: POINT }
}

const LINK: SandboxLink = {
  id: 'l1',
  // У клетки порта нет: конец связи -- точка на ней самой.
  source: { instance: 'E', port: null, section: 'soma', fraction: 0.5 },
  target: { instance: 'I', port: null, section: 'soma', fraction: 0.5 },
  receptor: 'ampa',
  inhibitory: false,
  weight: 1,
  delay: 1,
}

let root: Root | null = null
let host: HTMLElement

async function mount(props: Partial<Parameters<typeof Canvas>[0]> = {}) {
  const picked: Array<[string, string | null]> = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <Canvas
        blocks={[]}
        neurons={[neuron('E', false, 120), neuron('I', true, 360)]}
        links={[]}
        cells={{}}
        selected={null}
        pending={null}
        onPickBlock={vi.fn()}
        onPickNeuron={vi.fn()}
        onPickLink={vi.fn()}
        onPickEndpoint={(instance, port) => picked.push([instance, port])}
        onMove={vi.fn()}
        onEmpty={vi.fn()}
        {...props}
      />,
    )
  })
  return picked
}

function cell(id: string): SVGGElement {
  const found = [...host.querySelectorAll('.cv-cell')].find((node) =>
    [...node.querySelectorAll('text')].some((text) =>
      text.textContent?.startsWith(id),
    ),
  )
  if (!found) throw new Error(`на холсте нет клетки ${id}`)
  return found as SVGGElement
}

beforeEach(() => {
  root = null
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

describe('клетка на холсте', () => {
  it('тормозная квадратная, возбуждающая скруглённая', async () => {
    await mount()

    // Обозначения те же, что в миниатюре каталога: разница читается и там,
    // где цвета нет.
    expect(cell('I').querySelector('rect')?.getAttribute('rx')).toBe('4')
    expect(cell('E').querySelector('rect')?.getAttribute('rx')).not.toBe('4')
    expect(cell('I').getAttribute('class')).toContain('is-inh')
    expect(cell('E').getAttribute('class')).not.toContain('is-inh')
  })

  it('соединяется точкой на себе, а не портом', async () => {
    const picked = await mount()

    act(() => {
      cell('E').querySelector('.cv-soma circle')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    // Порт пустой -- и это не пропуск: фиктивную «сому» пришлось бы
    // поддерживать и на сервере, где порта у клетки нет.
    expect(picked).toEqual([['E', null]])
  })

  it('светится по своему имени, без приставки блока', async () => {
    await mount({ cells: { E: { v: -40, spiked: true, charge: 1, peak: 1 } } })

    expect(cell('E').getAttribute('class')).toContain('is-spiking')
    expect(cell('I').getAttribute('class')).not.toContain('is-spiking')
  })

  it('связь между двумя клетками рисуется, хотя портов у них нет', async () => {
    await mount({ links: [LINK] })

    // Прежний холст умел вести линию только между портами и на клетках молча
    // не рисовал ничего.
    expect(host.querySelectorAll('.cv-link .cv-wire')).toHaveLength(1)
  })

  it('пустой холст зовёт положить клетку, а не только вставить паттерн', async () => {
    await mount({ neurons: [] })

    expect(host.querySelector('.cv-empty')?.textContent).toContain('клетку')
  })
})
