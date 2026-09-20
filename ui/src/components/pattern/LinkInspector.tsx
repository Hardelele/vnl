/**
 * Выбранная связь целиком: чем бьёт, с какой силой, откуда и куда.
 *
 * Своя панель, а не строчка в списке, по той же причине, по которой у клетки
 * есть инспектор: в строку помещаются три числа, а связь -- это ещё и точка
 * на дендрите, и кратковременная динамика, и правило пластичности. Без
 * последних двух `short_term_facilitation` на витрине выглядит ровно так же,
 * как обычная цепочка: адрес, вес и задержка у них совпадают, а ведут они себя
 * по-разному -- и весь смысл паттерна именно в этом.
 *
 * Смотреть, а не править: карточка -- витрина библиотеки. Поля ввода здесь
 * были бы обещанием, которого экран не держит; правка параметров живёт в
 * песочнице (#531), и числа в ней те же самые.
 *
 * Объяснения подписей -- из общего словаря (`GET /api/glossary`, #541): что
 * такое `gaba_a`, вес и задержка, сказано на сервере рядом с числами, которыми
 * их считают. Пока словарь не пришёл, подсказки просто нет -- панель от этого
 * не ломается.
 */

import { receptorHint } from '../../model/glossary'
import { siteText } from '../../lib/site'
import type { Contact, Glossary } from '../../model/types'
import { Field } from '../live/Vitals'

export interface LinkInspectorProps {
  contact: Contact
  glossary: Glossary
}

export function LinkInspector({ contact, glossary }: LinkInspectorProps) {
  const arrow = contact.inhibitory ? '⊣' : '→'
  return (
    <div className="insp">
      <div className="panel-head">
        <span className="panel-title">Связь</span>
        <span className="mono panel-note">{contact.id}</span>
      </div>

      <div className="row">
        <span className={`row-arrow${contact.inhibitory ? ' is-inh' : ''}`}>{arrow}</span>
        <span className="mono row-path">
          {siteText(contact.pre)} {arrow} {siteText(contact.post)}
        </span>
        <span className="mono row-dim row-end">
          {contact.inhibitory ? 'тормозная' : 'возбуждающая'}
        </span>
      </div>

      <div className="insp-grid">
        <Field
          label="рецептор"
          value={contact.receptor}
          wide
          hint={receptorHint(glossary, contact.receptor)}
        />
        <Field label="вес" value={`${contact.weight} нСм`} hint={glossary.contact.weight} />
        <Field label="задержка" value={`${contact.delay} мс`} hint={glossary.contact.delay} />
      </div>

      {/* Динамика и пластичность -- только когда они есть. Строка «динамики
          нет» стояла бы у девятнадцати паттернов из двадцати и не значила бы
          ничего; там, где она есть, её видно по тому, что строка появилась. */}
      {contact.dynamics.enabled ? (
        <div className="row pat-fact" title={glossary.contact.dynamics}>
          <span className="insp-label">кратковременная динамика</span>
          <span className="row-dim">{dynamicsWords(contact)}</span>
        </div>
      ) : null}

      {contact.plasticity.enabled ? (
        <div className="row pat-fact" title={glossary.contact.plasticity}>
          <span className="insp-label">пластичность</span>
          <span className="row-dim">{plasticityWords(contact)}</span>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Кратковременная динамика словами.
 *
 * Названий режимов («депрессия», «фасилитация») здесь нет намеренно: режим не
 * поле ответа, а вывод из двух чисел, и у `short_term_facilitation` оба
 * времени ненулевые сразу. Назови такую связь одним словом -- и подпись
 * поспорит с числами под ней. Что из чисел выходит, объясняет подсказка из
 * словаря; здесь только то, что в контакте записано.
 */
function dynamicsWords(contact: Contact): string {
  const { u, tauRec, tauFacil } = contact.dynamics
  const said = [`спайк тратит ${Math.round(u * 100)}% запаса`]
  if (tauRec > 0) said.push(`восстановление ${tauRec} мс`)
  if (tauFacil > 0) said.push(`облегчение ${tauFacil} мс`)
  return said.join(' · ')
}

/**
 * Правило пластичности словами.
 *
 * Имя правила печатается машинным (`stdp_rl`): переводить его здесь значило бы
 * завести второй список правил -- первый живёт в `ir.Plasticity` и решает,
 * что считает симулятор. Что правило делает, говорит подсказка словаря.
 */
function plasticityWords(contact: Contact): string {
  const rule = contact.plasticity
  const said: string[] = [rule.rule]
  if (rule.modulator) said.push(`модулятор ${rule.modulator}`)
  said.push(`+${rule.aPlus} / −${rule.aMinus} нСм`)
  said.push(`τ ${rule.tauPlus} / ${rule.tauMinus} мс`)
  said.push(`потолок ${rule.wMax} нСм`)
  return said.join(' · ')
}
