import { describe, expect, it } from 'vitest'

import { DEFAULT_BOX, depths, miniature, nodeWidth } from './miniature'
import type { EdgeKind, Scheme } from '../model/types'

/** Элемент, который обязан быть: в тесте отсутствие -- это провал, не ветка. */
function at<T>(items: T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`нет элемента ${index}`)
  return item
}

function scheme(
  neurons: [string, boolean][],
  edges: [string, string, EdgeKind?][],
): Scheme {
  return {
    neurons: neurons.map(([id, inhibitory]) => ({ id, inhibitory })),
    edges: edges.map(([from, to, kind], index) => ({
      id: `c${index + 1}`,
      from,
      to,
      kind: kind ?? 'exc',
    })),
  }
}

describe('глубина по связям', () => {
  it('цепочка раскладывается по слоям', () => {
    const depth = depths(
      scheme(
        [
          ['IN', false],
          ['E', false],
          ['I', true],
        ],
        [
          ['IN', 'E'],
          ['IN', 'I'],
          ['I', 'E', 'inh'],
        ],
      ),
    )
    expect(depth.get('IN')).toBe(0)
    expect(depth.get('I')).toBe(1)
    // E ждёт и вход, и торможение -- значит стоит за самым глубоким из них.
    expect(depth.get('E')).toBe(2)
  })

  it('петля на себе не сдвигает клетку', () => {
    expect(depths(scheme([['E', false]], [['E', 'E']])).get('E')).toBe(0)
  })

  it('кольцо не вешает расстановку', () => {
    const depth = depths(
      scheme(
        [
          ['A', false],
          ['B', false],
          ['C', true],
        ],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'A', 'inh'],
        ],
      ),
    )
    expect([...depth.keys()].sort()).toEqual(['A', 'B', 'C'])
  })

  it('модуляция не уводит клетку на слой вправо', () => {
    // VTA управляет контактом на PYR, но сигнал через него не идёт.
    const depth = depths(
      scheme(
        [
          ['IN', false],
          ['PYR', false],
          ['VTA', false],
        ],
        [
          ['IN', 'PYR'],
          ['VTA', 'PYR', 'mod'],
        ],
      ),
    )
    expect(depth.get('PYR')).toBe(1)
    expect(depth.get('VTA')).toBe(0)
  })
})

describe('миниатюра', () => {
  it('одна клетка стоит по центру', () => {
    const view = miniature(scheme([['E', false]], []))
    expect(at(view.nodes, 0)).toMatchObject({
      x: DEFAULT_BOX.width / 2,
      y: DEFAULT_BOX.height / 2,
    })
  })

  it('слои идут слева направо и не выходят за поле', () => {
    const view = miniature(
      scheme(
        [
          ['IN', false],
          ['E', false],
        ],
        [['IN', 'E']],
      ),
    )
    expect(at(view.nodes, 0).x).toBeLessThan(at(view.nodes, 1).x)
    for (const node of view.nodes) {
      expect(node.x - node.width / 2).toBeGreaterThanOrEqual(0)
      expect(node.x + node.width / 2).toBeLessThanOrEqual(view.width)
      expect(node.y - node.height / 2).toBeGreaterThanOrEqual(0)
      expect(node.y + node.height / 2).toBeLessThanOrEqual(view.height)
    }
  })

  it('длинное имя расширяет фигуру, но не бесконечно', () => {
    expect(nodeWidth('E')).toBeLessThan(nodeWidth('interneuron'))
    expect(nodeWidth('очень длинное имя нейрона')).toBeLessThanOrEqual(72)
  })

  it('линия начинается и кончается на границах фигур', () => {
    const view = miniature(
      scheme(
        [
          ['I', true],
          ['E', false],
        ],
        [['I', 'E', 'inh']],
      ),
    )
    const edge = at(view.edges, 0)
    expect(edge.kind).toBe('inh')
    expect(edge.from.inhibitory).toBe(true)
    // Точка выхода отстоит от центра ровно на половину фигуры.
    expect(Math.abs(edge.start.x - edge.from.x)).toBeCloseTo(edge.from.width / 2, 5)
    expect(Math.abs(edge.end.x - edge.to.x)).toBeCloseTo(edge.to.width / 2, 5)
  })

  it('пустая схема рисуется пустой, а не падает', () => {
    const view = miniature({ neurons: [], edges: [] })
    expect(view.nodes).toEqual([])
    expect(view.edges).toEqual([])
  })

  it('связь в несуществующую клетку не рисуется', () => {
    const view = miniature(scheme([['E', false]], [['E', 'нет']]))
    expect(view.edges).toEqual([])
  })
})
