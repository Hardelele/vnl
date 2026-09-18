/**
 * Инспектор одного нейрона: почему он спайкует именно так.
 *
 * Обзорный экран отвечает на вопрос «кто и когда активен». Здесь отвечают на
 * другой: что делает с этой клеткой каждый её вход. Поэтому всё смотрит на
 * одну клетку и показывается причинность, а не сводка.
 */

import { useMemo } from 'react'

import type { RunView } from '../../model/run'
import type { Contact } from '../../model/types'
import {
  conductanceBalance,
  downsample,
  extentOf,
  niceStep,
  spikeTriggeredAverage,
} from '../../lib/analysis'
import { Plot } from '../chart/Plot'
import { useUi } from '../../state/store'
import './inspector.css'

const COLUMNS = 320
/** Окно усреднения вокруг спайка источника. */
const STA_BEFORE = 20
const STA_AFTER = 40

interface Props {
  view: RunView
  id: string
}

function minus(text: string): string {
  return text.replace('-', '−')
}

function roundTo(value: number, step: number, up: boolean): number {
  const rounded = up ? Math.ceil(value / step) : Math.floor(value / step)
  return rounded * step
}

/** Круглая шкала: подписи уровней должны читаться, а не быть хвостами float. */
function scaleFor(low: number, high: number, includeZero = false): {
  low: number
  high: number
  levels: number[]
} {
  const from = includeZero ? Math.min(low, 0) : low
  const to = includeZero ? Math.max(high, 0) : high
  const step = niceStep(to - from, 4)
  const bottom = roundTo(from, step, false)
  const top = roundTo(to, step, true)
  const levels: number[] = []
  for (let level = bottom; level <= top + 1e-9; level += step) {
    levels.push(Number(level.toFixed(6)))
  }
  return { low: bottom, high: top, levels }
}

export function NeuronInspector({ view, id }: Props) {
  const cursor = useUi((state) => state.cursor)
  const neuron = view.neuron(id)
  const cellType = view.cellType(id)

  const voltage = view.trace(id, 'v')
  const excitation = view.trace(id, 'g_exc')
  const inhibition = view.trace(id, 'g_inh')
  const spikes = view.spikesOf(id)
  const inputs = view.inputsOf(id)
  const dt = view.dt
  const duration = view.duration

  const balance = useMemo(
    () => conductanceBalance(excitation, inhibition),
    [excitation, inhibition],
  )

  const responses = useMemo(
    () =>
      voltage
        ? inputs.map((contact) => ({
            contact,
            window: spikeTriggeredAverage(
              voltage,
              view.spikesOf(contact.pre.instance),
              dt,
              STA_BEFORE,
              STA_AFTER,
            ),
          }))
        : [],
    [inputs, voltage, dt, view],
  )

  if (!neuron || !cellType) {
    return <p className="insp-empty">Нейрон {id} в этом прогоне не найден.</p>
  }

  const sample = cursor === null ? null : view.sampleAt(cursor)
  const rate = (spikes.length / duration) * 1000

  return (
    <div className="insp">
      <header className="insp-head">
        <div>
          <h2 className="insp-title">
            {id} <span className="insp-type">{cellType.id}</span>
          </h2>
          <p className="insp-sub mono">
            {spikes.length} спайков · {rate.toFixed(1)} Гц · порог{' '}
            {minus(cellType.pointModel.vThreshold.toFixed(1))} мВ
          </p>
        </div>
        <div className="insp-cursor mono">
          {cursor === null ? (
            <span className="insp-hint">наведите на график</span>
          ) : (
            <>
              <span className="insp-time">t = {cursor.toFixed(1)} мс</span>
              {voltage && sample !== null ? (
                <span>
                  Vm = {minus((voltage[sample] ?? 0).toFixed(1))} мВ
                </span>
              ) : null}
              {excitation && inhibition && sample !== null ? (
                <span>
                  g: <b className="insp-exc">{(excitation[sample] ?? 0).toFixed(2)}</b>{' '}
                  /{' '}
                  <b className="insp-inh">{(inhibition[sample] ?? 0).toFixed(2)}</b> нСм
                </span>
              ) : null}
            </>
          )}
        </div>
      </header>

      <section className="insp-block">
        <h3 className="insp-label">Входы</h3>
        {inputs.length === 0 ? (
          <p className="insp-empty">Входов нет: клетка ведома только стимулом.</p>
        ) : (
          <table className="insp-table">
            <thead>
              <tr>
                <th>источник</th>
                <th>место</th>
                <th>рецептор</th>
                <th className="num">вес, нСм</th>
                <th className="num">задержка, мс</th>
                <th>свойства</th>
              </tr>
            </thead>
            <tbody>
              {inputs.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <span
                      className={`insp-dot ${contact.inhibitory ? 'insp-dot-inh' : 'insp-dot-exc'}`}
                    />
                    {contact.pre.instance}
                  </td>
                  <td className="mono">{placeOf(contact)}</td>
                  <td className="mono">{contact.receptor}</td>
                  <td className="num">{contact.weight.toFixed(2)}</td>
                  <td className="num">{contact.delay.toFixed(2)}</td>
                  <td className="insp-props">{propertiesOf(contact)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {voltage ? (
        <section className="insp-block">
          <h3 className="insp-label">Мембранный потенциал</h3>
          {(() => {
            const scale = scaleFor(...spread(voltage))
            return (
              <Plot
                name={`${id}.soma`}
                kind="мембранный потенциал, мВ"
                to={duration}
                low={scale.low}
                high={scale.high}
                levels={scale.levels}
                height={150}
                series={[
                  {
                    points: downsample(voltage, dt, COLUMNS),
                    color: 'var(--trace)',
                  },
                ]}
                markers={[
                  {
                    value: cellType.pointModel.vThreshold,
                    label: `порог ${minus(cellType.pointModel.vThreshold.toFixed(1))} мВ`,
                  },
                ]}
                events={{
                  times: spikes,
                  color: neuron.inhibitory ? 'var(--inh)' : 'var(--exc)',
                }}
                showAxis={!excitation}
              />
            )
          })()}
        </section>
      ) : (
        <p className="insp-empty">
          Потенциал не записан. Добавьте <code>record {id}.soma.v</code> в модель.
        </p>
      )}

      {excitation && inhibition ? (
        <section className="insp-block">
          <h3 className="insp-label">Возбуждение и торможение</h3>
          {(() => {
            const both = [...excitation, ...inhibition]
            const scale = scaleFor(0, extentOf(both).high, true)
            return (
              <Plot
                name={`${id}.soma`}
                kind="проводимость входов, нСм"
                to={duration}
                low={scale.low}
                high={scale.high}
                levels={scale.levels}
                height={120}
                series={[
                  {
                    points: downsample(excitation, dt, COLUMNS),
                    color: 'var(--exc)',
                    fill: 'zero',
                  },
                  {
                    points: downsample(inhibition, dt, COLUMNS),
                    color: 'var(--inh)',
                    fill: 'zero',
                  },
                ]}
              />
            )
          })()}

          {balance ? (
            (() => {
              const extent = extentOf(balance)
              const scale = scaleFor(extent.low, extent.high, true)
              return (
                <Plot
                  name="баланс"
                  kind="возбуждение − торможение, нСм"
                  to={duration}
                  low={scale.low}
                  high={scale.high}
                  levels={scale.levels}
                  height={100}
                  series={[
                    {
                      points: downsample(balance, dt, COLUMNS),
                      color: 'var(--accent)',
                      fill: 'zero',
                    },
                  ]}
                  markers={[{ value: 0, label: '0' }]}
                  showAxis
                />
              )
            })()
          ) : null}
        </section>
      ) : (
        <p className="insp-empty">
          Баланс входа не показан: нужны записи{' '}
          <code>record {id}.soma.g_exc</code> и <code>g_inh</code>.
        </p>
      )}

      {responses.length > 0 ? (
        <section className="insp-block">
          <h3 className="insp-label">Отклик после спайка входа</h3>
          <p className="insp-note">
            Усреднение потенциала вокруг спайков источника: одиночное событие
            тонет в шуме, среднее по десяткам окон показывает форму. Это
            корреляция, а не действие входа поодиночке: если два источника
            спайкуют синхронно, в окне каждого видно и соседа.
          </p>
          <div className="insp-grid">
            {responses.map(({ contact, window }) => {
              if (!window) {
                return (
                  <p key={contact.id} className="insp-empty">
                    {contact.pre.instance} → {id}: спайков источника не хватило.
                  </p>
                )
              }
              const extent = extentOf(window.mean, 0.15)
              const scale = scaleFor(extent.low, extent.high)
              const delta = (window.mean[window.mean.length - 1] ?? 0) - (window.mean[0] ?? 0)
              return (
                <Plot
                  key={contact.id}
                  name={`${contact.pre.instance} → ${id}`}
                  kind={`${contact.receptor}, n = ${window.count}`}
                  from={-STA_BEFORE}
                  to={STA_AFTER}
                  low={scale.low}
                  high={scale.high}
                  levels={scale.levels}
                  height={110}
                  interactive={false}
                  showAxis
                  stat={`Δ ${delta >= 0 ? '+' : minus('-')}${Math.abs(delta).toFixed(2)} мВ`}
                  series={[
                    {
                      points: window.offsets.map((offset, index) => [
                        offset,
                        window.mean[index] as number,
                      ]),
                      color: contact.inhibitory ? 'var(--inh)' : 'var(--exc)',
                      width: 1.8,
                    },
                  ]}
                />
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function spread(values: number[]): [number, number] {
  const extent = extentOf(values, 0.08)
  return [extent.low, extent.high]
}

function placeOf(contact: Contact): string {
  return contact.post.section === 'soma'
    ? 'сома'
    : `${contact.post.section}@${contact.post.fraction}`
}

function propertiesOf(contact: Contact): string {
  const parts: string[] = []
  if (contact.dynamics.enabled) {
    parts.push(
      contact.dynamics.tauFacil > 0 ? 'фасилитация' : 'депрессия',
    )
  }
  if (contact.plasticity.enabled) parts.push(contact.plasticity.rule)
  return parts.length > 0 ? parts.join(' · ') : '—'
}
