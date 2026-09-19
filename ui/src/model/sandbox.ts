/**
 * Песочница: состояние проекта и операции над ним.
 *
 * Каждая операция возвращает всё состояние целиком, а не то, что изменилось.
 * Проект маленький, а три представления макета -- холст, дерево объектов и
 * свойства -- обязаны показывать одно и то же: собирать их из разных ответов
 * значило бы заводить три правды о проекте.
 */

import { ApiError, OfflineError } from './catalog'
import type { PatternPort, PointModel, RecordedVar, RunSpec, Scheme } from './types'

/** Конец связи: порт блока или точка отдельного нейрона. */
export interface Endpoint {
  instance: string
  port: string | null
  section: string
  fraction: number
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

export interface SandboxBlock {
  id: string
  patternId: string
  label: string
  position: [number, number]
  ports: PatternPort[]
  counts: { neurons: number; contacts: number }
  scheme: Scheme
  cells: SandboxCell[]
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
  /** Отдельный нейрон; `pointModel` пуст, если его тип неизвестен. */
  neurons: Array<{ id: string; cellType: string; pointModel: PointModel | null }>
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

async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch('/api' + path, init)
  } catch (reason) {
    throw new OfflineError(reason)
  }
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : {}
  if (!response.ok) {
    const message =
      (payload as { error?: string }).error ??
      `${response.status} ${response.statusText}`
    throw new ApiError(message, response.status)
  }
  return payload as T
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

export function connect(
  id: string,
  source: { instance: string; port: string },
  target: { instance: string; port: string },
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/links`, 'POST', { source, target })
}

export function setLinkParams(
  id: string,
  link: string,
  params: { weight?: number; delay?: number; receptor?: string },
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/links/${encodeURIComponent(link)}`,
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

/** Параметры мембраны. Правится тип клетки внутри блока -- см. `SandboxCell`. */
export function setCellParams(
  id: string,
  block: string,
  type: string,
  params: Partial<PointModel>,
): Promise<SandboxState> {
  return send<SandboxState>(
    `${at(id)}/blocks/${encodeURIComponent(block)}/cells/${encodeURIComponent(type)}`,
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

export function moveBlock(
  id: string,
  block: string,
  position: [number, number],
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/move`, 'POST', { id: block, position })
}

export function addStimulus(
  id: string,
  target: { instance: string; port: string },
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/stimuli`, 'POST', { target })
}

export function addRecording(
  id: string,
  target: { instance: string; port: string },
): Promise<SandboxState> {
  return send<SandboxState>(`${at(id)}/recordings`, 'POST', { target })
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
