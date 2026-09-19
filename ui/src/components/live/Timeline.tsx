/**
 * Таймлайн симуляции: активность сети по дорожкам.
 *
 * Дорожка на клетку, и в ней сразу спайки и трасса -- так в макете
 * (`design/mockups/Spike Timeline.dc.html`), и так правильнее: разряд и то, что
 * к нему привело, надо видеть вместе, а не на двух графиках друг под другом.
 *
 * Шкала времени одна на все дорожки и на курсор: тик «100 мс» обязан стоять на
 * одной вертикали везде, иначе дорожки нельзя читать друг под другом.
 *
 * Два разных действия мышью. Наведение показывает значения под указателем и
 * ничего не меняет. Щелчок ставит время симуляции на выбранный момент -- это
 * уже не просмотр, а откат: сессия восстанавливает состояние и встаёт на паузу.
 */

import { useCallback, useMemo, useState, type PointerEvent } from 'react'

import { ticks } from '../../lib/analysis'
import './timeline.css'

/** Внутренняя ширина дорожки: тянется по месту, важна только пропорция. */
const TRACK = 1000
const LANE = 100

export interface TimelineProps {
  duration: number
  /** Где сейчас время симуляции, мс. */
  time: number
  dt: number
  /** Имена клеток в том порядке, в каком они стоят на схеме. */
  order: string[]
  spikes: Record<string, number[]>
  /** Трассы по ключам вида `E.soma:v`. */
  traces: Record<string, number[]>
  inhibitory: Record<string, boolean>
  onSeek: (time: number) => void
  /** Выбранная клетка подсвечена и здесь, и в инспекторе. */
  selected?: string | null
  onSelect?: (name: string) => void
  disabled?: boolean
}

interface Lane {
  name: string
  inhibitory: boolean
  spikes: number[]
  rate: number
  trace: number[] | null
  unit: string
  low: number
  high: number
}

export function Timeline({
  duration,
  time,
  dt,
  order,
  spikes,
  traces,
  inhibitory,
  onSeek,
  selected = null,
  onSelect,
  disabled = false,
}: TimelineProps) {
  /** Где стоит указатель, мс. Это просмотр: время симуляции он не трогает. */
  const [hover, setHover] = useState<number | null>(null)

  const lanes = useMemo(
    () => order.map((name) => lane(name, spikes, traces, inhibitory, time)),
    [order, spikes, traces, inhibitory, time],
  )

  const at = useCallback(
    (event: PointerEvent<HTMLDivElement>): number => {
      const box = event.currentTarget.getBoundingClientRect()
      const part = (event.clientX - box.left) / box.width
      return Math.min(Math.max(part, 0), 1) * duration
    },
    [duration],
  )

  const grid = ticks(duration, 8)
  const share = (moment: number) => (moment / Math.max(duration, 1)) * 100
  const x = (moment: number) => (moment / Math.max(duration, 1)) * TRACK

  return (
    <div className="tl">
      <div className="tl-head">
        <span className="panel-title">Активность сети</span>
        <span className="mono tl-hover">
          {hover === null ? '' : `${hover.toFixed(1)} мс`}
        </span>
      </div>

      <div className="tl-body">
        <div className="tl-scale">
          <span className="tl-name" />
          <span className="tl-marks">
            {grid.map((moment) => (
              <span key={moment} className="mono tl-mark" style={{ left: `${share(moment)}%` }}>
                {moment}
              </span>
            ))}
          </span>
        </div>

        {lanes.map((item) => (
          <div className={`tl-lane${selected === item.name ? ' is-on' : ''}`} key={item.name}>
            <button
              type="button"
              className="tl-name"
              onClick={() => onSelect?.(item.name)}
              // Имя всё равно обрезается: у клеток собранной схемы общая
              // приставка блока, и шесть дорожек различаются её хвостом.
              title={onSelect ? `${item.name} — показать в инспекторе` : item.name}
            >
              {/* Имя клетки вперёд, блок следом: в собранной схеме приставка
                  у дорожек общая, и обрезать надо её, а не то, чем они
                  различаются. Полное имя -- в подсказке. */}
              <span className="tl-title">
                <span className={`tl-dot${item.inhibitory ? ' is-inh' : ''}`} />
                <span className="tl-cell">{cellOf(item.name)}</span>
                {ownerOf(item.name) ? (
                  <span className="tl-owner">{ownerOf(item.name)}</span>
                ) : null}
              </span>
              <span className="mono tl-stat">
                {item.spikes.length} сп. · {item.rate.toFixed(0)} Гц
              </span>
              <span className="mono tl-value">{valueAt(item, hover, dt)}</span>
            </button>

            <div
              className={`tl-field${disabled ? ' is-off' : ''}`}
              onPointerMove={(event) => setHover(at(event))}
              onPointerLeave={() => setHover(null)}
              onPointerDown={(event) => {
                if (!disabled) onSeek(at(event))
              }}
            >
              <svg className="tl-svg" viewBox={`0 0 ${TRACK} ${LANE}`} preserveAspectRatio="none">
                {grid.map((moment) => (
                  <line
                    key={moment}
                    className="tl-grid"
                    x1={x(moment)}
                    y1={0}
                    x2={x(moment)}
                    y2={LANE}
                  />
                ))}

                {item.trace ? (
                  <>
                    <path className="tl-fill" d={area(item, duration, dt)} />
                    <path className="tl-curve" d={curve(item, duration, dt)} />
                  </>
                ) : null}

                {item.spikes.map((moment, index) => (
                  <line
                    key={`${moment}-${index}`}
                    className={item.inhibitory ? 'tl-spike is-inh' : 'tl-spike'}
                    x1={x(moment)}
                    y1={item.trace ? LANE * 0.06 : LANE * 0.25}
                    x2={x(moment)}
                    y2={item.trace ? LANE * 0.4 : LANE * 0.75}
                  />
                ))}
              </svg>

              {hover === null ? null : (
                <div className="tl-hairline" style={{ left: `${share(hover)}%` }} />
              )}
              <div className="tl-cursor" style={{ left: `${share(time)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Имя нейрона в собранной сети -- `блок/клетка` (см. `compose.SEPARATOR`). */
function cellOf(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1)
}

function ownerOf(name: string): string {
  const cut = name.lastIndexOf('/')
  return cut < 0 ? '' : name.slice(0, cut)
}

/** Дорожка одной клетки: её спайки, её трасса и шкала под трассу. */
function lane(
  name: string,
  spikes: Record<string, number[]>,
  traces: Record<string, number[]>,
  inhibitory: Record<string, boolean>,
  elapsed: number,
): Lane {
  const fired = spikes[name] ?? []
  // Ключ трассы -- `E.soma:v`; секция здесь не важна, берём первую подходящую.
  const key = Object.keys(traces).find((candidate) => candidate.startsWith(`${name}.`))
  const values = key ? traces[key] ?? null : null
  const variable = key?.split(':')[1] ?? 'v'
  const span = extent(values)
  return {
    name,
    inhibitory: inhibitory[name] ?? false,
    spikes: fired,
    rate: elapsed > 0 ? (fired.length / elapsed) * 1000 : 0,
    trace: values && values.length ? values : null,
    unit: variable === 'v' ? 'мВ' : 'нСм',
    low: span.low,
    high: span.high,
  }
}

function extent(values: number[] | null): { low: number; high: number } {
  if (!values || !values.length) return { low: 0, high: 1 }
  let low = values[0] as number
  let high = low
  for (const value of values) {
    if (value < low) low = value
    if (value > high) high = value
  }
  if (high - low < 1e-6) {
    // Ровная линия: без запаса она легла бы точно на край дорожки.
    low -= 0.5
    high += 0.5
  }
  return { low, high }
}

/** Точки трассы в координатах дорожки; длинная трасса прореживается. */
function points(item: Lane, duration: number, dt: number): Array<[number, number]> {
  const values = item.trace ?? []
  const span = Math.max(item.high - item.low, 1e-6)
  const step = Math.max(1, Math.floor(values.length / TRACK))
  const out: Array<[number, number]> = []
  for (let index = 0; index < values.length; index += step) {
    const value = values[index] as number
    out.push([
      ((index * dt) / Math.max(duration, 1)) * TRACK,
      // Нижние две трети дорожки -- под трассу, верх -- под штрихи спайков.
      LANE - ((value - item.low) / span) * LANE * 0.52,
    ])
  }
  return out
}

function curve(item: Lane, duration: number, dt: number): string {
  return points(item, duration, dt)
    .map(([px, py], index) => `${index ? 'L' : 'M'} ${px.toFixed(1)} ${py.toFixed(1)}`)
    .join(' ')
}

function area(item: Lane, duration: number, dt: number): string {
  const line = points(item, duration, dt)
  if (line.length < 2) return ''
  const first = line[0] as [number, number]
  const last = line[line.length - 1] as [number, number]
  const body = line
    .map(([px, py]) => `L ${px.toFixed(1)} ${py.toFixed(1)}`)
    .join(' ')
  return `M ${first[0].toFixed(1)} ${LANE} ${body} L ${last[0].toFixed(1)} ${LANE} Z`
}

/** Значение трассы под указателем -- то, ради чего наведение и нужно. */
function valueAt(item: Lane, hover: number | null, dt: number): string {
  if (hover === null || !item.trace) return ''
  const index = Math.min(item.trace.length - 1, Math.max(0, Math.round(hover / dt)))
  const value = item.trace[index]
  return value === undefined ? '' : `${value.toFixed(1)} ${item.unit}`
}
