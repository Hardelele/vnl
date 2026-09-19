/**
 * Карточка паттерна: схема, что внутри, и симуляция с управляемым временем.
 *
 * Отдельного «результата» здесь нет. Симуляция идёт на месте: схема
 * подсвечивается, растр под ней дополняется, время можно остановить и
 * отмотать. Открывать отчёт незачем -- он и есть этот экран.
 *
 * Симуляция открывается при входе на карточку и закрывается при уходе.
 * В первой версии она живёт ровно столько, сколько открыт паттерн: пережить
 * закрытие вкладки ей незачем, а сессия, которую никто не смотрит, только
 * занимала бы память.
 */

import { useCallback, useEffect, useState } from 'react'

import { LINKS, NEURONS, PORTS, counted } from '../../lib/plural'
import { loadPattern } from '../../model/catalog'
import type { Contact, Neuron, PatternDetail } from '../../model/types'
import { simController, useSim } from '../../state/sim'
import { LiveScheme, type Threshold } from '../live/LiveScheme'
import { Timeline } from '../live/Timeline'
import { Transport } from '../live/Transport'
import './pattern.css'

export interface PatternScreenProps {
  id: string
  onBack: () => void
}

export function PatternScreen({ id, onBack }: PatternScreenProps) {
  const [pattern, setPattern] = useState<PatternDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<'elk' | 'builtin'>('builtin')
  const remember = useCallback((chosen: 'elk' | 'builtin') => setEngine(chosen), [])

  const control = simController
  const state = useSim((view) => view.state)
  const time = useSim((view) => view.time)
  const duration = useSim((view) => view.duration)
  const busy = useSim((view) => view.busy)
  const cells = useSim((view) => view.cells)
  const spikes = useSim((view) => view.spikes)
  const simError = useSim((view) => view.error)

  useEffect(() => {
    let alive = true
    loadPattern(id)
      .then((loaded) => alive && setPattern(loaded))
      .catch((reason: Error) => alive && setError(reason.message))
    // Симуляция открывается сразу: карточка без неё -- просто картинка.
    void control.open({ pattern: id })
    return () => {
      alive = false
      void control.close()
    }
  }, [id, control])

  if (error) {
    return (
      <div className="pat">
        <Crumbs onBack={onBack} />
        <p className="pat-alert" role="alert">
          {error}
        </p>
      </div>
    )
  }

  if (!pattern) {
    return (
      <div className="pat">
        <Crumbs onBack={onBack} />
        <p className="pat-hint">Читаем паттерн…</p>
      </div>
    )
  }

  const meta = [
    counted(pattern.counts.neurons, NEURONS),
    counted(pattern.counts.contacts, LINKS),
    counted(pattern.counts.ports, PORTS),
  ].join(' · ')

  return (
    <div className="pat">
      <Crumbs onBack={onBack} level={pattern.level} name={pattern.name} />

      <header className="pat-head">
        <div className="pat-title">
          <h1 className="pat-name">{pattern.name}</h1>
          <span className={`card-badge is-${pattern.status}`}>{pattern.statusName}</span>
        </div>
        <p className="pat-meta mono">
          {meta} · прогон {pattern.demo?.run.duration ?? 0} мс · шаг{' '}
          {pattern.demo?.run.dt ?? 0} мс
        </p>
        <div className="pat-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled
            title="Появится вместе с песочницей (#478, #479)"
          >
            Fork
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled
            title="Появится вместе с песочницей (#478, #479)"
          >
            В песочницу
          </button>
          <Transport
            state={state}
            time={time}
            duration={duration || (pattern.demo?.run.duration ?? 0)}
            busy={busy}
            onStart={() => void control.start()}
            onPause={() => void control.pause()}
            onReset={() => void control.reset()}
          />
        </div>
      </header>

      {simError ? (
        <p className="pat-alert" role="alert">
          {simError}
        </p>
      ) : null}

      <div className="pat-body">
        <section className="panel pat-scheme">
          <div className="panel-head">
            <span className="panel-title">Схема</span>
            <span className="mono panel-note">
              {engine === 'elk' ? 'раскладка ELK' : 'раскладка встроенная'}
            </span>
          </div>
          <div className="pat-canvas">
            <LiveScheme
              scheme={pattern.scheme}
              cells={cells}
              thresholds={thresholdsOf(pattern)}
              onEngine={remember}
            />
          </div>
          <Timeline
            duration={duration || (pattern.demo?.run.duration ?? 1)}
            time={time}
            order={pattern.body.neurons.map((neuron) => neuron.id)}
            spikes={spikes}
            inhibitory={Object.fromEntries(
              pattern.body.neurons.map((neuron) => [neuron.id, neuron.inhibitory]),
            )}
            onSeek={(moment) => void control.seek(moment)}
          />
        </section>

        <section className="pat-side">
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Нейроны</span>
            </div>
            {pattern.body.neurons.map((neuron) => (
              <CellRow key={neuron.id} neuron={neuron} pattern={pattern} />
            ))}
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Связи</span>
            </div>
            {pattern.body.contacts.map((contact) => (
              <LinkRow key={contact.id} contact={contact} />
            ))}
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Порты</span>
            </div>
            {pattern.ports.map((port) => (
              <div className="row" key={port.name}>
                <span className="row-id">{port.name}</span>
                <span className="mono row-dim">
                  {port.direction} · {port.site.instance}.{port.site.section}
                </span>
              </div>
            ))}
            {pattern.ports.length === 0 ? (
              <p className="row row-dim">Портов нет: подключить такой блок нельзя.</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

function Crumbs({
  onBack,
  level,
  name,
}: {
  onBack: () => void
  level?: string
  name?: string
}) {
  return (
    <nav className="pat-crumbs" aria-label="Где мы">
      <button type="button" className="pat-back" onClick={onBack}>
        Библиотека
      </button>
      {level ? <span className="mono">/ {level}</span> : null}
      {name ? <span className="pat-here">/ {name}</span> : null}
    </nav>
  )
}

function CellRow({ neuron, pattern }: { neuron: Neuron; pattern: PatternDetail }) {
  const type = pattern.body.cellTypes[neuron.cellType]
  const point = type?.pointModel
  return (
    <div className="row">
      <span className={`row-dot${neuron.inhibitory ? ' is-inh' : ''}`} />
      <span className="row-id">{neuron.id}</span>
      <span className="mono row-dim">{neuron.cellType}</span>
      <span className="mono row-dim row-end">
        {point ? `τ ${point.tauM} мс · порог ${point.vThreshold} мВ` : ''}
      </span>
    </div>
  )
}

function LinkRow({ contact }: { contact: Contact }) {
  const arrow = contact.inhibitory ? '⊣' : '→'
  return (
    <div className="row">
      <span className={`row-arrow${contact.inhibitory ? ' is-inh' : ''}`}>{arrow}</span>
      <span className="mono row-path">
        {contact.pre.instance} → {contact.post.instance}.{contact.post.section}
        {contact.post.fraction !== 0.5 ? `@${contact.post.fraction}` : ''}
      </span>
      <span className="mono row-dim row-end">
        {contact.weight} нСм · {contact.delay} мс
      </span>
    </div>
  )
}

/** Порог и покой каждой клетки: по ним считается заливка на схеме. */
function thresholdsOf(pattern: PatternDetail): Record<string, Threshold> {
  const table: Record<string, Threshold> = {}
  for (const neuron of pattern.body.neurons) {
    const point = pattern.body.cellTypes[neuron.cellType]?.pointModel
    if (point) table[neuron.id] = { rest: point.vRest, threshold: point.vThreshold }
  }
  return table
}
