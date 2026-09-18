import { describe, expect, it, vi } from 'vitest'

import { OfflineError } from '../model/catalog'
import { createSimController, type SimPorts } from './sim'
import type { SimUpdate } from '../model/sim'

function update(patch: Partial<SimUpdate> = {}): SimUpdate {
  return {
    id: 'sim1',
    source: 'паттерн «FFI»',
    state: 'paused',
    time: 0,
    duration: 400,
    dt: 0.1,
    pace: 50,
    samples: 0,
    from: 0,
    rewound: false,
    traces: {},
    spikes: {},
    cells: { E: { v: -65, spiked: false } },
    degradation: [],
    ...patch,
  }
}

/** Повторяющийся вызов под рукой: тест не должен ждать настоящие миллисекунды. */
function manualTimer() {
  let run: (() => void) | null = null
  const every: SimPorts['every'] = (callback) => {
    run = callback
    return () => {
      run = null
    }
  }
  return {
    every,
    get armed() {
      return run !== null
    },
    tick() {
      run?.()
    },
  }
}

describe('открытие симуляции', () => {
  it('приносит начальное состояние и не опрашивает стоящую сессию', async () => {
    const timer = manualTimer()
    const control = createSimController({
      open: vi.fn().mockResolvedValue(update()),
      every: timer.every,
    })

    await control.open({ pattern: 'ffi' })

    expect(control.store.getState().id).toBe('sim1')
    expect(control.store.getState().state).toBe('paused')
    expect(timer.armed).toBe(false)
  })

  it('незапущенный сервер отмечается отдельно', async () => {
    const control = createSimController({
      open: vi.fn().mockRejectedValue(new OfflineError(new TypeError('failed'))),
      every: manualTimer().every,
    })

    await control.open({ pattern: 'ffi' })

    expect(control.store.getState().offline).toBe(true)
    expect(control.store.getState().error).toContain('vnl serve')
  })
})

describe('ход времени', () => {
  it('пока время идёт, сессию опрашивают', async () => {
    const timer = manualTimer()
    const read = vi
      .fn()
      .mockResolvedValue(update({ state: 'running', samples: 300, time: 30 }))
    const control = createSimController({
      open: vi.fn().mockResolvedValue(update()),
      start: vi.fn().mockResolvedValue(update({ state: 'running' })),
      read,
      every: timer.every,
    })

    await control.open({ pattern: 'ffi' })
    await control.start()
    expect(timer.armed).toBe(true)

    timer.tick()
    await Promise.resolve()
    await Promise.resolve()

    expect(read).toHaveBeenCalledWith('sim1', 0)
    expect(control.store.getState().time).toBe(30)
  })

  it('на паузе опрос прекращается', async () => {
    const timer = manualTimer()
    const control = createSimController({
      open: vi.fn().mockResolvedValue(update()),
      start: vi.fn().mockResolvedValue(update({ state: 'running' })),
      pause: vi.fn().mockResolvedValue(update({ state: 'paused', samples: 300 })),
      every: timer.every,
    })

    await control.open({ pattern: 'ffi' })
    await control.start()
    await control.pause()

    expect(timer.armed).toBe(false)
  })

  it('конец прогона тоже останавливает опрос', async () => {
    const timer = manualTimer()
    const control = createSimController({
      open: vi.fn().mockResolvedValue(update()),
      start: vi.fn().mockResolvedValue(update({ state: 'running' })),
      read: vi.fn().mockResolvedValue(update({ state: 'finished', samples: 4000 })),
      every: timer.every,
    })

    await control.open({ pattern: 'ffi' })
    await control.start()
    timer.tick()
    await Promise.resolve()
    await Promise.resolve()

    expect(control.store.getState().state).toBe('finished')
    expect(timer.armed).toBe(false)
  })
})

describe('буфер', () => {
  it('приращение дописывается в конец', async () => {
    const control = createSimController({
      open: vi.fn().mockResolvedValue(
        update({ samples: 2, traces: { 'E.soma:v': [-65, -64] }, spikes: { E: [] } }),
      ),
      start: vi.fn().mockResolvedValue(
        update({
          state: 'paused',
          from: 2,
          samples: 4,
          traces: { 'E.soma:v': [-63, -62] },
          spikes: { E: [0.3] },
        }),
      ),
      every: manualTimer().every,
    })

    await control.open({ pattern: 'ffi' })
    await control.start()

    expect(control.store.getState().traces['E.soma:v']).toEqual([-65, -64, -63, -62])
    expect(control.store.getState().spikes.E).toEqual([0.3])
  })

  it('после отката буфер заменяется, а не дополняется', async () => {
    const control = createSimController({
      open: vi.fn().mockResolvedValue(
        update({ samples: 4, traces: { 'E.soma:v': [-65, -64, -63, -62] } }),
      ),
      seek: vi.fn().mockResolvedValue(
        update({ rewound: true, from: 0, samples: 2, traces: { 'E.soma:v': [-65, -64] } }),
      ),
      every: manualTimer().every,
    })

    await control.open({ pattern: 'ffi' })
    await control.seek(0.2)

    // Дорисовать новое будущее к старому значило бы показать график, которого
    // в этой симуляции никогда не было.
    expect(control.store.getState().traces['E.soma:v']).toEqual([-65, -64])
  })
})

describe('закрытие', () => {
  it('гасит опрос и отпускает сессию на сервере', async () => {
    const timer = manualTimer()
    const drop = vi.fn().mockResolvedValue(undefined)
    const control = createSimController({
      open: vi.fn().mockResolvedValue(update()),
      start: vi.fn().mockResolvedValue(update({ state: 'running' })),
      drop,
      every: timer.every,
    })

    await control.open({ pattern: 'ffi' })
    await control.start()
    await control.close()

    expect(timer.armed).toBe(false)
    expect(drop).toHaveBeenCalledWith('sim1')
    expect(control.store.getState().id).toBeNull()
  })
})
