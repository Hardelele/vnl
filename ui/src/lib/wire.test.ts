/**
 * Геометрия провода на холсте песочницы (#542, #554).
 *
 * Проверяется то, из-за чего схема из пяти клеток превращалась в клубок: куда
 * уходит кривая между двумя фигурами. Поэтому здесь считается настоящая рамка
 * нарисованной кривой, а не только её концы: беда была ровно в середине пути,
 * где провод выносило за пределы схемы.
 *
 * После #554 кривую рисует библиотечная дуга (`arc` из `lib/miniature`) -- та
 * же, что в строке библиотеки и в начинке блока. Прежних обещаний это не
 * отменяет: они здесь и проверяются, только уже на ней.
 */

import { describe, expect, it } from 'vitest'

import { layeredPlaces, type ArcBox } from './miniature'
import { schemeField, wire, type Point, type WireEnd } from './wire'
import type { Scheme } from '../model/types'

/** Клетка холста: фигура 74x38 с центром в её месте. */
function cell(x: number, y: number): WireEnd {
  return { x, y, halfWidth: 37, halfHeight: 19 }
}

/** Та же клетка как препятствие: мимо неё связь обязана пройти. */
function shape(x: number, y: number): ArcBox {
  return { x, y, width: 74, height: 38 }
}

/**
 * Точки кривой пути: по ним видно, где провод идёт на самом деле.
 *
 * Дуга квадратичная (три точки), петля на себя -- кубическая (четыре): у них
 * разная задача, и мерить их надо каждую по своей формуле, а не по одной
 * общей.
 */
function points(path: string, count = 65): Point[] {
  const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  expect([6, 8]).toContain(numbers.length)
  const pairs: Point[] = []
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    pairs.push({ x: numbers[i] ?? 0, y: numbers[i + 1] ?? 0 })
  }
  const at = (get: (point: Point) => number, t: number): number => {
    const k = 1 - t
    const [a, b, c, d] = pairs.map(get) as [number, number, number, number?]
    if (d === undefined) return k * k * a + 2 * k * t * b + t * t * c
    return k * k * k * a + 3 * k * k * t * b + 3 * k * t * t * c + t * t * t * d
  }
  const out: Point[] = []
  for (let i = 0; i <= count; i += 1) {
    const t = i / count
    out.push({ x: at((point) => point.x, t), y: at((point) => point.y, t) })
  }
  return out
}

/** Рамка нарисованной кривой. */
function frame(path: string): {
  left: number
  right: number
  top: number
  bottom: number
} {
  const drawn = points(path)
  return {
    left: Math.min(...drawn.map((point) => point.x)),
    right: Math.max(...drawn.map((point) => point.x)),
    top: Math.min(...drawn.map((point) => point.y)),
    bottom: Math.max(...drawn.map((point) => point.y)),
  }
}

/** Попала ли кривая внутрь чужой фигуры: связь, идущая по клетке, клетку прячет. */
function crosses(path: string, box: ArcBox): boolean {
  return points(path, 121).some(
    (point) =>
      Math.abs(point.x - box.x) < box.width / 2 &&
      Math.abs(point.y - box.y) < box.height / 2,
  )
}

describe('связь между двумя клетками', () => {
  it('идёт прямой от края до края, когда никому не мешает', () => {
    const line = wire(cell(100, 100), cell(400, 100))

    expect(line.bow).toBe(0)
    expect(line.start.x).toBe(137)
    expect(line.end.x).toBe(363)
  })

  it('связь справа налево -- такая же короткая, а не кольцо вокруг узлов', () => {
    // Прежде сторона была прибита к роли конца, и этот провод обязан был выйти
    // вправо, развернуться и прийти слева -- в обход обоих узлов (#542).
    // Дуге выбирать сторону не из чего вовсе: она выходит там, где граница
    // фигуры смотрит на изгиб.
    const forward = frame(wire(cell(100, 100), cell(400, 100)).path)
    const back = frame(wire(cell(400, 100), cell(100, 100)).path)

    expect(wire(cell(400, 100), cell(100, 100)).start.x).toBe(363)
    expect(wire(cell(400, 100), cell(100, 100)).end.x).toBe(137)
    expect(back.right - back.left).toBeCloseTo(forward.right - forward.left, 6)
  })

  it('не выходит за прямоугольник своих концов дальше собственного изгиба', () => {
    const line = wire(cell(400, 100), cell(100, 180))
    const box = frame(line.path)
    const slack = Math.abs(line.bow)

    expect(box.left).toBeGreaterThanOrEqual(137 - slack)
    expect(box.right).toBeLessThanOrEqual(363 + slack)
    expect(box.top).toBeGreaterThanOrEqual(100 - slack)
    expect(box.bottom).toBeLessThanOrEqual(180 + slack)
  })

  it('встречная пара рисуется двумя различимыми дугами', () => {
    // A→B и B→A -- две связи, а не один канал. Прямыми вторая легла бы точно
    // на первую (#524). Сторона берётся перпендикуляром справа по ходу: у
    // встречной ход обратный, и дуги расходятся сами.
    const there = wire(cell(100, 100), cell(400, 100), { alone: false })
    const back = wire(cell(400, 100), cell(100, 100), { alone: false })

    expect(there.bow).not.toBe(0)
    expect(frame(there.path).bottom - 100).toBeGreaterThan(19)
    expect(100 - frame(back.path).top).toBeGreaterThan(19)
  })

  it('узлы друг над другом -- дуга идёт сверху вниз без выноса вбок', () => {
    // Горизонтальный изгиб уводил такую линию на сотню пикселей вбок и
    // возвращал -- ту же петлю, только в миниатюре (#542).
    const line = wire(cell(200, 100), cell(200, 300))
    const box = frame(line.path)

    expect(line.start).toEqual({ x: 200, y: 119 })
    expect(line.end).toEqual({ x: 200, y: 281 })
    expect(box.right - box.left).toBeCloseTo(0, 6)
  })

  it('знак на конце разворачивается вместе с ходом связи', () => {
    // Плашка торможения рисуется поперёк `tip`; стой она всегда вертикально,
    // у связи сверху вниз она легла бы вдоль провода.
    const down = wire(cell(200, 100), cell(200, 300)).tip
    expect([down.x, down.y]).toEqual([expect.closeTo(0, 6), expect.closeTo(1, 6)])
    const right = wire(cell(100, 100), cell(400, 100)).tip
    expect([right.x, right.y]).toEqual([expect.closeTo(1, 6), expect.closeTo(0, 6)])
    const left = wire(cell(400, 100), cell(100, 100)).tip
    expect(left.x).toBeLessThan(-0.9)
  })
})

describe('чужая фигура на пути', () => {
  it('связь в обход идёт мимо стоящей между клеткой, а не сквозь неё', () => {
    // Ровно то, ради чего подбор изгиба и заведён: обходная связь, прошедшая
    // сквозь промежуточную клетку, рисует не ту схему (#524).
    const middle = shape(250, 100)
    const line = wire(cell(100, 100), cell(400, 100), { others: [middle] })

    expect(line.bow).not.toBe(0)
    expect(crosses(line.path, middle)).toBe(false)
  })

  it('дуга остаётся в поле схемы, даже когда обходить тесно', () => {
    const middle = shape(250, 100)
    const boxes = [shape(100, 100), middle, shape(400, 100)]
    const field = schemeField(boxes)
    const line = wire(cell(100, 100), cell(400, 100), { others: [middle], field })

    for (const point of points(line.path, 121)) {
      expect(point.x).toBeGreaterThanOrEqual(field.x)
      expect(point.x).toBeLessThanOrEqual(field.x + field.width)
      expect(point.y).toBeGreaterThanOrEqual(field.y)
      expect(point.y).toBeLessThanOrEqual(field.y + field.height)
    }
  })
})

describe('связь клетки на себя', () => {
  it('рисуется петлёй у самой клетки', () => {
    const line = wire(cell(200, 100), cell(200, 100))

    expect(line.shape).toBe('self')
    // Начало и конец в одной точке: общая формула дала бы кривую нулевой длины
    // либо -- как прежде -- кольцо через весь холст.
    expect(line.start).toEqual({ x: 237, y: 100 })
    expect(line.end).toEqual({ x: 200, y: 81 })
  })

  it('петля не уходит дальше половины клетки от её края', () => {
    const box = frame(wire(cell(200, 100), cell(200, 100)).path)

    expect(box.right).toBeLessThan(237 + 19)
    expect(box.top).toBeGreaterThan(81 - 19)
    expect(box.left).toBeGreaterThanOrEqual(200)
  })
})

/**
 * Приёмка #554 на схеме, с которой пришёл владелец: локальное возбуждение с
 * общим торможением -- четыре клетки и восемь связей, половина из них
 * встречные.
 *
 * Меряется то же, чем мерили строку библиотеки: сколько связей проходит сквозь
 * чужую фигуру и сколько уходит за общий прямоугольник схемы. В библиотеке тех
 * и других ноль, и на холсте после разбора блока обязано быть столько же --
 * это и есть «одна схема -- один вид».
 */
const LEGI: Scheme = {
  neurons: [
    { id: 'E1', inhibitory: false },
    { id: 'E2', inhibitory: false },
    { id: 'E3', inhibitory: false },
    { id: 'GI', inhibitory: true },
  ],
  edges: [
    { id: 'c1', from: 'E1', to: 'E2', kind: 'exc' },
    { id: 'c2', from: 'E2', to: 'E1', kind: 'exc' },
    { id: 'c3', from: 'E1', to: 'GI', kind: 'exc' },
    { id: 'c4', from: 'E2', to: 'GI', kind: 'exc' },
    { id: 'c5', from: 'E3', to: 'GI', kind: 'exc' },
    { id: 'c6', from: 'GI', to: 'E1', kind: 'inh' },
    { id: 'c7', from: 'GI', to: 'E2', kind: 'inh' },
    { id: 'c8', from: 'GI', to: 'E3', kind: 'inh' },
  ],
}

describe('разобранный блок на холсте (#554)', () => {
  /** Холст после «Разобрать на клетки»: места слоями, провода дугами. */
  function laid(): { boxes: Map<string, ArcBox>; wires: Array<[string, string, string]> } {
    const places = layeredPlaces(LEGI, [400, 300], { x: 120, y: 90 })
    const boxes = new Map<string, ArcBox>()
    for (const [id, [x, y]] of Object.entries(places)) {
      boxes.set(id, { x, y, width: 74, height: 38 })
    }
    const field = schemeField([...boxes.values()])
    const key = (one: string, other: string): string =>
      one < other ? `${one} ${other}` : `${other} ${one}`
    const size = new Map<string, number>()
    for (const edge of LEGI.edges) {
      size.set(key(edge.from, edge.to), (size.get(key(edge.from, edge.to)) ?? 0) + 1)
    }
    const seen = new Map<string, number>()
    const wires = LEGI.edges.map((edge) => {
      const way = `${edge.from} ${edge.to}`
      const sameWay = seen.get(way) ?? 0
      seen.set(way, sameWay + 1)
      const from = boxes.get(edge.from) as ArcBox
      const to = boxes.get(edge.to) as ArcBox
      const others = [...boxes.entries()]
        .filter(([id]) => id !== edge.from && id !== edge.to)
        .map(([, item]) => item)
      const line = wire(
        { x: from.x, y: from.y, halfWidth: from.width / 2, halfHeight: from.height / 2 },
        { x: to.x, y: to.y, halfWidth: to.width / 2, halfHeight: to.height / 2 },
        { others, field, sameWay, alone: (size.get(key(edge.from, edge.to)) ?? 1) <= 1 },
      )
      return [edge.from, edge.to, line.path] as [string, string, string]
    })
    return { boxes, wires }
  }

  it('ни одна связь не проходит сквозь чужую клетку', () => {
    const { boxes, wires } = laid()
    for (const [from, to, path] of wires) {
      for (const [id, box] of boxes) {
        if (id === from || id === to) continue
        expect(crosses(path, box), `${from} -> ${to} задевает ${id}`).toBe(false)
      }
    }
  })

  it('ни одна связь не уходит за общий прямоугольник схемы', () => {
    const { boxes, wires } = laid()
    const sides = [...boxes.values()]
    const left = Math.min(...sides.map((box) => box.x - box.width / 2))
    const right = Math.max(...sides.map((box) => box.x + box.width / 2))
    const top = Math.min(...sides.map((box) => box.y - box.height / 2))
    const bottom = Math.max(...sides.map((box) => box.y + box.height / 2))
    for (const [from, to, path] of wires) {
      for (const point of points(path, 121)) {
        expect(point.x, `${from} -> ${to}`).toBeGreaterThanOrEqual(left)
        expect(point.x, `${from} -> ${to}`).toBeLessThanOrEqual(right)
        expect(point.y, `${from} -> ${to}`).toBeGreaterThanOrEqual(top)
        expect(point.y, `${from} -> ${to}`).toBeLessThanOrEqual(bottom)
      }
    }
  })
})

describe('порт блока', () => {
  const out: WireEnd = { x: 250, y: 120, halfWidth: 0, halfHeight: 0 }
  const into: WireEnd = { x: 100, y: 120, halfWidth: 0, halfHeight: 0 }

  it('провод приходит ровно в кружок порта', () => {
    // У порта фигура вырождается в точку, и граница такой фигуры -- она сама.
    // Отдельной ветки «сторона задана жёстко» для этого не нужно.
    const line = wire(out, cell(600, 200))

    expect(line.start).toEqual({ x: 250, y: 120 })
  })

  it('выход блока в его же вход обходит коробку, а не ложится на неё', () => {
    // Оба конца на одной коробке: она перестаёт быть «своей» и попадает в
    // препятствия -- иначе провод лёг бы отрезком по самой коробке и пропал.
    const box = shape(175, 120)
    const line = wire(out, into, { others: [box] })

    expect(crosses(line.path, box)).toBe(false)
    // И не раздувается: петля у соседнего порта -- не кольцо через холст.
    expect(frame(line.path).right - 250).toBeLessThan(box.width)
  })
})
