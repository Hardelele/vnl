/**
 * Настройки песочницы: что уходит на сервер и что панель показывает потом.
 *
 * Порты подменены, поэтому проверяется именно договор между панелью и
 * сервером: адрес, состав тела запроса и то, что состояние заменяется ответом
 * целиком. Считать новое состояние самим интерфейсом нельзя -- тогда у проекта
 * стало бы две правды.
 */

import { describe, expect, it, vi } from 'vitest'

import type { SandboxState } from '../model/sandbox'
import { createSandboxController, type SandboxPorts } from './sandbox'
import type { PointModel } from '../model/types'

const POINT: PointModel = {
  kind: 'lif',
  vRest: -65,
  vReset: -65,
  vThreshold: -50,
  tauM: 10,
  rIn: 100,
  refractory: 2,
  adaptation: 0,
  tauAdaptation: 100,
}

function project(patch: Partial<SandboxState> = {}): SandboxState {
  return {
    schema: 1,
    id: 's1',
    name: 'Проба',
    blocks: [
      {
        id: 'ffi',
        patternId: 'ffi',
        label: 'FFI',
        position: [0, 0],
        ports: [],
        counts: { neurons: 3, contacts: 2 },
        scheme: { neurons: [], edges: [] },
        cells: [
          { type: 'pyr_l5', neurons: ['E'], inhibitory: false, pointModel: POINT },
        ],
      },
    ],
    neurons: [],
    links: [],
    stimuli: [
      {
        id: 'drive1',
        target: { instance: 'ffi', port: 'in', section: 'soma', fraction: 0.5 },
        kind: 'poisson',
        receptor: 'ampa',
        rate: 250,
        amplitude: 1.5,
        times: [],
        start: 0,
        stop: 500,
      },
    ],
    recordings: [
      {
        id: 'r1',
        target: { instance: 'ffi', port: 'out', section: 'soma', fraction: 0.5 },
        var: 'v',
      },
    ],
    run: { dt: 0.1, duration: 500, level: 'L1', seed: 1 },
    dirty: false,
    canUndo: false,
    problems: [],
    fingerprint: 'abc123',
    updatedAt: '',
    ...patch,
  }
}

/** Контроллер с открытым проектом и подменёнными портами. */
async function opened(ports: Partial<SandboxPorts> = {}) {
  const control = createSandboxController({
    open: vi.fn().mockResolvedValue(project()),
    ...ports,
  })
  await control.open('s1')
  return control
}

describe('настройки блока', () => {
  it('переименовывает экземпляр и берёт ответ сервера целиком', async () => {
    const rename = vi.fn().mockResolvedValue(project({ dirty: true }))
    const control = await opened({ rename })

    await control.rename('ffi', 'Вход')

    expect(rename).toHaveBeenCalledWith('s1', 'ffi', 'Вход')
    expect(control.store.getState().project?.dirty).toBe(true)
  })

  it('пустую подпись до сервера не доводит', async () => {
    const rename = vi.fn()
    const control = await opened({ rename })

    await control.rename('ffi', '   ')

    expect(rename).not.toHaveBeenCalled()
  })

  it('правит параметры мембраны по типу клетки, а не по нейрону', async () => {
    const cell = vi.fn().mockResolvedValue(project())
    const control = await opened({ cell })

    await control.setCell('ffi', 'pyr_l5', { vThreshold: -44 })

    expect(cell).toHaveBeenCalledWith('s1', 'ffi', 'pyr_l5', { vThreshold: -44 })
  })
})

describe('настройки стимула и записи', () => {
  it('меняет частоту и окно драйва', async () => {
    const driveParams = vi.fn().mockResolvedValue(project())
    const control = await opened({ driveParams })

    await control.setDrive('drive1', { rate: 40, start: 20, stop: 200 })

    expect(driveParams).toHaveBeenCalledWith('s1', 'drive1', {
      rate: 40,
      start: 20,
      stop: 200,
    })
  })

  it('меняет записываемую величину', async () => {
    const recordVar = vi.fn().mockResolvedValue(project())
    const control = await opened({ recordVar })

    await control.setRecord('r1', 'g_inh')

    expect(recordVar).toHaveBeenCalledWith('s1', 'r1', 'g_inh')
  })
})

describe('параметры прогона', () => {
  it('уходят на сервер и возвращаются в состояние', async () => {
    const next = project({ run: { dt: 0.25, duration: 120, level: 'L1', seed: 11 } })
    const run = vi.fn().mockResolvedValue(next)
    const control = await opened({ run })

    await control.setRun({ duration: 120, dt: 0.25, seed: 11 })

    expect(run).toHaveBeenCalledWith('s1', { duration: 120, dt: 0.25, seed: 11 })
    expect(control.store.getState().project?.run.duration).toBe(120)
  })

  it('отказ сервера показывается, а прежние числа остаются', async () => {
    const run = vi.fn().mockRejectedValue(new Error('шаг должен быть больше нуля'))
    const control = await opened({ run })

    await control.setRun({ dt: 0 })

    const state = control.store.getState()
    expect(state.error).toBe('шаг должен быть больше нуля')
    expect(state.project?.run.dt).toBe(0.1)
  })

  it('без открытого проекта ничего не посылает', async () => {
    const run = vi.fn()
    const control = createSandboxController({ run })

    await control.setRun({ duration: 10 })

    expect(run).not.toHaveBeenCalled()
  })
})
