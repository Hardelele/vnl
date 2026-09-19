/**
 * Песочница: холст, дерево объектов, свойства и то же управление временем.
 *
 * Три представления -- одно состояние. Ответ сервера на любую операцию
 * приходит целиком, поэтому холст, дерево и свойства не могут разойтись: они
 * читают один и тот же объект, а не каждый свой срез.
 *
 * Симуляция здесь такая же, как на карточке паттерна: собранная сеть, живое
 * время, пауза и откат. Отдельного «результата» нет и тут.
 *
 * Без входа песочницы нет: проект -- чужая работа, а не витрина, и сервер
 * закрывает даже чтение. Поэтому сюда не заходят без сессии -- щелчок по
 * вкладке уводит ко входу, -- а если сессия кончилась посреди работы, экран
 * ведёт туда же: человек нажал и ждёт результата, а не приглашения нажать ещё
 * раз (#518).
 */

import { useEffect, useState } from 'react'

import type { PatternDraft, SandboxBlock, SandboxNeuron } from '../../model/sandbox'
import { catalogController, useCatalog } from '../../state/catalog'
import { sandboxController, useSandbox } from '../../state/sandbox'
import { canChange, goToLogin, useSession } from '../../state/session'
import { simController, useSim } from '../../state/sim'
import { Thumbnail } from '../catalog/Thumbnail'
import { Timeline } from '../live/Timeline'
import { Transport } from '../live/Transport'
import { Canvas } from './Canvas'
import { Properties, RunFields, where } from './Properties'
import { SavePattern } from './SavePattern'
import './sandbox.css'

/**
 * Вкладки левой панели.
 *
 * Клетки -- отдельная вкладка, а не раздел внутри библиотеки. Библиотека
 * ищется и фильтруется по ступени разбора и статусу готовности; к клетке ни то
 * ни другое не применимо, и в этих фильтрах она была бы ровно тем смешением,
 * из-за которого одиночные клетки из библиотеки когда-то и убрали.
 */
type LeftTab = 'cells' | 'library' | 'objects'

export function SandboxScreen() {
  const control = sandboxController
  const sim = simController
  const [tab, setTab] = useState<LeftTab>('cells')
  /** Открыта ли форма сохранения. Имя и порты спрашивают до записи. */
  const [saving, setSaving] = useState(false)

  const list = useSandbox((state) => state.list)
  const palette = useSandbox((state) => state.cells)
  const project = useSandbox((state) => state.project)
  const selected = useSandbox((state) => state.selected)
  const pending = useSandbox((state) => state.pending)
  const opened = useSandbox((state) => state.opened)
  const error = useSandbox((state) => state.error)
  const denied = useSandbox((state) => state.denied)
  const savedId = useSandbox((state) => state.saved?.id ?? null)
  const savedName = useSandbox((state) => state.saved?.name ?? null)
  const savedLevel = useSandbox((state) => state.saved?.levelName ?? null)
  /** Идёт запрос к проекту. Имя своё: `busy` ниже -- про симуляцию. */
  const keeping = useSandbox((state) => state.busy)
  const allowed = useSession(canChange)

  const catalog = useCatalog((state) => state.catalog)
  const simState = useSim((state) => state.state)
  const time = useSim((state) => state.time)
  const duration = useSim((state) => state.duration)
  const busy = useSim((state) => state.busy)
  const cells = useSim((state) => state.cells)
  const spikes = useSim((state) => state.spikes)
  const traces = useSim((state) => state.traces)
  const dt = useSim((state) => state.dt)
  const simError = useSim((state) => state.error)
  const simDenied = useSim((state) => state.denied)
  const simId = useSim((state) => state.id)
  const built = useSim((state) => state.built)

  useEffect(() => {
    // Без входа список песочниц запрашивать нечем: сервер откажет. Сюда так и
    // так попадают только с сессией, но она могла кончиться по дороге.
    if (!allowed) {
      goToLogin()
      return
    }
    void control.refreshList()
    void control.refreshCells()
    void catalogController.refresh()
  }, [control, allowed])

  // Отказ по входу в песочнице всегда ответ на чьё-то действие: сюда не
  // заходят просто так. Значит ведём ко входу, а не показываем сообщение и
  // ждём, пока то же самое нажмут второй раз.
  useEffect(() => {
    if (denied || simDenied) goToLogin()
  }, [denied, simDenied])

  // Симуляция принадлежит схеме, а не экрану: другой проект -- другая сеть, и
  // прежняя сессия не должна его переживать. Иначе в пустом проекте под холстом
  // стоит полный прогон предыдущего, а «Запустить» продолжает чужую сеть.
  const openId = project?.id ?? null
  useEffect(() => {
    return () => {
      void sim.close()
    }
  }, [sim, openId])

  // Правка схемы отменяет прежний отказ: «нечего считать» после вставки блока
  // -- уже неверное утверждение, а висит оно рядом с исправленной схемой.
  useEffect(() => {
    if (project) sim.forget()
  }, [sim, project])

  if (!allowed) {
    // Браузер уже уходит на вход; строка стоит на время перехода, чтобы экран
    // не мигнул пустотой.
    return (
      <div className="sb-empty">
        <h1 className="sb-title">Песочница</h1>
        <p className="sb-hint">Открыта после входа — переходим ко входу…</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="sb-empty">
        <h1 className="sb-title">Песочница</h1>
        {error ? <p className="sb-alert">{error}</p> : null}
        <p className="sb-hint">
          Проект — это схема: отдельные клетки из палитры и блоки из библиотеки
          паттернов. Их можно соединять, запускать и сохранять.
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
          onClick={() => void control.create(nextName(list))}
        >
          Новый проект
        </button>
      </div>
    )
  }

  const inhibitory = neuronKinds(project.blocks, project.neurons)
  /** Сессия считает не эту схему: её результат уже про другую сеть. */
  const stale = Boolean(simId && built && built !== project.fingerprint)

  return (
    <div className="sb">
      <header className="sb-bar">
        {/* Список проектов прямо в панели, как в макете: переключаться между
            ними надо чаще, чем открывать заново, а выход к выбору — отдельно,
            иначе из проекта не выйти вовсе. */}
        <select
          className="sb-pick-project"
          value={project.id}
          aria-label="Проект"
          onChange={(event) => void control.open(event.target.value)}
        >
          {rows(list, project).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="sb-icon"
          title="Новый проект"
          onClick={() => void control.create(nextName(list))}
        >
          +
        </button>
        <button
          type="button"
          className="sb-icon"
          title="Закрыть проект и вернуться к списку"
          onClick={() => control.close()}
        >
          ×
        </button>
        <span className="mono sb-run">
          {project.run.duration} мс · dt {project.run.dt} · seed {project.run.seed}
        </span>

        <Transport
          state={simState}
          time={time}
          duration={duration || project.run.duration}
          busy={busy}
          restart={stale}
          onStart={() => void start()}
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
        {/* Отсюда схема попадает в библиотеку -- и только отсюда: второго
            редактора схем нет, а пустой черновик наполнять было нечем (#525). */}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            control.forgetSaved()
            setSaving(true)
          }}
        >
          Сохранить как паттерн
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
      {/* Предупреждения идут той же плашкой и отдельной строкой: запуску они
          не мешают (кнопка остаётся живой), но прогон по ним выйдет пустым, и
          сказать об этом надо до прогона, а не после -- человек иначе ждёт
          результата, получает нули и читает их как поломку инструмента (#506).
          Отдельной кнопки «всё равно запустить» здесь нет: предупреждение --
          не вопрос, а подпись. */}
      {project.warnings.length ? (
        <p className="sb-warn">{project.warnings.join(' · ')}</p>
      ) : null}
      {/* Прежний результат не выбрасывается, но и за результат новой схемы не
          выдаётся: пока его не пересчитали, он подписан прежней схемой (#481). */}
      {stale ? (
        <p className="sb-warn">
          Схема изменилась — на таймлайне прогон прежней. «Запустить» соберёт
          сеть заново.
        </p>
      ) : null}
      {/* Сохранение песочницу не меняет, поэтому без прямого «получилось»
          нельзя понять, случилось ли оно. Имя и ступень -- те, что записаны. */}
      {savedId && savedName ? (
        <p className="sb-warn">
          Паттерн «{savedName}» лежит в библиотеке{savedLevel ? ` — ${savedLevel}` : ''}.
          Он есть во вкладке «Библиотека» слева: его можно вставить сюда же блоком.
        </p>
      ) : null}
      {saving ? (
        <SavePattern
          projectName={project.name}
          hints={project.portHints}
          levels={catalog?.levels ?? []}
          busy={keeping}
          onCancel={() => setSaving(false)}
          onSave={(draft) => void keep(draft)}
        />
      ) : null}
      {pending ? (
        <p className="sb-warn">
          {/* Подсказка одинаково говорит про порт блока и про клетку: у клетки
              порта нет, и «Выбран порт E.null» было бы неправдой. */}
          Начало связи: {where(pending)} — щёлкните по второй точке подключения,
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
              className={`lib-tab${tab === 'cells' ? ' is-on' : ''}`}
              onClick={() => {
                setTab('cells')
                // Каталог пополняют и мимо этого экрана -- `vnl cell add`.
                void control.refreshCells()
              }}
            >
              Клетки
            </button>
            <button
              type="button"
              className={`lib-tab${tab === 'library' ? ' is-on' : ''}`}
              // Библиотеку пополняют и мимо этого экрана -- карточкой паттерна,
              // Claude через MCP. Перечитываем на возврате во вкладку, иначе
              // список остаётся таким, каким был при открытии проекта.
              onClick={() => {
                setTab('library')
                void catalogController.refresh()
              }}
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

          {tab === 'cells' ? (
            <div className="sb-list">
              {/* В строке -- фигура клетки, имя и медиатор. Фигура та же, что
                  на холсте и в миниатюре каталога: класть на схему человек
                  будет именно её, и узнавать её он должен заранее. */}
              {palette.map((cell) => (
                <div className="sb-row" key={cell.id}>
                  <span className="sb-mini sb-cell-shape">
                    <svg viewBox="0 0 40 24" role="img" aria-label={cell.name}>
                      <rect
                        className={`sb-shape${cell.inhibitory ? ' is-inh' : ''}`}
                        x={4}
                        y={5}
                        width={32}
                        height={14}
                        rx={cell.inhibitory ? 3 : 7}
                      />
                    </svg>
                  </span>
                  <span className="sb-row-text">
                    <span className="sb-row-name" title={cell.note || cell.name}>
                      {cell.name}
                    </span>
                    <span className="mono sb-level">
                      {cell.transmitter ?? cell.id}
                      {cell.builtin ? '' : ' · своя'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="sb-plus"
                    title={`Положить на холст: ${cell.note || cell.name}`}
                    onClick={() => void control.insertCell(cell.id)}
                  >
                    +
                  </button>
                </div>
              ))}
              {palette.length === 0 ? (
                <p className="sb-hint">Каталог типов клеток пуст.</p>
              ) : null}
            </div>
          ) : tab === 'library' ? (
            <div className="sb-list">
              {/* Миниатюра та же, что в каталоге, только мельче: по одному
                  имени блок в списке из сорока не выбрать, а вторая реализация
                  «как выглядит схема» разошлась бы с первой незаметно. */}
              {(catalog?.patterns ?? []).map((pattern) => (
                <div className="sb-row" key={pattern.id}>
                  <span className="sb-mini">
                    <Thumbnail scheme={pattern.scheme} label={pattern.name} />
                  </span>
                  <span className="sb-row-text">
                    {/* Имя обрезается: панель узкая, а имена паттернов длинные. */}
                    <span className="sb-row-name" title={pattern.name}>
                      {pattern.name}
                    </span>
                    <span className="mono sb-level">
                      {pattern.level} · {pattern.counts.neurons} кл.
                    </span>
                  </span>
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
              {/* Идентификатор стоит справа, а не в подписи: подпись длинная
                  и обрезается многоточием, а адрес обрезать нельзя -- им блок
                  и его нейроны зовутся в связях (`ffi/I`). Подпись и адрес --
                  разные вещи: подпись правят, адрес нет, за него держатся
                  связи, стимулы и записи. */}
              {project.blocks.map((block) => (
                <Row
                  key={block.id}
                  label={block.label}
                  kind={`блок ${block.id}`}
                  on={selected?.kind === 'block' && selected.id === block.id}
                  onPick={() => control.select({ kind: 'block', id: block.id })}
                />
              ))}
              {/* Клетка в дереве наравне с блоком: она такой же объект холста,
                  и выбрать её здесь надо уметь так же, как блок. */}
              {project.neurons.map((neuron) => (
                <Row
                  key={neuron.id}
                  label={`${neuron.id} · ${neuron.cellType}`}
                  kind="клетка"
                  on={selected?.kind === 'neuron' && selected.id === neuron.id}
                  onPick={() => control.select({ kind: 'neuron', id: neuron.id })}
                />
              ))}
              {project.links.map((link) => (
                <Row
                  key={link.id}
                  label={`${where(link.source)} → ${where(link.target)}`}
                  kind="связь"
                  on={selected?.kind === 'link' && selected.id === link.id}
                  onPick={() => control.select({ kind: 'link', id: link.id })}
                />
              ))}
              {project.stimuli.map((drive) => (
                <Row
                  key={drive.id}
                  label={`${drive.id} → ${where(drive.target)}`}
                  kind="стимул"
                  on={selected?.kind === 'stimulus' && selected.id === drive.id}
                  onPick={() => control.select({ kind: 'stimulus', id: drive.id })}
                />
              ))}
              {project.recordings.map((record) => (
                <Row
                  key={record.id}
                  label={`${record.id} · ${where(record.target)}`}
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
            neurons={project.neurons}
            links={project.links}
            cells={cells}
            selected={selected}
            pending={pending}
            opened={opened}
            onPickBlock={(id) => control.select({ kind: 'block', id })}
            onPickNeuron={(id) => control.select({ kind: 'neuron', id })}
            onPickLink={(id) => control.select({ kind: 'link', id })}
            onPickEndpoint={(instance, port) =>
              void control.touchEndpoint(instance, port)
            }
            onMove={(id, position) => void control.move(id, position)}
            onToggleBlock={(id) => control.toggleBlock(id)}
            onEmpty={() => control.select(null)}
          />
          <Timeline
            duration={duration || project.run.duration}
            time={time}
            dt={dt}
            order={Object.keys(cells)}
            spikes={spikes}
            traces={traces}
            inhibitory={inhibitory}
            onSeek={(moment) => void sim.seek(moment)}
            disabled={!duration}
          />
        </section>

        <aside className="panel sb-right">
          <Properties selection={selected} project={project} cells={cells} />
          <RunFields run={project.run} />
        </aside>
      </div>
    </div>
  )

  /** Сохранить проект паттерном. Форма закрывается только на удачном ответе. */
  async function keep(draft: PatternDraft): Promise<void> {
    if (await control.saveAsPattern(draft)) {
      setSaving(false)
      // Библиотеку слева перечитываем сразу: свежий паттерн должен появиться
      // там, где его вставляют, а не после переключения вкладок.
      void catalogController.refresh()
    }
  }

  async function start(): Promise<void> {
    // Симуляция открывается на первом запуске: собирать сеть до того, как её
    // попросили посчитать, незачем -- схема ещё меняется.
    //
    // А если схему правили после запуска, сессия считает уже не её: время в ней
    // идёт по модели, собранной на открытии, и «Сброс» этого не меняет. Поэтому
    // устаревшая сессия не продолжается, а заменяется новой из текущей схемы.
    const live = simController.store.getState()
    if (!live.id || live.built !== project!.fingerprint) {
      await sim.open({ sandbox: project!.id }, project!.fingerprint)
    }
    await sim.start()
  }
}

/** Имя нового проекта. Одинаковые имена в списке делают его бесполезным. */
function nextName(list: Array<{ name: string }>): string {
  const taken = new Set(list.map((row) => row.name))
  let number = list.length + 1
  while (taken.has(`Проект ${number}`)) number += 1
  return `Проект ${number}`
}

/** Список для выпадающего меню: открытый проект в нём есть всегда. */
function rows(
  list: Array<{ id: string; name: string }>,
  project: { id: string; name: string },
): Array<{ id: string; name: string }> {
  return list.some((row) => row.id === project.id) ? list : [project, ...list]
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

/**
 * Тормозность клеток собранной сети.
 *
 * Имена клеток блока идут с приставкой (`ffi/E`) -- ею разведены нейроны
 * разных экземпляров одного паттерна. У положенной руками клетки приставки
 * нет: она и есть объект схемы, и в сети зовётся своим именем.
 */
function neuronKinds(
  blocks: SandboxBlock[],
  neurons: SandboxNeuron[],
): Record<string, boolean> {
  const kinds: Record<string, boolean> = {}
  for (const block of blocks) {
    for (const neuron of block.scheme.neurons) {
      kinds[`${block.id}/${neuron.id}`] = neuron.inhibitory
    }
  }
  for (const neuron of neurons) {
    kinds[neuron.id] = neuron.inhibitory
  }
  return kinds
}
