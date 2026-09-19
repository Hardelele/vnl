/**
 * Инспектор клетки: что в неё входит и что с ней происходит сейчас.
 *
 * Возвращён из прежнего экрана прогона, но живёт теперь рядом со схемой и
 * таймлайном: смотреть на клетку в отрыве от того, что делает остальная сеть,
 * незачем. Графики потенциала и проводимостей остались в дорожке таймлайна --
 * здесь то, чего на графике нет: чем клетка возбуждается, с каким весом и
 * задержкой, и какие у неё параметры.
 *
 * Живые числа -- заряд, потенциал и разряды -- рисует общий `Vitals`: те же
 * три величины показывает панель выбранной клетки в песочнице, и второй
 * реализации «что показать про клетку» быть не должно. Здесь к ним добавлено
 * то, от чего доля заряда считается, -- порог и покой, -- и это единственная
 * причина, по которой параметры мембраны стоят следом.
 *
 * Главное место у заряда всё-таки на схеме: инспектор открыт для одной клетки,
 * а заряд читают у всех сразу.
 */

import type { CellState } from '../../model/sim'
import type { Model } from '../../model/types'
import { Field, Vitals } from './Vitals'
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
        <span className="mono row-dim row-end">{cell?.inhibitory ? 'тормозная' : 'возбуждающая'}</span>
      </div>

      <Vitals state={state} spikes={fired} elapsed={elapsed} />

      {/* Параметры мембраны -- следом за живыми числами и в той же сетке:
          порог и покой объясняют, от чего считается доля заряда, а сброс
          говорит, куда клетка падает после разряда. Без них процент над
          клеткой -- голое число. */}
      <div className="insp-grid">
        <Field label="порог" value={point ? `${point.vThreshold} мВ` : '—'} />
        <Field label="покой" value={point ? `${point.vRest} мВ` : '—'} />
        <Field label="сброс" value={point ? `${point.vReset} мВ` : '—'} />
        <Field label="τ мембраны" value={point ? `${point.tauM} мс` : '—'} />
        <Field
          label="адаптация"
          value={point?.adaptation ? `${point.adaptation} мВ` : 'нет'}
        />
        <Field label="рефрактерность" value={point ? `${point.refractory} мс` : '—'} />
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
