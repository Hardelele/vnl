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

export interface Run {
  schema: number
  model: Model
  result: Result
  diagnostics: Diagnostic[]
}
