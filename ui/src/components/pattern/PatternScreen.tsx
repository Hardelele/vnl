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
 *
 * Карточка и её симуляция открыты всем: «потрогать» -- часть просмотра. Отказ
 * «нужен вход» здесь появиться не должен, но если сервер его всё-таки дал (не
 * обновлён, закрыт целиком), нажатое ведёт ко входу, а то, что читалось само,
 * объясняется подписью: уводить с экрана человека, ничего не нажимавшего,
 * нельзя.
 */

import { useCallback, useEffect, useState } from 'react'

import { LINKS, NEURONS, PORTS, counted } from '../../lib/plural'
import { isDenied, loadPattern } from '../../model/catalog'
import type { Contact, Neuron, PatternDetail } from '../../model/types'
import { goToLogin, loginAt, useSession } from '../../state/session'
import { simController, useSim } from '../../state/sim'
import { LoginHint } from '../shell/Login'
import { Inspector } from '../live/Inspector'
import { LiveScheme } from '../live/LiveScheme'
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
  /** Отказ был «нужен вход»: он поправим входом, а не повторным открытием. */
  const [denied, setDenied] = useState(false)
  const [engine, setEngine] = useState<'elk' | 'builtin'>('builtin')
  /** Клетка, открытая в инспекторе. Общая для схемы, таймлайна и списка. */
  const [neuron, setNeuron] = useState<string | null>(null)
  const remember = useCallback((chosen: 'elk' | 'builtin') => setEngine(chosen), [])

  const control = simController
  const state = useSim((view) => view.state)
  const time = useSim((view) => view.time)
  const duration = useSim((view) => view.duration)
  const busy = useSim((view) => view.busy)
  const cells = useSim((view) => view.cells)
  const spikes = useSim((view) => view.spikes)
  const traces = useSim((view) => view.traces)
  const dt = useSim((view) => view.dt)
  const simError = useSim((view) => view.error)
  const simDenied = useSim((view) => view.denied)
  const login = useSession(loginAt)

  useEffect(() => {
    let alive = true
    loadPattern(id)
      .then((loaded) => alive && setPattern(loaded))
      .catch((reason: Error) => {
        if (!alive) return
        setError(reason.message)
        setDenied(isDenied(reason))
      })
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
        {denied ? (
          <LoginHint login={login}>{error}</LoginHint>
        ) : (
          <p className="pat-alert" role="alert">
            {error}
          </p>
        )}
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
            onStart={() => void act(() => control.start())}
            onPause={() => void act(() => control.pause())}
            onReset={() => void act(() => control.reset())}
          />
        </div>
      </header>

      {simError && simDenied ? (
        <LoginHint login={login}>{simError}</LoginHint>
      ) : simError ? (
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
              onEngine={remember}
              selected={neuron}
              onPick={setNeuron}
            />
          </div>
          <Timeline
            duration={duration || (pattern.demo?.run.duration ?? 1)}
            time={time}
            dt={dt}
            order={pattern.body.neurons.map((item) => item.id)}
            spikes={spikes}
            traces={traces}
            inhibitory={Object.fromEntries(
              pattern.body.neurons.map((item) => [item.id, item.inhibitory]),
            )}
            onSeek={(moment) => void act(() => control.seek(moment))}
            selected={neuron}
            onSelect={setNeuron}
          />
        </section>

        <section className="pat-side">
          {neuron ? (
            <div className="panel">
              <Inspector
                neuron={neuron}
                model={pattern.body}
                cells={cells}
                spikes={spikes}
                elapsed={time}
              />
            </div>
          ) : null}

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Нейроны</span>
              <span className="mono panel-note">
                {neuron ? 'выбран ' + neuron : 'выберите клетку'}
              </span>
            </div>
            {pattern.body.neurons.map((item) => (
              <CellRow
                key={item.id}
                neuron={item}
                pattern={pattern}
                on={item.id === neuron}
                onPick={() => setNeuron(item.id)}
              />
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

/**
 * Действие над симуляцией. Отказ по входу уводит ко входу: человек нажал и ждёт
 * результата, а не приглашения нажать то же самое второй раз.
 */
async function act(run: () => Promise<void>): Promise<void> {
  await run()
  if (simController.store.getState().denied) goToLogin()
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

function CellRow({
  neuron,
  pattern,
  on,
  onPick,
}: {
  neuron: Neuron
  pattern: PatternDetail
  on: boolean
  onPick: () => void
}) {
  const type = pattern.body.cellTypes[neuron.cellType]
  const point = type?.pointModel
  return (
    <button type="button" className={`row row-pick${on ? ' is-on' : ''}`} onClick={onPick}>
      <span className={`row-dot${neuron.inhibitory ? ' is-inh' : ''}`} />
      <span className="row-id">{neuron.id}</span>
      <span className="mono row-dim">{neuron.cellType}</span>
      <span className="mono row-dim row-end">
        {point ? `τ ${point.tauM} мс · порог ${point.vThreshold} мВ` : ''}
      </span>
    </button>
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
