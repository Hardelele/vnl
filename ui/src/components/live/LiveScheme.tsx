/**
 * Схема паттерна, живущая вместе с симуляцией.
 *
 * Та же раскладка, что у миниатюры в каталоге: одна схема не должна выглядеть
 * в двух местах по-разному. Разница в том, что здесь фигуры показывают
 * состояние -- насколько клетка подошла к порогу и дала ли она спайк прямо
 * сейчас.
 *
 * Заливка считается от настоящего порога клетки, а не от общего для всех
 * диапазона: у тормозных интернейронов порог другой, и общая шкала врала бы
 * про то, насколько клетка близка к разряду.
 */

import { useMemo } from 'react'

import { miniature, type MiniEdge, type MiniNode } from '../../lib/miniature'
import type { Scheme } from '../../model/types'
import type { CellState } from '../../model/sim'
import './scheme.css'

const BOX = { width: 560, height: 260, padding: 60 }

export interface Threshold {
  rest: number
  threshold: number
}

export interface LiveSchemeProps {
  scheme: Scheme
  cells: Record<string, CellState>
  thresholds: Record<string, Threshold>
}

export function LiveScheme({ scheme, cells, thresholds }: LiveSchemeProps) {
  const view = useMemo(() => miniature(scheme, BOX), [scheme])

  return (
    <svg
      className="scheme"
      viewBox={`0 0 ${view.width} ${view.height}`}
      role="img"
      aria-label="схема паттерна"
    >
      {view.edges.map((edge) => (
        <Edge key={edge.id} edge={edge} />
      ))}
      {view.nodes.map((node) => (
        <Cell
          key={node.id}
          node={node}
          state={cells[node.id]}
          scale={thresholds[node.id]}
        />
      ))}
    </svg>
  )
}

/** Насколько клетка подошла к порогу: 0 -- покой, 1 -- разряд. */
export function charge(state: CellState | undefined, scale: Threshold | undefined): number {
  if (!state || !scale) return 0
  const span = scale.threshold - scale.rest
  if (span <= 0) return 0
  return Math.min(1, Math.max(0, (state.v - scale.rest) / span))
}

function Cell({
  node,
  state,
  scale,
}: {
  node: MiniNode
  state: CellState | undefined
  scale: Threshold | undefined
}) {
  const level = charge(state, scale)
  const radius = node.inhibitory ? 6 : node.height / 2
  const kind = node.inhibitory ? 'is-inh' : 'is-exc'
  return (
    <g className={`scheme-cell ${kind}${state?.spiked ? ' is-spiking' : ''}`}>
      <rect
        x={node.x - node.width / 2}
        y={node.y - node.height / 2}
        width={node.width}
        height={node.height}
        rx={radius}
      />
      {/* Заливка -- отдельным прямоугольником поверх: так прозрачность
          меняется каждый кадр, не трогая обводку и подпись. */}
      <rect
        className="scheme-charge"
        x={node.x - node.width / 2}
        y={node.y - node.height / 2}
        width={node.width}
        height={node.height}
        rx={radius}
        opacity={level}
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
    <g className={`scheme-link is-${edge.kind}`}>
      <line x1={edge.start.x} y1={edge.start.y} x2={edge.end.x} y2={edge.end.y} />
      {edge.kind === 'inh' ? (
        <line
          className="scheme-cap"
          x1={edge.end.x - uy * 6}
          y1={edge.end.y + ux * 6}
          x2={edge.end.x + uy * 6}
          y2={edge.end.y - ux * 6}
        />
      ) : (
        <circle className="scheme-cap" cx={edge.end.x} cy={edge.end.y} r={3.5} />
      )}
    </g>
  )
}
