/**
 * Таймлайн симуляции: растр спайков и положение во времени.
 *
 * Это история той же симуляции, а не отдельный отчёт: щелчок по дорожке ставит
 * время на выбранный момент, и сессия откатывает движок туда же. Поэтому
 * перемотка здесь -- не просмотр, а действие, и сразу после неё симуляция
 * стоит на паузе.
 *
 * Шкала одна на все дорожки и на курсор: тик «100 мс» обязан стоять на одной
 * вертикали везде, иначе дорожки нельзя читать друг под другом.
 */

import { useCallback, type PointerEvent } from 'react'

import { ticks } from '../../lib/analysis'
import './timeline.css'

/** Внутренняя ширина дорожки. Совпадать с `Plot` не обязана: обе тянутся по ширине. */
const TRACK = 1000

export interface TimelineProps {
  duration: number
  /** Где сейчас время симуляции, мс. */
  time: number
  /** Имена клеток в том порядке, в каком они стоят на схеме. */
  order: string[]
  spikes: Record<string, number[]>
  inhibitory: Record<string, boolean>
  onSeek: (time: number) => void
  disabled?: boolean
}

export function Timeline({
  duration,
  time,
  order,
  spikes,
  inhibitory,
  onSeek,
  disabled = false,
}: TimelineProps) {
  const seek = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      // Тянуть курсор можно только зажав кнопку: иначе время уезжало бы от
      // случайного движения мыши над дорожкой.
      if (event.buttons !== 1 && event.type !== 'pointerdown') return
      const box = event.currentTarget.getBoundingClientRect()
      const share = (event.clientX - box.left) / box.width
      onSeek(Math.min(Math.max(share, 0), 1) * duration)
    },
    [duration, disabled, onSeek],
  )

  const grid = ticks(duration, 8)
  const at = (moment: number) => (moment / duration) * TRACK

  return (
    <div className="tl">
      <div className={`tl-body${disabled ? ' is-off' : ''}`}>
        {order.map((name) => (
          <div className="tl-row" key={name}>
            <span className="tl-name mono">{name}</span>
            <svg
              className="tl-track"
              viewBox={`0 0 ${TRACK} 14`}
              preserveAspectRatio="none"
            >
              <line className="tl-base" x1={0} y1={7} x2={TRACK} y2={7} />
              {(spikes[name] ?? []).map((moment, index) => (
                <line
                  key={`${moment}-${index}`}
                  className={inhibitory[name] ? 'tl-spike is-inh' : 'tl-spike'}
                  x1={at(moment)}
                  y1={1}
                  x2={at(moment)}
                  y2={13}
                />
              ))}
            </svg>
            <span className="tl-count mono">{(spikes[name] ?? []).length}</span>
          </div>
        ))}

        <div className="tl-row tl-axis">
          <span className="tl-name" />
          <svg className="tl-track" viewBox={`0 0 ${TRACK} 14`} preserveAspectRatio="none">
            {grid.map((moment) => (
              <line
                key={moment}
                className="tl-tick"
                x1={at(moment)}
                y1={0}
                x2={at(moment)}
                y2={5}
              />
            ))}
          </svg>
          <span className="tl-count" />
        </div>

        <div className="tl-row tl-scale">
          <span className="tl-name" />
          <span className="tl-marks">
            {grid.map((moment) => (
              <span
                key={moment}
                className="tl-mark mono"
                style={{ left: `${(moment / duration) * 100}%` }}
              >
                {moment}
              </span>
            ))}
          </span>
          <span className="tl-count mono">мс</span>
        </div>

        {/* Накладка занимает ровно ширину дорожек: по ней и считается доля
            времени, и по ней же ловится перемотка -- иначе щелчок сдвигался бы
            на ширину колонки с именами. */}
        <div className="tl-overlay" onPointerDown={seek} onPointerMove={seek}>
          <div
            className="tl-cursor"
            style={{ left: `${(time / Math.max(duration, 1)) * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}
