/**
 * Состояние песочницы в интерфейсе.
 *
 * Хранится ровно то, что пришло с сервера, плюс выделение -- оно живёт только
 * на экране и серверу не нужно. Каждая операция заменяет состояние целиком:
 * дописывать изменения руками значило бы считать проект во второй раз, уже
 * по-своему.
 *
 * Соединение -- маленький автомат: щелчок по порту запоминает источник,
 * второй щелчок создаёт связь. Держать это в состоянии, а не в компоненте,
 * нужно затем, чтобы дерево объектов и холст одинаково понимали, что сейчас
 * происходит.
 */

import { useSyncExternalStore } from 'react'

import { OfflineError } from '../model/catalog'
import {
  addBlock,
  addRecording,
  addStimulus,
  connect,
  createSandbox,
  listSandboxes,
  moveBlock,
  openSandbox,
  removeObject,
  renameBlock,
  save,
  setCellParams,
  setLinkParams,
  setRecordingVar,
  setRunParams,
  setStimulusParams,
  undo,
  type DriveParams,
  type SandboxRow,
  type SandboxState,
} from '../model/sandbox'
import type { PointModel, RecordedVar, RunSpec } from '../model/types'
import { createStore } from './store'

/** Что выбрано на холсте: блок, связь, стимул или запись. */
export interface Selection {
  kind: 'block' | 'link' | 'stimulus' | 'recording'
  id: string
}

/** Начатое соединение: откуда тянем. */
export interface Pending {
  instance: string
  port: string
}

export interface SandboxView {
  list: SandboxRow[]
  project: SandboxState | null
  selected: Selection | null
  pending: Pending | null
  busy: boolean
  error: string | null
  offline: boolean
}

const EMPTY: SandboxView = {
  list: [],
  project: null,
  selected: null,
  pending: null,
  busy: false,
  error: null,
  offline: false,
}

export interface SandboxPorts {
  list: typeof listSandboxes
  create: typeof createSandbox
  open: typeof openSandbox
  addBlock: typeof addBlock
  connect: typeof connect
  params: typeof setLinkParams
  rename: typeof renameBlock
  cell: typeof setCellParams
  move: typeof moveBlock
  stimulate: typeof addStimulus
  driveParams: typeof setStimulusParams
  record: typeof addRecording
  recordVar: typeof setRecordingVar
  run: typeof setRunParams
  remove: typeof removeObject
  undo: typeof undo
  save: typeof save
}

const DEFAULT_PORTS: SandboxPorts = {
  list: listSandboxes,
  create: createSandbox,
  open: openSandbox,
  addBlock,
  connect,
  params: setLinkParams,
  rename: renameBlock,
  cell: setCellParams,
  move: moveBlock,
  stimulate: addStimulus,
  driveParams: setStimulusParams,
  record: addRecording,
  recordVar: setRecordingVar,
  run: setRunParams,
  remove: removeObject,
  undo,
  save,
}

export function createSandboxController(ports: Partial<SandboxPorts> = {}) {
  const io = { ...DEFAULT_PORTS, ...ports }
  const store = createStore<SandboxView>({ ...EMPTY })

  const fail = (reason: unknown): void => {
    store.setState({
      busy: false,
      error: reason instanceof Error ? reason.message : String(reason),
      offline: reason instanceof OfflineError,
    })
  }

  /** Операция над проектом: занятость, единый разбор отказа, новое состояние. */
  const act = async (
    run: (id: string) => Promise<SandboxState>,
    after: Partial<SandboxView> = {},
  ): Promise<void> => {
    const project = store.getState().project
    if (!project) return
    store.setState({ busy: true })
    try {
      const next = await run(project.id)
      store.setState({ project: next, busy: false, error: null, offline: false, ...after })
    } catch (reason) {
      fail(reason)
    }
  }

  const openProject = async (loader: () => Promise<SandboxState>): Promise<void> => {
    store.setState({ busy: true, selected: null, pending: null })
    try {
      const project = await loader()
      store.setState({ project, busy: false, error: null, offline: false })
    } catch (reason) {
      fail(reason)
    }
  }

  return {
    store,

    async refreshList(): Promise<void> {
      try {
        store.setState({ list: await io.list(), error: null, offline: false })
      } catch (reason) {
        fail(reason)
      }
    },

    open: (id: string) => openProject(() => io.open(id)),

    /** Новый проект сразу открывается, а список пополняется -- он в панели. */
    async create(name: string): Promise<void> {
      await openProject(() => io.create(name))
      try {
        store.setState({ list: await io.list() })
      } catch {
        // Список не обновился -- это неудобство, а не потеря: проект открыт.
      }
    },

    /** Выйти из проекта к списку. Сам проект остаётся на диске. */
    close(): void {
      store.setState({ project: null, selected: null, pending: null, error: null })
    },

    /** Вставить паттерн. Место выбирается так, чтобы блоки не ложились друг на друга. */
    insert(pattern: string): Promise<void> {
      const project = store.getState().project
      const index = project?.blocks.length ?? 0
      const position: [number, number] = [60 + (index % 3) * 220, 60 + Math.floor(index / 3) * 140]
      return act((id) => io.addBlock(id, pattern, position))
    },

    /** Щелчок по порту: первый запоминает источник, второй создаёт связь. */
    async touchPort(instance: string, port: string): Promise<void> {
      const { pending } = store.getState()
      if (!pending) {
        store.setState({ pending: { instance, port } })
        return
      }
      if (pending.instance === instance && pending.port === port) {
        store.setState({ pending: null })
        return
      }
      const source = pending
      store.setState({ pending: null })
      await act((id) => io.connect(id, source, { instance, port }))
    },

    cancelPending(): void {
      store.setState({ pending: null })
    },

    select(selection: Selection | null): void {
      store.setState({ selected: selection })
    },

    move: (block: string, position: [number, number]) =>
      act((id) => io.move(id, block, position)),

    setParams: (link: string, params: { weight?: number; delay?: number; receptor?: string }) =>
      act((id) => io.params(id, link, params)),

    /** Подпись блока. Пустую не отправляем: сервер её всё равно не примет. */
    rename(block: string, label: string): Promise<void> {
      if (!label.trim()) return Promise.resolve()
      return act((id) => io.rename(id, block, label))
    },

    setCell: (block: string, type: string, params: Partial<PointModel>) =>
      act((id) => io.cell(id, block, type, params)),

    stimulate: (instance: string, port: string) =>
      act((id) => io.stimulate(id, { instance, port })),

    setDrive: (stimulus: string, params: DriveParams) =>
      act((id) => io.driveParams(id, stimulus, params)),

    record: (instance: string, port: string) =>
      act((id) => io.record(id, { instance, port })),

    setRecord: (recording: string, variable: RecordedVar) =>
      act((id) => io.recordVar(id, recording, variable)),

    setRun: (params: Partial<RunSpec>) => act((id) => io.run(id, params)),

    remove: (object: string) => act((id) => io.remove(id, object), { selected: null }),

    undo: () => act((id) => io.undo(id), { selected: null }),
    save: () => act((id) => io.save(id)),
  }
}

export type SandboxController = ReturnType<typeof createSandboxController>

export const sandboxController = createSandboxController()

/** Селектор обязан отдавать величину, а не собранный объект: см. `useCatalog`. */
export function useSandbox<S>(select: (state: SandboxView) => S): S {
  const { store } = sandboxController
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  )
}
