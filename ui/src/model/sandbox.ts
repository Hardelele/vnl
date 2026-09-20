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

export interface SandboxLink {
  id: string
  source: Endpoint
  target: Endpoint
  receptor: string
  inhibitory: boolean
  weight: number
  delay: number
}

export type DriveKind = 'current' | 'poisson' | 'spikes'

export interface SandboxDrive {
  id: string
  target: Endpoint
  kind: DriveKind
  receptor: string
  rate: number
  amplitude: number
  /** Моменты спайков для `kind: 'spikes'`; у остальных родов пусто. */
  times: number[]
  start: number
  stop: number
}

export interface SandboxRecording {
  id: string
  target: Endpoint
  var: RecordedVar
}

export interface SandboxState {
  schema: number
  id: string
  name: string
  blocks: SandboxBlock[]
  neurons: SandboxNeuron[]
  links: SandboxLink[]
  stimuli: SandboxDrive[]
  recordings: SandboxRecording[]
  run: RunSpec
  /** Есть ли несохранённые изменения. Факт, а не подпись из макета. */
  dirty: boolean
  canUndo: boolean
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

export function addBlock(
  id: string,
  pattern: string,
  position: [number, number],
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/blocks`, 'POST', { pattern, position })
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

export function addStimulus(id: string, target: EndpointRef): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/stimuli`, 'POST', { target })
}

export function addRecording(id: string, target: EndpointRef): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/recordings`, 'POST', { target })
}

/**
 * Разобрать блок: вместо коробки -- его клетки, связи и типы (#532).
 *
 * Операция обратная вставке паттерна. Тела у запроса нет: разбирают блок
 * целиком, а имена клеткам подбирает сервер -- он один знает, что в проекте
 * уже занято, и столкновение всплыло бы иначе только на запуске.
 */
export function ungroupBlock(id: string, object: string): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/objects/${encodeURIComponent(object)}/ungroup`,
    'POST',
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
