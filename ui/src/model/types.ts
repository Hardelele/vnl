/**
 * Зеркало формата из `vnl/api.py`. Менять только вместе с ним: поле, которого
 * там нет, здесь бесполезно, а расхождение вылезет уже в браузере.
 */

export const SCHEMA_VERSION = 1

/** Разрешённый адрес точки на клетке: тот же кортеж, что понимает NEURON. */
export interface Site {
  instance: string
  section: string
  fraction: number
}

export interface Section {
  id: string
  kind: 'soma' | 'dend' | 'axon'
  parent: string | null
  length: number
  diam: number
  lambda: number
}

export interface Morphology {
  name: string
  isPoint: boolean
  sections: Section[]
}

export interface PointModel {
  kind: string
  vRest: number
  vReset: number
  vThreshold: number
  tauM: number
  rIn: number
  refractory: number
  adaptation: number
  tauAdaptation: number
}

export interface CellType {
  id: string
  tags: string[]
  transmitter: string | null
  inhibitory: boolean
  pointModel: PointModel
  morphology: Morphology
}

export interface Neuron {
  id: string
  cellType: string
  tags: string[]
  inhibitory: boolean
}

/**
 * Тип клетки в каталоге -- то, что кладут на холст из палитры.
 *
 * Не разновидность паттерна: портов у клетки нет (соединяется она точками на
 * себе), внутренностей нет (разворачивать и форкать нечего), зато есть
 * параметры мембраны, которых у паттерна не бывает. Поэтому и каталог свой, и
 * ни ступени разбора, ни статуса готовности здесь нет.
 *
 * `inhibitory` приходит с сервера (`ir.is_inhibitory_cell`), а не считается
 * здесь по тегам: от него зависит фигура на холсте, и второе место, где
 * «тормозная» значит своё, разошлось бы с первым незаметно.
 */
export interface CellKind {
  id: string
  name: string
  note: string
  tags: string[]
  transmitter: string | null
  inhibitory: boolean
  /** Встроенная клетка или заведённая человеком. Встроенную можно перекрыть. */
  builtin: boolean
  /** Файл, из которого клетку разобрали; у встроенных пусто. */
  source: string | null
  pointModel: PointModel
  morphology: Morphology
}

export interface ShortTermDynamics {
  enabled: boolean
  u: number
  tauRec: number
  tauFacil: number
}

export interface Plasticity {
  enabled: boolean
  rule: 'none' | 'stdp' | 'stdp_rl'
  aPlus: number
  aMinus: number
  tauPlus: number
  tauMinus: number
  wMax: number
  wMin: number
  tauEligibility: number
  modulator: string | null
}

export interface Contact {
  id: string
  pre: Site
  post: Site
  receptor: string
  inhibitory: boolean
  reversal: number
  tauDecay: number
  weight: number
  delay: number
  dynamics: ShortTermDynamics
  plasticity: Plasticity
}

export interface Modulator {
  id: string
  transmitter: string
  sources: string[]
  gain: number
  tau: number
}

export interface Stimulus {
  id: string
  target: Site
  kind: 'current' | 'poisson' | 'spikes'
  receptor: string
  amplitude: number
  rate: number
  times: number[]
  start: number
  stop: number
}

export type RecordedVar = 'v' | 'g' | 'g_exc' | 'g_inh' | 'w' | 'spikes'

export interface Recording {
  id: string
  target: Site
  var: RecordedVar
  key: string
}

export interface RunSpec {
  dt: number
  duration: number
  level: 'L0' | 'L1' | 'L2'
  seed: number
}

export interface Model {
  name: string
  source: string | null
  run: RunSpec
  cellTypes: Record<string, CellType>
  neurons: Neuron[]
  contacts: Contact[]
  modulators: Modulator[]
  stimuli: Stimulus[]
  recordings: Recording[]
}

export interface Result {
  dt: number
  samples: number
  /** Ключ вида `E.soma:v`. Времён нет: t = i * dt. */
  traces: Record<string, number[]>
  spikes: Record<string, number[]>
  degradation: string[]
}

export interface Diagnostic {
  severity: 'error' | 'warning'
  where: string
  message: string
}

export interface SweepVariant {
  label: string
  value: number
  result: Result
  spikes: Record<string, number>
  rates: Record<string, number>
  diagnostics: Diagnostic[]
}

export interface Sweep {
  /** Исходная строка развёртки, например `c3.delay=0.5,1.4,4,10`. */
  spec: string
  /** Путь параметра: `c3.delay`. */
  path: string
  variants: SweepVariant[]
}

export interface Run {
  schema: number
  model: Model
  result: Result
  diagnostics: Diagnostic[]
  /** Есть только если прогон делался с развёрткой параметра. */
  sweep?: Sweep
}

// --- библиотека паттернов -------------------------------------------------

/**
 * Ступень разбора в каталоге, а не уровень детализации физики.
 *
 * Имена ступеней и их порядок сюда не переносятся намеренно: их держит
 * сервер (`patterns.LEVEL_NAMES`) и отдаёт в `Catalog.levels`, а библиотека
 * строит группы по этому списку. Своя копия названий здесь означала бы, что
 * после правки ступеней на сервере интерфейс какое-то время подписывает
 * группы по-старому.
 */
export type CatalogLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

export type PatternStatus = 'draft' | 'ready'

export interface PatternPort {
  name: string
  direction: 'in' | 'out' | 'mod'
  site: Site
  note: string
}

export interface SchemeNeuron {
  id: string
  inhibitory: boolean
}

/** Род связи: возбуждение, торможение и нейромодулятор -- разные механизмы. */
export type EdgeKind = 'exc' | 'inh' | 'mod'

export interface SchemeEdge {
  id: string
  from: string
  to: string
  kind: EdgeKind
}

/** Схема паттерна для миниатюры: из неё рисуется картинка в каталоге. */
export interface Scheme {
  neurons: SchemeNeuron[]
  edges: SchemeEdge[]
}

/** Витрина карточки: пример запуска, который не переезжает в чужую сеть. */
export interface DemoRun {
  stimuli: Stimulus[]
  recordings: Recording[]
  run: RunSpec
}

export interface Pattern {
  id: string
  name: string
  level: CatalogLevel
  levelName: string
  status: PatternStatus
  statusName: string
  ports: PatternPort[]
  counts: { neurons: number; contacts: number; ports: number }
  scheme: Scheme
  demo: DemoRun | null
  /** Чего паттерну не хватает, чтобы считаться готовым. */
  problems: string[]
  createdAt: string
  updatedAt: string
}

/** Паттерн с начинкой: приходит по запросу одного паттерна, не в каталоге. */
export interface PatternDetail extends Pattern {
  body: Model
}

/** Чип фильтра вместе с числом паттернов за ним. */
export interface Facet {
  id: string
  name: string
  count: number
}

export interface Catalog {
  schema: number
  query: { text: string; levels: string[]; statuses: string[] }
  /** Сколько всего в библиотеке и сколько прошло отбор. */
  total: number
  matched: number
  levels: Facet[]
  statuses: Facet[]
  patterns: Pattern[]
}
