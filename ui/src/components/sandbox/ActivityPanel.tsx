/**
 * Нижняя панель песочницы: прибита к низу окна, граница тянется мышью.
 *
 * Экран песочницы -- окно, а не страница: таймлайн раньше стоял под холстом в
 * общем потоке и на схеме из двух блоков уезжал ниже края, а чтобы его
 * увидеть, приходилось прокручивать вместе с ним и транспорт -- то есть
 * остановить прогон и смотреть спайки были двумя разными положениями скролла
 * (#504).
 *
 * Высота тянется, а не задана числом: дорожек бывает и две, и двенадцать, и
 * любая фиксированная высота неверна в одном из двух случаев. Сворачивание в
 * полоску оставлено рядом: когда смотрят схему, холст нужен целиком, а панель
 * должна сказать о себе одной строкой, а не исчезнуть.
 *
 * Высота помнится браузером (`state/desk`), а не проектом: это про экран
 * человека, а не про схему -- см. там же разбор.
 *
 * Шапка здесь одна на панель и на таймлайн. Своего заголовка у таймлайна нет
 * намеренно: два заголовка друг под другом отобрали бы строку у дорожек, ради
 * которых панель и открыта.
 */

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

import { TIMELINE_HINT } from '../live/Timeline'
import {
  PANEL_MIN,
  clampPanel,
  readPanelHeight,
  rememberPanelHeight,
} from '../../state/desk'

export interface ActivityPanelProps {
  /** Короткая сводка для свёрнутой полоски: «4 клетки · 9 Гц». */
  summary: string
  children: ReactNode
}

/** Шаг высоты с клавиатуры: тянуть мышью умеют не все и не всегда. */
const STEP = 24

export function ActivityPanel({ summary, children }: ActivityPanelProps) {
  const [height, setHeight] = useState(readPanelHeight)
  const [open, setOpen] = useState(true)
  /** Идёт ли перетаскивание -- только чтобы подсветить границу. */
  const [dragging, setDragging] = useState(false)
  const live = useRef(height)

  useEffect(() => {
    live.current = height
  }, [height])

  /**
   * Предел сверху зависит от окна: на низком экране панель в 720 px не
   * оставила бы холсту ничего. Считается на каждое движение, а не однажды:
   * окно меняют размером, и запомненный предел устарел бы молча.
   */
  const fit = (value: number): number =>
    clampPanel(Math.min(value, Math.max(PANEL_MIN, window.innerHeight - 220)))

  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (!open) return
    event.preventDefault()
    const grabY = event.clientY
    const from = live.current
    setDragging(true)

    // Панель растёт вверх: граница тянется к шапке, значит высота -- минус
    // приращение Y.
    const move = (moved: globalThis.PointerEvent): void => {
      const next = fit(from - (moved.clientY - grabY))
      live.current = next
      setHeight(next)
    }

    const drop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', drop)
      setDragging(false)
      // Запись одна, на отпускании: на каждый пиксель это было бы сотней
      // обращений к хранилищу за один жест.
      rememberPanelHeight(live.current)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', drop)
  }

  const nudge = (delta: number): void => {
    const next = fit(live.current + delta)
    live.current = next
    setHeight(next)
    rememberPanelHeight(next)
  }

  return (
    <section
      className={`ap${open ? '' : ' is-folded'}`}
      style={open ? { height: `${height}px` } : undefined}
      aria-label="Активность сети"
    >
      {open ? (
        <div
          className={`ap-grip${dragging ? ' is-live' : ''}`}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Высота панели «Активность сети»"
          tabIndex={0}
          title="Тянуть — высота панели"
          onPointerDown={startDrag}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') nudge(STEP)
            else if (event.key === 'ArrowDown') nudge(-STEP)
            else return
            event.preventDefault()
          }}
        />
      ) : null}

      <header className="ap-head">
        <button
          type="button"
          className="ap-fold"
          aria-expanded={open}
          title={open ? 'Свернуть в полоску' : 'Развернуть панель'}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="panel-title">Активность сети</span>
        <span className="mono ap-sum">{summary}</span>
        {/* Жесты названы словами: на вид они одинаковы, а щелчок откатывает
            сессию. Строка одна на весь интерфейс -- `TIMELINE_HINT`. */}
        {open ? (
          // Полный текст в `title`: на узкой панели строка обрезается
          // многоточием, и прочесть её надо уметь и тогда.
          <span className="ap-hint" title={TIMELINE_HINT}>
            {TIMELINE_HINT}
          </span>
        ) : null}
      </header>

      {open ? <div className="ap-body">{children}</div> : null}
    </section>
  )
}
