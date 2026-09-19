/**
 * Миниатюра схемы для карточки каталога.
 *
 * Раскладку большой схемы считает ELK: на трёх контактах самописные кривые уже
 * сливаются. Миниатюре он не нужен и мешает -- она размером со спичечный
 * коробок, а список из сорока карточек не должен ждать асинхронный движок и
 * дёргаться, когда тот ответит. Здесь простая послойная расстановка: слой --
 * это глубина по связям, внутри слоя клетки раскладываются поровну.
 *
 * Цикл (а растормаживание -- это почти цикл) обычную топологическую сортировку
 * останавливает. Поэтому неразобранные клетки после прохода ставятся за самым
 * глубоким из уже разобранных предшественников: миниатюра не обязана быть
 * точной, но обязана нарисоваться для любой схемы.
 *
 * Модуляция в глубину не считается. Дофамин из VTA -- не шаг сигнала, а
 * управление контактом; считай его связью, и клетка уезжала бы на слой вправо
 * по причине, которой на схеме нет.
 *
 * Связи -- дуги, а не отрезки. Отрезками миниатюра врала: FFI (`IN→E`, `IN→I`,
 * `I→E`) выглядела цепочкой `IN — I — E`, потому что обходная связь `IN→E` шла
 * ровно там же, где путь через `I`, а встречная пара `A⊣B`, `B⊣A` давала одну
 * линию -- вторая ложилась на первую. Поэтому каждой связи здесь выбирается
 * отклонение (`bow`): 0, если прямая никому не мешает, иначе дуга. Сторону
 * задаёт перпендикуляр справа по ходу связи -- у встречной пары ход обратный,
 * и дуги расходятся сами, без сговора между связями и без зависимости от
 * порядка в списке. Величина берётся из нескольких заготовленных шагов: для
 * каждого считается штраф (задел за чужую фигуру, выход за поле, лишняя
 * кривизна), побеждает наименьший. Это десяток проб на связь на одной
 * арифметике -- дешевле, чем разметка текста рядом, и синхронно.
 */

import type { EdgeKind, Scheme } from '../model/types'

export interface MiniPoint {
  x: number
  y: number
}

export interface MiniNode {
  id: string
  inhibitory: boolean
  /** Центр фигуры. */
  x: number
  y: number
  width: number
  height: number
}

export interface MiniEdge {
  id: string
  kind: EdgeKind
  from: MiniNode
  to: MiniNode
  /** Точки на границах фигур: линия не должна перечёркивать подпись. */
  start: MiniPoint
  end: MiniPoint
  /** Отклонение дуги от прямой; 0 -- связь идёт прямой. */
  bow: number
  /** Контрольная точка квадратичной кривой; при `bow` 0 лежит на прямой. */
  control: MiniPoint
  /** Единичный вектор входа в цель: по нему повёрнут знак на конце связи. */
  tip: MiniPoint
}

export interface Miniature {
  width: number
  height: number
  nodes: MiniNode[]
  edges: MiniEdge[]
}

export interface MiniatureBox {
  width: number
  height: number
  padding: number
}

/** Поле макета: карточка отводит миниатюре 240x120. */
export const DEFAULT_BOX: MiniatureBox = { width: 240, height: 120, padding: 30 }

const NODE_HEIGHT = 20
const NODE_MIN_WIDTH = 28
const NODE_MAX_WIDTH = 72
/** Ширина знака подписи в 10px Roboto -- с запасом, чтобы имя не вылезало. */
const CHAR_WIDTH = 5.8

/** Зазор, с которым связь обходит чужую фигуру: меньше -- линия её задевает. */
const CLEARANCE = 4
/** Шаг отклонения: при 34 дуга обходит клетку высотой 20 с этим зазором. */
const BOW_STEP = 34
/** Если шага не хватило -- дуга круче; больше 2 шагов уже не влезает в поле. */
const BOW_SCALE = [1, 1.55, 2.1]
/** Сколько точек кривой проверяется на помехи: хватает, чтобы не проскочить. */
const SAMPLES = 15
/** Полоса у края поля, за которую дуге лучше не выходить: там её срежет. */
const EDGE_INSET = 2

export function nodeWidth(label: string): number {
  const measured = 12 + label.length * CHAR_WIDTH
  return Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, measured))
}

/** Глубина каждой клетки по связям; модуляция не считается. */
export function depths(scheme: Scheme): Map<string, number> {
  const depth = new Map<string, number>()
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()

  for (const neuron of scheme.neurons) {
    incoming.set(neuron.id, 0)
    outgoing.set(neuron.id, [])
  }
  const edges = scheme.edges.filter(
    (edge) =>
      edge.kind !== 'mod' &&
      edge.from !== edge.to &&
      incoming.has(edge.from) &&
      incoming.has(edge.to),
  )
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    outgoing.get(edge.from)?.push(edge.to)
  }

  const queue = scheme.neurons
    .filter((neuron) => (incoming.get(neuron.id) ?? 0) === 0)
    .map((neuron) => neuron.id)
  for (const id of queue) depth.set(id, 0)

  while (queue.length) {
    const id = queue.shift() as string
    const here = depth.get(id) ?? 0
    for (const next of outgoing.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, here + 1))
      const left = (incoming.get(next) ?? 0) - 1
      incoming.set(next, left)
      if (left === 0) queue.push(next)
    }
  }

  // Остались запертые в цикле: ставим за самым глубоким предшественником.
  for (const neuron of scheme.neurons) {
    if (depth.has(neuron.id)) continue
    const before = edges
      .filter((edge) => edge.to === neuron.id)
      .map((edge) => depth.get(edge.from))
      .filter((value): value is number => value !== undefined)
    depth.set(neuron.id, before.length ? Math.max(...before) + 1 : 0)
  }
  return depth
}

/** Точка выхода линии на границе фигуры -- прямоугольник режется точно. */
function boundary(node: MiniNode, dx: number, dy: number): MiniPoint {
  const halfWidth = node.width / 2
  const halfHeight = node.height / 2
  const scale = Math.min(
    halfWidth / Math.max(Math.abs(dx), 1e-6),
    halfHeight / Math.max(Math.abs(dy), 1e-6),
  )
  return { x: node.x + dx * scale, y: node.y + dy * scale }
}

/**
 * Контрольная точка квадратичной кривой: середина хода, сдвинутая по
 * перпендикуляру справа по ходу связи. Наибольшее отклонение кривой от прямой
 * -- ровно `bow / 2`, на середине.
 */
function controlPoint(from: MiniPoint, to: MiniPoint, bow: number): MiniPoint {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  return {
    x: (from.x + to.x) / 2 - (dy / length) * bow,
    y: (from.y + to.y) / 2 + (dx / length) * bow,
  }
}

function quadPoints(p0: MiniPoint, p1: MiniPoint, p2: MiniPoint, count: number): MiniPoint[] {
  const points: MiniPoint[] = []
  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? i / (count - 1) : 0.5
    const k = 1 - t
    points.push({
      x: k * k * p0.x + 2 * k * t * p1.x + t * t * p2.x,
      y: k * k * p0.y + 2 * k * t * p1.y + t * t * p2.y,
    })
  }
  return points
}

/** Точки вдоль нарисованной связи: по ним видно, где она на самом деле идёт. */
export function edgePoints(edge: MiniEdge, count = 9): MiniPoint[] {
  return quadPoints(edge.start, edge.control, edge.end, count)
}

/** Путь связи для SVG. Прямая -- та же кривая, просто с `bow` 0. */
export function edgePath(edge: MiniEdge): string {
  const round = (value: number): number => Math.round(value * 100) / 100
  return [
    `M ${round(edge.start.x)} ${round(edge.start.y)}`,
    `Q ${round(edge.control.x)} ${round(edge.control.y)}`,
    `${round(edge.end.x)} ${round(edge.end.y)}`,
  ].join(' ')
}

/** Насколько точка зашла в фигуру с зазором; 0 -- не зашла. */
function intrusion(node: MiniNode, point: MiniPoint): number {
  const overX = node.width / 2 + CLEARANCE - Math.abs(point.x - node.x)
  const overY = node.height / 2 + CLEARANCE - Math.abs(point.y - node.y)
  return overX > 0 && overY > 0 ? Math.min(overX, overY) : 0
}

/** Чем плох такой изгиб: чужие фигуры на пути, выход за поле, лишняя дуга. */
function penalty(
  from: MiniNode,
  to: MiniNode,
  bow: number,
  others: MiniNode[],
  box: MiniatureBox,
): number {
  const points = quadPoints(from, controlPoint(from, to, bow), to, SAMPLES)
  // Пересечь чужую клетку нельзя совсем -- из-за этого FFI и читался цепочкой.
  let cost = Math.abs(bow) * 0.04
  for (const node of others) {
    let deepest = 0
    for (const point of points) deepest = Math.max(deepest, intrusion(node, point))
    if (deepest > 0) cost += 100 + deepest
  }
  for (const point of points) {
    const outside = Math.max(
      0,
      EDGE_INSET - point.x,
      point.x - (box.width - EDGE_INSET),
      EDGE_INSET - point.y,
      point.y - (box.height - EDGE_INSET),
    )
    cost += 8 * outside
  }
  return cost
}

/**
 * Чем пробовать отклонять связь. Единственная связь пары может идти прямой и
 * пробует обе стороны; вторая связь пары прямой идти не может -- она легла бы
 * точно на первую, -- поэтому только дуги и только вправо по ходу: встречная,
 * идущая обратно, окажется с другой стороны сама.
 */
function bowChoices(sameWay: number, alone: boolean): number[] {
  const base = BOW_STEP * (sameWay + 1)
  const arcs = BOW_SCALE.map((scale) => base * scale)
  if (!alone) return arcs
  return [0, ...arcs.flatMap((value) => [value, -value])]
}

/** Пара клеток без учёта направления: у встречных связей ключ один. */
function pairKey(from: string, to: string): string {
  return from < to ? `${from} ${to}` : `${to} ${from}`
}

export function miniature(scheme: Scheme, box: MiniatureBox = DEFAULT_BOX): Miniature {
  const depth = depths(scheme)
  const columns = new Map<number, string[]>()
  for (const neuron of scheme.neurons) {
    const level = depth.get(neuron.id) ?? 0
    const column = columns.get(level) ?? []
    column.push(neuron.id)
    columns.set(level, column)
  }

  const span = (size: number, count: number, index: number): number => {
    // Одна клетка стоит по центру, несколько -- поровну между краями поля.
    const inner = size - 2 * box.padding
    if (count <= 1) return size / 2
    return box.padding + (inner * index) / (count - 1)
  }

  const lastColumn = Math.max(0, ...columns.keys())
  const placed = new Map<string, MiniNode>()
  for (const [level, ids] of columns) {
    ids.forEach((id, index) => {
      const neuron = scheme.neurons.find((item) => item.id === id)
      placed.set(id, {
        id,
        inhibitory: neuron?.inhibitory ?? false,
        x: span(box.width, lastColumn + 1, level),
        y: span(box.height, ids.length, index),
        width: nodeWidth(id),
        height: NODE_HEIGHT,
      })
    })
  }

  const nodes = scheme.neurons
    .map((neuron) => placed.get(neuron.id))
    .filter((node): node is MiniNode => node !== undefined)

  const drawn = scheme.edges
    .map((edge) => ({ edge, from: placed.get(edge.from), to: placed.get(edge.to) }))
    .filter(
      (item): item is { edge: Scheme['edges'][number]; from: MiniNode; to: MiniNode } =>
        item.from !== undefined && item.to !== undefined && item.from !== item.to,
    )

  const pairSize = new Map<string, number>()
  for (const { edge } of drawn) {
    const key = pairKey(edge.from, edge.to)
    pairSize.set(key, (pairSize.get(key) ?? 0) + 1)
  }

  const seen = new Map<string, number>()
  const edges: MiniEdge[] = []
  for (const { edge, from, to } of drawn) {
    const wayKey = `${edge.from} ${edge.to}`
    const sameWay = seen.get(wayKey) ?? 0
    seen.set(wayKey, sameWay + 1)
    const alone = (pairSize.get(pairKey(edge.from, edge.to)) ?? 1) <= 1
    const others = nodes.filter((node) => node !== from && node !== to)

    let bow = 0
    let best = Number.POSITIVE_INFINITY
    for (const choice of bowChoices(sameWay, alone)) {
      const cost = penalty(from, to, choice, others, box)
      if (cost < best) {
        best = cost
        bow = choice
      }
    }

    // Связь выходит из фигуры и входит в неё в сторону изгиба, иначе дуга
    // отрывалась бы от клетки на самом видном месте -- у её края.
    const control = controlPoint(from, to, bow)
    const start = boundary(from, control.x - from.x, control.y - from.y)
    const end = boundary(to, control.x - to.x, control.y - to.y)
    const tipX = end.x - control.x
    const tipY = end.y - control.y
    const tipLength = Math.hypot(tipX, tipY) || 1
    edges.push({
      id: edge.id,
      kind: edge.kind,
      from,
      to,
      start,
      end,
      bow,
      control,
      tip: { x: tipX / tipLength, y: tipY / tipLength },
    })
  }

  return { width: box.width, height: box.height, nodes, edges }
}
