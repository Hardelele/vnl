/**
 * Карточка паттерна в каталоге: миниатюра, имя, статус и что внутри.
 *
 * Строка под именем перечисляет содержимое, а не дату: библиотеку читают,
 * чтобы выбрать блок, и «2 нейрона · 1 связь · 2 порта» для этого говорит
 * больше, чем «изменён вчера».
 */

import { LINKS, NEURONS, PORTS, counted } from '../../lib/plural'
import type { Pattern } from '../../model/types'
import { Thumbnail } from './Thumbnail'
import './card.css'

export interface PatternCardProps {
  pattern: Pattern
  onOpen?: (pattern: Pattern) => void
}

export function PatternCard({ pattern, onOpen }: PatternCardProps) {
  const meta = [
    counted(pattern.counts.neurons, NEURONS),
    counted(pattern.counts.contacts, LINKS),
    counted(pattern.counts.ports, PORTS),
  ].join(' · ')

  return (
    <button
      type="button"
      className="card"
      onClick={() => onOpen?.(pattern)}
      aria-label={`${pattern.name}, ${pattern.statusName}, ${meta}`}
    >
      <span className="card-thumb">
        <Thumbnail scheme={pattern.scheme} label={`схема: ${meta}`} />
      </span>
      <span className="card-body">
        <span className="card-line">
          <span className="card-name">{pattern.name}</span>
          <span className={`card-badge is-${pattern.status}`}>{pattern.statusName}</span>
        </span>
        <span className="card-meta mono">{meta}</span>
        {pattern.problems.length ? (
          // У черновика причина недоделанности видна сразу: иначе разбираться
          // с ней придётся, уже открыв паттерн и забыв, зачем открыл.
          <span className="card-problem">{pattern.problems[0]}</span>
        ) : null}
      </span>
    </button>
  )
}
