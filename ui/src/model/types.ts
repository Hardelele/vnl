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

/**
 * Параметры мембраны -- те же, что в `api.POINT_FIELDS`, и в том же порядке.
 *
 * Полей ровно пятнадцать, а не девять, как было до #527: пять последних читает
 * только `adex`, но приходят они всегда. Условный состав ответа означал бы,
 * что интерфейс не знает заранее, какие ключи придут, -- а не приди они
 * вовсе, `adex` нельзя было бы ни настроить, ни даже увидеть.
 */
export interface PointModel {
  /** Вид точечной модели: `lif` или `adex`. Не число, а другой солвер. */
  kind: string
  vRest: number
  vReset: number
  /** У `lif` -- порог; у `adex` -- точка, с которой начинается разгон. */
  vThreshold: number
  tauM: number
  rIn: number
  refractory: number
  adaptation: number
  tauAdaptation: number
  /** Резкость разгона у порога, мВ. Дальше -- только `adex`. */
  deltaT: number
  /** Потенциал, на котором разряд признан состоявшимся, мВ. */
  vPeak: number
  /** За сколько рассасывается ток адаптации, мс. */
  tauW: number
  /** Насколько ток адаптации следит за подпороговым потенциалом, нСм (`a`). */
  wCoupling: number
  /** Сколько тока адаптации добавляет один разряд, нА (`b`). */
  wIncrement: number
}

/**
 * Вид точечной модели из реестра сервера (`ir.POINT_MODELS`, #527).
 *
 * Как и рецепторы: своего списка в браузере нет -- какие мембраны симулятор
 * действительно считает, знает сервер, и он же отвергает вид, которого нет.
 * Имя рода -- он сам (`lif`, `adex`): ровно этим словом вид пишется в схеме.
 */
export interface PointModelKind {
  id: string
  note: string
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

/**
 * Рецептор из реестра сервера: чем он отличается от соседа по списку.
 *
 * Ни списка рецепторов, ни объяснений в браузере больше нет: и то и другое
 * приходит из `ir.RECEPTORS`, где рядом с ними лежат числа, по которым их
 * считают. Свой список здесь означал бы, что новый рецептор появляется в
 * симуляторе и не появляется в панели свойств.
 */
export interface Receptor {
  id: string
  note: string
  /** мВ, к какому потенциалу синапс тянет клетку. */
  reversal: number
  /** мс, за сколько спадает открытая проводимость. */
  tauDecay: number
  inhibitory: boolean
}

/**
 * Расшифровка подписей песочницы (#541).
 *
 * Все подписи на экране -- шифр: `ampa`, `нСм`, `τ мембраны`, `mod`. Тексты
 * живут на сервере, рядом со своим предметом, а здесь только показываются.
 * Ключи `cell` -- те же, что у `PointModel`: подсказка ложится на поле, а не
 * подбирается по порядку.
 */
export interface Glossary {
  schema: number
  receptors: Receptor[]
  cell: Record<string, string>
  /** Виды точечной модели с объяснениями -- для поля «Вид» (#527). */
  models: PointModelKind[]
  contact: Record<string, string>
  port: Record<string, string>
  recorded: RecordedKind[]
  /**
   * Что такое драйв и что такое запись -- объяснения самих вещей (#502).
   *
   * Отдельно от `drive`: там сказано, чем роды драйва отличаются друг от
   * друга, а это ответ на вопрос, который задают раньше, -- глядя на знак у
   * клетки и не зная ещё самого слова.
   */
  stimulus: string
  recording: string
  /** Что такое род драйва вообще -- объяснение самого поля (#553). */
  drive: string
  drives: DriveKindInfo[]
  /** Что такое сенсор и мотор вообще -- объяснение самих полей (#560). */
  sensor: string
  sensors: SensorKindInfo[]
  motor: string
  motors: MotorKindInfo[]
  /** Границы величины, которую принимает сенсор: ими задаются края кнопки. */
  value: { min: number; max: number }
}

/**
 * Род сенсора из того же реестра, что роды драйва (`protocols.SENSOR_KINDS`).
 *
 * `trigger` здесь не украшение: «отвечает на уровень» и «отвечает на
 * изменение» для того, кто жмёт кнопку, разные вещи -- в первом случае поток
 * идёт, пока держат, во втором приходит одно событие на нажатие.
 */
export interface SensorKindInfo {
  id: string
  name: string
  note: string
  /** level -- отвечает на удерживаемую величину, change -- на её перемену. */
  trigger: 'level' | 'change'
  /** events -- действует импульсами через синапс, current -- током. */
  emits: 'events' | 'current'
  receptor: boolean
  params: DriveParam[]
}

/** Род мотора: как считает величину и в чём она меряется. */
export interface MotorKindInfo {
  id: string
  name: string
  note: string
  unit: string
  params: DriveParam[]
}

/**
 * Род драйва из реестра сервера (`protocols.DRIVE_KINDS`).
 *
 * Своего списка родов в браузере нет по той же причине, что и списка
 * рецепторов: новый протокол появляется в симуляторе и обязан появиться в поле
 * выбора сам, а не вторым списком, который однажды забудут дописать (#553).
 * Вместе с родом едут и его поля: что у `tbs` есть «пачек» и «между пачками»,
 * а у `train` -- «тест восстановления», знает тот же реестр.
 */
export interface DriveKindInfo {
  id: string
  name: string
  note: string
  /** Нужен ли роду рецептор. У тока его нет: он входит помимо синапса. */
  receptor: boolean
  /** Шаблон ли это -- то есть считается ли список моментов из чисел. */
  template: boolean
  params: DriveParam[]
}

/** Поле рода драйва: как подписать, в чём мерить и как набирать. */
export interface DriveParam {
  /** Имя поля стимула; оно же ключ правки. Приходит с сервера как есть. */
  name: string
  label: string
  unit: string
  default: number
  step: number
  /** number -- дробное, int -- счётное, times -- список моментов. */
  form: 'number' | 'int' | 'times'
  note: string
}

/**
 * Величина записи из реестра сервера (`ir.RECORDED`): как её звать и в чём
 * мерить. Своего списка в браузере нет по той же причине, что и у рецепторов:
 * подпись `g_exc` не должна значить на карточке одно, а на оси графика другое.
 */
export interface RecordedKind {
  id: RecordedVar
  name: string
  unit: string
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
  kind: string
  receptor: string
  amplitude: number
  rate: number
  /**
   * Моменты импульсов. У шаблона протокола -- развёрнутые: считает их сервер
   * (`protocols.spike_times`), и это ровно тот список, который идёт в солвер
   * (#508). Второй арифметики протокола в браузере нет.
   */
  times: number[]
  /** Протокол словами: «поезд, 8 импульсов, 20 Гц». Тоже считает сервер. */
  protocol: string
  start: number
  stop: number
}

/**
 * Сенсор: дверь снаружи внутрь (#560).
 *
 * `story` -- род вместе с числами словами («частота, 100 Гц при 1»), и
 * собирает его реестр родов на сервере: вторая сборка той же строки в браузере
 * разошлась бы с первой молча, как это уже было со списком рецепторов.
 * Величины здесь нет: она не свойство схемы, а вход прогона, и живёт в ответе
 * сессии (`SimUpdate.sensors`).
 */
export interface Sensor {
  id: string
  kind: string
  story: string
  /** Гц при величине 1 -- у рода `rate`. */
  to: number
  targets: SensorLink[]
}

/** Подключение сенсора к точке клетки: те же поля, что у контакта. */
export interface SensorLink {
  target: Site
  receptor: string
  inhibitory: boolean
  weight: number
  delay: number
}

/**
 * Мотор: дверь изнутри наружу. Смотрит на точку клетки, как запись, но отдаёт
 * не график, а одно число -- его считает сессия (`SimUpdate.motors`).
 */
export interface Motor {
  id: string
  kind: string
  story: string
  /** Единица величины. Приходит с сервера: число без единицы -- шифр. */
  unit: string
  window: number
  source: Site
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
  sensors: Sensor[]
  motors: Motor[]
  recordings: Recording[]
}

export interface Result {
  dt: number
  samples: number
  /** Ключ вида `E.soma:v`. Времён нет: t = i * dt. */
  traces: Record<string, number[]>
  spikes: Record<string, number[]>
  /**
   * Величины моторов на конец прогона. Не трасса: мотор отдаёт число сейчас, а
   * «сейчас» у досчитанного прогона одно -- его последний момент.
   */
  motors: Record<string, number>
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
