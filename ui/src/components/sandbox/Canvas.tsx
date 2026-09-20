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
 * Схема у проекта одна, и вид у неё должен быть один (#554). Изображений её
 * было три -- строка библиотеки, холст и карточка паттерна, -- и они разошлись
 * во всём: места клеток, форма кривой, знаки на концах. Заметил это владелец:
 * «в библиотеке то норм, а вот в песочнице раскладка не та», «там выравнивание
 * блоков как будто другое», «и стрелки по-другому нарисованы». Эталоном он
 * назвал библиотеку, и холст подогнан под неё, а не наоборот:
 *
 * - **места**. Разбор блока (`ungroup`) больше не раздаёт клеткам сетку «лишь
 *   бы не в кучу»: места считает интерфейс той же послойной раскладкой,
 *   которой нарисована начинка коробки (`layeredPlaces`), и уезжают они вместе
 *   с запросом. Человек видел схему слоями -- слоями она и остаётся;
 * - **кривая**. Провод рисует `lib/wire`, а тот -- библиотечную дугу `arc` из
 *   `lib/miniature`: изгиб подбирается так, чтобы обойти чужие фигуры и не
 *   уехать за схему. Прежняя беда #542 (связь справа налево уходила петлёй
 *   вокруг всей схемы) этим решается сама: выбирать сторону дуге не из чего;
 * - **знаки**. Остриё и плашка описаны один раз (`lib/marker`) и всюду
 *   одинаковы. У возбуждения на холсте стоял кружок -- он симметричен и о
 *   направлении не говорит.
 *
 * Порт при этом по-прежнему получает провод ровно в свой кружок: у него
 * фигура вырождается в точку, и граница такой фигуры -- она сама.
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
 *
 * Холст -- окно в координаты схемы, а не картинка, которую вписывают (#545).
 * `viewBox` следует за областью: единица холста -- пиксель экрана при
 * приближении «один к одному», и от высоты нижней панели меняется только то,
 * сколько схемы видно. Прежде `viewBox` был жёстким `760x420` и вписывался с
 * сохранением пропорций, отчего схема меняла размер, когда тянут границу
 * панели, а за пределами `760x420` ничего не существовало.
 *
 * По схеме ходят колесом и Ctrl с колесом -- теми же жестами, что на
 * таймлайне после #548: голое колесо листает, Ctrl с колесом приближает. Два
 * разных способа приближать в одном экране заводить нельзя: человек не
 * помнит, над чем именно он держит курсор. Пустое место холста ещё и тянется
 * мышью -- это тот же жест «двигать бумагу», которым двигают и объекты, и
 * отдельного способа он не заводит.
 *
 * Приближение и прокрутка -- показ. Место объекта остаётся частью проекта и от
 * приближения не меняется; на сервер окно не ездит, `fingerprint` не трогает,
 * прогон не старит. Живёт оно в состоянии песочницы (`state/sandbox`), потому
 * что смотрит туда не только холст: `free()` кладёт новый объект в видимое
 * место.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react'

import { chargeFill, chargeLabel, momentOf } from '../../lib/charge'
import { capLine, tipPoints } from '../../lib/marker'
import {
  edgePath,
  miniature,
  type ArcBox,
  type ArcField,
  type MiniEdge,
  type Miniature,
} from '../../lib/miniature'
import { CELLS, LINKS, counted } from '../../lib/plural'
import { schemeField, wire, type Point, type WireEnd, type WirePlace } from '../../lib/wire'
import type { CellState } from '../../model/sim'
import type { SandboxBlock, SandboxLink, SandboxNeuron } from '../../model/sandbox'
import type { CellKind } from '../../model/types'
import type { CanvasView, Pending, Selection } from '../../state/sandbox'
import './canvas.css'

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

/**
 * Пределы приближения.
 *
 * Снизу 0.2: на пятой части схема из сотни объектов помещается в окно целиком,
 * а подписи в ней уже не читаются -- дальше отдалять не для чего. Сверху 4:
 * коробка блока в 150 единиц занимает тогда 600 пикселей, и разглядывать в ней
 * нечего, кроме той же подписи.
 */
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4
/** Чувствительность колеса: щелчок мыши (~100) меняет приближение примерно на 22%. */
const WHEEL = 0.002
/** Поле вокруг схемы при «вписать»: объект не должен упираться в край окна. */
const FIT_MARGIN = 40

/**
 * Жесты холста, названные словами.
 *
 * Те же, что на таймлайне (`TIMELINE_HINT`), и написаны они здесь по той же
 * причине: на вид колесо над холстом и колесо над таймлайном одинаковы, а
 * значат разное ровно настолько, насколько разное под ними нарисовано.
 */
export const CANVAS_HINT =
  'колесо прокручивает схему, Shift — вбок, Ctrl с колесом приближает, ' +
  'пустое место тянется мышью'

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

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
  /**
   * Окно: какой кусок координат схемы показывать. Он же `viewBox`.
   *
   * Холст его не держит, а только меняет через `onView`: в это же окно
   * смотрит `free()`, выбирая место новому объекту, и вторая копия «куда мы
   * смотрим» разошлась бы с первой молча (#545).
   */
  view: CanvasView
  /** Окно изменилось: прокрутили, приблизили или область стала другого размера. */
  onView: (view: CanvasView) => void
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
 * Чья фигура на холсте держит этот конец связи.
 *
 * У порта и у внутреннего узла (`ffi/I`) это коробка блока: по холсту двигают
 * её, и обходить её собственной связи незачем -- связь из неё и выходит.
 */
export function ownerOf(instance: string, blocks: SandboxBlock[]): string {
  return innerRef(instance, blocks)?.block.id ?? instance
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
 * У порта фигура вырождается в точку: порт нарисован кружком на своём краю
 * коробки (входы слева, выходы справа), и провод обязан прийти ровно туда.
 * Отдельной ветки это не требует -- точка на границе фигуры нулевого размера
 * есть она сама.
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
    return { ...point, halfWidth: 0, halfHeight: 0 }
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
  view,
  onView,
  onEmpty,
}: CanvasProps) {
  /** Объект, который сейчас тащат. Пока тащат -- рисуем его из этого состояния. */
  const [drag, setDrag] = useState<{ id: string; position: [number, number] } | null>(
    null,
  )
  const frame = useRef<SVGSVGElement | null>(null)
  /** Размер области в пикселях. До первого измерения его нет, а не «ноль». */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  /** Размер, под который окно уже пересчитано: по нему видно, что он изменился. */
  const fitted = useRef<{ width: number; height: number } | null>(null)
  /** Свежее окно для обработчиков, висящих на window во время жеста. */
  const live = useRef(view)
  live.current = view

  /**
   * Во сколько раз схема увеличена: пикселей экрана в единице холста.
   *
   * Считается, а не хранится: держать приближение отдельным числом рядом с
   * окном значило бы завести второе место, где написано одно и то же, и
   * однажды они разошлись бы.
   */
  const zoom = size ? size.width / view.width : 1

  // Область меряется у самого холста, а не считается из окна: её высоту
  // задаёт нижняя панель, которую тянут мышью, и событие `resize` про это
  // ничего не знает. `ResizeObserver` есть не везде (в jsdom его нет) --
  // запасной путь через `resize` беднее, но врать не начинает.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const measure = (): void => {
      const box = el.getBoundingClientRect()
      if (box.width > 0 && box.height > 0) {
        setSize((was) =>
          was && was.width === box.width && was.height === box.height
            ? was
            : { width: box.width, height: box.height },
        )
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  /**
   * Область стала другого размера -- окно меняет размер, но не приближение.
   *
   * Ровно это и требовалось: человек тянет границу нижней панели, и схема не
   * едет, а просто видна больше или меньше. Приближение берётся то, что было
   * до измерения: из прежнего размера области и прежней ширины окна.
   *
   * `useLayoutEffect`, а не `useEffect`: иначе один кадр холст рисуется окном
   * прежнего размера, вписанным в область нового, -- видимый скачок схемы при
   * каждом движении границы.
   */
  useLayoutEffect(() => {
    if (!size) return
    const was = fitted.current
    fitted.current = size
    // Первое измерение: единица холста -- пиксель экрана.
    const kept = was ? was.width / live.current.width : 1
    const width = size.width / kept
    const height = size.height / kept
    if (
      Math.abs(width - live.current.width) < 0.5 &&
      Math.abs(height - live.current.height) < 0.5
    ) {
      return
    }
    onView({ ...live.current, width, height })
  }, [size, onView])

  /**
   * Колесо: голое листает схему, Ctrl с колесом приближает.
   *
   * Те же жесты, что на таймлайне после #548, и по той же причине: два разных
   * способа приближать в одном экране -- это жест, значение которого зависит
   * от того, над чем держат курсор, а этого человек не помнит. Ctrl выбран не
   * произвольно: им приближают в браузере, в картах и в редакторах, и щипок на
   * трекпаде приходит тем же событием.
   *
   * Слушатель вешается руками, а не через `onWheel`: React вешает `wheel`
   * пассивным, и `preventDefault` в нём молча ничего не делает -- страница
   * продолжала бы прокручиваться под приближением.
   */
  useEffect(() => {
    const el = frame.current
    if (!el || !size) return

    const onWheel = (event: WheelEvent): void => {
      const now = live.current
      // `preventDefault` до всякой проверки: и прокрутка схемы, и приближение
      // -- наши жесты, и отдавать их браузеру (который прокрутит страницу или
      // увеличит её целиком) нельзя ни в каком случае.
      event.preventDefault()
      const near = size.width / now.width

      if (event.ctrlKey || event.metaKey) {
        const next = clamp(near * Math.exp(-event.deltaY * WHEEL), MIN_ZOOM, MAX_ZOOM)
        if (next === near) return
        // Точка под курсором остаётся на месте: приближают, чтобы разглядеть
        // конкретный узел, и уезжать из-под мыши он не должен.
        const box = el.getBoundingClientRect()
        const ux = now.x + ((event.clientX - box.left) / box.width) * now.width
        const uy = now.y + ((event.clientY - box.top) / box.height) * now.height
        const width = size.width / next
        const height = size.height / next
        onView({
          x: ux - (ux - now.x) * (width / now.width),
          y: uy - (uy - now.y) * (height / now.height),
          width,
          height,
        })
        return
      }

      // Shift с колесом листает вбок -- привычка из браузера, и отбирать её
      // не за что. Горизонтальное колесо (трекпад) приходит `deltaX`.
      const stepX = (event.shiftKey ? event.deltaY : event.deltaX) / near
      const stepY = (event.shiftKey ? 0 : event.deltaY) / near
      onView({ ...now, x: now.x + stepX, y: now.y + stepY })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [size, onView])

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

  /**
   * Фигуры холста прямоугольниками -- то, мимо чего связь обязана пройти.
   *
   * Ключ -- имя объекта, за который фигуру таскают: у порта и у внутреннего
   * узла это блок целиком. Своя фигура из препятствий исключается в самой
   * связи: обходить коробку, из которой вышел, незачем.
   */
  const figures = useMemo(() => {
    const map = new Map<string, ArcBox>()
    for (const block of blocks) {
      const [x, y] = positionOf(block.id, block.position)
      const box = blockBox(insides.has(block.id))
      map.set(block.id, {
        x: x + box.width / 2,
        y: y + box.height / 2,
        width: box.width,
        height: box.height,
      })
    }
    for (const neuron of neurons) {
      const [x, y] = positionOf(neuron.id, neuron.position)
      map.set(neuron.id, { x, y, width: DOT.width, height: DOT.height })
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, neurons, insides, drag])

  /**
   * Поле для дуг -- общий прямоугольник схемы.
   *
   * У миниатюры поле задано макетом карточки, а здесь фигуры кладёт человек, и
   * «за пределы» значит «за пределы того, что он разложил». Это же и приёмка
   * #542: провод не уходит от схемы дальше собственного изгиба.
   */
  const field = useMemo<ArcField | undefined>(() => {
    const boxes = [...figures.values()]
    return boxes.length ? schemeField(boxes) : undefined
  }, [figures])

  /**
   * Развод одинаковых ходов: сколько связей уже шло этим путём и одинока ли
   * связь между парой концов.
   *
   * То же самое, что миниатюра считает для встречных связей (#524): `A⊣B` и
   * `B⊣A` прямыми легли бы одна на другую, и взаимное торможение выглядело бы
   * одной линией неизвестно куда. Пара считается по концам, а не по фигурам:
   * два провода из разных портов одной коробки и так выходят из разных точек.
   */
  const routing = useMemo(() => {
    const key = (end: { instance: string; port: string | null }): string =>
      `${end.instance}|${end.port ?? ''}`
    const pair = (link: SandboxLink): string => {
      const one = key(link.source)
      const other = key(link.target)
      return one < other ? `${one} ${other}` : `${other} ${one}`
    }
    const pairSize = new Map<string, number>()
    for (const link of links) pairSize.set(pair(link), (pairSize.get(pair(link)) ?? 0) + 1)

    const seen = new Map<string, number>()
    const map = new Map<string, { sameWay: number; alone: boolean }>()
    for (const link of links) {
      const way = `${key(link.source)} -> ${key(link.target)}`
      const sameWay = seen.get(way) ?? 0
      seen.set(way, sameWay + 1)
      map.set(link.id, { sameWay, alone: (pairSize.get(pair(link)) ?? 1) <= 1 })
    }
    return map
  }, [links])

  /**
   * Что окружает связь: чужие фигуры и поле.
   *
   * Свои фигуры из препятствий убраны -- связь из них и выходит, обходить их
   * незачем. Кроме одного случая: когда оба конца на одной фигуре (выход блока
   * в его же вход, связь между двумя узлами одной коробки), она перестаёт быть
   * своей. Иначе провод лёг бы отрезком по самой коробке и пропал бы на ней.
   */
  const placeOf = (link: SandboxLink): WirePlace => {
    const mine = new Set([
      ownerOf(link.source.instance, blocks),
      ownerOf(link.target.instance, blocks),
    ])
    const shelter = mine.size > 1 ? mine : new Set<string>()
    return {
      others: [...figures.entries()]
        .filter(([id]) => !shelter.has(id))
        .map(([, box]) => box),
      field,
      ...(routing.get(link.id) ?? {}),
    }
  }

  const startDrag = (
    event: PointerEvent<SVGGElement>,
    id: string,
    from: [number, number],
  ): void => {
    const svg = event.currentTarget.ownerSVGElement
    if (!svg) return
    // Сколько единиц холста в пикселе экрана.
    //
    // Один и тот же счёт и в перетаскивании, и в отрисовке: окно -- это и есть
    // `viewBox`, а холст вписан в область с сохранением пропорций (`viewBox`
    // без `preserveAspectRatio` -- это `meet`), то есть масштаб задаёт та
    // сторона, которой не хватает. Считать его по одной ширине можно было,
    // пока область повторяла пропорцию холста. С оконным каркасом (#504)
    // высоту области задаёт нижняя панель, человек тянет её границу -- и
    // пропорция расходится. Тогда масштаб определяет высота, счёт по ширине
    // даёт число меньше настоящего, и объект отстаёт от курсора (#544).
    //
    // Теперь окно само следует за областью, и обе стороны дают одно и то же
    // число -- кроме единственного кадра между измерением и пересчётом окна.
    // Ради этого кадра `Math.max` и остаётся: он верен и в нём.
    const box = svg.getBoundingClientRect()
    const scale = Math.max(view.width / box.width, view.height / box.height)
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

  /**
   * Пустое место холста тянется мышью -- окно едет за рукой.
   *
   * Тот же жест, которым двигают объекты, только двигается бумага под ними, и
   * отдельного способа ходить по схеме он не заводит. Снятие выделения при
   * этом никуда не делось: если рука не сдвинулась дальше порога, это был
   * щелчок по пустому месту, а не перетаскивание. Разделять их по кнопке мыши
   * (средняя -- тащить) значило бы прятать ход по схеме от тех, у кого мышь с
   * двумя кнопками или трекпад.
   */
  const startPan = (event: PointerEvent<SVGSVGElement>): void => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    const scale = Math.max(view.width / box.width, view.height / box.height)
    const grabX = event.clientX
    const grabY = event.clientY
    const from = { x: view.x, y: view.y }
    let moved = false

    const move = (at: globalThis.PointerEvent): void => {
      const dx = at.clientX - grabX
      const dy = at.clientY - grabY
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      moved = true
      // Схема едет за рукой, значит окно едет против неё.
      onView({ ...live.current, x: from.x - dx * scale, y: from.y - dy * scale })
    }

    const drop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', drop)
      if (!moved) onEmpty()
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', drop)
  }

  /**
   * «Вписать»: показать всю схему целиком.
   *
   * Нужна затем же, зачем «целиком» на таймлайне: уехав прокруткой в угол
   * схемы из двадцати клеток, назад по одному щелчку колеса не вернёшься, а
   * искать потерянный объект вслепую -- не работа. Поле по краям, чтобы
   * крайний объект не упирался в границу окна.
   */
  const bounds = useMemo(() => {
    const spots: Array<{ x: number; y: number; width: number; height: number }> = []
    for (const block of blocks) {
      const box = blockBox(insides.has(block.id))
      spots.push({ x: block.position[0], y: block.position[1], ...box })
    }
    for (const neuron of neurons) {
      spots.push({
        x: neuron.position[0] - DOT.width / 2,
        y: neuron.position[1] - DOT.height / 2,
        width: DOT.width,
        height: DOT.height,
      })
    }
    if (!spots.length) return null
    return {
      left: Math.min(...spots.map((item) => item.x)),
      top: Math.min(...spots.map((item) => item.y)),
      right: Math.max(...spots.map((item) => item.x + item.width)),
      bottom: Math.max(...spots.map((item) => item.y + item.height)),
    }
  }, [blocks, neurons, insides])

  const fit = (): void => {
    if (!size || !bounds) return
    const width = bounds.right - bounds.left + FIT_MARGIN * 2
    const height = bounds.bottom - bounds.top + FIT_MARGIN * 2
    // Приближение одно на обе стороны: разное растянуло бы схему.
    const next = clamp(
      Math.min(size.width / width, size.height / height),
      MIN_ZOOM,
      MAX_ZOOM,
    )
    const seen = { width: size.width / next, height: size.height / next }
    onView({
      x: (bounds.left + bounds.right) / 2 - seen.width / 2,
      y: (bounds.top + bounds.bottom) / 2 - seen.height / 2,
      ...seen,
    })
  }

  return (
    <div className="canvas">
      <svg
        className="cv-svg"
        ref={frame}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        onPointerDown={startPan}
      >
      {links.map((link) => (
        <Link
          key={link.id}
          link={link}
          blocks={blocks}
          neurons={neurons}
          insides={insides}
          positionOf={positionOf}
          place={placeOf(link)}
          selected={selected?.kind === 'link' && selected.id === link.id}
          onPick={() => onPickLink(link.id)}
        />
      ))}

      {blocks.map((block) => {
        const [x, y] = positionOf(block.id, block.position)
        const chosen = selected?.kind === 'block' && selected.id === block.id
        const inside = insides.get(block.id)
        const open = inside !== undefined
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

            {inside ? (
              <g transform={`translate(${x} ${y + HEADER})`}>
                {inside.edges.map((edge) => (
                  <InnerEdge key={edge.id} edge={edge} />
                ))}
                {inside.nodes.map((node) => {
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

      {/* Пустой холст зовёт положить клетку, а не показывает пустоту. Надпись
          стоит посреди окна, а не посреди координат: уехав прокруткой, человек
          иначе видел бы просто ничего и не знал бы, что делать (#545). */}
      {blocks.length === 0 && neurons.length === 0 ? (
        <text
          className="cv-empty"
          x={view.x + view.width / 2}
          y={view.y + view.height / 2}
          textAnchor="middle"
        >
          Пусто. Положите клетку из палитры или вставьте паттерн слева.
        </text>
      ) : null}
      </svg>

      {/* Приближение числом и «вписать» -- поверх холста, а не в шапке панели:
          у холста своей шапки нет, а жест над ним. Строка жестов подсказкой, а
          не надписью: она объясняет, а не управляет, и место на холсте нужно
          схеме. */}
      <div className="cv-tools">
        <button
          type="button"
          className="mono cv-fit"
          disabled={!bounds}
          title={`Показать всю схему целиком. ${CANVAS_HINT}`}
          onClick={fit}
        >
          {Math.abs(zoom - 1) < 0.01
            ? '1:1'
            : `×${zoom < 10 ? zoom.toFixed(1) : zoom.toFixed(0)}`}
        </button>
      </div>
    </div>
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
  return (
    <g className={`cv-in-link is-${edge.kind}`}>
      <path className="cv-in-wire" d={edgePath(edge)} fill="none" />
      {edge.kind === 'inh' ? (
        <line className="cv-in-cap" {...capLine(edge.end, edge.tip)} />
      ) : (
        <polygon className="cv-in-cap" points={tipPoints(edge.end, edge.tip)} />
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
  place,
  selected,
  onPick,
}: {
  link: SandboxLink
  blocks: SandboxBlock[]
  neurons: SandboxNeuron[]
  insides: Insides
  positionOf: (id: string, fallback: [number, number]) => [number, number]
  place: WirePlace
  selected: boolean
  onPick: () => void
}) {
  const from = endpointEnd(link.source, blocks, neurons, positionOf, insides)
  const to = endpointEnd(link.target, blocks, neurons, positionOf, insides)
  if (!from || !to) return null

  // Связь ведётся дугой -- той же, что в миниатюре (`arc`, #554). Две прямые
  // между соседними блоками сливаются, и какая куда идёт -- уже не разобрать;
  // изгиб же подбирается так, чтобы обойти чужие фигуры и не уехать за схему.
  const line = wire(from, to, place)
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
      {/* Знаки общие на весь проект (`lib/marker`): торможение -- плашка
          поперёк хода, возбуждение -- остриё. Остриё, а не точка: точка
          симметрична, и `A→B` с `B→A` выглядели по ней одинаково (#524). */}
      {link.inhibitory ? (
        <line className="cv-cap" {...capLine(end, tip)} />
      ) : (
        <polygon className="cv-cap" points={tipPoints(end, tip)} />
      )}
    </g>
  )
}
