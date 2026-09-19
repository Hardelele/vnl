/**
 * Схема паттерна, живущая вместе с симуляцией.
 *
 * Раскладку считает ELK (`lib/place.ts`) -- тем же движком и теми же
 * настройками, что и статическая страница прогона. Пока он грузится, рисуется
 * дешёвая послойная расстановка: пустое место вместо схемы хуже, чем неточная
 * схема на полсекунды.
 *
 * Фигуры показывают состояние: насколько клетка подошла к порогу и дала ли она
 * спайк прямо сейчас. Заливка считается от настоящего порога клетки, а не от
 * общего для всех диапазона -- у тормозных интернейронов порог другой, и общая
 * шкала врала бы про то, насколько клетка близка к разряду.
 */

import { useEffect, useMemo, useState } from 'react'

import { builtinPlacement, placeScheme, type Placement } from '../../lib/place'
import type { Scheme } from '../../model/types'
import type { CellState } from '../../model/sim'
import './scheme.css'

export interface Threshold {
  rest: number
  threshold: number
}

export interface LiveSchemeProps {
  scheme: Scheme
  cells: Record<string, CellState>
  thresholds: Record<string, Threshold>
  /** Чем посчитана раскладка -- подпись в шапке панели. */
  onEngine?: (engine: Placement['engine']) => void
}

export function LiveScheme({ scheme, cells, thresholds, onEngine }: LiveSchemeProps) {
  const fallback = useMemo(() => builtinPlacement(scheme), [scheme])
  const [placement, setPlacement] = useState<Placement>(fallback)

  useEffect(() => {
    let alive = true
    setPlacement(fallback)
    placeScheme(scheme)
      .then((laid) => {
        if (!alive) return
        setPlacement(laid)
        onEngine?.(laid.engine)
      })
      // ELK не загрузился или не справился -- остаётся дешёвая раскладка.
      .catch(() => alive && onEngine?.('builtin'))
    return () => {
      alive = false
    }
  }, [scheme, fallback, onEngine])

  const pad = 14

  return (
    <svg
      className="scheme"
      viewBox={`${-pad} ${-pad} ${placement.width + pad * 2} ${placement.height + pad * 2}`}
      role="img"
      aria-label="схема паттерна"
    >
      {placement.edges.map((edge) => (
        <Edge key={edge.id} edge={edge} />
      ))}
      {placement.nodes.map((node) => (
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
  node: Placement['nodes'][number]
  state: CellState | undefined
  scale: Threshold | undefined
}) {
  const level = charge(state, scale)
  const radius = node.inhibitory ? 6 : node.height / 2
  const kind = node.inhibitory ? 'is-inh' : 'is-exc'
  const x = node.x - node.width / 2
  const y = node.y - node.height / 2
  return (
    <g className={`scheme-cell ${kind}${state?.spiked ? ' is-spiking' : ''}`}>
      <rect x={x} y={y} width={node.width} height={node.height} rx={radius} />
      {/* Заливка -- отдельным прямоугольником поверх: так прозрачность меняется
          каждый кадр, не трогая обводку и подпись. */}
      <rect
        className="scheme-charge"
        x={x}
        y={y}
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

function Edge({ edge }: { edge: Placement['edges'][number] }) {
  const points = edge.points
  const last = points[points.length - 1]
  const before = points[points.length - 2] ?? last
  if (!last || !before) return null

  const dx = last.x - before.x
  const dy = last.y - before.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const path = points
    .map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`)
    .join(' ')

  return (
    <g className={`scheme-link is-${edge.kind}`}>
      <path d={path} fill="none" />
      {edge.kind === 'inh' ? (
        // Плашка поперёк линии -- торможение.
        <line
          className="scheme-cap"
          x1={last.x - uy * 6}
          y1={last.y + ux * 6}
          x2={last.x + uy * 6}
          y2={last.y - ux * 6}
        />
      ) : (
        <circle className="scheme-cap" cx={last.x} cy={last.y} r={3.5} />
      )}
    </g>
  )
}
