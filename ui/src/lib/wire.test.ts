/**
 * Геометрия провода на холсте песочницы (#542).
 *
 * Проверяется то, из-за чего схема из пяти клеток превращалась в клубок:
 * сторона выхода и входа и то, куда после этого уходит кривая. Поэтому здесь
 * считается настоящая рамка нарисованной кривой, а не только её концы: беда
 * была ровно в середине пути, где провод выносило за пределы схемы.
 */

import { describe, expect, it } from 'vitest'

import { wire, type Point, type WireEnd } from './wire'

/** Изгиб и отвод -- те же, что в `wire`: проверяется именно их величина. */
const MIN_BEND = 30
const BOW = 48

/** Клетка холста: фигура 74x38 с центром в её месте. */
function cell(x: number, y: number): WireEnd {
  return { x, y, halfWidth: 37, halfHeight: 19 }
}

/** Точки кубической кривой пути: по ним видно, где провод идёт на самом деле. */
function points(path: string, count = 65): Point[] {
  const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  expect(numbers).toHaveLength(8)
  // Длина уже проверена выше; значения по умолчанию -- только для проверки типов.
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0] = numbers
  const at = (a: number, b: number, c: number, d: number, t: number): number => {
    const k = 1 - t
    return k * k * k * a + 3 * k * k * t * b + 3 * k * t * t * c + t * t * t * d
  }
  const out: Point[] = []
  for (let i = 0; i <= count; i += 1) {
    const t = i / count
    out.push({ x: at(x0, x1, x2, x3, t), y: at(y0, y1, y2, y3, t) })
  }
  return out
}

/** Рамка нарисованной кривой. */
function frame(path: string): { left: number; right: number; top: number; bottom: number } {
  const drawn = points(path)
  return {
    left: Math.min(...drawn.map((point) => point.x)),
    right: Math.max(...drawn.map((point) => point.x)),
    top: Math.min(...drawn.map((point) => point.y)),
    bottom: Math.max(...drawn.map((point) => point.y)),
  }
}

describe('сторона, с которой провод подходит к фигуре', () => {
  it('цель правее источника -- выход справа, вход слева', () => {
    const line = wire(cell(100, 100), cell(400, 100))

    expect([line.exit, line.entry]).toEqual(['right', 'left'])
    expect(line.start.x).toBe(137)
    expect(line.end.x).toBe(363)
  })

  it('цель левее источника -- выход слева, вход справа', () => {
    // Прежде обе стороны были прибиты к роли конца, и этот провод обязан был
    // выйти вправо, развернуться и прийти слева -- в обход обоих узлов.
    const line = wire(cell(400, 100), cell(100, 100))

    expect([line.exit, line.entry]).toEqual(['left', 'right'])
    expect(line.start.x).toBe(363)
    expect(line.end.x).toBe(137)
  })

  it('возврат не выходит за рамку своих концов дальше отвода', () => {
    const back = frame(wire(cell(400, 100), cell(100, 180)).path)

    // По ходу связи обе управляющие точки лежат между концами, поперёк --
    // отведены на `BOW`. Значит кривая помещается в прямоугольник концов,
    // расширенный на отвод, и узлы снаружи не огибает.
    expect(back.left).toBeGreaterThanOrEqual(137 - BOW)
    expect(back.right).toBeLessThanOrEqual(363 + BOW)
    expect(back.top).toBeGreaterThanOrEqual(100 - BOW)
    expect(back.bottom).toBeLessThanOrEqual(180 + BOW)
  })

  it('возврат отведён в сторону, а не положен на прямую связь', () => {
    // Клетки ряда стоят на одной высоте: без отвода возврат лёг бы точно на
    // связи цепочки, и увидеть его было бы нельзя.
    const back = frame(wire(cell(400, 100), cell(100, 100)).path)

    expect(100 - back.top).toBeGreaterThan(30)
    expect(back.bottom).toBeCloseTo(100, 6)
  })

  it('возврат по длине сравним с прямой связью, а не с кольцом', () => {
    const forward = frame(wire(cell(100, 100), cell(400, 100)).path)
    const back = frame(wire(cell(400, 100), cell(100, 100)).path)

    expect(back.right - back.left).toBeCloseTo(forward.right - forward.left, 6)
  })
})

describe('связь вверх-вниз', () => {
  it('узлы друг над другом -- изгиб вертикальный', () => {
    const line = wire(cell(200, 100), cell(200, 300))

    expect(line.shape).toBe('along')
    expect([line.exit, line.entry]).toEqual(['bottom', 'top'])
    expect(line.start).toEqual({ x: 200, y: 119 })
    expect(line.end).toEqual({ x: 200, y: 281 })
  })

  it('горизонтального выноса у неё нет вовсе', () => {
    const box = frame(wire(cell(200, 100), cell(200, 300)).path)

    // Горизонтальный изгиб уводил линию на 100 пикселей вбок и возвращал --
    // ту же петлю, только в миниатюре.
    expect(box.right - box.left).toBeCloseTo(0, 6)
  })

  it('знак на конце разворачивается вместе с ходом связи', () => {
    // Плашка торможения рисуется поперёк `tip`; стой она всегда вертикально,
    // у связи сверху вниз она легла бы вдоль провода.
    const down = wire(cell(200, 100), cell(200, 300)).tip
    expect([down.x, down.y]).toEqual([expect.closeTo(0, 6), expect.closeTo(1, 6)])
    const right = wire(cell(100, 100), cell(400, 100)).tip
    expect([right.x, right.y]).toEqual([expect.closeTo(1, 6), expect.closeTo(0, 6)])
    // У возврата ход наклонён отводом, и знак наклоняется вместе с ним, --
    // но входит по-прежнему в узел: справа налево.
    const left = wire(cell(400, 100), cell(100, 100)).tip
    expect(left.x).toBeLessThan(-0.9)
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

describe('порт блока', () => {
  const out: WireEnd = { x: 250, y: 120, halfWidth: 0, halfHeight: 0, side: 'right' }
  const into: WireEnd = { x: 100, y: 120, halfWidth: 0, halfHeight: 0, side: 'left' }

  it('сторона у порта остаётся заданной: провод обязан прийти в кружок', () => {
    const line = wire(out, cell(600, 200))

    expect(line.exit).toBe('right')
    expect(line.start).toEqual({ x: 250, y: 120 })
  })

  it('когда завернуть всё-таки надо, петля не растёт с расстоянием', () => {
    // Выход блока в его же вход: стороны заданы, и провод обязан обойти
    // коробку. Изгиб считается от проекции хода на направление выхода, а она
    // здесь отрицательна -- значит остаётся наименьшим, а не половиной
    // расстояния, как было от модуля.
    const near = frame(wire(out, into).path)
    const far = frame(wire(out, { ...into, x: -400 }).path)

    expect(near.right - 250).toBeLessThan(MIN_BEND)
    expect(far.right - 250).toBeLessThanOrEqual(near.right - 250)
    // И отводится в сторону: обе точки на одной высоте, и без отвода кривая
    // легла бы отрезком по самой коробке.
    expect(near.top).toBeLessThan(120 - 30)
  })
})
