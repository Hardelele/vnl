/**
 * График на временной оси.
 *
 * Все графики интерфейса рисуются этим примитивом, поэтому у них одинаковая
 * геометрия: левая колонка подписей ровно `--track-label`, область построения
 * во всю оставшуюся ширину. Только так тик «100 мс» стоит на одной вертикали
 * во всех блоках и их можно читать друг под другом.
 */

import { useCallback, type PointerEvent, type ReactNode } from 'react'

import { moveCursor, useUi } from '../../state/store'
import { niceStep, ticks } from '../../lib/analysis'
import './plot.css'

/** Внутренние координаты SVG. Растягивается по ширине, поэтому важна только
 *  пропорция; толщина линий компенсируется non-scaling-stroke. */
export const VB_W = 1000

export interface Series {
  points: Array<[number, number]>
  color: string
  /** Заливка до нуля или до низа шкалы -- для проводимостей и баланса. */
  fill?: 'zero' | 'bottom' | 'none'
  width?: number
  dashed?: boolean
  opacity?: number
  label?: string
}

export interface Marker {
  value: number
  label: string
  color?: string
}

export interface PlotProps {
  name: string
  kind: string
  /** Окно по оси времени. Для обычных трасс это [0, длительность прогона],
   *  для усреднённого отклика -- окно вокруг спайка, например [-20, 40]. */
  from?: number
  to: number
  low: number
  high: number
  series: Series[]
  height?: number
  /** Горизонтальные отметки: порог, ноль. */
  markers?: Marker[]
  /** Моменты событий: спайки самой клетки. */
  events?: { times: number[]; color: string }
  levels?: number[]
  stat?: ReactNode
  showAxis?: boolean
  /** Курсор времени имеет смысл только на общей шкале прогона. */
  interactive?: boolean
  axisUnit?: string
}

function format(value: number, digits: number): string {
  return value.toFixed(digits).replace('-', '−')
}

function digitsFor(span: number): number {
  if (span >= 50) return 0
  if (span >= 5) return 1
  return 2
}

export function Plot({
  name,
  kind,
  from = 0,
  to,
  low,
  high,
  series,
  height = 132,
  markers = [],
  events,
  levels,
  stat,
  showAxis = false,
  interactive = true,
  axisUnit = 'мс',
}: PlotProps) {
  const cursor = useUi((state) => (interactive ? state.cursor : null))
  const span = to - from

  const x = useCallback(
    (time: number) => ((time - from) / span) * VB_W,
    [from, span],
  )
  const y = useCallback(
    (value: number) => ((high - value) / (high - low)) * 100,
    [high, low],
  )

  const onMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!interactive) return
      const box = event.currentTarget.getBoundingClientRect()
      const share = (event.clientX - box.left) / box.width
      moveCursor(from + Math.min(Math.max(share, 0), 1) * span)
    },
    [from, span, interactive],
  )

  const grid = gridTicks(from, to)
  const scale = levels ?? defaultLevels(low, high)
  const digits = digitsFor(high - low)

  return (
    <figure className="plot">
      <div className="plot-head">
        <span className="plot-name mono">{name}</span>
        <span className="plot-kind">{kind}</span>
        {stat ? <span className="plot-stat mono">{stat}</span> : null}
      </div>

      <div className="plot-row">
        <div className="plot-gutter">
          {scale.map((level) => (
            <span
              key={level}
              className="plot-level mono"
              style={{ top: `${y(level)}%` }}
            >
              {format(level, digits)}
            </span>
          ))}
        </div>

        <div
          className="plot-area"
          style={{ height }}
          onPointerMove={onMove}
          onPointerLeave={() => (interactive ? moveCursor(null) : undefined)}
        >
          <svg
            viewBox={`0 0 ${VB_W} 100`}
            preserveAspectRatio="none"
            className="plot-svg"
            role="img"
            aria-label={`${name}: ${kind}`}
          >
            {grid.map((tick) => (
              <line
                key={tick}
                className="plot-grid"
                x1={x(tick)}
                x2={x(tick)}
                y1={0}
                y2={100}
              />
            ))}
            {scale.map((level) => (
              <line
                key={level}
                className="plot-grid-y"
                x1={0}
                x2={VB_W}
                y1={y(level)}
                y2={y(level)}
              />
            ))}

            {series.map((item, index) => {
              const path = toPath(item.points, x, y)
              if (!path) return null
              const base = item.fill === 'zero' ? y(0) : 100
              return (
                <g key={index}>
                  {item.fill && item.fill !== 'none' ? (
                    <path
                      className="plot-fill"
                      style={{ fill: item.color }}
                      d={`${path} L${x(last(item.points))},${base} L${x(first(item.points))},${base} Z`}
                    />
                  ) : null}
                  <path
                    className={`plot-line${item.dashed ? ' plot-dashed' : ''}`}
                    style={{
                      stroke: item.color,
                      strokeWidth: item.width ?? 1.4,
                      opacity: item.opacity ?? 1,
                    }}
                    d={path}
                  />
                </g>
              )
            })}

            {markers.map((marker) => (
              <line
                key={marker.label}
                className="plot-marker"
                style={marker.color ? { stroke: marker.color } : undefined}
                x1={0}
                x2={VB_W}
                y1={y(marker.value)}
                y2={y(marker.value)}
              />
            ))}

            {events
              ? events.times.map((time, index) => (
                  <line
                    key={index}
                    className="plot-event"
                    style={{ stroke: events.color }}
                    x1={x(time)}
                    x2={x(time)}
                    y1={0}
                    y2={8}
                  />
                ))
              : null}
          </svg>

          {markers.map((marker) => (
            <span
              key={marker.label}
              className="plot-marker-label mono"
              style={{ top: `${y(marker.value)}%` }}
            >
              {marker.label}
            </span>
          ))}

          {cursor !== null ? (
            <div
              className="plot-cursor"
              style={{ left: `${((cursor - from) / span) * 100}%` }}
            />
          ) : null}
        </div>
      </div>

      {showAxis ? (
        <div className="plot-row plot-axis-row">
          <div />
          <div className="plot-axis">
            {grid.map((tick, index) => (
              <span
                key={tick}
                className={`plot-tick mono${index === 0 ? ' plot-tick-first' : ''}${
                  index === grid.length - 1 ? ' plot-tick-last' : ''
                }`}
                style={{ left: `${((tick - from) / span) * 100}%` }}
              >
                {tick}
                {index === grid.length - 1 ? ` ${axisUnit}` : ''}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </figure>
  )
}

/** Сетка по времени: у окна вокруг спайка начало отрицательное, поэтому
 *  круглые отметки считаются от нуля в обе стороны. */
function gridTicks(from: number, to: number): number[] {
  if (from === 0) return ticks(to)
  const step = niceStep(to - from, 6)
  const out: number[] = []
  for (let value = Math.ceil(from / step) * step; value <= to + 1e-9; value += step) {
    out.push(Number(value.toFixed(6)))
  }
  return out
}


function defaultLevels(low: number, high: number): number[] {
  const middle = (low + high) / 2
  return [high, middle, low]
}

function first(points: Array<[number, number]>): number {
  return points[0]?.[0] ?? 0
}

function last(points: Array<[number, number]>): number {
  return points[points.length - 1]?.[0] ?? 0
}

function toPath(
  points: Array<[number, number]>,
  x: (time: number) => number,
  y: (value: number) => number,
): string {
  if (points.length === 0) return ''
  const parts: string[] = []
  for (const [time, value] of points) {
    parts.push(`${parts.length === 0 ? 'M' : 'L'}${x(time).toFixed(1)},${y(value).toFixed(2)}`)
  }
  return parts.join(' ')
}
