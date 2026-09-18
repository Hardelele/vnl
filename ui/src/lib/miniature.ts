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
 */

import type { EdgeKind, Scheme } from '../model/types'

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
  start: { x: number; y: number }
  end: { x: number; y: number }
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
function boundary(node: MiniNode, dx: number, dy: number): { x: number; y: number } {
  const halfWidth = node.width / 2
  const halfHeight = node.height / 2
  const scale = Math.min(
    halfWidth / Math.max(Math.abs(dx), 1e-6),
    halfHeight / Math.max(Math.abs(dy), 1e-6),
  )
  return { x: node.x + dx * scale, y: node.y + dy * scale }
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

  const edges: MiniEdge[] = []
  for (const edge of scheme.edges) {
    const from = placed.get(edge.from)
    const to = placed.get(edge.to)
    if (!from || !to || from === to) continue
    const dx = to.x - from.x
    const dy = to.y - from.y
    edges.push({
      id: edge.id,
      kind: edge.kind,
      from,
      to,
      start: boundary(from, dx, dy),
      end: boundary(to, -dx, -dy),
    })
  }

  return { width: box.width, height: box.height, nodes, edges }
}
