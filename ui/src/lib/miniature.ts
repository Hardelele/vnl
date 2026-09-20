/**
 * Миниатюра схемы для карточки каталога.
 *
 * Раскладку большой схемы считает ELK: на трёх контактах самописные кривые уже
 * сливаются. Миниатюре он не нужен и мешает -- она размером со спичечный
 * коробок, а список из сорока карточек не должен ждать асинхронный движок и
 * дёргаться, когда тот ответит. Здесь простая послойная расстановка: слой --
 * это глубина по связям, внутри слоя клетки раскладываются поровну.
 *
 * Цикл (а растормаживание -- это почти цикл) обычную топологическую сортировку
 * останавливает. Поэтому неразобранные клетки после прохода ставятся за самым
 * глубоким из уже разобранных предшественников: миниатюра не обязана быть
 * точной, но обязана нарисоваться для любой схемы.
 *
 * Модуляция в глубину не считается. Дофамин из VTA -- не шаг сигнала, а
 * управление контактом; считай его связью, и клетка уезжала бы на слой вправо
 * по причине, которой на схеме нет.
 *
 * Связи -- дуги, а не отрезки. Отрезками миниатюра врала: FFI (`IN→E`, `IN→I`,
 * `I→E`) выглядела цепочкой `IN — I — E`, потому что обходная связь `IN→E` шла
 * ровно там же, где путь через `I`, а встречная пара `A⊣B`, `B⊣A` давала одну
 * линию -- вторая ложилась на первую. Поэтому каждой связи здесь выбирается
 * отклонение (`bow`): 0, если прямая никому не мешает, иначе дуга. Сторону
 * задаёт перпендикуляр справа по ходу связи -- у встречной пары ход обратный,
 * и дуги расходятся сами, без сговора между связями и без зависимости от
 * порядка в списке. Величина берётся из нескольких заготовленных шагов: для
 * каждого считается штраф (задел за чужую фигуру, выход за поле, лишняя
 * кривизна), побеждает наименьший. Это десяток проб на связь на одной
 * арифметике -- дешевле, чем разметка текста рядом, и синхронно.
 *
 * Тот же подбор рисует теперь и провода холста песочницы (`lib/wire`, #554).
 * Раскладок «как выглядит эта схема» в проекте было три, и они разошлись:
 * человек видел внутри коробки схему слоями, жал «разобрать на клетки» и
 * получал ту же схему сеткой, да ещё и другими кривыми с другими знаками на
 * концах. Владелец выбрал направление переноса прямо: в библиотеке хорошо,
 * значит на холсте должно стать как в библиотеке, а не наоборот. Поэтому
 * подбор изгиба вынесен сюда одной функцией (`arc`) и зовётся из обоих мест,
 * а не переписан на холсте во второй раз.
 *
 * Отсюда же две мелочи, которых миниатюре одной не требовалось:
 *
 * - поле (`ArcField`) задаётся прямоугольником, а не размером. У миниатюры оно
 *   начинается в нуле, у холста -- это общий прямоугольник схемы, и он стоит
 *   где угодно;
 * - шаг отклонения считается от роста самой высокой фигуры на пути, а не берётся
 *   числом. Прежнее число 34 подобрано под клетку миниатюры высотой 20 -- ровно
 *   то, что даёт эта формула, -- но на холсте клетка 38, а коробка блока 62, и
 *   дуга с отклонением 17 обошла бы их насквозь.
 */

import type { EdgeKind, Scheme } from '../model/types'

export interface MiniPoint {
  x: number
  y: number
}

export interface MiniNode {
  id: string
  inhibitory: boolean
  /** Центр фигуры. */
  x: number
  y: number
  width: number
  height: number
}

export interface MiniEdge {
  id: string
  kind: EdgeKind
  from: MiniNode
  to: MiniNode
  /** Точки на границах фигур: линия не должна перечёркивать подпись. */
  start: MiniPoint
  end: MiniPoint
  /** Отклонение дуги от прямой; 0 -- связь идёт прямой. */
  bow: number
  /** Контрольная точка квадратичной кривой; при `bow` 0 лежит на прямой. */
  control: MiniPoint
  /** Единичный вектор входа в цель: по нему повёрнут знак на конце связи. */
  tip: MiniPoint
}

export interface Miniature {
  width: number
  height: number
  nodes: MiniNode[]
  edges: MiniEdge[]
}

export interface MiniatureBox {
  width: number
  height: number
  padding: number
}

/**
 * Фигура, из которой связь выходит, в которую входит или мимо которой идёт.
 *
 * Центр и размер, а не углы: линия выходит на границе прямоугольника, и
 * считается эта точка от центра. У порта блока размеры нулевые -- порт
 * нарисован кружком на своём краю коробки, и связь обязана прийти ровно туда.
 */
export interface ArcBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Поле, за которое дуге лучше не выходить.
 *
 * Прямоугольник, а не размер: у миниатюры поле начинается в нуле, а у холста
 * это общий прямоугольник схемы -- он стоит там, где стоят фигуры.
 */
export interface ArcField {
  x: number
  y: number
  width: number
  height: number
}

/** Дуга связи: где начинается, где кончается и как изогнута. */
export interface Arc {
  start: MiniPoint
  end: MiniPoint
  control: MiniPoint
  bow: number
  tip: MiniPoint
}

/** Поле макета: карточка отводит миниатюре 240x120. */
export const DEFAULT_BOX: MiniatureBox = { width: 240, height: 120, padding: 30 }

const NODE_HEIGHT = 20
const NODE_MIN_WIDTH = 28
const NODE_MAX_WIDTH = 72
/** Ширина знака подписи в 10px Roboto -- с запасом, чтобы имя не вылезало. */
const CHAR_WIDTH = 5.8

/** Зазор, с которым связь обходит чужую фигуру: меньше -- линия её задевает. */
const CLEARANCE = 4
/** Запас сверх зазора: без него дуга ложится ровно на угол обходимой фигуры. */
const BOW_LEEWAY = 3
/** Если шага не хватило -- дуга круче; больше 2 шагов уже не влезает в поле. */
const BOW_SCALE = [1, 1.55, 2.1]
/** Сколько точек кривой проверяется на помехи: хватает, чтобы не проскочить. */
const SAMPLES = 15
/** Полоса у края поля, за которую дуге лучше не выходить: там её срежет. */
const EDGE_INSET = 2

export function nodeWidth(label: string): number {
  const measured = 12 + label.length * CHAR_WIDTH
  return Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, measured))
}

/** Глубина каждой клетки по связям; модуляция не считается. */
export function depths(scheme: Scheme): Map<string, number> {
  const depth = new Map<string, number>()
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()

  for (const neuron of scheme.neurons) {
    incoming.set(neuron.id, 0)
    outgoing.set(neuron.id, [])
  }
  const edges = scheme.edges.filter(
    (edge) =>
      edge.kind !== 'mod' &&
      edge.from !== edge.to &&
      incoming.has(edge.from) &&
      incoming.has(edge.to),
  )
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    outgoing.get(edge.from)?.push(edge.to)
  }

  const queue = scheme.neurons
    .filter((neuron) => (incoming.get(neuron.id) ?? 0) === 0)
    .map((neuron) => neuron.id)
  for (const id of queue) depth.set(id, 0)

  while (queue.length) {
    const id = queue.shift() as string
    const here = depth.get(id) ?? 0
    for (const next of outgoing.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, here + 1))
      const left = (incoming.get(next) ?? 0) - 1
      incoming.set(next, left)
      if (left === 0) queue.push(next)
    }
  }

  // Остались запертые в цикле: ставим за самым глубоким предшественником.
  for (const neuron of scheme.neurons) {
    if (depth.has(neuron.id)) continue
    const before = edges
      .filter((edge) => edge.to === neuron.id)
      .map((edge) => depth.get(edge.from))
      .filter((value): value is number => value !== undefined)
    depth.set(neuron.id, before.length ? Math.max(...before) + 1 : 0)
  }
  return depth
}

/**
 * Клетки схемы по слоям: слой -- глубина по связям, порядок внутри слоя --
 * порядок клеток в самой схеме.
 *
 * Вынесено из `miniature` потому, что слои нужны не только ей. Разбор блока на
 * холсте ставит клетки по этой же раскладке (#554): человек видел внутри
 * коробки схему слоями, и после «разобрать на клетки» она обязана стоять
 * слоями, а не сеткой «лишь бы не в кучу». Вторая такая же расстановка
 * разошлась бы с первой незаметно -- она и расходилась.
 */
export function layered(scheme: Scheme): string[][] {
  const depth = depths(scheme)
  const columns = new Map<number, string[]>()
  for (const neuron of scheme.neurons) {
    const level = depth.get(neuron.id) ?? 0
    const column = columns.get(level) ?? []
    column.push(neuron.id)
    columns.set(level, column)
  }
  const last = Math.max(0, ...columns.keys())
  const out: string[][] = []
  // Слой без клеток возможен и пропускать его нельзя: пропущенный слой сдвинул
  // бы все следующие влево, и схема поехала бы относительно той же схемы,
  // нарисованной миниатюрой.
  for (let level = 0; level <= last; level += 1) out.push(columns.get(level) ?? [])
  return out
}

/**
 * Места клеток по той же раскладке, но шагом холста.
 *
 * Пиксели миниатюры сюда не переносятся: фигура клетки на холсте 74x38, а в
 * миниатюре 28x20, и один в один они не лягут. Переносится строение -- какая
 * клетка в каком слое и в каком ряду, -- а шаг задаёт тот, кто знает размер
 * нарисованной фигуры.
 *
 * Слой -- столбец, как и в миниатюре: схема читается слева направо. Вокруг
 * названной точки, а не в неё: стопка из трёх клеток, положенная в одно место,
 * выглядит одной клеткой, и растаскивать её пришлось бы мышью.
 */
export function layeredPlaces(
  scheme: Scheme,
  centre: [number, number],
  step: { x: number; y: number },
): Record<string, [number, number]> {
  const columns = layered(scheme)
  const places: Record<string, [number, number]> = {}
  columns.forEach((ids, column) => {
    ids.forEach((id, row) => {
      places[id] = [
        Math.round(centre[0] + (column - (columns.length - 1) / 2) * step.x),
        Math.round(centre[1] + (row - (ids.length - 1) / 2) * step.y),
      ]
    })
  })
  return places
}

/** Точка выхода линии на границе фигуры -- прямоугольник режется точно. */
function boundary(node: ArcBox, dx: number, dy: number): MiniPoint {
  const halfWidth = node.width / 2
  const halfHeight = node.height / 2
  const scale = Math.min(
    halfWidth / Math.max(Math.abs(dx), 1e-6),
    halfHeight / Math.max(Math.abs(dy), 1e-6),
  )
  return { x: node.x + dx * scale, y: node.y + dy * scale }
}

/**
 * Контрольная точка квадратичной кривой: середина хода, сдвинутая по
 * перпендикуляру справа по ходу связи. Наибольшее отклонение кривой от прямой
 * -- ровно `bow / 2`, на середине.
 */
function controlPoint(from: MiniPoint, to: MiniPoint, bow: number): MiniPoint {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  return {
    x: (from.x + to.x) / 2 - (dy / length) * bow,
    y: (from.y + to.y) / 2 + (dx / length) * bow,
  }
}

function quadPoints(p0: MiniPoint, p1: MiniPoint, p2: MiniPoint, count: number): MiniPoint[] {
  const points: MiniPoint[] = []
  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? i / (count - 1) : 0.5
    const k = 1 - t
    points.push({
      x: k * k * p0.x + 2 * k * t * p1.x + t * t * p2.x,
      y: k * k * p0.y + 2 * k * t * p1.y + t * t * p2.y,
    })
  }
  return points
}

/** Точки вдоль нарисованной связи: по ним видно, где она на самом деле идёт. */
export function edgePoints(edge: MiniEdge, count = 9): MiniPoint[] {
  return quadPoints(edge.start, edge.control, edge.end, count)
}

/** Путь связи для SVG. Прямая -- та же кривая, просто с `bow` 0. */
export function edgePath(edge: MiniEdge): string {
  const round = (value: number): number => Math.round(value * 100) / 100
  return [
    `M ${round(edge.start.x)} ${round(edge.start.y)}`,
    `Q ${round(edge.control.x)} ${round(edge.control.y)}`,
    `${round(edge.end.x)} ${round(edge.end.y)}`,
  ].join(' ')
}

/** Насколько точка зашла в фигуру с зазором; 0 -- не зашла. */
function intrusion(node: ArcBox, point: MiniPoint): number {
  const overX = node.width / 2 + CLEARANCE - Math.abs(point.x - node.x)
  const overY = node.height / 2 + CLEARANCE - Math.abs(point.y - node.y)
  return overX > 0 && overY > 0 ? Math.min(overX, overY) : 0
}

/** Чем плох такой изгиб: чужие фигуры на пути, выход за поле, лишняя дуга. */
function penalty(
  from: ArcBox,
  to: ArcBox,
  bow: number,
  others: ArcBox[],
  field: ArcField,
): number {
  const points = quadPoints(from, controlPoint(from, to, bow), to, SAMPLES)
  // Пересечь чужую клетку нельзя совсем -- из-за этого FFI и читался цепочкой.
  let cost = Math.abs(bow) * 0.04
  for (const node of others) {
    let deepest = 0
    for (const point of points) deepest = Math.max(deepest, intrusion(node, point))
    if (deepest > 0) cost += 100 + deepest
  }
  for (const point of points) {
    const outside = Math.max(
      0,
      field.x + EDGE_INSET - point.x,
      point.x - (field.x + field.width - EDGE_INSET),
      field.y + EDGE_INSET - point.y,
      point.y - (field.y + field.height - EDGE_INSET),
    )
    cost += 8 * outside
  }
  return cost
}

/**
 * Шаг отклонения: на сколько дуга отходит от прямой, чтобы обойти фигуру.
 *
 * Наибольшее отклонение кривой от прямой -- половина шага, поэтому шаг берётся
 * в два роста самой высокой фигуры из тех, что связь может задеть, плюс зазор
 * и небольшой запас. У миниатюры все клетки высотой 20, и формула даёт ровно
 * то число 34, что стояло здесь константой. На холсте клетка 38, а коробка
 * блока 62 -- тем же числом 34 дуга проходила бы сквозь них.
 *
 * Концы связи считаются наравне с чужими фигурами: встречная пара разводится
 * этим же шагом, и разойтись она должна настолько, чтобы обе дуги были видны
 * рядом со своими клетками, а не слиплись у них на краю.
 */
function bowStep(from: ArcBox, to: ArcBox, others: ArcBox[]): number {
  let half = 0
  for (const box of [from, to, ...others]) half = Math.max(half, box.height / 2)
  return 2 * (half + CLEARANCE + BOW_LEEWAY)
}

/**
 * Чем пробовать отклонять связь. Единственная связь пары может идти прямой и
 * пробует обе стороны; вторая связь пары прямой идти не может -- она легла бы
 * точно на первую, -- поэтому только дуги и только вправо по ходу: встречная,
 * идущая обратно, окажется с другой стороны сама.
 */
function bowChoices(step: number, sameWay: number, alone: boolean): number[] {
  const base = step * (sameWay + 1)
  const arcs = BOW_SCALE.map((scale) => base * scale)
  if (!alone) return arcs
  return [0, ...arcs.flatMap((value) => [value, -value])]
}

/** Пара клеток без учёта направления: у встречных связей ключ один. */
function pairKey(from: string, to: string): string {
  return from < to ? `${from} ${to}` : `${to} ${from}`
}

/**
 * Дуга одной связи: выбрать изгиб и посчитать точки.
 *
 * Вынесено наружу ради проводов холста песочницы (#554): дуга там считается
 * этой же функцией, а не второй такой же. Три вещи решаются разом, и порядок
 * между ними важен:
 *
 * 1. изгиб выбирается перебором заготовленных шагов по наименьшему штрафу --
 *    задел за чужую фигуру дороже всего, выход за поле дешевле, лишняя
 *    кривизна дешевле всего;
 * 2. точки крепления берутся уже по выбранному изгибу: связь выходит из
 *    фигуры и входит в неё в сторону дуги, иначе линия отрывалась бы от
 *    клетки на самом видном месте -- у её края;
 * 3. `tip` -- касательная в конце, а не направление «начало -- конец»: по ней
 *    повёрнут знак рода связи, и на дуге это разные вещи.
 *
 * Связь фигуры на саму себя сюда не приходит: ход нулевой длины, делить на
 * него нельзя, а изгибать нечего. Миниатюра такие связи не рисует вовсе,
 * холст рисует петлёй у самой фигуры (`lib/wire`).
 */
export function arc(
  from: ArcBox,
  to: ArcBox,
  others: ArcBox[],
  field: ArcField,
  sameWay = 0,
  alone = true,
): Arc {
  const step = bowStep(from, to, others)
  let bow = 0
  let best = Number.POSITIVE_INFINITY
  for (const choice of bowChoices(step, sameWay, alone)) {
    const cost = penalty(from, to, choice, others, field)
    if (cost < best) {
      best = cost
      bow = choice
    }
  }

  const control = controlPoint(from, to, bow)
  const start = boundary(from, control.x - from.x, control.y - from.y)
  const end = boundary(to, control.x - to.x, control.y - to.y)
  const tipX = end.x - control.x
  const tipY = end.y - control.y
  const tipLength = Math.hypot(tipX, tipY) || 1
  return {
    start,
    end,
    control,
    bow,
    tip: { x: tipX / tipLength, y: tipY / tipLength },
  }
}

export function miniature(scheme: Scheme, box: MiniatureBox = DEFAULT_BOX): Miniature {
  const columns = layered(scheme)

  const span = (size: number, count: number, index: number): number => {
    // Одна клетка стоит по центру, несколько -- поровну между краями поля.
    const inner = size - 2 * box.padding
    if (count <= 1) return size / 2
    return box.padding + (inner * index) / (count - 1)
  }

  const placed = new Map<string, MiniNode>()
  columns.forEach((ids, level) => {
    ids.forEach((id, index) => {
      const neuron = scheme.neurons.find((item) => item.id === id)
      placed.set(id, {
        id,
        inhibitory: neuron?.inhibitory ?? false,
        x: span(box.width, columns.length, level),
        y: span(box.height, ids.length, index),
        width: nodeWidth(id),
        height: NODE_HEIGHT,
      })
    })
  })

  const nodes = scheme.neurons
    .map((neuron) => placed.get(neuron.id))
    .filter((node): node is MiniNode => node !== undefined)

  const drawn = scheme.edges
    .map((edge) => ({ edge, from: placed.get(edge.from), to: placed.get(edge.to) }))
    .filter(
      (item): item is { edge: Scheme['edges'][number]; from: MiniNode; to: MiniNode } =>
        item.from !== undefined && item.to !== undefined && item.from !== item.to,
    )

  const pairSize = new Map<string, number>()
  for (const { edge } of drawn) {
    const key = pairKey(edge.from, edge.to)
    pairSize.set(key, (pairSize.get(key) ?? 0) + 1)
  }

  const seen = new Map<string, number>()
  const edges: MiniEdge[] = []
  for (const { edge, from, to } of drawn) {
    const wayKey = `${edge.from} ${edge.to}`
    const sameWay = seen.get(wayKey) ?? 0
    seen.set(wayKey, sameWay + 1)
    const alone = (pairSize.get(pairKey(edge.from, edge.to)) ?? 1) <= 1
    const others = nodes.filter((node) => node !== from && node !== to)
    // Поле миниатюры начинается в нуле; у холста оно стоит там, где фигуры.
    const line = arc(
      from,
      to,
      others,
      { x: 0, y: 0, width: box.width, height: box.height },
      sameWay,
      alone,
    )
    edges.push({ id: edge.id, kind: edge.kind, from, to, ...line })
  }

  return { width: box.width, height: box.height, nodes, edges }
}
