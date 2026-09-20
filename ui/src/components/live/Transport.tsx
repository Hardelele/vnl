/**
 * Управление временем симуляции.
 *
 * «Запустить» продолжает с текущего момента, а не считает заново -- начать
 * сначала умеет только «Сброс». Это не мелочь оформления: если бы запуск
 * означал пересчёт, отмотать время назад и посмотреть, что будет дальше, было
 * бы нельзя.
 *
 * Шаг по миллисекунде -- второй способ двигать время, и он здесь, а не на
 * таймлайне. На таймлайне время ставят щелчком, то есть попаданием мышью: при
 * прогоне 400 мс на 700 пикселях один пиксель -- 0.57 мс, и встать ровно на
 * нужную миллисекунду нельзя в принципе, а дважды на ту же -- тем более.
 * Кнопка и стрелка дают ровную величину, и повторить её можно сколько угодно
 * раз (#537).
 *
 * Шаг -- не то же, что перемотка, и сессия это различает: разряд, попавший
 * внутрь шага, показывается, а попавший в прыжок курсором -- нет
 * (`live.Session.step`). Отсюда и разные вызовы у контроллера, `step` и
 * `seek`, а не один с догадкой по величине.
 */

import { useEffect } from 'react'

import type { SimState } from '../../model/sim'
import './transport.css'

/** Обычный шаг, мс. Миллисекунда -- та величина, которой мерят задержки. */
export const STEP_MS = 1
/**
 * Крупный шаг, мс -- с Shift.
 *
 * Десять: столько стоит задержка проведения в `synaptic_delay` и столько же
 * примерно длится постсинаптический ответ, то есть это шаг «на событие
 * вперёд», а не «на кадр вперёд».
 */
export const BIG_STEP_MS = 10

export interface TransportProps {
  state: SimState
  time: number
  duration: number
  busy: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  /** Шаг по времени: вперёд -- кадр с разрядом, назад -- состояние. */
  onStep: (delta: number) => void
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

/** Набирают ли сейчас текст: тогда стрелки принадлежат полю, а не времени. */
function typing(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null
  if (!node || !node.tagName) return false
  if (node.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)
}

export function Transport({
  state,
  time,
  duration,
  busy,
  onStart,
  onPause,
  onReset,
  onStep,
  restart = false,
}: TransportProps) {
  const running = state === 'running'
  const done = state === 'finished' && !restart
  // Шагать назад с нуля и вперёд с конца некуда, и кнопка об этом говорит
  // заранее -- иначе нажатие выглядело бы сработавшим, а время стояло бы.
  const atStart = time <= 0
  const atEnd = duration > 0 && time >= duration

  /**
   * Стрелки шагают по времени, Shift делает шаг крупным.
   *
   * Слушатель на окне, а не на кнопках: шагают, глядя на схему и на таймлайн,
   * и требовать сперва попасть фокусом в кнопку значило бы отдать клавишу
   * тому, кто на ней стоит. Поэтому же проверяется, не набирают ли текст: в
   * поле имени песочницы стрелка двигает курсор в слове, и отбирать её у него
   * нельзя.
   *
   * С Ctrl не срабатываем: Ctrl с колесом на таймлайне приближает время
   * (#548), Ctrl со стрелкой -- ходьба по словам и переключение вкладок, и
   * перехватывать чужие сочетания не за чем.
   */
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (typing(event.target)) return
      const back = event.key === 'ArrowLeft'
      if (!back && event.key !== 'ArrowRight') return
      if (busy || (back ? atStart : atEnd)) return
      // Иначе страница уедет вбок: поле дорожек при масштабе шире окна.
      event.preventDefault()
      onStep((back ? -1 : 1) * (event.shiftKey ? BIG_STEP_MS : STEP_MS))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [busy, atStart, atEnd, onStep])

  const step = (back: boolean) => (event: { shiftKey: boolean }) =>
    onStep((back ? -1 : 1) * (event.shiftKey ? BIG_STEP_MS : STEP_MS))

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
      {/* Шаг стоит по бокам от часов: он двигает ровно то число, которое на них
          написано, и читается вместе с ним. */}
      <button
        type="button"
        className="btn-secondary tr-step"
        disabled={busy || atStart}
        aria-label="Шаг назад на миллисекунду"
        title={`На ${STEP_MS} мс назад (стрелка влево; с Shift — ${BIG_STEP_MS} мс). Показано состояние на этот момент`}
        onClick={step(true)}
      >
        −1 мс
      </button>
      <span className="tr-clock mono">
        {time.toFixed(1)} / {duration.toFixed(0)} мс
      </span>
      <button
        type="button"
        className="btn-secondary tr-step"
        disabled={busy || atEnd}
        aria-label="Шаг вперёд на миллисекунду"
        title={`На ${STEP_MS} мс вперёд (стрелка вправо; с Shift — ${BIG_STEP_MS} мс). Разряд внутри шага будет показан`}
        onClick={step(false)}
      >
        +1 мс
      </button>
      <span className={`tr-state is-${state}`}>{STATE_WORD[state]}</span>
    </div>
  )
}
