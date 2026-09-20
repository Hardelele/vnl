import { describe, expect, it } from 'vitest'

import { RunView, SchemaError, parseRun } from './run'
import type { Run } from './types'

function minimalRun(): Run {
  return {
    schema: 1,
    model: {
      name: 'tiny',
      source: null,
      run: { dt: 0.1, duration: 10, level: 'L1', seed: 1 },
      cellTypes: {
        exc: {
          id: 'exc',
          tags: ['excitatory'],
          transmitter: 'glutamate',
          inhibitory: false,
          pointModel: {
            kind: 'lif',
            vRest: -65,
            vReset: -65,
            vThreshold: -50,
            tauM: 10,
            rIn: 100,
            refractory: 2,
            adaptation: 0,
            tauAdaptation: 100,
          },
          morphology: { name: 'point', isPoint: true, sections: [] },
        },
      },
      neurons: [
        { id: 'A', cellType: 'exc', tags: [], inhibitory: false },
        { id: 'B', cellType: 'exc', tags: [], inhibitory: false },
      ],
      contacts: [
        {
          id: 'c1',
          pre: { instance: 'A', section: 'soma', fraction: 0.5 },
          post: { instance: 'B', section: 'soma', fraction: 0.5 },
          receptor: 'ampa',
          inhibitory: false,
          reversal: 0,
          tauDecay: 2,
          weight: 1,
          delay: 1,
          dynamics: { enabled: false, u: 0.5, tauRec: 0, tauFacil: 0 },
          plasticity: {
            enabled: false,
            rule: 'none',
            aPlus: 0,
            aMinus: 0,
            tauPlus: 20,
            tauMinus: 20,
            wMax: 5,
            wMin: 0,
            tauEligibility: 500,
            modulator: null,
          },
        },
      ],
      modulators: [],
      stimuli: [],
      sensors: [],
      motors: [],
      recordings: [],
    },
    result: {
      dt: 0.1,
      samples: 3,
      traces: { 'B.soma:v': [-65, -60, -55] },
      spikes: { A: [1, 2], B: [] },
      motors: {},
      degradation: [],
    },
    diagnostics: [],
  }
}

describe('чтение выгрузки', () => {
  it('отказывается от чужого формата', () => {
    expect(() => parseRun({ hello: 'world' })).toThrow(SchemaError)
  })

  it('отказывается от другой версии схемы и называет команду', () => {
    const run = { ...minimalRun(), schema: 99 }
    expect(() => parseRun(run)).toThrow(/vnl data/)
  })
})

describe('индексы прогона', () => {
  const view = new RunView(minimalRun())

  it('знает входы и выходы каждой клетки', () => {
    expect(view.inputsOf('B').map((c) => c.id)).toEqual(['c1'])
    expect(view.outputsOf('A').map((c) => c.id)).toEqual(['c1'])
    expect(view.inputsOf('A')).toEqual([])
  })

  it('находит трассу по клетке и величине', () => {
    expect(view.trace('B', 'v')).toEqual([-65, -60, -55])
    expect(view.trace('A', 'v')).toBeUndefined()
  })

  it('переводит время в отсчёт и не выходит за трассу', () => {
    expect(view.sampleAt(0.2)).toBe(2)
    expect(view.sampleAt(1000)).toBe(2)
    expect(view.sampleAt(-5)).toBe(0)
  })

  it('отдаёт порог клетки: без него трасса ни о чём не говорит', () => {
    expect(view.thresholdOf('B')).toBe(-50)
  })
})
