/**
 * Холст песочницы: блоки с портами, отдельные клетки и связи между ними.
 *
 * Паттерн показан одним блоком, а не своей начинкой: на холсте важно, что с
 * чем соединено, а внутренности блока не редактируются -- для переделки есть
 * Fork. Соединение делается щелчком по порту, а не протягиванием линии:
 * протягивание требует зажатой кнопки и промаха не прощает, а щелчок по
 * кружку порта одинаково работает и мышью, и пальцем.
 *
 * Клетка -- не маленький блок, и рисуется она иначе: фигурой без портов.
 * Обозначения те же, что в миниатюре каталога и на схеме прогона
 * (`Thumbnail`, `miniature`): возбуждающая скруглённая, тормозная квадратная --
 * так разница читается и там, где цвета нет. Тормозность приходит с сервера
 * полем `inhibitory`; считать её здесь значило бы завести второе место, где
 * это слово означает своё.
 *
 * Соединяется клетка точкой на себе, а не портом: у неё одна точка подключения
 * -- сома, и щелчок по ней выбирает конец связи с пустым портом. Фиктивный
 * порт «сома» пришлось бы поддерживать и на сервере, где его нет.
 *
 * Подсветка блока -- его собственная активность: в собранной сети клетки блока
 * получают имена с приставкой (`ffi/E`). Отдельная клетка светится по своему
 * имени -- приставки у неё нет, она и есть объект схемы.
 */

import { useState, type PointerEvent } from 'react'

import type { CellState } from '../../model/sim'
import type { SandboxBlock, SandboxLink, SandboxNeuron } from '../../model/sandbox'
import type { Pending, Selection } from '../../state/sandbox'
import './canvas.css'

const WIDTH = 760
const HEIGHT = 420
const BOX = { width: 150, height: 62 }
/** Фигура клетки. Уже блока: у неё нет ни портов, ни счётчиков внутри. */
const DOT = { width: 74, height: 38 }

export type Point = { x: number; y: number }

export interface CanvasProps {
  blocks: SandboxBlock[]
  neurons: SandboxNeuron[]
  links: SandboxLink[]
  cells: Record<string, CellState>
  selected: Selection | null
  pending: Pending | null
  onPickBlock: (id: string) => void
  onPickNeuron: (id: string) => void
  onPickLink: (id: string) => void
  /** Конец связи: порт блока или точка клетки (`port: null`). */
  onPickEndpoint: (instance: string, port: string | null) => void
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

/**
 * Точка, за которую клетку соединяют, -- её сома.
 *
 * Рисуется справа, где у блока выходы: связь читается слева направо. Это
 * только место на картинке: адрес у клетки один и тот же, с какой бы стороны
 * связь к ней ни подходила, -- порта у неё нет вовсе.
 */
export function somaPoint(position: [number, number]): Point {
  return { x: position[0] + DOT.width / 2, y: position[1] }
}

/**
 * Где связь касается объекта: у блока -- его порт, у клетки -- край фигуры.
 *
 * Край, а не центр: линия, упирающаяся в середину фигуры, перечёркивает
 * подпись, а знак на её конце пропадает под заливкой. Сторона выбирается по
 * ходу связи -- уходит справа, приходит слева.
 */
export function endpointPoint(
  endpoint: { instance: string; port: string | null },
  side: 'source' | 'target',
  blocks: SandboxBlock[],
  neurons: SandboxNeuron[],
  positionOf: (id: string, fallback: [number, number]) => [number, number],
): Point | null {
  const block = blocks.find((item) => item.id === endpoint.instance)
  if (block) {
    return endpoint.port
      ? portPoint(block, endpoint.port, positionOf(block.id, block.position))
      : null
  }
  const neuron = neurons.find((item) => item.id === endpoint.instance)
  if (!neuron) return null
  const [x, y] = positionOf(neuron.id, neuron.position)
  return { x: x + (side === 'source' ? DOT.width / 2 : -DOT.width / 2), y }
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
  neurons,
  links,
  cells,
  selected,
  pending,
  onPickBlock,
  onPickNeuron,
  onPickLink,
  onPickEndpoint,
  onMove,
  onEmpty,
}: CanvasProps) {
  /** Объект, который сейчас тащат. Пока тащат -- рисуем его из этого состояния. */
  const [drag, setDrag] = useState<{ id: string; position: [number, number] } | null>(
    null,
  )

  const positionOf = (id: string, fallback: [number, number]): [number, number] =>
    drag && drag.id === id ? drag.position : fallback

  const startDrag = (
    event: PointerEvent<SVGGElement>,
    id: string,
    from: [number, number],
  ): void => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    const scale = WIDTH / svg.getBoundingClientRect().width
    const grabX = event.clientX
    const grabY = event.clientY
    const [startX, startY] = from

    const where = (moved: { clientX: number; clientY: number }): [number, number] => [
      Math.round(startX + (moved.clientX - grabX) * scale),
      Math.round(startY + (moved.clientY - grabY) * scale),
    ]

    const move = (moved: globalThis.PointerEvent): void =>
      setDrag({ id, position: where(moved) })

    const drop = (dropped: globalThis.PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', drop)
      setDrag(null)
      const [x, y] = where(dropped)
      // Сдвиг отправляется один раз, на отпускании: холст физику не меняет, а
      // каждый промежуточный пиксель в истории отмены только мешал бы.
      if (Math.abs(x - startX) > 2 || Math.abs(y - startY) > 2) {
        onMove(id, [x, y])
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
          neurons={neurons}
          positionOf={positionOf}
          selected={selected?.kind === 'link' && selected.id === link.id}
          onPick={() => onPickLink(link.id)}
        />
      ))}

      {blocks.map((block) => {
        const [x, y] = positionOf(block.id, block.position)
        const chosen = selected?.kind === 'block' && selected.id === block.id
        const active = spiking(block, cells)
        return (
          <g
            key={block.id}
            className={`cv-block${chosen ? ' is-on' : ''}${active ? ' is-spiking' : ''}`}
            onPointerDown={(event) => startDrag(event, block.id, block.position)}
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
                    onPickEndpoint(block.id, port.name)
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

      {neurons.map((neuron) => {
        const [x, y] = positionOf(neuron.id, neuron.position)
        const chosen = selected?.kind === 'neuron' && selected.id === neuron.id
        // Приставки у отдельной клетки нет: в собранной сети она зовётся так же.
        const active = cells[neuron.id]?.spiked ?? false
        const soma = somaPoint([x, y])
        const waiting = pending?.instance === neuron.id
        return (
          <g
            key={neuron.id}
            className={`cv-cell${neuron.inhibitory ? ' is-inh' : ''}${
              chosen ? ' is-on' : ''
            }${active ? ' is-spiking' : ''}`}
            onPointerDown={(event) => startDrag(event, neuron.id, neuron.position)}
            onClick={() => onPickNeuron(neuron.id)}
          >
            <rect
              x={x - DOT.width / 2}
              y={y - DOT.height / 2}
              width={DOT.width}
              height={DOT.height}
              // Тормозная клетка квадратная, возбуждающая скруглённая -- те же
              // обозначения, что в миниатюре каталога и на схеме прогона.
              rx={neuron.inhibitory ? 4 : DOT.height / 2}
            />
            <text className="cv-label" x={x} y={y + 4} textAnchor="middle">
              {short(neuron.id, 9)}
              <title>
                {neuron.id} · {neuron.cellType}
              </title>
            </text>
            <g
              className={`cv-soma${waiting ? ' is-waiting' : ''}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                // Порта нет: конец связи -- точка на самой клетке.
                onPickEndpoint(neuron.id, null)
              }}
            >
              <circle cx={soma.x} cy={soma.y} r={5}>
                <title>сома {neuron.id}: щёлкните, чтобы соединить</title>
              </circle>
            </g>
          </g>
        )
      })}

      {blocks.length === 0 && neurons.length === 0 ? (
        <text className="cv-empty" x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle">
          Пусто. Положите клетку из палитры или вставьте паттерн слева.
        </text>
      ) : null}
    </svg>
  )
}

function Link({
  link,
  blocks,
  neurons,
  positionOf,
  selected,
  onPick,
}: {
  link: SandboxLink
  blocks: SandboxBlock[]
  neurons: SandboxNeuron[]
  positionOf: (id: string, fallback: [number, number]) => [number, number]
  selected: boolean
  onPick: () => void
}) {
  const start = endpointPoint(link.source, 'source', blocks, neurons, positionOf)
  const end = endpointPoint(link.target, 'target', blocks, neurons, positionOf)
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
