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
import type { CellState } from '../../model/sim'
import type { SandboxBlock, SandboxLink, SandboxNeuron } from '../../model/sandbox'

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

/**
 * Блок FFI со своей начинкой.
 *
 * Схема приходит с сервера (`SandboxBlock.scheme`) вместе с тормозностью
 * каждой клетки: считать её здесь значило бы завести второе место, где это
 * слово означает своё.
 */
const FFI: SandboxBlock = {
  id: 'ffi',
  patternId: 'ffi',
  label: 'FFI',
  position: [300, 80],
  ports: [
    { name: 'in', direction: 'in', site: { instance: 'IN', section: 'soma', fraction: 0.5 }, note: '' },
    { name: 'out', direction: 'out', site: { instance: 'E', section: 'soma', fraction: 0.5 }, note: '' },
  ],
  counts: { neurons: 3, contacts: 3 },
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
  cells: [],
  contacts: [],
}

/** Связь снаружи прямо в тормозный нейрон блока, минуя порт `in`. */
const INTO_BLOCK: SandboxLink = {
  id: 'l2',
  source: { instance: 'E', port: null, section: 'soma', fraction: 0.5 },
  target: { instance: 'ffi/I', port: null, section: 'soma', fraction: 0.5 },
  receptor: 'ampa',
  inhibitory: false,
  weight: 1,
  delay: 1,
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

function inner(id: string): SVGGElement {
  const found = [...host.querySelectorAll('.cv-in-cell')].find(
    // Первый узел, а не весь текст: рядом лежит <title> с полным именем.
    (node) => node.querySelector('text')?.firstChild?.textContent === id,
  )
  if (!found) throw new Error(`внутри блока нет узла ${id}`)
  return found as SVGGElement
}

/** Состояние клетки из сессии: доля и пик приходят с сервера, не считаются. */
function live(charge: number, spiked = false, peak = charge): CellState {
  return { v: -65 + charge * 15, spiked, charge, peak }
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
    await mount({ cells: { E: live(1, true) } })

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

describe('блок на холсте', () => {
  it('свёрнутый показывает коробку со счётчиками, а не начинку', async () => {
    await mount({ blocks: [FFI] })

    expect(host.querySelectorAll('.cv-in-cell')).toHaveLength(0)
    expect(host.querySelector('.cv-sub')?.textContent).toContain('3 кл.')
  })

  it('раскрытый рисует начинку теми же обозначениями, что миниатюра', async () => {
    await mount({ blocks: [FFI], opened: ['ffi'] })

    expect(host.querySelectorAll('.cv-in-cell')).toHaveLength(3)
    // Тормозная квадратная, возбуждающая скруглённая -- разница читается и
    // там, где цвета нет.
    expect(inner('I').querySelector('rect')?.getAttribute('rx')).toBe('4')
    expect(inner('E').querySelector('rect')?.getAttribute('rx')).not.toBe('4')
    expect(inner('I').getAttribute('class')).toContain('is-inh')
    // Связи внутри блока рисуются тоже: без них видны точки, но не схема.
    expect(host.querySelectorAll('.cv-in-link .cv-in-wire')).toHaveLength(3)
    // Порты никуда не делись: они остаются названной точкой подключения.
    expect(host.querySelectorAll('.cv-port')).toHaveLength(2)
  })

  it('щелчок по внутреннему узлу даёт конец связи без порта', async () => {
    const picked = await mount({ blocks: [FFI], opened: ['ffi'] })

    act(() => {
      inner('I').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Имя сетевое: ровно так нейрон блока зовётся в собранной модели, и
    // придумывать ему второй вид адреса незачем.
    expect(picked).toEqual([['ffi/I', null]])
  })

  it('щелчок по внутреннему узлу не выбирает блок вместо узла', async () => {
    const chosen: string[] = []
    await mount({
      blocks: [FFI],
      opened: ['ffi'],
      onPickBlock: (id: string) => chosen.push(id),
    })

    act(() => {
      inner('E').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(chosen).toEqual([])
  })

  it('связь внутрь блока рисуется и входит в сам узел', async () => {
    await mount({ blocks: [FFI], links: [INTO_BLOCK], opened: ['ffi'] })
    const open = host.querySelector('.cv-link .cv-wire')?.getAttribute('d')

    act(() => root?.unmount())
    host.remove()
    await mount({ blocks: [FFI], links: [INTO_BLOCK] })
    const shut = host.querySelector('.cv-link .cv-wire')?.getAttribute('d')

    // Рисуется в обоих случаях: у свёрнутого блока узла на холсте нет, и связь
    // приводится к краю коробки -- прятать её нельзя, в схеме она есть.
    expect(open).toBeTruthy()
    expect(shut).toBeTruthy()
    // Но конец у неё разный: раскрытый блок показывает, куда связь вели.
    expect(open).not.toBe(shut)
  })

  it('переключатель раскрывает блок, а не меняет схему', async () => {
    const toggled: string[] = []
    await mount({ blocks: [FFI], onToggleBlock: (id: string) => toggled.push(id) })

    act(() => {
      host.querySelector('.cv-open circle')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    expect(toggled).toEqual(['ffi'])
  })

  it('у раскрытого блока светится разрядившийся узел, а не вся рамка', async () => {
    await mount({
      blocks: [FFI],
      opened: ['ffi'],
      cells: { 'ffi/I': live(1, true) },
    })

    expect(inner('I').getAttribute('class')).toContain('is-spiking')
    expect(inner('E').getAttribute('class')).not.toContain('is-spiking')
    expect(host.querySelector('.cv-block')?.getAttribute('class')).not.toContain(
      'is-spiking',
    )
  })
})

describe('заряд клетки на холсте', () => {
  it('над фигурой стоит доля заряда в процентах', async () => {
    await mount({ cells: { E: live(0.33), I: live(0.66) } })

    // Вспышка говорит «разрядилась» и молчит о том, почему соседняя не
    // разрядилась: не хватило десяти процентов или вход до неё не дошёл.
    expect(cell('E').querySelector('.cv-level')?.textContent).toBe('33%')
    expect(cell('I').querySelector('.cv-level')?.textContent).toBe('66%')
  })

  it('надпись стоит над фигурой, а не в ней', async () => {
    await mount({ cells: { E: live(0.5) } })
    const level = cell('E').querySelector('.cv-level')
    const shape = cell('E').querySelector('rect')

    expect(Number(level?.getAttribute('y'))).toBeLessThan(
      Number(shape?.getAttribute('y')),
    )
  })

  it('клетка ниже покоя отмечена, а не показана нулём', async () => {
    await mount({ cells: { E: live(-0.2), I: live(0.8) } })
    const below = cell('E').querySelector('.cv-level')

    expect(below?.textContent).toBe('↓20%')
    expect(below?.classList.contains('is-below')).toBe(true)
    expect(
      cell('I').querySelector('.cv-level')?.classList.contains('is-below'),
    ).toBe(false)
  })

  it('заливка идёт по доле и обрезана по фигуре', async () => {
    await mount({ cells: { E: live(0.5), I: live(-0.2) } })

    expect(cell('E').querySelector('.cv-charge')?.getAttribute('opacity')).toBe('0.5')
    expect(cell('I').querySelector('.cv-charge')?.getAttribute('opacity')).toBe('0')
  })

  it('в кадре разряда написано сто процентов, а не значение после сброса', async () => {
    // Между кадрами движок делает полсотни шагов, разряд занимает один.
    // Правило кадра (`momentOf`) общее с карточкой паттерна: своей ветки для
    // песочницы нет -- иначе разряд, видимый на карточке, здесь пропал бы.
    await mount({ cells: { E: live(0, true, 1) } })

    expect(cell('E').querySelector('.cv-level')?.textContent).toBe('100%')
  })

  it('после перемотки показан настоящий заряд, а не сто процентов', async () => {
    // Перемотка -- не кадр: сервер начинает накопленное заново от достигнутого
    // состояния (#534), и давно разрядившаяся клетка приходит с `spiked: false`.
    await mount({ cells: { E: live(0, false, 0) } })

    expect(cell('E').querySelector('.cv-level')?.textContent).toBe('0%')
  })

  it('без ответа сессии надпись не выдумывается', async () => {
    await mount({ cells: {} })

    expect(host.querySelectorAll('.cv-level')).toHaveLength(0)
  })

  it('в раскрытом блоке заряд стоит над каждым внутренним узлом', async () => {
    await mount({
      blocks: [FFI],
      opened: ['ffi'],
      cells: { 'ffi/IN': live(0.2), 'ffi/E': live(0.4), 'ffi/I': live(0.6) },
    })

    expect(inner('IN').querySelector('.cv-in-level')?.textContent).toBe('20%')
    expect(inner('E').querySelector('.cv-in-level')?.textContent).toBe('40%')
    expect(inner('I').querySelector('.cv-in-level')?.textContent).toBe('60%')
  })

  it('свёрнутый блок заряда не показывает: у коробки его нет', async () => {
    await mount({
      blocks: [FFI],
      cells: { 'ffi/IN': live(0.2), 'ffi/E': live(0.4), 'ffi/I': live(0.6) },
    })

    // Средним по пятерым клеткам с разными порогами ничего не измеришь, а
    // число у порта прочли бы как заряд блока целиком. Остаётся вспышка, а
    // числа -- по щелчку на «+».
    expect(host.querySelectorAll('.cv-level')).toHaveLength(0)
    expect(host.querySelectorAll('.cv-in-level')).toHaveLength(0)
  })
})
