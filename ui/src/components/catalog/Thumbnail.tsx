/**
 * Миниатюра паттерна в каталоге.
 *
 * Рисуется из схемы, а не лежит картинкой рядом: картинка отстаёт от схемы уже
 * после первой правки, и замечают это тогда, когда по ней выбирают блок.
 *
 * Обозначения те же, что на странице прогона: возбуждающая клетка -- скруглённая,
 * тормозная -- квадратная, торможение приходит плашкой, модуляция -- янтарным
 * пунктиром. Одна и та же фигура не должна значить в двух местах разное.
 */

import { useMemo } from 'react'

import { miniature, type MiniEdge, type MiniNode } from '../../lib/miniature'
import type { Scheme } from '../../model/types'
import './thumbnail.css'

export interface ThumbnailProps {
  scheme: Scheme
  /** Подпись для тех, кто читает экран не глазами. */
  label?: string
}

export function Thumbnail({ scheme, label }: ThumbnailProps) {
  const view = useMemo(() => miniature(scheme), [scheme])
  const empty = view.nodes.length === 0

  return (
    <svg
      className="thumbnail"
      viewBox={`0 0 ${view.width} ${view.height}`}
      role="img"
      aria-label={label ?? describe(view.nodes.length, view.edges.length)}
      preserveAspectRatio="xMidYMid meet"
    >
      {empty ? (
        <rect
          className="thumbnail-empty"
          x={1}
          y={1}
          width={view.width - 2}
          height={view.height - 2}
          rx={8}
        />
      ) : null}
      {view.edges.map((edge) => (
        <Edge key={edge.id} edge={edge} />
      ))}
      {view.nodes.map((node) => (
        <Cell key={node.id} node={node} />
      ))}
    </svg>
  )
}

function describe(neurons: number, edges: number): string {
  if (!neurons) return 'схема пока пуста'
  return `схема: ${neurons} кл., ${edges} св.`
}

function Cell({ node }: { node: MiniNode }) {
  // Тормозная клетка -- квадратная, возбуждающая -- скруглённая: разница видна
  // и там, где цвета нет, например в чёрно-белой печати.
  const radius = node.inhibitory ? 4 : node.height / 2
  return (
    <g className={node.inhibitory ? 'thumbnail-cell is-inh' : 'thumbnail-cell'}>
      <rect
        x={node.x - node.width / 2}
        y={node.y - node.height / 2}
        width={node.width}
        height={node.height}
        rx={radius}
      />
      <text x={node.x} y={node.y} dominantBaseline="central" textAnchor="middle">
        {node.id}
      </text>
    </g>
  )
}

function Edge({ edge }: { edge: MiniEdge }) {
  const dx = edge.end.x - edge.start.x
  const dy = edge.end.y - edge.start.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length

  return (
    <g className={`thumbnail-link is-${edge.kind}`}>
      <line x1={edge.start.x} y1={edge.start.y} x2={edge.end.x} y2={edge.end.y} />
      {edge.kind === 'inh' ? (
        <line
          className="thumbnail-cap"
          x1={edge.end.x - uy * 4}
          y1={edge.end.y + ux * 4}
          x2={edge.end.x + uy * 4}
          y2={edge.end.y - ux * 4}
        />
      ) : (
        <circle className="thumbnail-cap" cx={edge.end.x} cy={edge.end.y} r={2.4} />
      )}
    </g>
  )
}
