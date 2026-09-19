/**
 * Инспектор клетки: что в неё входит и что с ней происходит сейчас.
 *
 * Возвращён из прежнего экрана прогона, но живёт теперь рядом со схемой и
 * таймлайном: смотреть на клетку в отрыве от того, что делает остальная сеть,
 * незачем. Графики потенциала и проводимостей остались в дорожке таймлайна --
 * здесь то, чего на графике нет: чем клетка возбуждается, с каким весом и
 * задержкой, и какие у неё параметры.
 *
 * Частота считается по пройденному времени симуляции, а не по длительности
 * прогона: на середине прогона делить на полную длительность значило бы
 * показывать вдвое меньшую частоту и пугать ею зря.
 */

import type { CellState } from '../../model/sim'
import type { Model } from '../../model/types'
import './inspector.css'

export interface InspectorProps {
  /** Имя клетки в собранной сети. */
  neuron: string
  model: Model
  cells: Record<string, CellState>
  spikes: Record<string, number[]>
  /** Пройденное время симуляции, мс. */
  elapsed: number
}

export function Inspector({ neuron, model, cells, spikes, elapsed }: InspectorProps) {
  const cell = model.neurons.find((item) => item.id === neuron)
  const type = cell ? model.cellTypes[cell.cellType] : undefined
  const point = type?.pointModel
  const state = cells[neuron]
  const fired = spikes[neuron] ?? []
  const rate = elapsed > 0 ? (fired.length / elapsed) * 1000 : 0

  const inputs = model.contacts.filter((contact) => contact.post.instance === neuron)
  const outputs = model.contacts.filter((contact) => contact.pre.instance === neuron)

  return (
    <div className="insp">
      <div className="panel-head">
        <span className="panel-title">Клетка</span>
        <span className="mono panel-note">{cell?.cellType ?? '—'}</span>
      </div>

      <div className="row">
        <span className={`row-dot${cell?.inhibitory ? ' is-inh' : ''}`} />
        <span className="row-id">{neuron}</span>
        <span className="mono row-dim row-end">
          {fired.length} сп. · {rate.toFixed(0)} Гц
        </span>
      </div>

      <div className="insp-grid">
        <Cell label="потенциал" value={state ? `${state.v.toFixed(1)} мВ` : '—'} />
        <Cell label="порог" value={point ? `${point.vThreshold} мВ` : '—'} />
        <Cell label="покой" value={point ? `${point.vRest} мВ` : '—'} />
        <Cell label="τ мембраны" value={point ? `${point.tauM} мс` : '—'} />
        <Cell
          label="адаптация"
          value={point?.adaptation ? `${point.adaptation} мВ` : 'нет'}
        />
        <Cell label="рефрактерность" value={point ? `${point.refractory} мс` : '—'} />
      </div>

      <div className="panel-head insp-sub">
        <span className="panel-title">Входы</span>
        <span className="mono panel-note">{inputs.length}</span>
      </div>
      {inputs.map((contact) => (
        <div className="row" key={contact.id}>
          <span className={`row-arrow${contact.inhibitory ? ' is-inh' : ''}`}>
            {contact.inhibitory ? '⊣' : '→'}
          </span>
          <span className="mono row-path">
            {contact.pre.instance} · {contact.post.section}
            {contact.post.fraction === 0.5 ? '' : `@${contact.post.fraction}`}
          </span>
          <span className="mono row-dim row-end">
            {contact.receptor} · {contact.weight} нСм · {contact.delay} мс
          </span>
        </div>
      ))}
      {inputs.length === 0 ? (
        <p className="row row-dim">Входов нет: клетка молчит, пока её не задеть стимулом.</p>
      ) : null}

      {outputs.length ? (
        <>
          <div className="panel-head insp-sub">
            <span className="panel-title">Выходы</span>
            <span className="mono panel-note">{outputs.length}</span>
          </div>
          {outputs.map((contact) => (
            <div className="row" key={contact.id}>
              <span className={`row-arrow${contact.inhibitory ? ' is-inh' : ''}`}>
                {contact.inhibitory ? '⊣' : '→'}
              </span>
              <span className="mono row-path">{contact.post.instance}</span>
              <span className="mono row-dim row-end">
                {contact.weight} нСм · {contact.delay} мс
              </span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="insp-cell">
      <span className="insp-label">{label}</span>
      <span className="mono insp-value">{value}</span>
    </div>
  )
}
