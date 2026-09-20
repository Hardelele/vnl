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
 * Сторону, с которой провод отходит от фигуры и с которой подходит к ней,
 * выбирает `lib/wire` по взаимному расположению концов: место клетки на холсте
 * задаёт человек, и связь справа налево не обязана обходить оба узла снаружи
 * только потому, что выход нарисован справа (#542). Порт -- исключение: он
 * нарисован кружком на своём краю коробки, и провод обязан прийти туда.
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
 *
 * О том, что блок раскрывается и разбирается, холст говорит сам (#549). Обе
 * возможности были и раньше, но знака о них не было: раскрытие пряталось за
 * кружком с плюсом -- таким же кружком, как порт рядом, -- а разбор жил только
 * в панели свойств, куда надо сперва добраться. Человек, ради которого это
 * делалось, не нашёл ни того, ни другого.
 *
 * Поэтому:
 *
 * - счётчик «3 кл. · 2 св.» внизу коробки стал самой кнопкой раскрытия. Он и
 *   так говорил, что внутри что-то есть; теперь он ещё и предлагает туда
 *   заглянуть -- шевроном, рамкой под курсором и подсказкой. Отдельный значок
 *   рядом со счётчиком был бы вторым местом про одно и то же;
 * - кнопка перестала быть кружком: кружок на холсте уже занят портом, и знак
 *   «показать начинку» читался как «добавить порт». Теперь это плашка с
 *   подписью, а порт остался кружком с именем;
 * - двойной щелчок по коробке делает то же самое. Не вместо кнопки, а рядом:
 *   кнопку находят глазами, двойной щелчок -- рукой, по привычке из файловых
 *   окон;
 * - «разобрать на клетки» появляется под выбранным блоком. Кнопка в панели
 *   свойств остаётся: панель -- место, где блок правят целиком. Но узнать о
 *   разборе можно, только уже выбрав блок, а выбирают его на холсте.
 *
 * Возможностей при этом не прибавилось: и раскрытие, и разбор -- те же вызовы,
 * что и были (`toggleBlock`, `ungroup`).
 */

import { useMemo, useState, type PointerEvent } from 'react'

import { chargeFill, chargeLabel, momentOf } from '../../lib/charge'
import { edgePath, miniature, type MiniEdge, type Miniature } from '../../lib/miniature'
import { CELLS, LINKS, counted } from '../../lib/plural'
import { wire, type Point, type WireEnd } from '../../lib/wire'
import type { CellState } from '../../model/sim'
import type { SandboxBlock, SandboxLink, SandboxNeuron } from '../../model/sandbox'
import type { CellKind } from '../../model/types'
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
/**
 * Плашка действия блока: «▾ 3 кл. · 2 св.», «▴ свернуть», «разобрать на клетки».
 *
 * Плашка, а не кружок: кружком на холсте нарисован порт, и второй кружок рядом
 * человек читает как ещё одну точку подключения (#549). Высота и отступ общие,
 * чтобы три плашки выглядели одним родом вещей, а не тремя случайностями.
 */
const PAD = { height: 20, inset: 6 }
/** Ширина плашек с постоянной подписью: «▴ свернуть» и «разобрать на клетки». */
const SHUT_WIDTH = 68
const BREAK_WIDTH = 124

export type { Point }

/** Раскладка начинки каждого раскрытого блока: id блока -> миниатюра. */
export type Insides = ReadonlyMap<string, Miniature>

export interface CanvasProps {
  blocks: SandboxBlock[]
  neurons: SandboxNeuron[]
  links: SandboxLink[]
  cells: Record<string, CellState>
  /**
   * Каталог типов клеток -- ради `note` (#541). На холсте клетка подписана
   * своим именем (`sst`), и что за ним стоит, нигде не сказано; объяснение
   * уже написано в `vnl/cells.py` и приходит вместе с каталогом.
   *
   * Необязателен: холст рисуется и до ответа сервера, а подсказка объясняет, а
   * не управляет.
   */
  palette?: CellKind[]
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
  /**
   * Разобрать блок на клетки и связи (#532).
   *
   * Необязательна по той же причине, что и раскрытие: холст рисуется и там,
   * где проект не правят. Но там, где правят, дорога к разбору должна быть с
   * холста, а не только из панели свойств: о кнопке в панели узнаёшь, уже
   * выбрав блок, а выбирают его здесь (#549).
   */
  onUngroupBlock?: (id: string) => void
  onEmpty: () => void
}

/** Размер блока на холсте: раскрытый занимает больше места, чем коробка. */
export function blockBox(open: boolean): { width: number; height: number } {
  return open ? OPEN : BOX
}

/** Размер фигуры клетки. Нужен раскладке: ELK двигает то, что нарисовано. */
export function cellBox(): { width: number; height: number } {
  return DOT
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
 * К чему связь крепится: у блока -- его порт или внутренний узел, у клетки --
 * её фигура.
 *
 * Отдаётся не точка, а фигура целиком: сторона, с которой провод подходит,
 * зависит от того, где стоит второй конец, и знать её здесь неоткуда. Выбирает
 * её `wire`, а край фигуры считает по выбранной стороне. Край, а не центр:
 * линия, упирающаяся в середину фигуры, перечёркивает подпись, а знак на её
 * конце пропадает под заливкой.
 *
 * У порта сторона задана жёстко: порт нарисован кружком на своём краю коробки
 * (входы слева, выходы справа), и провод, подошедший с другой стороны,
 * оторвался бы от него.
 *
 * У свёрнутого блока внутреннего узла на холсте нет, и связь приводится к
 * коробке. Не прятать: связь в схеме есть и считается, а исчезнувшая линия
 * выглядела бы как потерянная правка.
 */
export function endpointEnd(
  endpoint: { instance: string; port: string | null },
  blocks: SandboxBlock[],
  neurons: SandboxNeuron[],
  positionOf: (id: string, fallback: [number, number]) => [number, number],
  insides: Insides = new Map(),
): WireEnd | null {
  const inner = innerRef(endpoint.instance, blocks)
  if (inner) {
    const [x, y] = positionOf(inner.block.id, inner.block.position)
    const view = insides.get(inner.block.id)
    const node = view?.nodes.find((item) => item.id === inner.neuron)
    if (!node) {
      return {
        x: x + BOX.width / 2,
        y: y + BOX.height / 2,
        halfWidth: BOX.width / 2,
        halfHeight: BOX.height / 2,
      }
    }
    return {
      x: x + node.x,
      y: y + HEADER + node.y,
      halfWidth: node.width / 2,
      halfHeight: node.height / 2,
    }
  }

  const block = blocks.find((item) => item.id === endpoint.instance)
  if (block) {
    if (!endpoint.port) return null
    const point = portPoint(
      block,
      endpoint.port,
      positionOf(block.id, block.position),
      insides.has(block.id),
    )
    if (!point) return null
    const port = block.ports.find((item) => item.name === endpoint.port)
    return {
      ...point,
      halfWidth: 0,
      halfHeight: 0,
      side: port?.direction === 'in' ? 'left' : 'right',
    }
  }
  const neuron = neurons.find((item) => item.id === endpoint.instance)
  if (!neuron) return null
  const [x, y] = positionOf(neuron.id, neuron.position)
  return { x, y, halfWidth: DOT.width / 2, halfHeight: DOT.height / 2 }
}

/**
 * Имя блока в одну строку: длинное вылезает за коробку, а коробка фиксирована.
 *
 * Предел в 18 знаков был взят на глаз и на глаз же промахивался: имя из
 * библиотеки («Гиперполяризующее торможение») занимало 18 знаков кеглем 13 --
 * шире, чем коробка в 150, -- и наезжало на порты по краям. Теперь 15: с
 * запасом по ширине и без наездов (#549).
 */
export function short(label: string, limit = 15): string {
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
  palette = [],
  selected,
  pending,
  opened = [],
  onPickBlock,
  onPickNeuron,
  onPickLink,
  onPickEndpoint,
  onMove,
  onToggleBlock,
  onUngroupBlock,
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
    // Сколько единиц холста в пикселе экрана.
    //
    // Холст вписан в свою область с сохранением пропорций (`viewBox` без
    // `preserveAspectRatio` -- это `meet`), то есть масштаб задаёт та сторона,
    // которой не хватает: `min(ширина/WIDTH, высота/HEIGHT)`. Считать его по
    // одной ширине можно было, пока область повторяла пропорцию холста. С
    // оконным каркасом (#504) высоту области задаёт нижняя панель, человек
    // тянет её границу -- и пропорция расходится с `WIDTH/HEIGHT`. Тогда
    // масштаб определяет высота, счёт по ширине даёт число меньше настоящего,
    // и объект отстаёт от курсора.
    const box = svg.getBoundingClientRect()
    const scale = Math.max(WIDTH / box.width, HEIGHT / box.height)
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
            // Двойной щелчок по коробке -- та же дверь, что и плашка внизу.
            // Привычка из файловых окон: «двойной щелчок открывает». Кнопку
            // находят глазами, двойной щелчок -- рукой, и одно другому не
            // мешает, пока оба ведут в одно и то же место (#549).
            onDoubleClick={
              onToggleBlock ? () => onToggleBlock(block.id) : undefined
            }
          >
            <rect x={x} y={y} width={box.width} height={box.height} rx={10} />
            {/* У раскрытого блока подпись прижата влево: справа в той же
                полосе стоит «свернуть», и по центру они встретились бы. У
                свёрнутого в полосе больше ничего нет -- подпись по центру. */}
            <text
              className="cv-label"
              x={open ? x + 10 : x + box.width / 2}
              y={open ? y + 17 : y + 24}
              textAnchor={open ? 'start' : 'middle'}
            >
              {short(block.label, open ? 16 : 15)}
              <title>
                {block.label} · {block.id}
              </title>
            </text>

            {/* Счётчик внизу коробки -- он же кнопка «показать, что внутри».
                Раньше это была справка рядом с безымянным «+»; теперь одно
                место говорит и сколько внутри, и что туда можно заглянуть.
                Без `onToggleBlock` заглядывать некуда -- остаётся справка. */}
            {open ? null : (
              <g
                className={`cv-open${onToggleBlock ? '' : ' is-mute'}`}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={
                  onToggleBlock
                    ? (event) => {
                        event.stopPropagation()
                        onToggleBlock(block.id)
                      }
                    : undefined
                }
              >
                <rect
                  className="cv-open-pad"
                  x={x + PAD.inset}
                  y={y + box.height - PAD.height - PAD.inset}
                  width={box.width - PAD.inset * 2}
                  height={PAD.height}
                  rx={6}
                />
                <text
                  className="cv-sub"
                  x={x + box.width / 2}
                  y={y + box.height - PAD.inset - PAD.height / 2}
                  dominantBaseline="central"
                  textAnchor="middle"
                >
                  {onToggleBlock ? '▾ ' : ''}
                  {block.counts.neurons} кл. · {block.counts.contacts} св.
                </text>
                {onToggleBlock ? (
                  <title>
                    Показать, что внутри: {counted(block.counts.neurons, CELLS)},{' '}
                    {counted(block.counts.contacts, LINKS)}. К любой из них можно
                    вести связь мимо портов. Двойной щелчок по блоку — то же самое.
                  </title>
                ) : null}
              </g>
            )}

            {open && onToggleBlock ? (
              <g
                className="cv-open is-shut"
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleBlock(block.id)
                }}
              >
                <rect
                  className="cv-open-pad"
                  x={x + box.width - SHUT_WIDTH - PAD.inset}
                  y={y + (HEADER - PAD.height) / 2}
                  width={SHUT_WIDTH}
                  height={PAD.height}
                  rx={6}
                />
                <text
                  className="cv-sub"
                  x={x + box.width - SHUT_WIDTH / 2 - PAD.inset}
                  y={y + HEADER / 2}
                  dominantBaseline="central"
                  textAnchor="middle"
                >
                  ▴ свернуть
                </text>
                <title>Свернуть {block.id} обратно в коробку с портами</title>
              </g>
            ) : null}

            {/* Разбор -- у выбранного блока и только у него: плашка под каждой
                коробкой превратила бы схему из десяти блоков в список кнопок.
                Подпись называет последствие («перестанет быть блоком»), а не
                прячет его за словом «разобрать»: блок после этого не
                восстанавливается сам -- только отменой (#532, #549). */}
            {chosen && onUngroupBlock ? (
              <g
                className="cv-act"
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onUngroupBlock(block.id)
                }}
              >
                <rect
                  x={x}
                  y={y + box.height + PAD.inset}
                  width={BREAK_WIDTH}
                  height={PAD.height}
                  rx={6}
                />
                <text
                  x={x + BREAK_WIDTH / 2}
                  y={y + box.height + PAD.inset + PAD.height / 2}
                  dominantBaseline="central"
                  textAnchor="middle"
                >
                  разобрать на клетки
                </text>
                <title>
                  {block.label} перестанет быть блоком: на холсте останутся{' '}
                  {counted(block.counts.neurons, CELLS)} и{' '}
                  {counted(block.counts.contacts, LINKS)} как обычные объекты
                  проекта — их можно двигать, править и соединять поодиночке.
                  Отменяется одним шагом.
                </title>
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
                      // Двойной щелчок по узлу -- это два щелчка «соединить»,
                      // а не приказ свернуть блок: иначе начинка исчезала бы
                      // ровно в тот момент, когда в неё целятся.
                      onDoubleClick={(event) => event.stopPropagation()}
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
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onPickEndpoint(block.id, port.name)
                  }}
                >
                  {/* Порт называет себя портом -- названной автором дверью, --
                      чтобы не читаться как ещё один нейрон внутри. Узел
                      внутри говорит о себе своим сетевым именем (`ffi/I`), и
                      разница между «дверь» и «клетка» должна быть слышна и в
                      подсказке, а не только в форме значка (#549). */}
                  <title>
                    порт {port.name} блока {block.id}: щёлкните, чтобы соединить
                  </title>
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
        // Что это за клетка -- человеческими словами. Текст написан в
        // `vnl/cells.py` и приходит каталогом: своего словаря здесь нет (#541).
        const kind = palette.find((item) => item.id === neuron.cellType)
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
            {/* Подсказка на всей фигуре, а не только на подписи: целиться
                курсором в семь букв посреди клетки человек не обязан. */}
            <title>
              {kind ? `${kind.name}. ${kind.note}` : `${neuron.id} · ${neuron.cellType}`}
            </title>
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
  const from = endpointEnd(link.source, blocks, neurons, positionOf, insides)
  const to = endpointEnd(link.target, blocks, neurons, positionOf, insides)
  if (!from || !to) return null

  // Связь ведётся кривой: две прямые между соседними блоками сливаются, и
  // какая куда идёт -- уже не разобрать. Сторону выхода и входа выбирает
  // `wire` по взаимному расположению концов (#542).
  const line = wire(from, to)
  const { end, tip } = line

  return (
    <g
      className={`cv-link${link.inhibitory ? ' is-inh' : ''}${selected ? ' is-on' : ''}`}
      onClick={onPick}
    >
      {/* Полоса попадания мышью -- та же кривая, что видимая: разойдись они,
          связь стало бы не выбрать там, где она нарисована. */}
      <path className="cv-hit" d={line.path} fill="none" />
      <path className="cv-wire" d={line.path} fill="none" />
      {link.inhibitory ? (
        // Плашка поперёк хода связи -- как на схеме паттерна и в миниатюре.
        // Прежде она стояла всегда вертикально: провод и входил всегда слева.
        <line
          className="cv-cap"
          x1={end.x - tip.y * 6}
          y1={end.y + tip.x * 6}
          x2={end.x + tip.y * 6}
          y2={end.y - tip.x * 6}
        />
      ) : (
        <circle className="cv-cap" cx={end.x} cy={end.y} r={3} />
      )}
    </g>
  )
}
