import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BOX,
  depths,
  edgePoints,
  miniature,
  nodeWidth,
  type MiniEdge,
  type MiniNode,
  type MiniPoint,
} from './miniature'
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

/** Сливаются ли две связи на картинке: по этому и читается «линия тут одна». */
function coincide(one: MiniEdge, other: MiniEdge): boolean {
  const left = edgePoints(one, 9)
  const right = edgePoints(other, 9)
  const same = (points: MiniPoint[]): boolean =>
    left.every((point, index) => distance(point, at(points, index)) < 3)
  // Встречная связь идёт по тем же точкам в обратном порядке -- для глаза это
  // одна и та же линия, поэтому сравниваем и так, и так.
  return same(right) || same([...right].reverse())
}

function distance(one: MiniPoint, other: MiniPoint): number {
  return Math.hypot(one.x - other.x, one.y - other.y)
}

/** С какой стороны от прямой между клетками лежит середина связи. */
function side(edge: MiniEdge, from: MiniNode, to: MiniNode): number {
  const middle = at(edgePoints(edge, 3), 1)
  const centerX = (from.x + to.x) / 2
  const centerY = (from.y + to.y) / 2
  return Math.sign(
    (to.x - from.x) * (middle.y - centerY) - (to.y - from.y) * (middle.x - centerX),
  )
}

/** Попала ли точка внутрь фигуры: связь, идущая по клетке, клетку скрывает. */
function inside(node: MiniNode, point: MiniPoint): boolean {
  return (
    Math.abs(point.x - node.x) < node.width / 2 &&
    Math.abs(point.y - node.y) < node.height / 2
  )
}

function edgeOf(view: { edges: MiniEdge[] }, from: string, to: string): MiniEdge {
  const found = view.edges.find((edge) => edge.from.id === from && edge.to.id === to)
  if (!found) throw new Error(`нет связи ${from}->${to}`)
  return found
}

function nodeOf(view: { nodes: MiniNode[] }, id: string): MiniNode {
  const found = view.nodes.find((node) => node.id === id)
  if (!found) throw new Error(`нет клетки ${id}`)
  return found
}

/** FFI: вход возбуждает и цель, и тормозную клетку, а та тормозит цель. */
const FFI = scheme(
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
)

describe('связь на миниатюре говорит то же, что на схеме', () => {
  it('встречная пара рисуется двумя различимыми линиями', () => {
    // A⊣B и B⊣A -- два подавления, а не один канал между клетками. Прямыми
    // вторая связь ложилась точно на первую, и взаимное торможение выглядело
    // как одна линия неизвестно куда.
    const view = miniature(
      scheme(
        [
          ['A', true],
          ['B', true],
        ],
        [
          ['A', 'B', 'inh'],
          ['B', 'A', 'inh'],
        ],
      ),
    )
    const there = edgeOf(view, 'A', 'B')
    const back = edgeOf(view, 'B', 'A')
    expect(coincide(there, back)).toBe(false)
    // Уходят от прямой в разные стороны, а не одна чуть поверх другой.
    expect(side(there, there.from, there.to)).not.toBe(0)
    expect(side(back, there.from, there.to)).toBe(-side(there, there.from, there.to))
    const middle = (edge: MiniEdge): MiniPoint => at(edgePoints(edge, 3), 1)
    expect(distance(middle(there), middle(back))).toBeGreaterThan(there.from.height)
  })

  it('обходная связь идёт мимо промежуточной клетки, а не сквозь неё', () => {
    // Из-за этого FFI и читался цепочкой IN -- I -- E: связь IN→E шла ровно
    // там же, где путь IN→I→E, и обхода на картинке не было вовсе. А обход --
    // это и есть FFI: без него на миниатюре нарисована другая схема.
    const view = miniature(FFI)
    const bypass = edgeOf(view, 'IN', 'E')
    const middle = nodeOf(view, 'I')
    for (const point of edgePoints(bypass, 41)) {
      expect(inside(middle, point)).toBe(false)
    }
    expect(coincide(bypass, edgeOf(view, 'IN', 'I'))).toBe(false)
    expect(coincide(bypass, edgeOf(view, 'I', 'E'))).toBe(false)
  })

  it('связь входит в цель со стороны знака на конце', () => {
    // Знак рода стоит только у того конца, куда связь приходит, и повёрнут по
    // `tip`. Смотри он мимо клетки -- направление снова стало бы неразличимым,
    // а A→B и B→A одинаковыми.
    const view = miniature(FFI)
    for (const edge of view.edges) {
      const into = { x: edge.to.x - edge.end.x, y: edge.to.y - edge.end.y }
      expect(edge.tip.x * into.x + edge.tip.y * into.y).toBeGreaterThan(0)
      expect(Math.hypot(edge.tip.x, edge.tip.y)).toBeCloseTo(1, 6)
    }
    const pair = miniature(
      scheme(
        [
          ['A', false],
          ['B', false],
        ],
        [
          ['A', 'B'],
          ['B', 'A'],
        ],
      ),
    )
    const there = edgeOf(pair, 'A', 'B')
    const back = edgeOf(pair, 'B', 'A')
    // Знаки встречных связей смотрят в разные стороны: видно, где чей конец.
    expect(there.tip.x * back.tip.x + there.tip.y * back.tip.y).toBeLessThan(0)
  })

  it('две связи в одну сторону остаются двумя связями', () => {
    // Между парой клеток бывает и возбуждение, и торможение сразу. Свести их
    // в одну линию -- потерять половину схемы.
    const view = miniature(
      scheme(
        [
          ['A', false],
          ['B', false],
        ],
        [
          ['A', 'B'],
          ['A', 'B', 'inh'],
        ],
      ),
    )
    expect(view.edges).toHaveLength(2)
    expect(coincide(at(view.edges, 0), at(view.edges, 1))).toBe(false)
  })

  it('восемь связей дают восемь линий, и ни одна не спрятана под другой', () => {
    // Местное возбуждение с общим торможением: пары связаны в обе стороны, и
    // на прямых от восьми связей оставалось видно четыре.
    const view = miniature(
      scheme(
        [
          ['E1', false],
          ['E2', false],
          ['E3', false],
          ['GI', true],
        ],
        [
          ['E1', 'E2'],
          ['E2', 'E1'],
          ['E1', 'GI'],
          ['E2', 'GI'],
          ['E3', 'GI'],
          ['GI', 'E1', 'inh'],
          ['GI', 'E2', 'inh'],
          ['GI', 'E3', 'inh'],
        ],
      ),
    )
    expect(view.edges).toHaveLength(8)
    for (const one of view.edges) {
      for (const other of view.edges) {
        if (one === other) continue
        expect(coincide(one, other)).toBe(false)
      }
      for (const node of view.nodes) {
        if (node === one.from || node === one.to) continue
        for (const point of edgePoints(one, 41)) expect(inside(node, point)).toBe(false)
      }
    }
  })

  it('род связи остаётся при своей линии', () => {
    // Цвет и пунктир рисуются по `kind`; торможение, уехавшее на чужую линию,
    // читалось бы как возбуждение.
    const view = miniature(
      scheme(
        [
          ['IN', false],
          ['PYR', false],
          ['SST', true],
          ['VTA', false],
        ],
        [
          ['IN', 'PYR'],
          ['SST', 'PYR', 'inh'],
          ['VTA', 'PYR', 'mod'],
        ],
      ),
    )
    expect(view.edges.map((edge) => [edge.from.id, edge.to.id, edge.kind])).toEqual([
      ['IN', 'PYR', 'exc'],
      ['SST', 'PYR', 'inh'],
      ['VTA', 'PYR', 'mod'],
    ])
  })

  it('одинокая связь идёт прямой, пока никому не мешает', () => {
    // Дуга -- средство, а не украшение: гнуть там, где ничто не мешает,
    // значит превращать простую цепочку в клубок.
    const view = miniature(
      scheme(
        [
          ['A', false],
          ['B', false],
          ['C', false],
        ],
        [
          ['A', 'B'],
          ['B', 'C'],
        ],
      ),
    )
    for (const edge of view.edges) expect(edge.bow).toBe(0)
  })

  it('дуга остаётся внутри поля миниатюры', () => {
    // Карточка обрежет всё, что вышло за viewBox, и связь оборвётся на
    // полпути -- это хуже прямой, которую она обходит.
    const view = miniature(FFI)
    for (const edge of view.edges) {
      for (const point of edgePoints(edge, 41)) {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(view.width)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeLessThanOrEqual(view.height)
      }
    }
  })
})
