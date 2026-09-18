/**
 * Песочница: холст, дерево объектов, свойства и то же управление временем.
 *
 * Три представления -- одно состояние. Ответ сервера на любую операцию
 * приходит целиком, поэтому холст, дерево и свойства не могут разойтись: они
 * читают один и тот же объект, а не каждый свой срез.
 *
 * Симуляция здесь такая же, как на карточке паттерна: собранная сеть, живое
 * время, пауза и откат. Отдельного «результата» нет и тут.
 */

import { useEffect, useState } from 'react'

import type { CellState } from '../../model/sim'
import type { SandboxBlock, SandboxLink } from '../../model/sandbox'
import { catalogController, useCatalog } from '../../state/catalog'
import { sandboxController, useSandbox, type Selection } from '../../state/sandbox'
import { simController, useSim } from '../../state/sim'
import { Timeline } from '../live/Timeline'
import { Transport } from '../live/Transport'
import { Canvas } from './Canvas'
import './sandbox.css'

type LeftTab = 'library' | 'objects'

export function SandboxScreen() {
  const control = sandboxController
  const sim = simController
  const [tab, setTab] = useState<LeftTab>('library')

  const list = useSandbox((state) => state.list)
  const project = useSandbox((state) => state.project)
  const selected = useSandbox((state) => state.selected)
  const pending = useSandbox((state) => state.pending)
  const error = useSandbox((state) => state.error)

  const catalog = useCatalog((state) => state.catalog)
  const simState = useSim((state) => state.state)
  const time = useSim((state) => state.time)
  const duration = useSim((state) => state.duration)
  const busy = useSim((state) => state.busy)
  const cells = useSim((state) => state.cells)
  const spikes = useSim((state) => state.spikes)
  const simError = useSim((state) => state.error)

  useEffect(() => {
    void control.refreshList()
    void catalogController.refresh()
    return () => {
      void sim.close()
    }
  }, [control, sim])

  if (!project) {
    return (
      <div className="sb-empty">
        <h1 className="sb-title">Песочница</h1>
        {error ? <p className="sb-alert">{error}</p> : null}
        <p className="sb-hint">
          Проект — это схема, собранная из паттернов библиотеки. Их можно
          соединять, запускать и сохранять.
        </p>
        <div className="sb-projects">
          {list.map((row) => (
            <button
              key={row.id}
              type="button"
              className="sb-project"
              onClick={() => void control.open(row.id)}
            >
              <span className="sb-project-name">{row.name}</span>
              <span className="mono sb-project-meta">
                {row.blocks} бл. · {row.links} св.
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void control.create('Новый проект')}
        >
          Новый проект
        </button>
      </div>
    )
  }

  const inhibitory = neuronKinds(project.blocks)

  return (
    <div className="sb">
      <header className="sb-bar">
        <span className="sb-name">{project.name}</span>
        <span className="mono sb-run">
          {project.run.duration} мс · dt {project.run.dt} · seed {project.run.seed}
        </span>

        <Transport
          state={simState}
          time={time}
          duration={duration || project.run.duration}
          busy={busy}
          onStart={() => void start(project.id)}
          onPause={() => void sim.pause()}
          onReset={() => void sim.reset()}
        />

        <button
          type="button"
          className="btn-secondary"
          disabled={!project.dirty}
          onClick={() => void control.save()}
        >
          Сохранить
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!project.canUndo}
          onClick={() => void control.undo()}
        >
          Отменить
        </button>
        <span className={`sb-dirty${project.dirty ? ' is-on' : ''}`}>
          {project.dirty ? 'не сохранено' : 'сохранено'}
        </span>
      </header>

      {error || simError ? (
        <p className="sb-alert" role="alert">
          {error ?? simError}
        </p>
      ) : null}
      {project.problems.length ? (
        <p className="sb-warn">{project.problems.join(' · ')}</p>
      ) : null}
      {pending ? (
        <p className="sb-warn">
          Выбран порт {pending.instance}.{pending.port} — щёлкните по второму порту,
          чтобы соединить.{' '}
          <button type="button" className="sb-link" onClick={() => control.cancelPending()}>
            отменить
          </button>
        </p>
      ) : null}

      <div className="sb-body">
        <aside className="panel sb-left">
          <div className="sb-tabs">
            <button
              type="button"
              className={`lib-tab${tab === 'library' ? ' is-on' : ''}`}
              onClick={() => setTab('library')}
            >
              Библиотека
            </button>
            <button
              type="button"
              className={`lib-tab${tab === 'objects' ? ' is-on' : ''}`}
              onClick={() => setTab('objects')}
            >
              Объекты
            </button>
          </div>

          {tab === 'library' ? (
            <div className="sb-list">
              {(catalog?.patterns ?? []).map((pattern) => (
                <div className="sb-row" key={pattern.id}>
                  <span className="mono sb-level">{pattern.level}</span>
                  <span className="sb-row-name">{pattern.name}</span>
                  <button
                    type="button"
                    className="sb-plus"
                    title="Вставить в схему"
                    onClick={() => void control.insert(pattern.id)}
                  >
                    +
                  </button>
                </div>
              ))}
              {catalog && catalog.patterns.length === 0 ? (
                <p className="sb-hint">Библиотека пуста — вставлять нечего.</p>
              ) : null}
            </div>
          ) : (
            <div className="sb-list">
              {project.blocks.map((block) => (
                <Row
                  key={block.id}
                  label={block.label}
                  kind="блок"
                  on={selected?.kind === 'block' && selected.id === block.id}
                  onPick={() => control.select({ kind: 'block', id: block.id })}
                />
              ))}
              {project.links.map((link) => (
                <Row
                  key={link.id}
                  label={`${link.source.instance}.${link.source.port} → ${link.target.instance}.${link.target.port}`}
                  kind="связь"
                  on={selected?.kind === 'link' && selected.id === link.id}
                  onPick={() => control.select({ kind: 'link', id: link.id })}
                />
              ))}
              {project.stimuli.map((drive) => (
                <Row
                  key={drive.id}
                  label={`${drive.id} → ${drive.target.instance}.${drive.target.port}`}
                  kind="стимул"
                  on={selected?.kind === 'stimulus' && selected.id === drive.id}
                  onPick={() => control.select({ kind: 'stimulus', id: drive.id })}
                />
              ))}
              {project.recordings.map((record) => (
                <Row
                  key={record.id}
                  label={`${record.id} · ${record.target.instance}.${record.target.port}`}
                  kind="запись"
                  on={selected?.kind === 'recording' && selected.id === record.id}
                  onPick={() => control.select({ kind: 'recording', id: record.id })}
                />
              ))}
            </div>
          )}
        </aside>

        <section className="sb-canvas">
          <Canvas
            blocks={project.blocks}
            links={project.links}
            cells={cells}
            selected={selected}
            pending={pending}
            onPickBlock={(id) => control.select({ kind: 'block', id })}
            onPickLink={(id) => control.select({ kind: 'link', id })}
            onPickPort={(instance, port) => void control.touchPort(instance, port)}
            onMove={(id, position) => void control.move(id, position)}
            onEmpty={() => control.select(null)}
          />
          <Timeline
            duration={duration || project.run.duration}
            time={time}
            order={Object.keys(cells)}
            spikes={spikes}
            inhibitory={inhibitory}
            onSeek={(moment) => void sim.seek(moment)}
            disabled={!duration}
          />
        </section>

        <aside className="panel sb-right">
          <Properties selection={selected} project={project} cells={cells} />
        </aside>
      </div>
    </div>
  )

  async function start(id: string): Promise<void> {
    // Симуляция открывается на первом запуске: собирать сеть до того, как её
    // попросили посчитать, незачем -- схема ещё меняется.
    if (!simController.store.getState().id) await sim.open({ sandbox: id })
    await sim.start()
  }
}

function Row({
  label,
  kind,
  on,
  onPick,
}: {
  label: string
  kind: string
  on: boolean
  onPick: () => void
}) {
  return (
    <button type="button" className={`sb-row sb-pick${on ? ' is-on' : ''}`} onClick={onPick}>
      <span className="sb-row-name">{label}</span>
      <span className="mono sb-kind">{kind}</span>
    </button>
  )
}

function Properties({
  selection,
  project,
  cells,
}: {
  selection: Selection | null
  project: { blocks: SandboxBlock[]; links: SandboxLink[] }
  cells: Record<string, CellState>
}) {
  const control = sandboxController

  if (!selection) {
    return (
      <>
        <div className="panel-head">
          <span className="panel-title">Свойства</span>
        </div>
        <p className="sb-hint">
          Выберите блок или связь. Соединение — щелчок по порту, потом по второму.
        </p>
      </>
    )
  }

  if (selection.kind === 'block') {
    const block = project.blocks.find((item) => item.id === selection.id)
    if (!block) return null
    return (
      <>
        <div className="panel-head">
          <span className="panel-title">Блок</span>
          <span className="mono panel-note">{block.patternId}</span>
        </div>
        <div className="row">
          <span className="row-id">{block.label}</span>
          <span className="mono row-dim row-end">
            {block.counts.neurons} кл. · {block.counts.contacts} св.
          </span>
        </div>
        {block.ports.map((port) => {
          const site = `${block.id}/${port.site.instance}`
          const state = cells[site]
          return (
            <div className="row" key={port.name}>
              <span className="row-id">{port.name}</span>
              <span className="mono row-dim">{port.direction}</span>
              <span className="mono row-dim row-end">
                {state ? `${state.v.toFixed(1)} мВ` : port.site.instance}
              </span>
            </div>
          )
        })}
        <div className="sb-actions">
          {block.ports
            .filter((port) => port.direction === 'in')
            .map((port) => (
              <button
                key={port.name}
                type="button"
                className="btn-secondary"
                onClick={() => void control.stimulate(block.id, port.name)}
              >
                Драйв на {port.name}
              </button>
            ))}
          {block.ports
            .filter((port) => port.direction === 'out')
            .map((port) => (
              <button
                key={port.name}
                type="button"
                className="btn-secondary"
                onClick={() => void control.record(block.id, port.name)}
              >
                Записывать {port.name}
              </button>
            ))}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void control.remove(block.id)}
          >
            Убрать блок
          </button>
        </div>
      </>
    )
  }

  if (selection.kind === 'link') {
    const link = project.links.find((item) => item.id === selection.id)
    if (!link) return null
    return (
      <>
        <div className="panel-head">
          <span className="panel-title">Связь</span>
          <span className="mono panel-note">{link.id}</span>
        </div>
        <div className="row">
          <span className="mono row-path">
            {link.source.instance}.{link.source.port} → {link.target.instance}.
            {link.target.port}
          </span>
        </div>
        <label className="sb-field">
          <span>Рецептор</span>
          <select
            value={link.receptor}
            onChange={(event) =>
              void control.setParams(link.id, { receptor: event.target.value })
            }
          >
            <option value="ampa">ampa</option>
            <option value="nmda">nmda</option>
            <option value="gaba_a">gaba_a</option>
            <option value="gaba_b">gaba_b</option>
          </select>
        </label>
        <NumberField
          label="Вес, нСм"
          value={link.weight}
          onChange={(weight) => void control.setParams(link.id, { weight })}
        />
        <NumberField
          label="Задержка, мс"
          value={link.delay}
          onChange={(delay) => void control.setParams(link.id, { delay })}
        />
        <div className="sb-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void control.remove(link.id)}
          >
            Убрать связь
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="panel-head">
        <span className="panel-title">{selection.kind === 'stimulus' ? 'Стимул' : 'Запись'}</span>
        <span className="mono panel-note">{selection.id}</span>
      </div>
      <div className="sb-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void control.remove(selection.id)}
        >
          Убрать
        </button>
      </div>
    </>
  )
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="sb-field">
      <span>{label}</span>
      <input
        type="number"
        step="0.1"
        defaultValue={value}
        // Правка уходит по уходу из поля, а не на каждую цифру: иначе история
        // отмены наполнится промежуточными «1», «1.», «1.4».
        onBlur={(event) => {
          const next = Number.parseFloat(event.target.value)
          if (Number.isFinite(next) && next !== value) onChange(next)
        }}
      />
    </label>
  )
}

/** Тормозность клеток собранной сети: имена в ней с приставкой блока. */
function neuronKinds(blocks: SandboxBlock[]): Record<string, boolean> {
  const kinds: Record<string, boolean> = {}
  for (const block of blocks) {
    for (const neuron of block.scheme.neurons) {
      kinds[`${block.id}/${neuron.id}`] = neuron.inhibitory
    }
  }
  return kinds
}
