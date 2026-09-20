/**
 * Что холст отдаёт раскладке и что делает с её ответом (#543).
 *
 * ELK подменён: в jsdom он не грузится, а проверяется здесь не он. Важно
 * другое -- какие размеры узлов он получает (раскрытый блок вчетверо больше
 * клетки, и одинаковые квадраты дали бы раскладку не этой схемы) и как его
 * ответ превращается в места объектов: у блока место -- левый верхний угол, у
 * клетки -- середина фигуры.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { arrangement } from './arrange'
import { placeBoxes, type LaidGraph, type LayoutBox, type LayoutEdge } from '../../lib/place'
import type {
  SandboxBlock,
  SandboxLink,
  SandboxMotor,
  SandboxNeuron,
  SandboxSensor,
} from '../../model/sandbox'

vi.mock('../../lib/place', () => ({
  placeBoxes: vi.fn(),
}))

const laid = vi.mocked(placeBoxes)

/** Ответ движка: узлы в том же порядке, поставленные в ряд от нуля. */
function answer(boxes: LayoutBox[]): LaidGraph {
  let x = 0
  const out = boxes.map((box) => {
    const placed = { ...box, x, y: 0 }
    x += box.width + 90
    return placed
  })
  return { width: x, height: 0, boxes: out, edges: [] }
}

function block(id: string): SandboxBlock {
  return {
    id,
    patternId: 'ffi',
    label: id,
    position: [0, 0],
    ports: [],
    counts: { neurons: 3, contacts: 3 },
    scheme: { neurons: [], edges: [] },
    cells: [],
    contacts: [],
  }
}

function neuron(id: string): SandboxNeuron {
  return { id, cellType: 'relay', position: [0, 0], inhibitory: false, pointModel: null }
}

function link(id: string, from: string, to: string): SandboxLink {
  return {
    id,
    source: { instance: from, port: null, section: 'soma', fraction: 0.5 },
    target: { instance: to, port: null, section: 'soma', fraction: 0.5 },
    receptor: 'ampa',
    inhibitory: false,
    weight: 1,
    delay: 1,
  }
}

function boxes(): LayoutBox[] {
  return laid.mock.calls[0]?.[0] ?? []
}

function edges(): LayoutEdge[] {
  return laid.mock.calls[0]?.[1] ?? []
}

beforeEach(() => {
  laid.mockReset()
  laid.mockImplementation((given) => Promise.resolve(answer(given)))
})

describe('что уходит в раскладку', () => {
  it('размер узла -- настоящий размер фигуры на холсте', async () => {
    await arrangement([block('ffi'), block('ffi2')], [neuron('x')], [], ['ffi2'])

    // Свёрнутый блок, раскрытый и клетка -- три разных габарита. ELK разводит
    // узлы по ним, и одинаковые квадраты значили бы раскладку не этой схемы.
    expect(boxes()).toEqual([
      { id: 'ffi', width: 150, height: 62 },
      { id: 'ffi2', width: 236, height: 152 },
      { id: 'x', width: 74, height: 38 },
    ])
  })

  it('связь во внутренний узел блока считается связью с блоком (#530)', async () => {
    await arrangement(
      [block('ffi')],
      [neuron('x')],
      [link('l1', 'x', 'ffi/I')],
      ['ffi'],
    )

    // По холсту двигается блок целиком, а не его внутренний узел.
    expect(edges()).toEqual([{ id: 'l1', from: 'x', to: 'ffi' }])
  })

  it('связь объекта на себя слоя не добавляет и в раскладку не идёт', async () => {
    await arrangement([], [neuron('x')], [link('l1', 'x', 'x')], [])

    expect(edges()).toEqual([])
  })
})

describe('что раскладка возвращает', () => {
  it('у блока место -- угол, у клетки -- середина фигуры', async () => {
    const places = await arrangement([block('ffi')], [neuron('x')], [], [])

    // Холст рисует коробку блока от места, а фигуру клетки -- вокруг него.
    // Отступ общий: `viewBox` начинается с нуля, и прижатая к краю схема
    // потеряла бы и обводку, и надпись о заряде над клеткой.
    expect(places).toEqual({ ffi: [12, 30], x: [12 + 240 + 37, 30 + 19] })
  })

  it('пустой холст раскладывать нечего -- и движок не зовётся', async () => {
    expect(await arrangement([], [], [], [])).toEqual({})
    expect(laid).not.toHaveBeenCalled()
  })
})

describe('раскладка знает про границу с миром (#571)', () => {
  const SENSOR: SandboxSensor = {
    id: 'sensor1',
    kind: 'rate',
    story: 'частота, 100 Гц при 1',
    to: 100,
    position: [0, 0],
  }
  const MOTOR: SandboxMotor = {
    id: 'motor1',
    kind: 'rate',
    story: 'частота за окно 50 мс',
    unit: 'Гц',
    window: 50,
    source: { instance: 'E', port: null, section: 'soma', fraction: 0.5 },
    position: [0, 0],
  }

  it('двери раскладываются наравне с клетками, и место у них по центру', async () => {
    laid.mockImplementation(async (boxes) => answer(boxes))

    const places = await arrangement(
      [],
      [neuron('E')],
      [link('l1', 'sensor1', 'E')],
      [],
      [SENSOR],
      [MOTOR],
    )

    // Все трое получили места, и у всех троих место -- середина фигуры.
    expect(Object.keys(places).sort()).toEqual(['E', 'motor1', 'sensor1'])
  })

  it('мотор встаёт после своей клетки, хотя связи у него нет', async () => {
    let edges: LayoutEdge[] = []
    laid.mockImplementation(async (boxes, given) => {
      edges = given
      return answer(boxes)
    })

    await arrangement([], [neuron('E')], [], [], [], [MOTOR])

    // Мотор смотрит на клетку, и для раскладки это «после неё»: иначе ELK
    // положил бы его отдельным островом, и линия шла бы через всю схему.
    expect(edges).toEqual([{ id: 'watch-motor1', from: 'E', to: 'motor1' }])
  })

  it('связь на объект, которого на холсте нет, раскладку не роняет', async () => {
    let edges: LayoutEdge[] = []
    laid.mockImplementation(async (boxes, given) => {
      edges = given
      return answer(boxes)
    })

    // Сенсор проекту известен, а холсту его не передали: ELK споткнулся бы на
    // ребре в узел, которого в графе нет.
    await arrangement([], [neuron('E')], [link('l1', 'sensor1', 'E')], [])

    expect(edges).toEqual([])
  })
})
