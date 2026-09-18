/**
 * Управление временем симуляции.
 *
 * «Запустить» продолжает с текущего момента, а не считает заново -- начать
 * сначала умеет только «Сброс». Это не мелочь оформления: если бы запуск
 * означал пересчёт, отмотать время назад и посмотреть, что будет дальше, было
 * бы нельзя.
 */

import type { SimState } from '../../model/sim'
import './transport.css'

export interface TransportProps {
  state: SimState
  time: number
  duration: number
  busy: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
}

const STATE_WORD: Record<SimState, string> = {
  running: 'идёт',
  paused: 'на паузе',
  finished: 'дошла до конца',
}

export function Transport({
  state,
  time,
  duration,
  busy,
  onStart,
  onPause,
  onReset,
}: TransportProps) {
  const running = state === 'running'
  const done = state === 'finished'

  return (
    <div className="tr">
      <button
        type="button"
        className="btn-primary"
        disabled={busy || done}
        title={done ? 'Прогон дошёл до конца — начните сначала «Сбросом»' : undefined}
        onClick={running ? onPause : onStart}
      >
        {running ? 'Пауза' : 'Запустить'}
      </button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={onReset}>
        Сброс
      </button>
      <span className="tr-clock mono">
        {time.toFixed(1)} / {duration.toFixed(0)} мс
      </span>
      <span className={`tr-state is-${state}`}>{STATE_WORD[state]}</span>
    </div>
  )
}
