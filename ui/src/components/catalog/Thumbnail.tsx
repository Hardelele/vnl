/**
 * Миниатюра паттерна в каталоге.
 *
 * Рисуется из схемы, а не лежит картинкой рядом: картинка отстаёт от схемы уже
 * после первой правки, и замечают это тогда, когда по ней выбирают блок.
 *
 * Обозначения те же, что на странице прогона: возбуждающая клетка -- скруглённая,
 * тормозная -- квадратная, торможение приходит плашкой, модуляция -- янтарным
 * пунктиром. Одна и та же фигура не должна значить в двух местах разное.
 *
 * Знак стоит только у того конца, куда связь приходит, и по нему читается
 * направление: возбуждение -- острие, торможение -- плашка. Раньше у
 * возбуждения на конце была точка: на большой схеме она значит место контакта
 * на ветви, а здесь ветвей нет, и от точки оставалась одна двусмысленность --
 * `A→B` и `B→A` выглядели одинаково.
 *
 * Сами знаки описаны один раз на весь проект (`lib/marker`). Раньше их было
 * три набора -- свой здесь, свой на холсте, свой на карточке, -- и владелец
 * это увидел: «и стрелки по-другому нарисованы» (#554). Числа остались
 * здешние: их и выбрали эталоном.
 */

import { useMemo } from 'react'

import { capLine, tipPoints } from '../../lib/marker'
import { edgePath, miniature, type MiniEdge, type MiniNode } from '../../lib/miniature'
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
  // Связь -- квадратичная кривая: у прямой контрольная точка лежит на ней
  // самой, поэтому ветки на «прямую и дугу» здесь нет. Поворот знака берётся
  // из касательной в конце, а не из направления «начало -- конец»: у дуги это
  // разные вещи, и на дуге знак смотрел бы мимо клетки.
  return (
    <g className={`thumbnail-link is-${edge.kind}`}>
      <path className="thumbnail-wire" d={edgePath(edge)} />
      {edge.kind === 'inh' ? (
        <line className="thumbnail-cap" {...capLine(edge.end, edge.tip)} />
      ) : (
        <polygon className="thumbnail-cap" points={tipPoints(edge.end, edge.tip)} />
      )}
    </g>
  )
}
