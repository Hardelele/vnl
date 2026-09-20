/**
 * Витрина прогона: чем паттерн бьют и что с него снимают.
 *
 * Эти два списка карточка получала с самого начала (`demo` в ответе сервера) и
 * читала из них ровно два числа -- длительность и шаг (#546). Человек видел
 * спайки и не видел, чем они вызваны, а у половины библиотеки весь смысл
 * именно в драйве: `short_term_depression` -- это пачка из восьми спайков,
 * `disinhibition` -- окно `gate` на 200--400 мс. Схема у них при этом ничем не
 * выдаёт, что с ними делают.
 *
 * Словами, а не пересказом полей: «пуассоновский шум 250 Гц, вес 1.5 нСм, с 20
 * по 380 мс» вместо `kind: poisson, rate: 250, start: 20`. Разница не в
 * красоте -- по списку полей нельзя понять, что `rate` у спайкового драйва не
 * значит ничего, а `times` у пуассоновского пусты не потому, что их забыли.
 *
 * Править нечего и здесь: карточка -- витрина, поля ввода живут в песочнице
 * (#531). Окно показывается только когда оно уже прогона: «с 0 по 300 мс» при
 * трёхсотмиллисекундном прогоне -- это не окно, а повтор длительности.
 */

import { siteText } from '../../lib/site'
import { momentWords } from '../../lib/times'
import { receptorHint, recordedName } from '../../model/glossary'
import type { DemoRun, Glossary, Stimulus } from '../../model/types'

export interface DemoProps {
  /** Витрина прогона. Пусто -- паттерн лежит в библиотеке без примера запуска. */
  demo: DemoRun | null
  glossary: Glossary
}

export function DrivePanel({ demo, glossary }: DemoProps) {
  const stimuli = demo?.stimuli ?? []
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Драйв</span>
        <span className="mono panel-note">{stimuli.length || ''}</span>
      </div>
      {stimuli.map((stim) => (
        <DriveRow
          key={stim.id}
          stim={stim}
          duration={demo?.run.duration ?? 0}
          glossary={glossary}
        />
      ))}
      {stimuli.length === 0 ? (
        <p className="row row-dim">
          {demo
            ? 'Драйва нет: сеть считается без внешнего входа.'
            : 'Примера запуска у паттерна нет.'}
        </p>
      ) : null}
    </div>
  )
}

export function RecordsPanel({ demo, glossary }: DemoProps) {
  const recordings = demo?.recordings ?? []
  if (!recordings.length) return null
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Записи</span>
        <span className="mono panel-note">{recordings.length}</span>
      </div>
      {recordings.map((record) => (
        <div className="row pat-soft" key={record.id}>
          <span className="mono row-path">{siteText(record.target)}</span>
          <span className="row-dim row-end">{recordedName(glossary, record.var)}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Один стимул: куда и чем -- первой строкой, подробности -- второй.
 *
 * Рецептор на второй строке остаётся значком с подсказкой, а не пересказом:
 * что такое `ampa`, сказано в словаре сервера, и повторять это здесь словами
 * значило бы объяснять рецептор в двух местах по-разному. Току рецептор не
 * пишется вовсе -- он идёт в клетку напрямую, мимо синапса.
 */
function DriveRow({
  stim,
  duration,
  glossary,
}: {
  stim: Stimulus
  duration: number
  glossary: Glossary
}) {
  const rest = details(stim, duration)
  const receptor = stim.kind !== 'current'
  return (
    <div className="row pat-fact">
      <span className="pat-fact-head">
        <span className="row-arrow">→</span>
        <span className="mono row-path">{siteText(stim.target)}</span>
        <span>{driveWords(stim)}</span>
      </span>
      {receptor || rest ? (
        <span className="row-dim">
          {receptor ? (
            <>
              через{' '}
              <span className="mono" title={receptorHint(glossary, stim.receptor)}>
                {stim.receptor}
              </span>
              {rest ? ' · ' : ''}
            </>
          ) : null}
          {rest}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Чем бьют -- одной строкой.
 *
 * Протокол словами приходит с сервера (`protocols.describe`): у каждого рода
 * своё число -- шум задаётся средней частотой, ток амплитудой, поезд числом
 * импульсов и частотой, -- и знает об этом реестр родов, а не карточка. Своя
 * сборка этой строки была второй правдой о драйве и уже расходилась: карточка
 * звала пуассоновский шум просто «шумом N Гц», умалчивая, что частота средняя
 * (#508, #553).
 *
 * Вес приписывается здесь: он есть у всех родов, кроме тока, и в словах
 * протокола ему делать нечего -- протокол это про моменты, а не про силу.
 */
function driveWords(stim: Stimulus): string {
  if (stim.kind === 'current') return stim.protocol
  return `${stim.protocol}, вес ${stim.amplitude} нСм`
}

/** Моменты спайков и окно -- вторая строка: длинные, а читают их после рода. */
function details(stim: Stimulus, duration: number): string {
  const said: string[] = []
  // Моменты -- у всех родов, где они есть: и у списка, набранного руками, и у
  // шаблона протокола, который сервер развернул в такой же список (#508).
  // У пуассоновского драйва их нет заранее вовсе, и строка не появляется.
  const moments = momentWords(stim.times)
  if (moments) said.push(moments)
  const window = windowWords(stim, duration)
  if (window) said.push(window)
  return said.join(' · ')
}

/**
 * Окно, если оно уже прогона.
 *
 * Стимул, идущий весь прогон, окна не имеет: `stop` у него -- бесконечность,
 * обрезанная сервером по длительности (`_stimulus` в `api.py`), и написать
 * «по 400 мс» значило бы выдать обрезку за решение автора паттерна.
 */
function windowWords(stim: Stimulus, duration: number): string {
  const late = stim.start > 0
  const early = duration > 0 && stim.stop < duration
  if (late && early) return `с ${stim.start} по ${stim.stop} мс`
  if (late) return `с ${stim.start} мс`
  if (early) return `по ${stim.stop} мс`
  return ''
}
