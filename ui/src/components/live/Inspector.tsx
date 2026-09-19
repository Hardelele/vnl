/**
 * Инспектор клетки: что в неё входит и что с ней происходит сейчас.
 *
 * Возвращён из прежнего экрана прогона, но живёт теперь рядом со схемой и
 * таймлайном: смотреть на клетку в отрыве от того, что делает остальная сеть,
 * незачем. Графики потенциала и проводимостей остались в дорожке таймлайна --
 * здесь то, чего на графике нет: чем клетка возбуждается, с каким весом и
 * задержкой, и какие у неё параметры.
 *
 * Заряд -- доля пути от покоя до порога -- стоит рядом с порогом и покоем, от
 * которых он и считается: это то же число, что над клеткой на схеме, только
 * вместе с тем, что его объясняет. Главное место у него всё-таки на схеме:
 * инспектор открыт для одной клетки, а заряд читают у всех сразу.
 *
 * Частота считается по пройденному времени симуляции, а не по длительности
 * прогона: на середине прогона делить на полную длительность значило бы
 * показывать вдвое меньшую частоту и пугать ею зря.
 */

import { chargeLabel, momentOf } from '../../lib/charge'
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
  // Тот же процент, что стоит над клеткой на схеме: одна функция, одно
  // округление -- иначе схема и панель разошлись бы на единицу в том же кадре.
  const level = chargeLabel(momentOf(state))

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
        {/* Заряд первым и во всю ширину: он отвечает на главный вопрос о
            клетке сейчас -- далеко ли ей до разряда, -- а порог с покоем ниже
            объясняют, от чего эта доля считается. */}
        <Cell
          label="заряд"
          value={level ? (level.below ? `${level.text} · ниже покоя` : level.text) : '—'}
          wide
          below={level?.below}
        />
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

function Cell({
  label,
  value,
  wide = false,
  below = false,
}: {
  label: string
  value: string
  /** Во всю ширину сетки: так стоит заряд, остальное -- половинками. */
  wide?: boolean
  /** Клетка ниже покоя: значение красится в цвет торможения, как на схеме. */
  below?: boolean
}) {
  return (
    <div className={`insp-cell${wide ? ' is-wide' : ''}`}>
      <span className="insp-label">{label}</span>
      <span className={`mono insp-value${below ? ' is-below' : ''}`}>{value}</span>
    </div>
  )
}
