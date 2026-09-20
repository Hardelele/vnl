/**
 * Схема паттерна, живущая вместе с симуляцией.
 *
 * Раскладку считает ELK (`lib/place.ts`) -- тем же движком и теми же
 * настройками, что и статическая страница прогона. Пока он грузится, рисуется
 * дешёвая послойная расстановка: пустое место вместо схемы хуже, чем неточная
 * схема на полсекунды.
 *
 * Фигуры показывают состояние: насколько клетка подошла к порогу и дала ли она
 * спайк прямо сейчас. Над каждой клеткой стоит её заряд числом -- процент пути
 * от покоя до порога. Заливка одна и та же на треть и на две трети шкалы
 * читается одинаково, а вопрос обычно именно такой: сколько уже набралось и
 * далеко ли до разряда. Поэтому число рядом с фигурой, а не в панели сбоку:
 * заряд читается там же, где виден разряд, и видно, как одна клетка набирает, а
 * соседняя её гасит.
 *
 * Долю считает сессия по параметрам каждой клетки (`CellState.charge`) -- у
 * тормозных интернейронов порог другой, и общая шкала врала бы про то,
 * насколько клетка близка к разряду.
 */

import { useEffect, useMemo, useState } from 'react'

import { chargeFill, chargeLabel, momentOf } from '../../lib/charge'
import { capLine, tipPoints } from '../../lib/marker'
import { builtinPlacement, placeScheme, type Placement } from '../../lib/place'
import type { Scheme } from '../../model/types'
import type { CellState } from '../../model/sim'
import './scheme.css'

export interface LiveSchemeProps {
  scheme: Scheme
  cells: Record<string, CellState>
  /** Чем посчитана раскладка -- подпись в шапке панели. */
  onEngine?: (engine: Placement['engine']) => void
  /** Выбранная клетка: та же, что открыта в инспекторе и подсвечена в таймлайне. */
  selected?: string | null
  onPick?: (neuron: string) => void
  /** Выбранная связь: та же, что подсвечена строкой в списке связей (#546). */
  selectedLink?: string | null
  onPickLink?: (link: string) => void
}

export function LiveScheme({
  scheme,
  cells,
  onEngine,
  selected = null,
  onPick,
  selectedLink = null,
  onPickLink,
}: LiveSchemeProps) {
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
  // Сверху места больше: там стоят надписи о заряде, и обрезать их нельзя.
  const padTop = 26

  return (
    <svg
      className="scheme"
      viewBox={`${-pad} ${-padTop} ${placement.width + pad * 2} ${placement.height + padTop + pad}`}
      role="img"
      aria-label="схема паттерна"
    >
      {placement.edges.map((edge) => (
        <Edge
          key={edge.id}
          edge={edge}
          chosen={selectedLink === edge.id}
          onPick={onPickLink}
        />
      ))}
      {placement.nodes.map((node) => (
        <Cell
          key={node.id}
          node={node}
          state={cells[node.id]}
          chosen={selected === node.id}
          onPick={onPick}
        />
      ))}
    </svg>
  )
}

function Cell({
  node,
  state,
  chosen,
  onPick,
}: {
  node: Placement['nodes'][number]
  state: CellState | undefined
  chosen: boolean
  onPick?: (neuron: string) => void
}) {
  const level = chargeFill(state?.charge)
  const label = chargeLabel(momentOf(state))
  const radius = node.inhibitory ? 6 : node.height / 2
  const kind = node.inhibitory ? 'is-inh' : 'is-exc'
  const x = node.x - node.width / 2
  const y = node.y - node.height / 2
  return (
    <g
      className={`scheme-cell ${kind}${state?.spiked ? ' is-spiking' : ''}${chosen ? ' is-on' : ''}${onPick ? ' is-pickable' : ''}`}
      onClick={() => onPick?.(node.id)}
    >
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
      {/* Заряд числом -- над фигурой: видно и сколько набралось, и что клетку
          увели ниже покоя. Внутрь не поместить -- там стоит имя клетки. */}
      {label ? (
        <text
          className={`scheme-level${label.below ? ' is-below' : ''}`}
          x={node.x}
          y={y - 5}
          textAnchor="middle"
        >
          {label.text}
        </text>
      ) : null}
    </g>
  )
}

/**
 * Связь на схеме: её же можно выбрать -- щелчком по линии (#546).
 *
 * Модуляторная линия не выбирается: её рисует не контакт, а модулятор
 * (`scheme_payload` склеивает её из источника и подопечной связи), и за ней в
 * списке связей нет строки. Курсор над ней остаётся обычным: рука над линией,
 * от щелчка по которой ничего не происходит, обещает то, чего нет.
 */
function Edge({
  edge,
  chosen = false,
  onPick,
}: {
  edge: Placement['edges'][number]
  chosen?: boolean
  onPick?: (link: string) => void
}) {
  const pickable = Boolean(onPick) && edge.kind !== 'mod'
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
    <g
      className={`scheme-link is-${edge.kind}${chosen ? ' is-on' : ''}${pickable ? ' is-pickable' : ''}`}
      onClick={pickable ? () => onPick?.(edge.id) : undefined}
    >
      {/* Прозрачная полоса поверх линии -- то, во что попадают мышью: в
          полуторапиксельную линию не прицелиться, а утолщать саму линию ради
          курсора значило бы менять схему под способ ввода. */}
      {pickable ? <path className="scheme-hit" d={path} fill="none" /> : null}
      <path d={path} fill="none" />
      {/* Знаки общие на весь проект (`lib/marker`): плашка поперёк -- это
          торможение, остриё -- возбуждение. Прежде здесь у возбуждения стоял
          кружок: он симметричен и о направлении не говорит, а «место контакта
          на ветви» значит на схеме с ветвями, которых тут нет (#524, #554). */}
      {edge.kind === 'inh' ? (
        <line className="scheme-cap" {...capLine(last, { x: ux, y: uy })} />
      ) : (
        <polygon className="scheme-cap" points={tipPoints(last, { x: ux, y: uy })} />
      )}
    </g>
  )
}
