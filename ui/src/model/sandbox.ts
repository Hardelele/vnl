/**
 * Песочница: состояние проекта и операции над ним.
 *
 * Каждая операция возвращает всё состояние целиком, а не то, что изменилось.
 * Проект маленький, а три представления макета -- холст, дерево объектов и
 * свойства -- обязаны показывать одно и то же: собирать их из разных ответов
 * значило бы заводить три правды о проекте.
 */

import { request } from './catalog'
import type {
  CatalogLevel,
  PatternDetail,
  PatternPort,
  PointModel,
  RecordedVar,
  RunSpec,
  Scheme,
  Site,
} from './types'

/** Конец связи: порт блока или точка отдельного нейрона. */
export interface Endpoint {
  instance: string
  port: string | null
  section: string
  fraction: number
}

/**
 * Куда щёлкнули, чтобы начать или закончить связь.
 *
 * Порт может отсутствовать, и это не пропуск: у клетки портов нет вовсе --
 * она соединяется точкой на себе (по умолчанию сомой), и сервер разбирает
 * такой конец связи через `resolve_endpoint`. Заводить ради клетки
 * фиктивный порт «сома» значило бы врать на обеих сторонах.
 */
/**
 * Адрес конца связи одной строкой.
 *
 * У блока это `ffi.out` -- порт; у клетки порта нет, и печатать `E.null`
 * нельзя: такого адреса не существует. Пишется само имя клетки -- ровно то,
 * чем она зовётся и в собранной сети.
 *
 * Здесь, рядом с самим концом связи, а не в панели свойств, где она выросла:
 * тот же адрес печатают дерево объектов, подсказка знака на холсте и линия
 * мотора (#571). Держать её в панели значило бы, что холст, которому она
 * понадобилась, тянет к себе панель свойств целиком, -- а панель уже тянет с
 * холста разбор приставки.
 */
export function where(endpoint: Pick<Endpoint, 'instance' | 'port'>): string {
  return endpoint.port ? `${endpoint.instance}.${endpoint.port}` : endpoint.instance
}

export interface EndpointRef {
  instance: string
  port: string | null
}

/**
 * Клетки блока, сгруппированные по типу.
 *
 * Параметры мембраны в IR висят на типе клетки, а не на нейроне, поэтому
 * правится тип -- и `neurons` говорит, кого правка задевает. Снимок у каждого
 * блока свой, так что два экземпляра одного паттерна расходятся свободно.
 */
export interface SandboxCell {
  type: string
  neurons: string[]
  inhibitory: boolean
  pointModel: PointModel
}

/**
 * Контакт внутри снимка блока.
 *
 * Поля те же, что у `SandboxLink`, потому что вещь одна: связь холста и
 * контакт блока различаются только адресом -- у связи это объекты холста
 * (`ffi.out`), здесь точки снимка (`IN.soma`). Приставки экземпляра в адресе
 * нет: правится снимок, а не собранная сеть, -- и снимок у каждого блока свой,
 * поэтому правка не задевает ни соседний блок, ни библиотеку.
 */
export interface SandboxContact {
  id: string
  pre: Site
  post: Site
  receptor: string
  inhibitory: boolean
  weight: number
  delay: number
}

export interface SandboxBlock {
  id: string
  patternId: string
  label: string
  position: [number, number]
  ports: PatternPort[]
  counts: { neurons: number; contacts: number }
  scheme: Scheme
  cells: SandboxCell[]
  contacts: SandboxContact[]
}

/**
 * Отдельная клетка на холсте.
 *
 * Не маленький блок: портов нет, внутренностей нет, карточки нет -- а есть
 * параметры мембраны, которых у блока не бывает. `pointModel` пуст, если тип
 * клетки в песочнице потерян: такое чинят, а не скрывают, и из дерева объектов
 * клетка при этом не исчезает.
 */
export interface SandboxNeuron {
  id: string
  cellType: string
  position: [number, number]
  /** Считает сервер: от этого зависит фигура на холсте. */
  inhibitory: boolean
  pointModel: PointModel | null
}

/**
 * Тип клетки самого проекта (#564).
 *
 * Не строка каталога: у каталожной клетки есть человеческое имя и объяснение
 * (`CellKind`), а у типа, попавшего в проект из разобранного паттерна, только
 * идентификатор -- `target`, `pyr_l5`. Поэтому в палитре они и стоят разными
 * списками: свести их в один значило бы либо выдумать `target` имя, либо
 * выбросить имена у половины строк.
 *
 * Поля те же, что у `SandboxCell` (клетки блока), потому что вещь та же:
 * `neurons` говорит, кого задевает правка порога, -- параметры мембраны в IR
 * висят на типе, а не на нейроне.
 */
export interface SandboxCellType {
  type: string
  neurons: string[]
  inhibitory: boolean
  transmitter: string | null
  pointModel: PointModel
}

export interface SandboxLink {
  id: string
  source: Endpoint
  target: Endpoint
  receptor: string
  inhibitory: boolean
  weight: number
  delay: number
}

/**
 * Род драйва -- строка, а не перечисление из трёх слов.
 *
 * Перечисление здесь означало бы, что браузер знает список родов; он его не
 * знает и знать не должен -- список приходит с сервера вместе с объяснениями
 * и полями (`Glossary.drives`, #553). Новый протокол (#508) иначе появлялся бы
 * в симуляторе и не появлялся в поле выбора.
 */
export type DriveKind = string

export interface SandboxDrive {
  id: string
  target: Endpoint
  kind: DriveKind
  receptor: string
  rate: number
  amplitude: number
  /**
   * Моменты импульсов. У списка спайков -- набранные руками, у шаблона
   * протокола -- развёрнутые сервером: шаблон обязан уметь напечатать себя
   * списком времён, и печатает его сервер (#508).
   */
  times: number[]
  /** Протокол словами: «поезд, 8 импульсов, 20 Гц». Считает сервер. */
  protocol: string
  start: number
  stop: number
  // Числа шаблонов протоколов. Имена -- ровно те, что у полей стимула на
  // сервере, и с подчёркиванием: они приходят в реестре родов и уходят
  // обратно правкой как есть. Таблица перевода имён была бы третьим местом,
  // где протокол описан, и разошлась бы молча.
  n: number
  freq: number
  isi: number
  duration: number
  bursts: number
  burst_period: number
  repeats: number
  period: number
  recovery: number
}

export interface SandboxRecording {
  id: string
  target: Endpoint
  var: RecordedVar
}

/**
 * Сенсор проекта: дверь снаружи внутрь (#560).
 *
 * Подключений здесь нет: сенсор соединяется с клеткой обычной связью
 * (`SandboxLink`), у которой источник -- он сам. Второй список тех же стрелок
 * означал бы, что связь от сенсора -- не связь.
 *
 * Величины тоже нет: она не часть проекта, а вход прогона, и приходит в ответе
 * сессии. Поэтому нажатие кнопки не делает проект несохранённым и не старит
 * прогон -- отпечаток сети от него не меняется.
 */
export interface SandboxSensor {
  id: string
  kind: string
  /** Род словами вместе с числами. Считает сервер. */
  story: string
  /** Гц при величине 1 -- у рода `rate`. */
  to: number
  position: [number, number]
}

/** Мотор проекта: смотрит на точку клетки и отдаёт наружу число. */
export interface SandboxMotor {
  id: string
  kind: string
  story: string
  /** Единица величины: её называет сервер, а не подпись в браузере. */
  unit: string
  window: number
  source: Endpoint
  position: [number, number]
}

/** Слой клеток: заведён одной строкой, живёт как обычные клетки. */
export interface SandboxPopulation {
  id: string
  /** Строк и столбцов. */
  grid: [number, number]
  cellType: string
  /** Имена клеток по порядку: строками сверху вниз. */
  members: string[]
}

/** Слой клеток за полем: по нему рисуется отклик. */
export interface FieldLayer {
  id: string
  /** Строк и столбцов -- та же сетка, что у поля. */
  grid: [number, number]
  /**
   * Имена клеток по порядку: строками сверху вниз.
   *
   * Списком, а не правилом «`R` плюс индекс»: разбор имени на две стороны
   * разошёлся бы на первом же слое, названном иначе, -- а имена внутри блока
   * ещё и с приставкой (`retina24/R[3,7]`).
   */
  members: string[]
}

/** Поле сенсоров собранной сети. */
export interface SandboxField {
  id: string
  /** Род и сетка словами -- собирает сервер, как и для двери. */
  story: string
  grid: [number, number]
  /** Каналы на пиксель: пусто -- одна яркость. */
  channels: string[]
  /** Сколько величин входит разом: строк x столбцов x каналов. */
  size: number
  /** Слой за полем; `null` -- поле льёт не в слой, и отклик рисовать нечем. */
  layer: FieldLayer | null
}

export interface SandboxState {
  schema: number
  id: string
  name: string
  blocks: SandboxBlock[]
  neurons: SandboxNeuron[]
  /**
   * Типы клеток, которые уже есть в этом проекте (#564).
   *
   * Часть состояния проекта, а не отдельный запрос: разбор блока пополняет
   * их, и отдельный маршрут пришлось бы перечитывать после каждого разбора --
   * палитра то знала бы про `target`, то нет.
   */
  cellTypes: SandboxCellType[]
  links: SandboxLink[]
  stimuli: SandboxDrive[]
  /**
   * Граница с миром: список дверей собранной схемы (#560). Приходит вместе с
   * остальным состоянием, а не отдельным запросом -- панель кнопок это ещё
   * одно представление того же проекта, и выдумывать список в браузере нельзя.
   */
  sensors: SandboxSensor[]
  /**
   * Поля собранной сети (#581): то, чему можно показать картинку.
   *
   * Отдельно от `sensors`, и не по прихоти: своих дверей у проекта может не
   * быть вовсе -- поле приезжает внутри блока («Сетчатка 24x24»), и в список
   * заведённых на холсте оно не попадает по определению. Собирает его сервер
   * из той же сети, которую считает сессия.
   *
   * Необязательное -- по той же причине, что подписи шагов истории: сервер
   * бывает старее страницы, и схема без полей обязана открываться, а не
   * падать на пустом списке.
   */
  fields?: SandboxField[]
  /**
   * Слои собранной сети (#583): сетка и клетки по порядку.
   *
   * Нужны там, где поля может и не быть: таймлайн сворачивает 576 дорожек в
   * одну по этому списку, свойства рассказывают про слой целиком. Считает их
   * сервер -- «какие клетки стоят в этом слое» не должно иметь двух ответов.
   */
  populations?: SandboxPopulation[]
  motors: SandboxMotor[]
  recordings: SandboxRecording[]
  run: RunSpec
  /** Есть ли несохранённые изменения. Факт, а не подпись из макета. */
  dirty: boolean
  canUndo: boolean
  /**
   * Есть ли что вернуть после отмены (#570).
   *
   * Факт проекта, а не догадка браузера: стопка возврата живёт в `Project` на
   * сервере, и считать её здесь значило бы завести вторую историю, которая
   * разойдётся с первой на первом же обращении Claude через MCP.
   */
  canRedo: boolean
  /**
   * Что отменится и что вернётся -- человеческими словами: «вставлен паттерн
   * «Растормаживание»», «разобран ffi». Отсюда их берёт подсказка кнопки.
   *
   * Необязательны: сервер бывает старее страницы, а кнопка обязана работать и
   * без подписи -- она объясняет, а не управляет.
   */
  undoLabel?: string | null
  redoLabel?: string | null
  /** Что мешает запуску. Пусто -- можно считать. */
  problems: string[]
  /**
   * Что запуску не мешает, но сделает прогон пустым (#506).
   *
   * Второе поле, а не продолжение `problems`: по `problems` сервер отказывает
   * считать, а схему без драйва он считает законно -- она просто промолчит.
   * Считает предупреждения Python (`compose`), интерфейс их только показывает:
   * то же самое спрашивают CLI и Claude через MCP, и вторая реализация слова
   * «нечем спайкать» разошлась бы с первой незаметно.
   */
  warnings: string[]
  /**
   * Что предложить в форме «Сохранить как паттерн»: клетка без входящих связей
   * похожа на вход, без исходящих -- на выход.
   *
   * Догадку считает сервер (`patterns.suggest_ports`), а не интерфейс: тот же
   * вопрос задаёт Claude через MCP, и вторая реализация слова «похоже на вход»
   * разошлась бы с первой незаметно. Решает всё равно человек -- имя порта
   * увидит каждый, кто вставит блок.
   */
  portHints: PatternPort[]
  /**
   * Отпечаток собираемой сети. Открытая сессия считает модель на момент своего
   * запуска, поэтому по расхождению отпечатков видно, что её результат -- про
   * другую схему. Расстановка блоков по холсту отпечаток не меняет.
   */
  fingerprint: string
  updatedAt: string
}

export interface SandboxRow {
  id: string
  name: string
  blocks: number
  links: number
  updatedAt: string
}

/** Разбор ответа общий с библиотекой: 401 здесь значит то же -- нужен вход. */
function ask<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>('/api' + path, init)
}

function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  return ask<T>(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

const at = (id: string) => `/sandboxes/${encodeURIComponent(id)}`

export async function listSandboxes(): Promise<SandboxRow[]> {
  const payload = await ask<{ sandboxes: SandboxRow[] }>('/sandboxes')
  return payload.sandboxes
}

export function createSandbox(name: string): Promise<SandboxState> {
  return send<SandboxState>('/sandboxes', 'POST', { name })
}

export function openSandbox(id: string): Promise<SandboxState> {
  return ask<SandboxState>(at(id))
}

/**
 * Вставить паттерн блоком.
 *
 * `demo` -- переход с карточки паттерна (#526): вместе с блоком в проект
 * ложатся стимулы и записи витрины и параметры её прогона. Умолчание -- «нет»,
 * и это не осторожность, а правило: кнопка «+» в панели «Библиотека» кладёт
 * молчащий блок, потому что чужой драйв в собираемой сети спорил бы с тем
 * входом, ради которого блок и ставят. Разбор -- на сервере, в
 * `patterns.adopt_demo`: там же, где эти объекты и заводятся.
 */
export function addBlock(
  id: string,
  pattern: string,
  position: [number, number],
  demo = false,
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/blocks`, 'POST', { pattern, position, demo })
}

/**
 * Положить на холст отдельную клетку из каталога типов.
 *
 * Параметры мембраны сюда не передаются: тип берётся из каталога целиком, а
 * правят его потом в панели свойств -- уже в этой песочнице и только в ней.
 */
export function addNeuron(
  id: string,
  cell: string,
  position: [number, number],
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/neurons`, 'POST', { cell, position })
}

/**
 * Положить клетку типа, который уже есть в этом проекте (#564).
 *
 * Тот же маршрут, другое поле: `cell` -- каталог, `type` -- типы проекта. Два
 * поля, а не одно с поиском «сперва там, потом тут», потому что это два
 * разных источника, и одноимённый тип в них бывает разным -- разбор блока
 * кладёт в проект `relay_2`, когда его `relay` не совпал с проектным.
 *
 * Тип берётся существующий, а не его копия: параметры мембраны висят на типе,
 * и копия означала бы, что правка порога задевает не всех клеток `target`.
 */
export function addNeuronOfType(
  id: string,
  type: string,
  position: [number, number],
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/neurons`, 'POST', { type, position })
}

export function connect(
  id: string,
  source: EndpointRef,
  target: EndpointRef,
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/links`, 'POST', { source, target })
}

/**
 * Что правится у связи -- и у контакта внутри блока.
 *
 * Один тип на оба случая нарочно: связь и контакт -- одна вещь с разными
 * адресами, и два набора полей означали бы, что «вес» внутри блока значит не
 * то же самое, что снаружи.
 */
export type ContactParams = { weight?: number; delay?: number; receptor?: string }

export function setLinkParams(
  id: string,
  link: string,
  params: ContactParams,
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/links/${encodeURIComponent(link)}`,
    'PATCH',
    params,
  )
}

/**
 * Параметры контакта внутри блока (#531).
 *
 * Адрес объекта такой же, как у мембраны (`objects/<блок>/...`): панель
 * свойств одного блока не должна ходить по двум разным семействам путей.
 * Правится снимок экземпляра -- ни соседний блок того же паттерна, ни
 * библиотека не меняются.
 */
export function setContactParams(
  id: string,
  object: string,
  contact: string,
  params: ContactParams,
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/objects/${encodeURIComponent(object)}/contacts/${encodeURIComponent(contact)}`,
    'PATCH',
    params,
  )
}

/**
 * Имя отдельной клетки -- её же адрес (#563).
 *
 * Не `renameBlock` с другим путём: у блока правится подпись, которой в
 * собранной сети нет вовсе, а здесь -- имя нейрона, за которое держатся связи,
 * стимулы и записи и которым подписан столбец растра. Поэтому и поле зовётся
 * `id`, а не `label`: по телу запроса видно, что это другая операция.
 *
 * Перепись ссылок целиком на сервере (`patterns.rename_neuron`): считать
 * здесь, какие связи задеты, значило бы завести в браузере вторую копию
 * правила «что на эту клетку смотрит», а забытое место всплыло бы потерянным
 * стимулом.
 */
export function renameNeuron(
  id: string,
  neuron: string,
  name: string,
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/neurons/${encodeURIComponent(neuron)}`,
    'PATCH',
    { id: name },
  )
}

/**
 * Имя проекта. Идентификатор при этом прежний -- за него держатся файл в
 * хранилище и открытая сессия симуляции.
 *
 * Тем же путём, что и чтение проекта: имя -- свойство песочницы, а не действие
 * над ней.
 */
export function renameProject(id: string, name: string): Promise<SandboxState> {
  return send<SandboxState>(at(id), 'PATCH', { name })
}

/**
 * Ещё один такой же объект холста: клетка или блок (#563).
 *
 * Один вызов на оба рода -- человек просит «дублировать выбранное», а что
 * именно выбрано, в этот момент не формулирует. Копия ложится рядом, без
 * связей и без драйва: связь без второго конца бессмысленна, а копия драйва
 * означала бы удвоенный вход в схему, которую ещё собирают.
 */
export function duplicateObject(
  id: string,
  object: string,
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/objects/${encodeURIComponent(object)}/duplicate`,
    'POST',
  )
}

/** Подпись блока на холсте: это `label` экземпляра, а не имя паттерна. */
export function renameBlock(
  id: string,
  block: string,
  label: string,
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/blocks/${encodeURIComponent(block)}`,
    'PATCH',
    { label },
  )
}

/**
 * Параметры мембраны. Правится тип клетки, а не нейрон -- см. `SandboxCell`.
 *
 * Объект -- любой на холсте: у блока типы свои, из его снимка, у отдельной
 * клетки общие для песочницы. Поэтому и путь говорит «объект»: маршрут,
 * врущий о том, что принимает, однажды заставит завести второй такой же.
 */
export function setCellParams(
  id: string,
  object: string,
  type: string,
  params: Partial<PointModel>,
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/objects/${encodeURIComponent(object)}/cells/${encodeURIComponent(type)}`,
    'PATCH',
    params,
  )
}

/** Что у стимула правится: цель менять нельзя -- это уже другой стимул. */
export type DriveParams = Partial<Omit<SandboxDrive, 'id' | 'target'>>

export function setStimulusParams(
  id: string,
  stimulus: string,
  params: DriveParams,
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/stimuli/${encodeURIComponent(stimulus)}`,
    'PATCH',
    params,
  )
}

export function setRecordingVar(
  id: string,
  recording: string,
  variable: RecordedVar,
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/recordings/${encodeURIComponent(recording)}`,
    'PATCH',
    { var: variable },
  )
}

/** Длительность, шаг, зерно и уровень -- то, что в песочнице меняют первым. */
export function setRunParams(
  id: string,
  params: Partial<RunSpec>,
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/run`, 'PATCH', params)
}

/** Сдвиг по холсту -- для любого объекта: и блока, и отдельной клетки. */
export function moveObject(
  id: string,
  object: string,
  position: [number, number],
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/move`, 'POST', { id: object, position })
}

/** Куда встают объекты после раскладки: имя объекта -> его место на холсте. */
export type Places = Record<string, [number, number]>

/**
 * Разложить схему: места всем объектам сразу (#543).
 *
 * Отдельная операция, а не `moveObject` в цикле: раскладка -- одно действие
 * человека, и «Отменить» обязано возвращать прежние места целиком. Считает
 * места интерфейс (ELK знает размеры фигур только здесь), применяет их проект
 * -- одним шагом истории.
 */
export function arrangeObjects(id: string, places: Places): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/arrange`, 'POST', { places })
}

export function addStimulus(id: string, target: EndpointRef): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/stimuli`, 'POST', { target })
}

export function addRecording(id: string, target: EndpointRef): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/recordings`, 'POST', { target })
}

/**
 * Завести сенсор. Подключают его потом обычной связью -- `connect` от него к
 * клетке: для человека это та же стрелка, и второго способа её провести нет.
 */
export function addSensor(
  id: string,
  params: { id?: string; kind?: string; to?: number; position?: [number, number] } = {},
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/sensors`, 'POST', params)
}

/** Завести мотор: он смотрит на точку клетки, как запись. */
export function addMotor(
  id: string,
  source: EndpointRef,
  params: { id?: string; kind?: string; window?: number; position?: [number, number] } = {},
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/motors`, 'POST', { source, ...params })
}

export function setSensorParams(
  id: string,
  sensor: string,
  params: { kind?: string; to?: number },
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/sensors/${encodeURIComponent(sensor)}`,
    'PATCH',
    params,
  )
}

export function setMotorParams(
  id: string,
  motor: string,
  params: { kind?: string; window?: number; source?: EndpointRef },
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/motors/${encodeURIComponent(motor)}`,
    'PATCH',
    params,
  )
}

/**
 * Разобрать блок: вместо коробки -- его клетки, связи и типы (#532).
 *
 * Операция обратная вставке паттерна. Имена клеткам подбирает сервер -- он
 * один знает, что в проекте уже занято, и столкновение всплыло бы иначе
 * только на запуске.
 *
 * А вот места приходят отсюда, как и у «Разложить»: клетки обязаны встать
 * так же, как стояли внутри коробки, а как они там стояли, знает только
 * интерфейс -- он их и нарисовал (#554). Ключи -- имена клеток внутри
 * паттерна (`E1`, `GI`); сервер переложит их на те имена, которые раздаст.
 * Места необязательны: без них сервер расставит клетки сам, и старый клиент
 * продолжает работать.
 */
export function ungroupBlock(
  id: string,
  object: string,
  places?: Places,
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/objects/${encodeURIComponent(object)}/ungroup`,
    'POST',
    places ? { places } : undefined,
  )
}

export function removeObject(id: string, object: string): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/objects/${encodeURIComponent(object)}`,
    'DELETE',
  )
}

export function undo(id: string): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/undo`, 'POST')
}

/**
 * Вернуть отменённое (#570). Свой маршрут, а не `undo` со знаком: это другое
 * действие человека, и отличать их телом запроса значило бы прятать половину
 * возможностей сервера внутрь одного адреса.
 */
export function redo(id: string): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/redo`, 'POST')
}

export function save(id: string): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/save`, 'POST')
}

/** Что человек вводит в форме сохранения: имя, ступень каталога и порты. */
export interface PatternDraft {
  name: string
  level: CatalogLevel
  ports: PatternPort[]
}

/**
 * «Сохранить как паттерн»: проект уезжает в библиотеку.
 *
 * Отвечает не состоянием песочницы, а паттерном: сама песочница не меняется --
 * сохранение не подменяет проект блоком и ничего в нём не двигает. Порты
 * уходят тем же видом, каким пришли в `portHints`: сервер их так и читает, и
 * второй формат одного порта завёлся бы ровно здесь.
 */
export function saveAsPattern(id: string, draft: PatternDraft): Promise<PatternDetail> {
  return send<PatternDetail>('/patterns', 'POST', {
    sandbox: id,
    name: draft.name,
    level: draft.level,
    ports: draft.ports,
  })
}
