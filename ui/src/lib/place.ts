/**
 * Раскладка схемы для карточки паттерна -- и для холста песочницы (#543).
 *
 * Граф у них разный: на карточке это клетки паттерна, на холсте -- объекты
 * проекта, блоки и клетки вперемешку. Движок и настройки одни и те же
 * (`placeBoxes`): две настройки разошлись бы незаметно. Разница в том, что
 * карточка раскладку показывает, а песочница записывает её в проект.
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

/**
 * Узел раскладки: имя и размер той фигуры, которая на самом деле нарисована.
 *
 * Размер обязателен и настоящий. ELK раздвигает узлы по их габаритам, и
 * одинаковые квадраты вместо фигур дали бы раскладку не этой схемы: раскрытый
 * блок вчетверо больше клетки и обязан занимать вчетверо больше места.
 */
export interface LayoutBox {
  id: string
  width: number
  height: number
}

export interface LayoutEdge {
  id: string
  from: string
  to: string
}

/** Место, посчитанное ELK: левый верхний угол фигуры. */
export interface LaidBox extends LayoutBox {
  x: number
  y: number
}

export interface LaidGraph {
  width: number
  height: number
  boxes: LaidBox[]
  edges: Array<{ id: string; points: Array<{ x: number; y: number }> }>
}

/**
 * Раскладка графа из прямоугольников -- одна на всех, кто её просит.
 *
 * Схема карточки и холст песочницы раскладывают разные графы (клетки паттерна
 * и объекты проекта), но одним движком и с одними настройками: две настройки
 * разошлись бы незаметно, и один и тот же блок читался бы в витрине цепочкой,
 * а в рабочем месте развилкой.
 */
export async function placeBoxes(
  boxes: LayoutBox[],
  edges: LayoutEdge[],
): Promise<LaidGraph> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const known = new Set(boxes.map((box) => box.id))
  const laid = await new ELK().layout({
    id: 'root',
    layoutOptions: OPTIONS,
    children: boxes.map((box) => ({ ...box })),
    edges: edges
      // Связь в исчезнувший узел ELK принимает за ошибку графа и бросает
      // целиком, а на холсте такая связь бывает видна.
      .filter((edge) => known.has(edge.from) && known.has(edge.to))
      .map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
  })
  return {
    width: laid.width ?? 0,
    height: laid.height ?? 0,
    boxes: (laid.children ?? []).map((child) => ({
      id: child.id,
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? 0,
      height: child.height ?? 0,
    })),
    edges: (laid.edges ?? []).flatMap((edge) => {
      const section = edge.sections?.[0]
      if (!section) return []
      return [
        {
          id: edge.id,
          points: [
            section.startPoint,
            ...(section.bendPoints ?? []),
            section.endPoint,
          ].map((point) => ({ x: point.x, y: point.y })),
        },
      ]
    }),
  }
}

export async function placeScheme(scheme: Scheme): Promise<Placement> {
  if (!scheme.neurons.length) return builtinPlacement(scheme)

  const inhibitory = new Map(scheme.neurons.map((n) => [n.id, n.inhibitory]))
  const kinds = new Map(scheme.edges.map((edge) => [edge.id, edge.kind]))

  const laid = await placeBoxes(
    scheme.neurons.map((neuron) => ({
      id: neuron.id,
      width: nodeWidth(neuron.id) + 12,
      height: NODE_HEIGHT,
    })),
    scheme.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to })),
  )

  return {
    width: laid.width || BOX.width,
    height: laid.height || BOX.height,
    // ELK отдаёт левый верхний угол, а рисуем мы от центра.
    nodes: laid.boxes.map((box) => ({
      id: box.id,
      inhibitory: inhibitory.get(box.id) ?? false,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      width: box.width,
      height: box.height,
    })),
    edges: laid.edges.map((edge) => ({
      id: edge.id,
      kind: kinds.get(edge.id) ?? 'exc',
      points: edge.points,
    })),
    engine: 'elk',
  }
}
