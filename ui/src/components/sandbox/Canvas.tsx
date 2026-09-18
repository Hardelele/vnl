/**
 * Холст песочницы: блоки с портами и связи между ними.
 *
 * Паттерн показан одним блоком, а не своей начинкой: на холсте важно, что с
 * чем соединено, а внутренности блока не редактируются -- для переделки есть
 * Fork. Соединение делается щелчком по порту, а не протягиванием линии:
 * протягивание требует зажатой кнопки и промаха не прощает, а щелчок по
 * кружку порта одинаково работает и мышью, и пальцем.
 *
 * Подсветка блока -- его собственная активность: в собранной сети клетки блока
 * получают имена с приставкой (`ffi/E`), по ним и видно, спайкнул ли кто-то
 * внутри прямо сейчас.
 */

import { useState, type PointerEvent } from 'react'

import type { CellState } from '../../model/sim'
import type { SandboxBlock, SandboxLink } from '../../model/sandbox'
import type { Pending, Selection } from '../../state/sandbox'
import './canvas.css'

const WIDTH = 760
const HEIGHT = 420
const BOX = { width: 150, height: 62 }

export type Point = { x: number; y: number }

export interface CanvasProps {
  blocks: SandboxBlock[]
  links: SandboxLink[]
  cells: Record<string, CellState>
  selected: Selection | null
  pending: Pending | null
  onPickBlock: (id: string) => void
  onPickLink: (id: string) => void
  onPickPort: (instance: string, port: string) => void
  onMove: (id: string, position: [number, number]) => void
  onEmpty: () => void
}

/** Точка порта на краю блока: входы слева, выходы и модуляция справа. */
export function portPoint(
  block: SandboxBlock,
  port: string,
  position: [number, number] = block.position,
): Point | null {
  const item = block.ports.find((candidate) => candidate.name === port)
  if (!item) return null
  const left = item.direction === 'in'
  const side = block.ports.filter(
    (candidate) => (candidate.direction === 'in') === left,
  )
  const index = side.findIndex((candidate) => candidate.name === port)
  const step = BOX.height / (side.length + 1)
  return {
    x: left ? position[0] : position[0] + BOX.width,
    y: position[1] + step * (index + 1),
  }
}

/** Имя блока в одну строку: длинное вылезает за коробку, а коробка фиксирована. */
export function short(label: string, limit = 18): string {
  return label.length <= limit ? label : label.slice(0, limit - 1).trimEnd() + '…'
}

function spiking(block: SandboxBlock, cells: Record<string, CellState>): boolean {
  return block.scheme.neurons.some((neuron) => cells[`${block.id}/${neuron.id}`]?.spiked)
}

export function Canvas({
  blocks,
  links,
  cells,
  selected,
  pending,
  onPickBlock,
  onPickLink,
  onPickPort,
  onMove,
  onEmpty,
}: CanvasProps) {
  /** Блок, который сейчас тащат. Пока тащат -- рисуем его из этого состояния. */
  const [drag, setDrag] = useState<{ id: string; position: [number, number] } | null>(
    null,
  )

  const positionOf = (block: SandboxBlock): [number, number] =>
    drag && drag.id === block.id ? drag.position : block.position

  const startDrag = (event: PointerEvent<SVGGElement>, block: SandboxBlock): void => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const scale = WIDTH / svg.getBoundingClientRect().width
    const grabX = event.clientX
    const grabY = event.clientY
    const [startX, startY] = block.position

    const where = (moved: { clientX: number; clientY: number }): [number, number] => [
      Math.round(startX + (moved.clientX - grabX) * scale),
      Math.round(startY + (moved.clientY - grabY) * scale),
    ]

    const move = (moved: globalThis.PointerEvent): void =>
      setDrag({ id: block.id, position: where(moved) })

    const drop = (dropped: globalThis.PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', drop)
      setDrag(null)
      const [x, y] = where(dropped)
      // Сдвиг отправляется один раз, на отпускании: холст физику не меняет, а
      // каждый промежуточный пиксель в истории отмены только мешал бы.
      if (Math.abs(x - startX) > 2 || Math.abs(y - startY) > 2) {
        onMove(block.id, [x, y])
      }
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', drop)
  }

  return (
    <svg
      className="canvas"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onEmpty()
      }}
    >
      {links.map((link) => (
        <Link
          key={link.id}
          link={link}
          blocks={blocks}
          positionOf={positionOf}
          selected={selected?.kind === 'link' && selected.id === link.id}
          onPick={() => onPickLink(link.id)}
        />
      ))}

      {blocks.map((block) => {
        const [x, y] = positionOf(block)
        const chosen = selected?.kind === 'block' && selected.id === block.id
        const active = spiking(block, cells)
        return (
          <g
            key={block.id}
            className={`cv-block${chosen ? ' is-on' : ''}${active ? ' is-spiking' : ''}`}
            onPointerDown={(event) => startDrag(event, block)}
            onClick={() => onPickBlock(block.id)}
          >
            <rect x={x} y={y} width={BOX.width} height={BOX.height} rx={10} />
            <text className="cv-label" x={x + BOX.width / 2} y={y + 26} textAnchor="middle">
              {short(block.label)}
              <title>{block.label}</title>
            </text>
            <text className="cv-sub" x={x + BOX.width / 2} y={y + 44} textAnchor="middle">
              {block.counts.neurons} кл. · {block.counts.contacts} св.
            </text>

            {block.ports.map((port) => {
              const point = portPoint(block, port.name, [x, y])
              if (!point) return null
              const waiting = pending?.instance === block.id && pending.port === port.name
              return (
                <g
                  key={port.name}
                  className={`cv-port is-${port.direction}${waiting ? ' is-waiting' : ''}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onPickPort(block.id, port.name)
                  }}
                >
                  <circle cx={point.x} cy={point.y} r={5} />
                  <text
                    className="cv-port-name"
                    x={port.direction === 'in' ? point.x - 9 : point.x + 9}
                    y={point.y + 3}
                    textAnchor={port.direction === 'in' ? 'end' : 'start'}
                  >
                    {port.name}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}

      {blocks.length === 0 ? (
        <text className="cv-empty" x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle">
          Пусто. Вставьте паттерн из библиотеки слева.
        </text>
      ) : null}
    </svg>
  )
}

function Link({
  link,
  blocks,
  positionOf,
  selected,
  onPick,
}: {
  link: SandboxLink
  blocks: SandboxBlock[]
  positionOf: (block: SandboxBlock) => [number, number]
  selected: boolean
  onPick: () => void
}) {
  const from = blocks.find((block) => block.id === link.source.instance)
  const to = blocks.find((block) => block.id === link.target.instance)
  if (!from || !to || !link.source.port || !link.target.port) return null
  const start = portPoint(from, link.source.port, positionOf(from))
  const end = portPoint(to, link.target.port, positionOf(to))
  if (!start || !end) return null

  // Связь ведётся кривой: две прямые между соседними блоками сливаются, и
  // какая куда идёт -- уже не разобрать.
  const bend = Math.max(30, Math.abs(end.x - start.x) / 2)
  const path = `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`

  return (
    <g
      className={`cv-link${link.inhibitory ? ' is-inh' : ''}${selected ? ' is-on' : ''}`}
      onClick={onPick}
    >
      <path className="cv-hit" d={path} fill="none" />
      <path className="cv-wire" d={path} fill="none" />
      {link.inhibitory ? (
        <line
          className="cv-cap"
          x1={end.x - 1}
          y1={end.y - 6}
          x2={end.x - 1}
          y2={end.y + 6}
        />
      ) : (
        <circle className="cv-cap" cx={end.x} cy={end.y} r={3} />
      )}
    </g>
  )
}
