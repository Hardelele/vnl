/**
 * Раскладка схемы для карточки паттерна.
 *
 * Считает ELK -- тот же движок, что и у статической страницы прогона, и с теми
 * же настройками. Своя послойная расстановка (`miniature`) для карточки не
 * годится: она ставит все клетки одного слоя на одну линию, и прямая связь
 * IN -> E проходит сквозь стоящий между ними тормозный нейрон. Получается, что
 * схема читается как цепочка IN -> I -> E, хотя весь смысл feed-forward
 * inhibition в том, что вход возбуждает выход напрямую и одновременно гонит
 * торможение в обход. Картинка, которая врёт про механизм, хуже, чем никакой.
 *
 * ELK грузится по требованию: полтора мегабайта ради экрана, куда заходят не
 * всегда, не должны лежать в основном бандле. Пока он грузится и если не
 * загрузится вовсе, рисуется дешёвая раскладка -- она неточная, но мгновенная.
 */

import { miniature, nodeWidth, type MiniatureBox } from './miniature'
import type { EdgeKind, Scheme } from '../model/types'

export interface PlacedNode {
  id: string
  inhibitory: boolean
  /** Центр фигуры. */
  x: number
  y: number
  width: number
  height: number
}

export interface PlacedEdge {
  id: string
  kind: EdgeKind
  /** Ломаная от источника к цели: ELK разводит связи вокруг чужих фигур. */
  points: Array<{ x: number; y: number }>
}

export interface Placement {
  width: number
  height: number
  nodes: PlacedNode[]
  edges: PlacedEdge[]
  /** Чем посчитано -- это видно в шапке панели, как в макете. */
  engine: 'elk' | 'builtin'
}

const NODE_HEIGHT = 30
const BOX: MiniatureBox = { width: 560, height: 260, padding: 60 }

/** Настройки те же, что у `vnl.layout`: одна схема не должна выглядеть двояко. */
const OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'POLYLINE',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  'elk.spacing.nodeNode': '48',
  'elk.spacing.edgeEdge': '18',
  'elk.spacing.edgeNode': '24',
  'elk.layered.mergeEdges': 'false',
}

/** Мгновенная раскладка на случай, пока ELK не ответил. */
export function builtinPlacement(scheme: Scheme): Placement {
  const view = miniature(scheme, BOX)
  return {
    width: view.width,
    height: view.height,
    engine: 'builtin',
    nodes: view.nodes.map((node) => ({
      id: node.id,
      inhibitory: node.inhibitory,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    })),
    edges: view.edges.map((edge) => ({
      id: edge.id,
      kind: edge.kind,
      points: [edge.start, edge.end],
    })),
  }
}

export async function placeScheme(scheme: Scheme): Promise<Placement> {
  if (!scheme.neurons.length) return builtinPlacement(scheme)

  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const inhibitory = new Map(scheme.neurons.map((n) => [n.id, n.inhibitory]))
  const kinds = new Map(scheme.edges.map((edge) => [edge.id, edge.kind]))

  const graph = {
    id: 'root',
    layoutOptions: OPTIONS,
    children: scheme.neurons.map((neuron) => ({
      id: neuron.id,
      width: nodeWidth(neuron.id) + 12,
      height: NODE_HEIGHT,
    })),
    edges: scheme.edges
      .filter((edge) => inhibitory.has(edge.from) && inhibitory.has(edge.to))
      .map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
  }

  const laid = await new ELK().layout(graph)
  const nodes: PlacedNode[] = (laid.children ?? []).map((child) => ({
    id: child.id,
    inhibitory: inhibitory.get(child.id) ?? false,
    // ELK отдаёт левый верхний угол, а рисуем мы от центра.
    x: (child.x ?? 0) + (child.width ?? 0) / 2,
    y: (child.y ?? 0) + (child.height ?? 0) / 2,
    width: child.width ?? 0,
    height: child.height ?? 0,
  }))

  const edges: PlacedEdge[] = []
  for (const edge of laid.edges ?? []) {
    const section = edge.sections?.[0]
    if (!section) continue
    edges.push({
      id: edge.id,
      kind: kinds.get(edge.id) ?? 'exc',
      points: [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      ].map((point) => ({ x: point.x, y: point.y })),
    })
  }

  return {
    width: laid.width ?? BOX.width,
    height: laid.height ?? BOX.height,
    nodes,
    edges,
    engine: 'elk',
  }
}
