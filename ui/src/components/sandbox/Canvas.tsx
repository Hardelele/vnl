/**
 * Холст песочницы: блоки, отдельные клетки и связи между ними.
 *
 * Блок бывает свёрнутым и раскрытым. Свёрнутый -- коробка с портами: на схеме
 * из десяти микросхем важно, что с чем соединено, а не как каждая устроена
 * внутри. Раскрытый показывает свою начинку теми же обозначениями, что
 * миниатюра каталога, и к любому внутреннему узлу можно вести связь.
 *
 * Раскрытие -- показ, а не схема. Блок и так считается насквозь: `compose`
 * разворачивает его нейроны в общую сеть (`ffi/IN`, `ffi/E`, `ffi/I`), и
 * чёрный ящик был способом показать блок, а не способом его посчитать. Поэтому
 * раскрытие ничего не отправляет на сервер и не старит прогон.
 *
 * Порт при этом остаётся: это названная автором точка подключения, ярлык
 * частой двери, -- но не единственная дверь. От feed-forward inhibition берут
 * тормозный нейрон, а входной релей не нужен вовсе, и порт под каждый такой
 * случай автор объявить не может.
 *
 * Клетка -- не маленький блок, и рисуется она иначе: фигурой без портов.
 * Обозначения те же, что в миниатюре каталога и на схеме прогона
 * (`Thumbnail`, `miniature`): возбуждающая скруглённая, тормозная квадратная --
 * так разница читается и там, где цвета нет. Тормозность приходит с сервера
 * полем `inhibitory`; считать её здесь значило бы завести второе место, где
 * это слово означает своё. Внутренние узлы блока берут её из `block.scheme`,
 * посчитанного тем же `ir.is_inhibitory_cell`.
 *
 * Соединяется клетка точкой на себе, а не портом: у неё одна точка подключения
 * -- сома, и щелчок по ней выбирает конец связи с пустым портом. Внутренний
 * узел блока -- то же самое, только имя у него сетевое: `ffi/I`. Фиктивный
 * порт «сома» пришлось бы поддерживать и на сервере, где его нет.
 *
 * Подсветка: у свёрнутого блока светится коробка -- внутри кто-то разрядился;
 * у раскрытого светится сам разрядившийся узел, потому что теперь видно кто.
 *
 * Заряд клетки стоит числом над фигурой и заливкой внутри неё -- теми же, что
 * на схеме паттерна (`lib/charge`, `LiveScheme`). Вспышка говорит «разрядилась»
 * и молчит о том, почему соседняя не разрядилась: не хватило десяти процентов
 * или вход до неё вовсе не дошёл. Отлаживают схему как раз в песочнице, и
 * ответ на этот вопрос нужен здесь, а не только на витрине (#535).
 *
 * Долю считает сессия (`CellState.charge`): порог, покой и адаптация -- физика,
 * а у интерфейса под рукой только номинальный порог типа клетки, тогда как у
 * клетки он свой.
 */

import { useMemo, useState, type PointerEvent } from 'react'

import { chargeFill, chargeLabel, momentOf } from '../../lib/charge'
import { edgePath, miniature, type MiniEdge, type Miniature } from '../../lib/miniature'
import type { CellState } from '../../model/sim'
import type { SandboxBlock, SandboxLink, SandboxNeuron } from '../../model/sandbox'
import type { Pending, Selection } from '../../state/sandbox'
import './canvas.css'

const WIDTH = 760
const HEIGHT = 420
const BOX = { width: 150, height: 62 }
/**
 * Раскрытый блок. Шире и выше свёрнутого: внутрь надо поместить схему, а не
 * подпись, и на тесном поле связи миниатюры сливаются в одну линию.
 */
const OPEN = { width: 236, height: 152 }
/** Полоса с подписью блока наверху: начинка рисуется под ней, а не поверх. */
const HEADER = 26
/**
 * Поле для начинки. Раскладку считает `miniature` -- та же, что у миниатюры
 * каталога и у строки библиотеки. Вторая раскладка «как выглядит эта схема»
 * разошлась бы с первой незаметно, и один и тот же блок читался бы в каталоге
 * цепочкой, а на холсте развилкой.
 */
const INNER = { width: OPEN.width, height: OPEN.height - HEADER, padding: 42 }
/** Фигура клетки. Уже блока: у неё нет ни портов, ни счётчиков внутри. */
const DOT = { width: 74, height: 38 }
/** Длина острия и половина плашки на конце внутренней связи -- как в миниатюре. */
const TIP = 6
const CAP = 4

export type Point = { x: number; y: number }

/** Раскладка начинки каждого раскрытого блока: id блока -> миниатюра. */
export type Insides = ReadonlyMap<string, Miniature>

export interface CanvasProps {
  blocks: SandboxBlock[]
  neurons: SandboxNeuron[]
  links: SandboxLink[]
  cells: Record<string, CellState>
  selected: Selection | null
  pending: Pending | null
  /** Какие блоки раскрыты. Это показ: на сервер не уходит и схему не меняет. */
  opened?: string[]
  onPickBlock: (id: string) => void
  onPickNeuron: (id: string) => void
  onPickLink: (id: string) => void
  /**
   * Конец связи: порт блока, точка клетки или внутренний узел блока.
   *
   * У двух последних порта нет: `instance` -- это имя в собранной сети, `X`
   * или `ffi/I`, и сервер разбирает такой конец через `resolve_endpoint`.
   */
  onPickEndpoint: (instance: string, port: string | null) => void
  onMove: (id: string, position: [number, number]) => void
  /** Раскрыть или свернуть блок. Без неё блок остаётся коробкой. */
  onToggleBlock?: (id: string) => void
  onEmpty: () => void
}

/** Размер блока на холсте: раскрытый занимает больше места, чем коробка. */
export function blockBox(open: boolean): { width: number; height: number } {
  return open ? OPEN : BOX
}

/** Точка порта на краю блока: входы слева, выходы и модуляция справа. */
export function portPoint(
  block: SandboxBlock,
  port: string,
  position: [number, number] = block.position,
  open = false,
): Point | null {
  const item = block.ports.find((candidate) => candidate.name === port)
  if (!item) return null
  const left = item.direction === 'in'
  const side = block.ports.filter(
    (candidate) => (candidate.direction === 'in') === left,
  )
  const index = side.findIndex((candidate) => candidate.name === port)
  const box = blockBox(open)
  // У раскрытого блока порты расставляются по той же высоте, что и начинка:
  // полоса с подписью занята именем и переключателем.
  const top = open ? HEADER : 0
  const step = (box.height - top) / (side.length + 1)
  return {
    x: left ? position[0] : position[0] + box.width,
    y: position[1] + top + step * (index + 1),
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
 * Разобрать сетевое имя на блок и узел внутри него.
 *
 * `ffi/I` -- это нейрон `I` блока `ffi`; `X` -- отдельная клетка, и блока за
 * ней нет. Приставка -- то же, чем `compose` разводит два экземпляра одного
 * паттерна, и другого способа понять, кому принадлежит узел, здесь не заводим.
 */
export function innerRef(
  instance: string,
  blocks: SandboxBlock[],
): { block: SandboxBlock; neuron: string } | null {
  const cut = instance.indexOf('/')
  if (cut < 0) return null
  const block = blocks.find((item) => item.id === instance.slice(0, cut))
  return block ? { block, neuron: instance.slice(cut + 1) } : null
}

/**
 * Где связь касается объекта: у блока -- его порт или внутренний узел, у
 * клетки -- край фигуры.
 *
 * Край, а не центр: линия, упирающаяся в середину фигуры, перечёркивает
 * подпись, а знак на её конце пропадает под заливкой. Сторона выбирается по
 * ходу связи -- уходит справа, приходит слева.
 *
 * У свёрнутого блока внутреннего узла на холсте нет, и связь приводится к краю
 * коробки. Не прятать: связь в схеме есть и считается, а исчезнувшая линия
 * выглядела бы как потерянная правка.
 */
export function endpointPoint(
  endpoint: { instance: string; port: string | null },
  side: 'source' | 'target',
  blocks: SandboxBlock[],
  neurons: SandboxNeuron[],
  positionOf: (id: string, fallback: [number, number]) => [number, number],
  insides: Insides = new Map(),
): Point | null {
  const inner = innerRef(endpoint.instance, blocks)
  if (inner) {
    const [x, y] = positionOf(inner.block.id, inner.block.position)
    const view = insides.get(inner.block.id)
    const node = view?.nodes.find((item) => item.id === inner.neuron)
    if (!node) {
      return { x: x + (side === 'source' ? BOX.width : 0), y: y + BOX.height / 2 }
    }
    return {
      x: x + node.x + (side === 'source' ? node.width / 2 : -node.width / 2),
      y: y + HEADER + node.y,
    }
  }

  const block = blocks.find((item) => item.id === endpoint.instance)
  if (block) {
    return endpoint.port
      ? portPoint(
          block,
          endpoint.port,
          positionOf(block.id, block.position),
          insides.has(block.id),
        )
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
  opened = [],
  onPickBlock,
  onPickNeuron,
  onPickLink,
  onPickEndpoint,
  onMove,
  onToggleBlock,
  onEmpty,
}: CanvasProps) {
  /** Объект, который сейчас тащат. Пока тащат -- рисуем его из этого состояния. */
  const [drag, setDrag] = useState<{ id: string; position: [number, number] } | null>(
    null,
  )

  // Раскладка начинки считается один раз на отрисовку, а не в каждой связи:
  // `endpointPoint` спрашивает её для обоих концов каждой линии.
  const insides = useMemo<Insides>(() => {
    const map = new Map<string, Miniature>()
    for (const block of blocks) {
      if (opened.includes(block.id)) map.set(block.id, miniature(block.scheme, INNER))
    }
    return map
  }, [blocks, opened])

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
          insides={insides}
          positionOf={positionOf}
          selected={selected?.kind === 'link' && selected.id === link.id}
          onPick={() => onPickLink(link.id)}
        />
      ))}

      {blocks.map((block) => {
        const [x, y] = positionOf(block.id, block.position)
        const chosen = selected?.kind === 'block' && selected.id === block.id
        const view = insides.get(block.id)
        const open = view !== undefined
        const box = blockBox(open)
        // У раскрытого блока светится не коробка, а разрядившийся узел: теперь
        // видно кто, и подсвечивать вместо него всю рамку значило бы прятать
        // то, ради чего блок и раскрыли.
        const active = !open && spiking(block, cells)
        // Заряда у свёрнутого блока нет и не будет. Потенциал есть у клетки, а
        // коробка -- это несколько клеток с разными порогами: среднее по ним
        // ничего не измеряет, наибольшее превращает блок в вечно заряженный по
        // самой возбудимой, а порт -- всего лишь ярлык одной внутренней клетки,
        // и «62%» рядом с `out` прочли бы как заряд блока целиком. Любое из
        // трёх чисел было бы выдумано здесь, в браузере, -- ровно то, чего в
        // показе заряда делать нельзя.
        //
        // Поэтому у коробки остаётся вспышка («внутри кто-то разрядился»), а
        // числа появляются по щелчку на «+»: блок считается насквозь, раскрытие
        // ничего не стоит и не старит прогон, и ответ «кто и насколько» лежит
        // на один щелчок дальше, а не подменяется правдоподобным средним.
        return (
          <g
            key={block.id}
            className={`cv-block${open ? ' is-open' : ''}${chosen ? ' is-on' : ''}${
              active ? ' is-spiking' : ''
            }`}
            onPointerDown={(event) => startDrag(event, block.id, block.position)}
            onClick={() => onPickBlock(block.id)}
          >
            <rect x={x} y={y} width={box.width} height={box.height} rx={10} />
            <text
              className="cv-label"
              x={x + box.width / 2}
              y={open ? y + 17 : y + 26}
              textAnchor="middle"
            >
              {short(block.label)}
              <title>
                {block.label} · {block.id}
              </title>
            </text>
            {open ? null : (
              <text
                className="cv-sub"
                x={x + box.width / 2}
                y={y + 44}
                textAnchor="middle"
              >
                {block.counts.neurons} кл. · {block.counts.contacts} св.
              </text>
            )}

            {onToggleBlock ? (
              <g
                className="cv-open"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleBlock(block.id)
                }}
              >
                <circle cx={x + box.width - 14} cy={y + 14} r={7}>
                  <title>
                    {open
                      ? `свернуть ${block.id}`
                      : `показать, что внутри ${block.id}`}
                  </title>
                </circle>
                <text
                  className="cv-open-sign"
                  x={x + box.width - 14}
                  y={y + 14}
                  dominantBaseline="central"
                  textAnchor="middle"
                >
                  {open ? '−' : '+'}
                </text>
              </g>
            ) : null}

            {view ? (
              <g transform={`translate(${x} ${y + HEADER})`}>
                {view.edges.map((edge) => (
                  <InnerEdge key={edge.id} edge={edge} />
                ))}
                {view.nodes.map((node) => {
                  const flat = `${block.id}/${node.id}`
                  const waiting = pending?.instance === flat && !pending.port
                  // Имя в живой сети у внутреннего узла с приставкой (`ffi/E`):
                  // ею `compose` разводит два экземпляра одного паттерна.
                  const state = cells[flat]
                  const lit = state?.spiked ?? false
                  const level = chargeLabel(momentOf(state))
                  return (
                    <g
                      key={node.id}
                      className={`cv-in-cell${node.inhibitory ? ' is-inh' : ''}${
                        waiting ? ' is-waiting' : ''
                      }${lit ? ' is-spiking' : ''}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        // Порта нет: конец связи -- сам нейрон, и зовут его
                        // так же, как в собранной сети.
                        onPickEndpoint(flat, null)
                      }}
                    >
                      {/* Подсказка на группе, а не на подписи: у подписи
                          отключены события, и над буквами её было бы не
                          видно. */}
                      <title>{flat}: щёлкните, чтобы соединить</title>
                      <rect
                        x={node.x - node.width / 2}
                        y={node.y - node.height / 2}
                        width={node.width}
                        height={node.height}
                        // Те же обозначения, что в миниатюре каталога:
                        // тормозная квадратная, возбуждающая скруглённая.
                        rx={node.inhibitory ? 4 : node.height / 2}
                      />
                      {/* Заливка -- отдельной фигурой поверх обводки, как на
                          схеме паттерна: прозрачность меняется каждый кадр, не
                          трогая ни рамку, ни подпись. */}
                      <rect
                        className="cv-in-charge"
                        x={node.x - node.width / 2}
                        y={node.y - node.height / 2}
                        width={node.width}
                        height={node.height}
                        rx={node.inhibitory ? 4 : node.height / 2}
                        opacity={chargeFill(state?.charge)}
                      />
                      <text
                        x={node.x}
                        y={node.y}
                        dominantBaseline="central"
                        textAnchor="middle"
                      >
                        {node.id}
                      </text>
                      {/* Число то же, что над отдельной клеткой, а кегль
                          мельче: узлов внутри блока бывает пятеро, и поле под
                          начинку от этого не растёт. */}
                      {level ? (
                        <text
                          className={`cv-in-level${level.below ? ' is-below' : ''}`}
                          x={node.x}
                          y={node.y - node.height / 2 - 2}
                          textAnchor="middle"
                        >
                          {level.text}
                        </text>
                      ) : null}
                    </g>
                  )
                })}
              </g>
            ) : null}

            {block.ports.map((port) => {
              const point = portPoint(block, port.name, [x, y], open)
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
        const state = cells[neuron.id]
        const active = state?.spiked ?? false
        const level = chargeLabel(momentOf(state))
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
            {/* Заливка -- отдельной фигурой поверх обводки, как на схеме
                паттерна: прозрачность меняется каждый кадр, не трогая ни
                рамку, ни подпись. */}
            <rect
              className="cv-charge"
              x={x - DOT.width / 2}
              y={y - DOT.height / 2}
              width={DOT.width}
              height={DOT.height}
              rx={neuron.inhibitory ? 4 : DOT.height / 2}
              opacity={chargeFill(state?.charge)}
            />
            <text className="cv-label" x={x} y={y + 4} textAnchor="middle">
              {short(neuron.id, 9)}
              <title>
                {neuron.id} · {neuron.cellType}
              </title>
            </text>
            {/* Заряд числом -- над фигурой, там же, где он стоит на схеме
                паттерна: внутрь не поместить, там имя клетки. Надписи нет,
                пока сессия не ответила про эту клетку: «0%» в этом месте был
                бы выдумкой, а не покоем. */}
            {level ? (
              <text
                className={`cv-level${level.below ? ' is-below' : ''}`}
                x={x}
                y={y - DOT.height / 2 - 5}
                textAnchor="middle"
              >
                {level.text}
              </text>
            ) : null}
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

/**
 * Связь внутри раскрытого блока.
 *
 * Своя, а не та же, что между объектами холста: эта не выбирается и не
 * правится -- внутренности блока держит снимок паттерна, и менять их прямо на
 * холсте нельзя. Знак на конце тот же, что в миниатюре: возбуждение -- остриё,
 * торможение -- плашка.
 */
function InnerEdge({ edge }: { edge: MiniEdge }) {
  const ux = edge.tip.x
  const uy = edge.tip.y
  return (
    <g className={`cv-in-link is-${edge.kind}`}>
      <path className="cv-in-wire" d={edgePath(edge)} fill="none" />
      {edge.kind === 'inh' ? (
        <line
          className="cv-in-cap"
          x1={edge.end.x - uy * CAP}
          y1={edge.end.y + ux * CAP}
          x2={edge.end.x + uy * CAP}
          y2={edge.end.y - ux * CAP}
        />
      ) : (
        <polygon
          className="cv-in-cap"
          points={[
            `${edge.end.x},${edge.end.y}`,
            `${edge.end.x - ux * TIP - uy * 2.5},${edge.end.y - uy * TIP + ux * 2.5}`,
            `${edge.end.x - ux * TIP + uy * 2.5},${edge.end.y - uy * TIP - ux * 2.5}`,
          ].join(' ')}
        />
      )}
    </g>
  )
}

function Link({
  link,
  blocks,
  neurons,
  insides,
  positionOf,
  selected,
  onPick,
}: {
  link: SandboxLink
  blocks: SandboxBlock[]
  neurons: SandboxNeuron[]
  insides: Insides
  positionOf: (id: string, fallback: [number, number]) => [number, number]
  selected: boolean
  onPick: () => void
}) {
  const start = endpointPoint(link.source, 'source', blocks, neurons, positionOf, insides)
  const end = endpointPoint(link.target, 'target', blocks, neurons, positionOf, insides)
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
