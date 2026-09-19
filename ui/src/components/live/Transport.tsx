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
  /**
   * Запуск не продолжит эту симуляцию, а соберёт сеть заново: схему правили,
   * и прежний прогон -- о другой сети. Дошедший до конца прогон тогда запуску
   * не помеха: продолжать в нём и правда нечего, но считать есть что.
   */
  restart?: boolean
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
  restart = false,
}: TransportProps) {
  const running = state === 'running'
  const done = state === 'finished' && !restart

  return (
    <div className="tr">
      <button
        type="button"
        className="btn-primary"
        disabled={busy || done}
        title={
          done
            ? 'Прогон дошёл до конца — начните сначала «Сбросом»'
            : restart
              ? 'Схема изменилась — сеть соберётся заново'
              : undefined
        }
        onClick={running ? onPause : onStart}
      >
        {running ? 'Пауза' : restart ? 'Запустить заново' : 'Запустить'}
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
