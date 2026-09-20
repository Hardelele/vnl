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
 *
 * Менять библиотеку карточка умеет ровно одним действием -- удалить паттерн, -- и
 * без входа этой кнопки нет вовсе. Прежние «Fork» и «В песочницу» стояли здесь
 * погашенными с подписью «появится вместе с песочницей», и это было неправдой:
 * песочница давно есть. Погашенных кнопок здесь нет и не будет; вместо них
 * появилась настоящая дорога -- «В песочницу» (#526).
 *
 * Кнопка стоит на виду и у невошедшего, а не прячется, как «Удалить». Разница
 * не в строгости, а в том, что она делает: «Удалить» меняет библиотеку, и
 * предлагать его тому, кто не может, незачем, -- а «В песочницу» ведёт в место,
 * и спрятать её значило бы скрыть, что песочница вообще есть. Поэтому щелчок
 * без входа уводит ко входу -- ровно как вкладка «Песочница» в панели сверху,
 * -- а не молчит и не открывает окно с вопросом, ответ на который и так один.
 *
 * Кнопки «Fork» здесь нет намеренно, и это не пропуск. Форк значил «правимая
 * копия паттерна», но править тело паттерна негде: редактора схем, кроме
 * песочницы, нет и не будет (#525). После #531 и #532 всё, ради чего форк
 * заводили, уже делается этой же дорогой: блок приезжает снимком, контакты и
 * мембрана правятся прямо в нём, «Разобрать на клетки» распускает его в схему,
 * а «Сохранить как паттерн» кладёт получившееся в библиотеку новой записью.
 * Отдельная кнопка «Fork» на карточке дала бы вместо этого запись, не
 * отличающуюся от оригинала ничем, кроме имени, -- ровно тот пустой черновик,
 * который из библиотеки убрали в #525, -- и завела бы второе место, пишущее в
 * библиотеку мимо песочницы.
 *
 * Выделение на карточке одно на весь экран: клетка или связь. Схема, списки и
 * таймлайн показывают одно и то же выбранное -- щёлкнув по связи на схеме,
 * человек видит подсвеченной ту же строку, и наоборот (#546). Двух выделений
 * сразу нет намеренно: панель сбоку одна, и «выбрана клетка E и связь c3»
 * пришлось бы как-то показывать двумя панелями о разном.
 */

import { useCallback, useEffect, useState } from 'react'

import { LINKS, NEURONS, PORTS, counted } from '../../lib/plural'
import { siteText } from '../../lib/site'
import { deletePattern, isDenied, loadPattern } from '../../model/catalog'
import { NO_GLOSSARY, loadGlossary, receptorHint } from '../../model/glossary'
import type { Contact, Glossary, Neuron, PatternDetail } from '../../model/types'
import {
  SANDBOX_LOCKED,
  canChange,
  goToLogin,
  loginAt,
  useSession,
} from '../../state/session'
import { simController, useSim } from '../../state/sim'
import { LoginHint } from '../shell/Login'
import { DrivePanel, RecordsPanel } from './Demo'
import { LinkInspector } from './LinkInspector'
import { Inspector } from '../live/Inspector'
import { LiveScheme } from '../live/LiveScheme'
import { TIMELINE_HINT, Timeline } from '../live/Timeline'
import { Transport } from '../live/Transport'
import './pattern.css'

export interface PatternScreenProps {
  id: string
  onBack: () => void
  /**
   * Откуда сюда пришли -- подпись первой крошки (#566).
   *
   * Карточку открывают из каталога и из панели «Библиотека» в песочнице, и
   * возврат обязан вести туда же, откуда пришли: «Библиотека» в крошках,
   * уводящая в каталог того, кто пришёл из проекта, -- это потерянное место
   * работы, а не навигация. Подпись приходит снаружи, потому что называть
   * экраны -- дело оболочки: она же пишет их на вкладках, и вторая таблица
   * имён разошлась бы с первой.
   */
  backLabel?: string
  /** Унести этот паттерн в песочницу (#526). Экраны переключает оболочка. */
  onToSandbox: () => void
}

export function PatternScreen({
  id,
  onBack,
  backLabel = 'Библиотека',
  onToSandbox,
}: PatternScreenProps) {
  const [pattern, setPattern] = useState<PatternDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Отказ был «нужен вход»: он поправим входом, а не повторным открытием. */
  const [denied, setDenied] = useState(false)
  const [engine, setEngine] = useState<'elk' | 'builtin'>('builtin')
  /** Что выбрано: клетка или связь. Общее для схемы, таймлайна и списков. */
  const [picked, setPicked] = useState<Picked>(null)
  /**
   * Расшифровка подписей с сервера (#541). Пустая -- карточка работает как
   * работала: подсказка объясняет, а не показывает, и ждать её незачем.
   */
  const [glossary, setGlossary] = useState<Glossary>(NO_GLOSSARY)
  /** Спросили ли про удаление. Действие необратимо, поэтому в два шага. */
  const [dropping, setDropping] = useState(false)
  const [busyDrop, setBusyDrop] = useState(false)
  const remember = useCallback((chosen: 'elk' | 'builtin') => setEngine(chosen), [])
  const pickNeuron = useCallback((id: string) => setPicked({ kind: 'neuron', id }), [])
  const pickLink = useCallback((id: string) => setPicked({ kind: 'link', id }), [])

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
  const allowed = useSession(canChange)

  useEffect(() => {
    let alive = true
    // Словарь -- реестр, одинаковый на любой машине: спрашивается один раз за
    // открытие карточки и не зависит от того, какой паттерн открыт.
    loadGlossary()
      .then((loaded) => alive && setGlossary(loaded))
      // Без расшифровки карточка показывает то же самое, только без подсказок:
      // ругаться на её отсутствие значило бы пугать отказом там, где ничего не
      // потеряно.
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    setPicked(null)
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
        <Crumbs onBack={onBack} label={backLabel} />
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
        <Crumbs onBack={onBack} label={backLabel} />
        <p className="pat-hint">Читаем паттерн…</p>
      </div>
    )
  }

  // Выбранное распускается на две величины: схеме и таймлайну нужна клетка,
  // спискам -- ещё и связь. Держать их двумя состояниями значило бы уметь
  // выбрать обе сразу.
  const neuron = picked?.kind === 'neuron' ? picked.id : null
  const contact =
    picked?.kind === 'link'
      ? (pattern.body.contacts.find((item) => item.id === picked.id) ?? null)
      : null

  const meta = [
    counted(pattern.counts.neurons, NEURONS),
    counted(pattern.counts.contacts, LINKS),
    counted(pattern.counts.ports, PORTS),
  ].join(' · ')

  return (
    <div className="pat">
      <Crumbs onBack={onBack} label={backLabel} level={pattern.level} name={pattern.name} />

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
          {/* Дорога в песочницу. Блок едет туда не один: вместе с ним ложатся
              драйв и записи этой самой карточки, настоящими объектами проекта
              (#526). Иначе переход был бы полупустым -- та же схема, но
              молчащая, и всё, что показано ниже, человеку пришлось бы завести
              заново руками.

              Вставка из панели «Библиотека» по-прежнему кладёт молчащий блок:
              там просьба другая -- «дай кусок схемы в мою сеть», -- и чужой
              драйв в ней спорил бы с собственным входом. Разбор в
              `patterns.adopt_demo`. */}
          <button
            type="button"
            className="btn-secondary"
            title={
              allowed
                ? 'Положить блоком в проект песочницы — вместе с драйвом и записями карточки'
                : SANDBOX_LOCKED
            }
            onClick={() => {
              // Закрытое действие ведёт ко входу сразу, как и вкладка
              // «Песочница»: спрашивать «войти?» -- лишний шаг там, где ответ
              // и так один (#518).
              if (!allowed) {
                goToLogin()
                return
              }
              onToSandbox()
            }}
          >
            В песочницу
          </button>
          {/* Удаление -- единственное действие карточки, которое меняет
              библиотеку, и без входа его тут нет вовсе: так же, как в каталоге
              нет кнопки, которая вместо своей работы предлагает войти. */}
          {allowed ? (
            dropping ? (
              <>
                <span className="pat-ask">Удалить «{pattern.name}» насовсем?</span>
                <button
                  type="button"
                  className="btn-secondary pat-drop"
                  disabled={busyDrop}
                  onClick={() => void drop()}
                >
                  Удалить
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setDropping(false)}
                >
                  Отмена
                </button>
              </>
            ) : (
              // Спрашиваем на месте, а не окном поверх экрана: действие
              // необратимо, но и уводить внимание с карточки незачем.
              <button
                type="button"
                className="btn-secondary pat-drop"
                onClick={() => setDropping(true)}
              >
                Удалить
              </button>
            )
          ) : null}
          <Transport
            state={state}
            time={time}
            duration={duration || (pattern.demo?.run.duration ?? 0)}
            busy={busy}
            onStart={() => void act(() => control.start())}
            onPause={() => void act(() => control.pause())}
            onReset={() => void act(() => control.reset())}
            onStep={(delta) => void act(() => control.step(delta))}
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
        {/* Левая колонка -- одна ячейка сетки на схему и активность вместе, а
            не две соседние (#552). Порознь они попадали бы в разные ряды, а
            высоту ряда задаёт самая высокая ячейка -- правая колонка со
            списками: между схемой и растром вставало бы полтысячи пустых
            пикселей, и вместе они на экран уже не помещались. Обёртка делает
            левую колонку столбиком, который о высоте соседа ничего не знает. */}
        <div className="pat-main">
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
                onPick={pickNeuron}
                selectedLink={contact?.id ?? null}
                onPickLink={pickLink}
              />
            </div>
          </section>

          {/* Активность сети -- своей панелью под схемой, в той же колонке (#552).

              Раньше она стояла внутри карточки схемы и получала ширину левой
              колонки: 670 пикселей на окне 1600, из которых 176 отдано колонке
              имён, -- 494 на сами дорожки. На такой ширине растр перестаёт быть
              растром: разряды соседних клеток сливаются в одну полосу, а прогон,
              ради которого карточку и открыли, читается вдвое хуже, чем та же
              сеть в песочнице. Ширину дала не эта перестановка, а колонка: она
              стала широкой, а списки справа -- уже (360 вместо 448).

              Разобранная альтернатива -- вынести активность вниз во всю ширину
              карточки, под обе колонки. Ширины она даёт столько же (1136 против
              1120 на окне 1600), но растр уезжает под правую колонку: та вчетверо
              выше схемы, и между ними встаёт 535 пикселей пустоты -- померено. На
              экран вместе они уже не помещаются, а смотрят их вместе.

              Вторая альтернатива -- та же тянущаяся граница, что в песочнице, и
              пусть человек решает сам. Отвергнута по причине из самой задачи:
              `ActivityPanel` писалась под оконный каркас песочницы (высота в
              окно, страница не скроллится), а карточка осталась обычной
              страницей (#504), и та же граница на скроллящейся странице вела бы
              себя иначе при том же виде.

              Свой заголовок появился ровно потому, что активность стала панелью:
              внутри карточки схемы его давал `panel-head` соседа по рамке, а
              теперь рамка своя. Строка про жесты та же, что в песочнице. */}
          <section className="panel pat-activity">
            <div className="panel-head">
              <span className="panel-title">Активность сети</span>
              <span className="mono panel-note" title={TIMELINE_HINT}>
                {TIMELINE_HINT}
              </span>
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
              onSelect={pickNeuron}
            />
          </section>
        </div>

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

          {contact ? (
            <div className="panel">
              <LinkInspector contact={contact} glossary={glossary} />
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
                onPick={() => pickNeuron(item.id)}
              />
            ))}
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Связи</span>
              <span className="mono panel-note">
                {contact ? 'выбрана ' + contact.id : 'выберите связь'}
              </span>
            </div>
            {pattern.body.contacts.map((item) => (
              <LinkRow
                key={item.id}
                contact={item}
                glossary={glossary}
                on={item.id === contact?.id}
                onPick={() => pickLink(item.id)}
              />
            ))}
          </div>

          {/* Драйв и записи -- рядом со связями и портами: это такая же часть
              устройства паттерна, как они, и спрашивают о ней там же. */}
          <DrivePanel demo={pattern.demo} glossary={glossary} />
          <RecordsPanel demo={pattern.demo} glossary={glossary} />

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Порты</span>
            </div>
            {pattern.ports.map((port) => (
              <div className="row" key={port.name}>
                <span className="row-id">{port.name}</span>
                <span className="mono row-dim" title={glossary.port[port.direction]}>
                  {port.direction} · {siteText(port.site)}
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

  /**
   * Удалить паттерн и уйти в библиотеку.
   *
   * Обратно на карточку возвращаться некуда: паттерна больше нет, а экран,
   * который показывает удалённое, врёт. Каталог перечитается сам при открытии.
   */
  async function drop(): Promise<void> {
    setBusyDrop(true)
    try {
      await deletePattern(id)
      onBack()
    } catch (reason) {
      const failure = reason as Error
      setBusyDrop(false)
      setDropping(false)
      // Отказ по входу -- это кончившаяся сессия: человек нажал и ждёт
      // результата, а не приглашения нажать то же самое второй раз.
      if (isDenied(failure)) {
        goToLogin()
        return
      }
      setError(failure.message)
    }
  }
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
  label,
  level,
  name,
}: {
  onBack: () => void
  /** Имя того места, откуда пришли: каталог или песочница (#566). */
  label: string
  level?: string
  name?: string
}) {
  return (
    <nav className="pat-crumbs" aria-label="Где мы">
      <button type="button" className="pat-back" onClick={onBack}>
        {label}
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

/**
 * Строка связи в списке -- и способ её выбрать.
 *
 * Кнопка, как и строка клетки: раньше это был `div`, по которому нельзя было
 * щёлкнуть, хотя рядом, в том же столбце, строки клеток выбирались (#546).
 * Рецептор стоит первым из трёх чисел, потому что он и решает, что связь
 * делает: вес и задержка говорят «сколько» и «когда», а `gaba_a` -- «гасит».
 */
function LinkRow({
  contact,
  glossary,
  on,
  onPick,
}: {
  contact: Contact
  glossary: Glossary
  on: boolean
  onPick: () => void
}) {
  const arrow = contact.inhibitory ? '⊣' : '→'
  return (
    <button type="button" className={`row row-pick${on ? ' is-on' : ''}`} onClick={onPick}>
      <span className={`row-arrow${contact.inhibitory ? ' is-inh' : ''}`}>{arrow}</span>
      <span className="mono row-path">
        {contact.pre.instance} {arrow} {siteText(contact.post)}
      </span>
      <span className="mono row-dim row-end">
        <span title={receptorHint(glossary, contact.receptor)}>{contact.receptor}</span> ·{' '}
        {contact.weight} нСм · {contact.delay} мс
      </span>
    </button>
  )
}

/**
 * Что выбрано на карточке. Один выбор на экран: панель сбоку одна, и показать
 * «клетку E и связь c3» одновременно ей нечем.
 */
type Picked = { kind: 'neuron'; id: string } | { kind: 'link'; id: string } | null
