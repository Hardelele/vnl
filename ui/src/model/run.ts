/**
 * Производные величины одного прогона.
 *
 * Считаются один раз при загрузке и раздаются как готовые индексы: компоненты
 * не должны каждый раз перебирать контакты, чтобы узнать, кто входит в клетку.
 */

import type { Contact, Neuron, Run, Stimulus } from './types'

export class RunView {
  readonly run: Run

  private readonly byId = new Map<string, Neuron>()
  private readonly incoming = new Map<string, Contact[]>()
  private readonly outgoing = new Map<string, Contact[]>()
  private readonly stimuliByTarget = new Map<string, Stimulus[]>()

  constructor(run: Run) {
    this.run = run
    for (const neuron of run.model.neurons) {
      this.byId.set(neuron.id, neuron)
      this.incoming.set(neuron.id, [])
      this.outgoing.set(neuron.id, [])
      this.stimuliByTarget.set(neuron.id, [])
    }
    for (const contact of run.model.contacts) {
      this.incoming.get(contact.post.instance)?.push(contact)
      this.outgoing.get(contact.pre.instance)?.push(contact)
    }
    for (const stimulus of run.model.stimuli) {
      this.stimuliByTarget.get(stimulus.target.instance)?.push(stimulus)
    }
  }

  get model() {
    return this.run.model
  }

  get result() {
    return this.run.result
  }

  get duration() {
    return this.run.model.run.duration
  }

  get dt() {
    return this.run.result.dt
  }

  neuron(id: string): Neuron | undefined {
    return this.byId.get(id)
  }

  neuronIds(): string[] {
    return this.run.model.neurons.map((neuron) => neuron.id)
  }

  inputsOf(id: string): Contact[] {
    return this.incoming.get(id) ?? []
  }

  outputsOf(id: string): Contact[] {
    return this.outgoing.get(id) ?? []
  }

  stimuliOf(id: string): Stimulus[] {
    return this.stimuliByTarget.get(id) ?? []
  }

  spikesOf(id: string): number[] {
    return this.run.result.spikes[id] ?? []
  }

  /** Трасса величины на клетке; секция не важна, берётся первая подходящая. */
  trace(instance: string, variable: string): number[] | undefined {
    const exact = this.run.result.traces[`${instance}.soma:${variable}`]
    if (exact) return exact
    const suffix = `:${variable}`
    for (const [key, values] of Object.entries(this.run.result.traces)) {
      if (key.startsWith(`${instance}.`) && key.endsWith(suffix)) return values
    }
    return undefined
  }

  /** Индекс отсчёта по времени в мс, обрезанный по длине прогона. */
  sampleAt(time: number): number {
    const index = Math.round(time / this.dt)
    return Math.min(Math.max(index, 0), this.run.result.samples - 1)
  }

  timeAt(index: number): number {
    return index * this.dt
  }

  get sweep() {
    return this.run.sweep
  }

  /** Трасса величины в конкретном варианте развёртки. */
  variantTrace(
    variantIndex: number,
    instance: string,
    variable: string,
  ): number[] | undefined {
    const variant = this.run.sweep?.variants[variantIndex]
    if (!variant) return undefined
    const exact = variant.result.traces[`${instance}.soma:${variable}`]
    if (exact) return exact
    const suffix = `:${variable}`
    for (const [key, values] of Object.entries(variant.result.traces)) {
      if (key.startsWith(`${instance}.`) && key.endsWith(suffix)) return values
    }
    return undefined
  }

  cellType(id: string) {
    const neuron = this.byId.get(id)
    return neuron ? this.run.model.cellTypes[neuron.cellType] : undefined
  }

  /** Порог клетки в мВ -- без него трасса потенциала ни о чём не говорит. */
  thresholdOf(id: string): number | undefined {
    return this.cellType(id)?.pointModel.vThreshold
  }
}

export class SchemaError extends Error {}

export async function loadRun(url = 'run.json'): Promise<RunView> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `не удалось загрузить ${url}: ${response.status} ${response.statusText}`,
    )
  }
  return parseRun(await response.json())
}

export function parseRun(data: unknown): RunView {
  const run = data as Run
  if (!run || typeof run !== 'object' || !('schema' in run)) {
    throw new SchemaError('это не выгрузка прогона VNL')
  }
  if (run.schema !== 1) {
    throw new SchemaError(
      `формат данных версии ${run.schema}, интерфейс понимает версию 1 — ` +
        'пересоберите файл командой vnl data',
    )
  }
  return new RunView(run)
}
