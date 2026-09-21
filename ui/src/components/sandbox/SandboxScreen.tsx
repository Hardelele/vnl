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
 *
 * Сюда приходят и с карточки паттерна (#526), неся её паттерн в `bring`.
 * Проект под него экран не выбирает молча: если ни один не открыт, показывает
 * обычный выбор с припиской, куда ляжет блок, и кладёт его сразу после того,
 * как проект открыли или завели. Угадывать за человека, в какую из его схем
 * добавить чужой блок, нельзя -- это правка чужой работы; а вот положить в ту,
 * которую он сам только что открыл, -- ровно то, о чём он попросил щелчком.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { historyCommand, objectCommand } from '../../lib/keys'
import { CELLS, counted } from '../../lib/plural'
import type { CellDraft } from '../../model/cells'
import { driveHint, receptorHint } from '../../model/glossary'
import { where } from '../../model/sandbox'
import type { PatternDraft, SandboxBlock, SandboxNeuron } from '../../model/sandbox'
import type { CellState } from '../../model/sim'
import type { Glossary } from '../../model/types'
import { useButtons } from '../../state/board'
import { catalogController, useCatalog } from '../../state/catalog'
import { sandboxController, useSandbox } from '../../state/sandbox'
import { canChange, goToLogin, useSession } from '../../state/session'
import { simController, useSim } from '../../state/sim'
import { Timeline } from '../live/Timeline'
import { Transport } from '../live/Transport'
import { ActivityPanel } from './ActivityPanel'
import { ButtonBoard } from './ButtonBoard'
import { FieldRow } from './FieldRow'
import { arrangement } from './arrange'
import { Canvas } from './Canvas'
import { LibraryRow } from './LibraryRow'
import { CellToCatalog } from './CellToCatalog'
import { ProjectBar } from './ProjectBar'
import { Properties } from './Properties'
import { RunSettings } from './RunSettings'
import { SavePattern } from './SavePattern'
import './sandbox.css'

/**
 * Вкладки левой панели.
 *
 * Клетки -- отдельная вкладка, а не раздел внутри библиотеки. Библиотека
 * ищется и фильтруется по ступени разбора и статусу готовности; к клетке ни то
 * ни другое не применимо, и в этих фильтрах она была бы ровно тем смешением,
 * из-за которого одиночные клетки из библиотеки когда-то и убрали.
 *
 * `outside` -- «Внешнее» (#575): сенсоры и моторы. До этого сенсор лежал
 * разделом внутри палитры клеток, а мотор заводился из свойств выбранной
 * клетки, -- две сущности, которые не клетки и не паттерны, жили по углам
 * двух разных мест. Два места для одного и есть та болезнь, из-за которой
 * панель свойств стала свалкой (#569).
 *
 * Имя вкладки -- «Внешнее», а не «Сенсоры-моторы». Владелец предложил оба и
 * говорит об этом разделе как о наборе готовых внешних штук, которые
 * подключают к сети, -- «по аналогии с фильтрами и масками в блендере», то
 * есть сенсором и мотором дело не кончится. Вкладка, названная двумя своими
 * нынешними жителями, третьего жителя не пустит, не переименовавшись; а
 * переименованная вкладка -- это место, которое человек однажды не нашёл.
 * «Внешнее» же говорит ровно то, что их объединяет: это не части схемы, это
 * её связи с тем, что снаружи. Заодно оно короткое, а вкладок теперь четыре
 * на панель шириной 238 px.
 */
type LeftTab = 'cells' | 'library' | 'objects' | 'outside'

export interface SandboxScreenProps {
  /** Паттерн, принесённый с карточки: его надо положить блоком с витриной. */
  bring?: string | null
  /** Положили -- просьба исполнена, и повторять её при следующем кадре незачем. */
  onBrought?: () => void
  /**
   * Открыть карточку паттерна (#566).
   *
   * Экраны переключает оболочка -- она одна знает, что такое «экран», -- а
   * песочница только называет паттерн. Ровно так же устроена дорога в
   * обратную сторону (#526): карточка не вставляет блок сама, а говорит
   * оболочке, что несёт.
   */
  onOpenPattern?: (id: string) => void
  /**
   * С какой вкладки левой панели открыться.
   *
   * Нужна ровно на возврат с карточки: человек ушёл туда из панели
   * «Библиотека» и возвращается в неё же, а не на «Клетки», с которых экран
   * начинается обычно. Начальное значение, а не управляемое: дальше вкладку
   * выбирает человек, и отбирать у него этот выбор после каждой перерисовки
   * было бы хуже, чем не угадывать вовсе.
   */
  startTab?: LeftTab
}

export function SandboxScreen({
  bring = null,
  onBrought,
  onOpenPattern,
  startTab,
}: SandboxScreenProps) {
  const control = sandboxController
  const sim = simController
  const [tab, setTab] = useState<LeftTab>(startTab ?? 'cells')
  /** Открыта ли форма сохранения. Имя и порты спрашивают до записи. */
  const [saving, setSaving] = useState(false)
  /**
   * Какой тип проекта кладут в каталог, если кладут (#567).
   *
   * Идентификатор, а не флажок: форма спрашивает про конкретную клетку и
   * показывает, что под её именем уже лежит в каталоге. Состояние экрана, а
   * не проекта -- в проекте от этой операции не меняется ничего.
   */
  const [adopting, setAdopting] = useState<string | null>(null)
  /**
   * Что приехало с карточки -- строкой для человека (#526).
   *
   * Состояние экрана, а не проекта: после вставки проект выглядит так же, как
   * если бы драйв завели руками, и по нему не видно, что он приехал сам.
   * Панель объектов лежит на другой вкладке, поэтому без этой строки человек
   * узнал бы о витрине только случайно.
   */
  const [brought, setBrought] = useState<string | null>(null)
  /** Уже несомое: чтобы вставка не повторилась на следующей перерисовке. */
  const carried = useRef<string | null>(null)
  /**
   * Какую дверь только что положили -- ради одной строки про следующий шаг
   * (#573).
   *
   * Заведя сенсор, человек не узнаёт, что теперь можно завести кнопку: на
   * холсте появилась фигура, и на этом рассказ кончался. Следующий шаг не
   * очевиден -- и хуже того, кнопка без запущенного прогона выглядит
   * выключенной, то есть первый же шаг выглядит неудачей.
   *
   * Состояние экрана, а не проекта: в проекте от этого не меняется ничего, и
   * после перезагрузки страницы сенсор выглядит ровно так же, как заведённый
   * неделю назад.
   */
  const [doorPut, setDoorPut] = useState<string | null>(null)
  /**
   * Выдвинута ли левая панель. Значение имеет смысл только на тесном окне: там
   * панель -- ящик поверх экрана, потому что колонкой она не получает высоты и
   * список перестаёт быть списком (#550, разбор в `sandbox.css`). На просторном
   * окне панель стоит колонкой всегда, и флаг на неё не влияет -- ящик включает
   * не React, а медиазапрос: раскладку решает размер окна, а не состояние
   * компонента, иначе после поворота экрана панель осталась бы спрятанной.
   */
  const [picker, setPicker] = useState(false)
  /** Кнопка вызова и сам ящик: нужны, чтобы передавать им фокус, см. ниже. */
  const opener = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLElement>(null)

  const list = useSandbox((state) => state.list)
  const palette = useSandbox((state) => state.cells)
  /** Расшифровка подписей: рецепторы, мембрана, контакт, порты (#541). */
  const glossary = useSandbox((state) => state.glossary)
  const project = useSandbox((state) => state.project)
  const selected = useSandbox((state) => state.selected)
  const pending = useSandbox((state) => state.pending)
  const opened = useSandbox((state) => state.opened)
  /** Куда смотрит холст. Показ, а не схема: на сервер не уходит (#545). */
  const canvasView = useSandbox((state) => state.view)
  const error = useSandbox((state) => state.error)
  const denied = useSandbox((state) => state.denied)
  const savedId = useSandbox((state) => state.saved?.id ?? null)
  const savedName = useSandbox((state) => state.saved?.name ?? null)
  const savedLevel = useSandbox((state) => state.saved?.levelName ?? null)
  /** Что легло в каталог последним (#567): в проекте этого не видно. */
  const adoptedId = useSandbox((state) => state.adopted?.id ?? null)
  const adoptedName = useSandbox((state) => state.adopted?.name ?? null)
  /** Идёт запрос к проекту. Имя своё: `busy` ниже -- про симуляцию. */
  const keeping = useSandbox((state) => state.busy)
  const allowed = useSession(canChange)

  const catalog = useCatalog((state) => state.catalog)
  const simState = useSim((state) => state.state)
  const time = useSim((state) => state.time)
  const duration = useSim((state) => state.duration)
  const busy = useSim((state) => state.busy)
  const cells = useSim((state) => state.cells)
  /** Граница с миром на текущем моменте: по ней горят кнопки (#562). */
  const sensed = useSim((state) => state.sensors)
  const acted = useSim((state) => state.motors)
  /** Кадры полей: приходят не с каждым ответом, а по требованию (#581). */
  const frames = useSim((state) => state.frames)
  /**
   * Кнопкам -- только те двери, у которых величина одна (#581).
   *
   * На поле кнопку не повесишь: её бит лёг бы в первый пиксель из 576, и
   * сервер такую подачу отвергает. Отбор здесь, а не в панели кнопок: панель
   * про поля не знает и знать не должна -- она про пальцы и лампочки.
   */
  /**
   * Слои для таймлайна и клетки, которые в слои не входят (#583).
   *
   * Дорожка на клетку хороша, пока клеток пять; у слоя их 576, и список
   * дорожек превращается в стену, за которой не видно сумматора. Слой идёт
   * своей дорожкой, а его клетки из общего списка уходят.
   */
  const layerLanes = useMemo(
    () =>
      (project?.populations ?? []).map((item) => ({
        id: item.id,
        // Имя без приставки блока: она у всех дорожек блока общая и стоит
        // второй строкой, как у клеток (`ffi/E`).
        label: `${item.id.split('/').pop() ?? item.id} ${item.grid[0]}×${item.grid[1]}`,
        members: item.members,
      })),
    [project?.populations],
  )

  const loose = useMemo(() => {
    const inside = new Set(
      (project?.populations ?? []).flatMap((item) => item.members),
    )
    return Object.keys(cells).filter((name) => !inside.has(name))
  }, [cells, project?.populations])

  const pressed = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [name, value] of Object.entries(sensed)) {
      if (typeof value === 'number') out[name] = value
    }
    return out
  }, [sensed])
  const spikes = useSim((state) => state.spikes)
  const traces = useSim((state) => state.traces)
  const dt = useSim((state) => state.dt)
  const simError = useSim((state) => state.error)
  const simDenied = useSim((state) => state.denied)
  const simId = useSim((state) => state.id)
  const built = useSim((state) => state.built)

  // Поле появилось в проекте (вставили «Сетчатку», открыли проект заново), а
  // сессия могла идти и раньше: на поле уже что-то держится, и панель обязана
  // показать это, а не пустую сетку до первого показа.
  useEffect(() => {
    if (simId && project?.fields?.length) void sim.look()
    // Спрашивается при смене сессии и появлении полей, а не на каждом кадре:
    // кадр меняется только тогда, когда его сменили.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simId, project?.fields?.length])

  useEffect(() => {
    // Без входа список песочниц запрашивать нечем: сервер откажет. Сюда так и
    // так попадают только с сессией, но она могла кончиться по дороге.
    if (!allowed) {
      goToLogin()
      return
    }
    void control.refreshList()
    void control.refreshCells()
    // Реестр, а не состояние проекта: спрашивается один раз на открытие
    // экрана и не перечитывается ни на правке схемы, ни на смене вкладки.
    void control.refreshGlossary()
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
  /**
   * Кнопки проекта: нужны ровно затем, чтобы совет «заведите кнопку» исчез,
   * когда ему последовали (#573). Советовать сделанное -- это шум, и хуже
   * того, шум, который человек уже выполнил.
   */
  const buttons = useButtons(openId ?? '')
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

  // Строка про приехавшее с карточки принадлежит тому проекту, в который оно
  // приехало: в соседнем она говорила бы про чужой блок.
  useEffect(() => setBrought(null), [openId])

  // То же и про совет завести кнопку: он про дверь этого проекта.
  useEffect(() => setDoorPut(null), [openId])

  /**
   * Паттерн, принесённый с карточки (#526).
   *
   * Кладётся в открытый проект -- в тот, который человек открыл сам. Пока ни
   * одного не открыто, ничего не происходит: экран показывает обычный выбор
   * проекта с припиской, куда ляжет блок, а этот же эффект сработает, как
   * только проект появится. Выбрать проект за человека нельзя -- это правка
   * чужой работы; завести новый молча тоже: в списке и так копятся «Проект 2»,
   * «Проект 3», которые никто не просил.
   *
   * `carried` сторожит повтор: ответом на вставку приходит новое состояние
   * проекта, эффект просыпается второй раз, и без сторожа блок лёг бы дважды.
   * Просьба гасится в любом случае -- и на отказе тоже: про отказ на экране
   * уже написано, а несомое, которое никогда не долетит, висело бы вечно.
   */
  useEffect(() => {
    if (!bring) {
      carried.current = null
      return
    }
    if (!project || carried.current === bring) return
    carried.current = bring
    const wasStimuli = project.stimuli.length
    const wasRecordings = project.recordings.length
    void (async () => {
      await control.bring(bring)
      const after = control.store.getState().project
      const block = after?.blocks[after.blocks.length - 1]
      if (after && block) {
        setBrought(
          arrival(
            block.label,
            after.stimuli.length - wasStimuli,
            after.recordings.length - wasRecordings,
            after.run.duration,
            after.run.seed,
          ),
        )
        // Сразу на «Объекты»: приехало не только то, что видно на холсте, и
        // стимул с записями лежат именно здесь.
        setTab('objects')
      }
      onBrought?.()
    })()
  }, [bring, project, control, onBrought])

  // Esc закрывает выдвинутую панель. Ящик перекрывает и холст, и панель
  // песочницы вместе с кнопкой, которой его вызвали, поэтому выходов из него
  // три: щелчок мимо, Esc и сам выбор. Одного щелчка мимо мало -- с клавиатуры
  // мимо не щёлкнешь.
  //
  // Вместе с Esc сюда же и фокус: ящик приходит поверх панели песочницы, и
  // фокус, оставшийся на кнопке вызова, оказался бы под подложкой -- Tab пошёл
  // бы по невидимым кнопкам панели и добрался бы до списка через десяток
  // нажатий. Поэтому на открытии фокус уходит на первую вкладку ящика, а на
  // закрытии возвращается туда, откуда его позвали.
  useEffect(() => {
    if (!picker) return
    drawer.current?.querySelector('button')?.focus()
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPicker(false)
        opener.current?.focus()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [picker])

  /**
   * Клавиши над выбранным объектом: `Delete` убирает, Ctrl+D дублирует (#563).
   *
   * Слушатель здесь, а не на холсте, хотя жалоба была именно про холст.
   * Выбирают не только там: та же клетка выбирается строкой в дереве
   * объектов, а стимул и запись выбираются только в нём, -- и клавиша обязана
   * работать над выбранным, откуда бы его ни выбрали. Холст, знающий про
   * выделение лишь то, что ему передали сверху, второй такой же обработчик
   * держал бы для половины случаев.
   *
   * Подтверждения нет намеренно: «Отменить» одношаговое и возвращает объект
   * вместе со всем, что на нём висело, -- вопрос «точно?» стоил бы нажатия на
   * каждое удаление ради того, что и так отменяется одним.
   *
   * Какая клавиша что значит, решает `lib/keys`: правила там не механические
   * (раскладка, Backspace вместо Delete, что дублируется, а что нет), и
   * проверять их прямо честнее, чем через отрисованный экран. Здесь остаётся
   * только исполнить решённое.
   */
  /**
   * `Ctrl+Z` и `Ctrl+Shift+Z` (он же `Ctrl+Y`): шаг назад и шаг вперёд (#570).
   *
   * Тем же устройством, что клавиши над объектом: слушатель на окне, разбор в
   * `lib/keys`. Отдельным эффектом, а не веткой в соседнем, потому что и
   * условия у них разные -- клавиша истории работает и тогда, когда не выбрано
   * ничего, а `Delete` без выбранного объекта делать нечего.
   *
   * «Нечего отменять» ничего не делает молча -- ровно как погашенная кнопка:
   * сообщение на клавишу, нажатую по привычке, было бы шумом.
   */
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      // Пока открыта форма сохранения, экран занят ею: откатывать из-под неё
      // то, что она как раз собирается записать, -- не то, о чём просят.
      if (saving) return
      const command = historyCommand(event)
      if (!command) return
      // Иначе Ctrl+Z уйдёт браузеру: на странице есть поля ввода, и он
      // отменил бы правку в последнем из них.
      event.preventDefault()
      void (command === 'undo' ? control.undo() : control.redo())
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [control, saving])

  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      // Пока открыта форма сохранения, экран занят ею: удалять из-под неё то,
      // что она как раз собирается записать, -- не то, о чём просят.
      if (saving) return
      const chosen = control.store.getState().selected
      const command = objectCommand(event, chosen?.kind ?? null)
      if (!command || !chosen) return
      // Иначе Backspace уводит страницу назад по истории браузера, а Ctrl+D
      // открывает «добавить в закладки».
      event.preventDefault()
      void (command === 'remove'
        ? control.remove(chosen.id)
        : control.duplicate(chosen.id))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [control, saving])

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
        {/* Паттерн уже в пути, но куда его класть -- решает человек: выбрать
            за него проект значило бы править чужую работу, а завести новый
            молча -- насорить в списке проектами, которых никто не просил. */}
        {bring ? (
          <p className="sb-warn">
            Паттерн с карточки ляжет в тот проект, который вы откроете, — вместе
            с драйвом и записями карточки. Выберите проект или заведите новый.
          </p>
        ) : null}
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

  /**
   * Выбор в левой панели: само действие и уход ящика следом.
   *
   * Ящик закрывается на любом выборе -- и на вставке клетки или паттерна, и на
   * выборе объекта: всё это «взял одно и смотрю, что вышло», а результат
   * (холст, свойства выбранного) лежит ровно под ящиком. Оставлять его
   * открытым значило бы прятать то, ради чего в него ходили. Вставить подряд
   * два паттерна при этом можно -- ящик вызывается одной кнопкой, и это
   * дешевле, чем каждый раз закрывать его руками.
   *
   * На просторном окне `setPicker` не меняет ничего: там панель -- колонка.
   */
  const pick = (act: () => void): void => {
    act()
    if (!picker) return
    setPicker(false)
    opener.current?.focus()
  }

  /**
   * Положить дверь и сказать, что делать дальше (#573).
   *
   * Заведение и совет -- одно действие, а не два: совет относится к той двери,
   * которая только что появилась, и берётся он из ответа сервера (имя двери
   * выбирает он). Отдельной кнопки «а теперь кнопку» здесь нет нарочно --
   * заводят её в свойствах этой двери, куда человек и так попал: свежая дверь
   * сразу выбрана.
   */
  const putDoor = async (put: () => Promise<void>, kind: 'sensor' | 'motor'): Promise<void> => {
    await put()
    const fresh = control.store.getState().selected
    if (fresh?.kind === kind) setDoorPut(fresh.id)
  }

  const inhibitory = neuronKinds(project.blocks, project.neurons)
  /** Типы проекта, которых каталог не знает: `target`, `pyr_l5` (#564). */
  const known = new Set(palette.map((kind) => kind.id))
  const own = project.cellTypes.filter((kind) => !known.has(kind.type))
  /** Сессия считает не эту схему: её результат уже про другую сеть. */
  const stale = Boolean(simId && built && built !== project.fingerprint)
  /**
   * На какую клетку положить мотор: выбранную, если выбрана клетка (#571).
   *
   * Клетка, а не любой выбранный объект: мотор читает разряды, а разряды есть
   * у клетки. У блока их несколько, и «мотор на блок» был бы адресом, которого
   * не существует, -- ровно тем же, чем был бы «драйв на блок».
   */
  const chosenNeuron = selected?.kind === 'neuron' ? selected.id : null

  return (
    <div className="sb">
      <header className="sb-bar">
        {/* Вызов левой панели. Видна только на тесном окне, где панель --
            ящик: на просторном она колонка, и кнопка спрятана стилями, а не
            условием здесь. Разметка на обеих раскладках одна и та же, иначе
            при смене размера окна панель пересоздавалась бы и теряла вкладку
            и прокрутку списка. */}
        <button
          ref={opener}
          type="button"
          className="sb-icon sb-open-left"
          aria-expanded={picker}
          aria-controls="sb-left"
          title="Клетки, библиотека, объекты"
          onClick={() => setPicker(true)}
        >
          ☰
        </button>
        {/* Проектная часть -- одним местом и первой в полосе (#569): какой
            проект открыт, как он зовётся, переключиться, завести новый,
            закрыть. Разбор, почему меню, а не список с «+» и «×», -- в самом
            `ProjectBar`.

            Числа прогона отсюда ушли вниз, к управлению временем: они
            настройки того же прогона, что и кнопки под дорожками, а в полосе
            стояли подписью, которую нельзя тронуть. */}
        <ProjectBar
          id={project.id}
          name={project.name}
          list={rows(list, project)}
          onRename={(name) => void control.renameProject(name)}
          onOpen={(id) => void control.open(id)}
          onCreate={() => void control.create(nextName(list))}
          onClose={() => control.close()}
        />
        {/* Отмена и возврат -- парой и рядом с проектной частью (#570).
            Парой, потому что форма и есть объяснение: одинокая «Отменить»
            рядом с «Сохранить» читалась как «отменить все правки», то есть
            «вернуть как было при открытии», -- а делала шаг истории. Две
            стрелки друг за другом говорят «история» прежде всякой подписи.

            Слева сверху -- там, где их держат все редакторы; владелец так и
            сказал: «добавил бы сверху кнопочки назад-вперёд, там, где обычно
            это у всяких редакторов располагается».

            Подсказка называет само действие («Отменить: разобран ffi»):
            подпись шага приходит с сервера вместе с состоянием, и второго
            места, где написано, что сейчас отменится, нет. */}
        <div className="sb-history">
          <button
            type="button"
            className="sb-icon"
            disabled={keeping || !project.canUndo}
            aria-label="Отменить"
            title={undoTitle(project.canUndo, project.undoLabel)}
            onClick={() => void control.undo()}
          >
            ↶
          </button>
          <button
            type="button"
            className="sb-icon"
            disabled={keeping || !project.canRedo}
            aria-label="Вернуть"
            title={redoTitle(project.canRedo, project.redoLabel)}
            onClick={() => void control.redo()}
          >
            ↷
          </button>
        </div>
        <span className="sb-bar-gap" />

        {/* Раскладка -- по требованию, а не на каждую вставку: человек
            расставил объекты по смыслу, и новая клетка, перетасовавшая бы всю
            схему, отняла бы у него эту работу (#543). Места считает холст: он
            один знает размеры фигур и то, какие блоки сейчас раскрыты. */}
        <button
          type="button"
          className="btn-secondary"
          disabled={keeping || (!project.blocks.length && !project.neurons.length)}
          title="Расставить объекты по слоям"
          onClick={() =>
            void control.arrange(() =>
              arrangement(
                project.blocks,
                project.neurons,
                project.links,
                opened,
                project.sensors,
                project.motors,
              ),
            )
          }
        >
          Разложить
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!project.dirty}
          onClick={() => void control.save()}
        >
          Сохранить
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

      {/* Сообщения и формы -- своей полосой, а не в общем потоке экрана: экран
          песочницы высотой ровно в окно и целиком не скроллится, поэтому
          длинная форма сохранения должна прокручиваться внутри себя, а не
          выдавливать холст с таймлайном за край (#504). */}
      <div className="sb-notes">
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
      {/* Что приехало с карточки. Стоит здесь же, где «паттерн лежит в
          библиотеке»: обе строки про то, чего на холсте не видно (#526). */}
      {brought ? <p className="sb-warn">{brought}</p> : null}
      {/* Следующий шаг после двери (#573). Исчезает, как только к этой двери
          привязана кнопка: совет, которому последовали, -- это уже шум. */}
      {doorPut &&
      !buttons.some((one) => one.sensor === doorPut || one.motor === doorPut) ? (
        <p className="sb-warn">
          Дверь <span className="mono">{doorPut}</span> в схеме. Трогают её
          снаружи кнопкой: заведите её в свойствах справа («Сделать кнопку») или
          знаком «+» в полосе кнопок под холстом. Нажатие подаётся в прогон,
          поэтому кнопка оживёт, когда прогон запущен.
        </p>
      ) : null}
      {/* То же самое про каталог клеток (#567). Проект после этого ровно тот
          же, и без прямой строки человек не узнает, случилось ли что-нибудь. */}
      {adoptedId && adoptedName ? (
        <p className="sb-warn">
          Клетка «{adoptedName}» лежит в каталоге под именем{' '}
          <span className="mono">{adoptedId}</span> — она есть в палитре слева и
          в любом другом проекте. В проекте уехала копия: правка порога здесь её
          больше не тронет.
        </p>
      ) : null}
      {adopting ? (
        <CellToCatalog
          type={adopting}
          // Что уже лежит под этим именем -- из той же палитры, по которой
          // рисуется список слева: второго списка клеток в интерфейсе нет.
          standing={palette.find((cell) => cell.id === adopting)}
          busy={keeping}
          onCancel={() => setAdopting(null)}
          onPut={(draft) => void adopt(draft)}
        />
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
      </div>

      {/* Подложка под ящиком. Рисуется только когда он выдвинут, и только
          тогда же перехватывает щелчки: на просторном окне её нет вовсе. */}
      {picker ? (
        <button
          type="button"
          className="sb-veil"
          aria-label="Закрыть панель"
          onClick={() => {
            setPicker(false)
            opener.current?.focus()
          }}
        />
      ) : null}

      <div className="sb-body">
        <aside
          id="sb-left"
          ref={drawer}
          className={`panel sb-left${picker ? ' is-open' : ''}`}
        >
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
            {/* «Внешнее» стоит перед «Объектами», а не в конце: первые три
                вкладки -- это то, из чего схему собирают (клетки, паттерны,
                двери наружу), а «Объекты» -- то, что уже собрано. */}
            <button
              type="button"
              className={`lib-tab${tab === 'outside' ? ' is-on' : ''}`}
              title="Сенсоры и моторы — то, чем схема связана с внешним миром"
              onClick={() => setTab('outside')}
            >
              Внешнее
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
                  {/* Подсказка на всей строке, а не только на имени: медиатор
                      и фигура -- такой же шифр, как `sst`, и объяснять надо то,
                      на что человек смотрит целиком (#541). */}
                  <span
                    className="sb-row-text"
                    title={cell.note ? `${cell.name}. ${cell.note}` : cell.name}
                  >
                    <span className="sb-row-name">{cell.name}</span>
                    <span className="mono sb-level">
                      {cell.transmitter ?? cell.id}
                      {cell.builtin ? '' : ' · своя'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="sb-plus"
                    title={`Положить на холст: ${cell.note || cell.name}`}
                    onClick={() => pick(() => void control.insertCell(cell.id))}
                  >
                    +
                  </button>
                </div>
              ))}
              {palette.length === 0 ? (
                <p className="sb-hint">Каталог типов клеток пуст.</p>
              ) : null}

              {/* Типы клеток самого проекта -- отдельным разделом под
                  каталогом (#564). Они попадают в проект из разобранного
                  паттерна (#532) и каталогу не принадлежат: `target` в нём
                  нет и не будет, пока его туда не положили. Смешать их с
                  каталогом нельзя -- у каталожной клетки есть человеческое
                  имя и объяснение, а у типа из паттерна только
                  идентификатор, и общий список пришлось бы либо выдумывать
                  `target` имя, либо у половины строк имена гасить.

                  Показываются только те, которых нет в каталоге. Одноимённый
                  тип -- это тот же самый тип: кнопка «+» каталожной строки
                  кладёт клетку, а `Sandbox.add_neuron` оставляет в проекте
                  уже лежащий там тип (`setdefault`), то есть обе строки
                  сделали бы буквально одно и то же. Решается это здесь, а не
                  на сервере: ответ о проекте не должен зависеть от того, что
                  лежит в `.vnl/cells` на этой машине, -- а вопрос «стоит ли
                  повторять строку в списке» и есть вопрос про список. */}
              {own.length ? (
                <>
                  <div className="sb-section">В проекте</div>
                  <p className="sb-note">
                    Типы из разобранных паттернов. В каталоге их нет: у них
                    есть только имя типа.
                  </p>
                  {own.map((kind) => (
                    /* Строка в два этажа: сверху клетка и «+», снизу «в
                       каталог». В одну строку они не встают -- панель шириной
                       238 px, и подпись типа («glutamate −50 мВ · 1 клетка»)
                       переносится на три строки; кнопка словом оказывалась бы
                       посреди этого переноса. Значком её не сделать: «+» рядом
                       уже значит «ещё одну такую клетку сюда», и второй значок
                       пришлось бы объяснять наведением -- то есть после того,
                       как на него нажали (#567). */
                    <div className="sb-own" key={kind.type}>
                    <div className="sb-row">
                      <span className="sb-mini sb-cell-shape">
                        <svg viewBox="0 0 40 24" role="img" aria-label={kind.type}>
                          <rect
                            className={`sb-shape${kind.inhibitory ? ' is-inh' : ''}`}
                            x={4}
                            y={5}
                            width={32}
                            height={14}
                            rx={kind.inhibitory ? 3 : 7}
                          />
                        </svg>
                      </span>
                      <span className="sb-row-text">
                        <span className="sb-row-name mono">{kind.type}</span>
                        {/* Сколько таких уже стоит -- вместо объяснения,
                            которого у типа из паттерна нет. Заодно это и
                            предупреждение: правка порога задевает всех. */}
                        <span className="mono sb-level">
                          {kind.transmitter ?? 'порог'}{' '}
                          {kind.pointModel.vThreshold} мВ ·{' '}
                          {counted(kind.neurons.length, CELLS)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="sb-plus"
                        title={`Положить ещё одну клетку типа ${kind.type}. Тип общий: правка порога задевает все клетки этого типа в проекте`}
                        onClick={() => pick(() => void control.insertCellOfType(kind.type))}
                      >
                        +
                      </button>
                      </div>
                      {/* «в каталог» -- не вариант «+». Та кнопка кладёт ещё
                          одну такую клетку в этот проект, эта уносит тип за
                          его пределы: ничего на холст не кладёт и в проекте
                          не меняет ни поля, а пополняет каталог, общий на все
                          проекты (#567). */}
                      <div className="sb-own-act">
                        <button
                          type="button"
                          className="sb-adopt-btn"
                          title={`Положить тип ${kind.type} в каталог клеток: он станет доступен и в других проектах. Спросим имя и объяснение — без них строка каталога ничего не говорит`}
                          onClick={() => pick(() => setAdopting(kind.type))}
                        >
                          в каталог
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          ) : tab === 'library' ? (
            <div className="sb-list">
              {/* Превью та же миниатюра, что в каталоге: по одному имени блок
                  в списке из сорока не выбрать, а вторая реализация «как
                  выглядит схема» разошлась бы с первой незаметно. Размер и
                  разбор развилок -- в `LibraryRow` (#547). */}
              {(catalog?.patterns ?? []).map((pattern) => (
                <LibraryRow
                  key={pattern.id}
                  pattern={pattern}
                  onInsert={(id) => pick(() => void control.insert(id))}
                  // Уход на карточку ничего не сохраняет и ничего не теряет:
                  // проект живёт в состоянии песочницы и в открытом `Project`
                  // на сервере -- вместе с историей отмены и несохранёнными
                  // правками. Экран песочницы при этом снимается, поэтому
                  // ящик закрывать не нужно -- его не станет вместе с ним.
                  onOpen={onOpenPattern ? (id) => onOpenPattern(id) : undefined}
                />
              ))}
              {catalog && catalog.patterns.length === 0 ? (
                <p className="sb-hint">Библиотека пуста — вставлять нечего.</p>
              ) : null}
            </div>
          ) : tab === 'outside' ? (
            /* «Внешнее» (#575): сенсоры и моторы -- и кладут их здесь, и
               видят списком здесь же.

               Раздела «Граница с миром» в палитре клеток больше нет: то же
               самое в двух местах -- та самая болезнь, из-за которой панель
               свойств стала свалкой (#569). А вот кнопки в свойствах клетки
               («Сенсор на X», «Мотор с X») остались, и это не то же самое:
               там цель уже названа щелчком, и сенсор приходит сразу со
               стрелкой. Второй реализации нет ни у одной из дорог -- все
               зовут `Project`.

               Устроена вкладка под то, чем станет: сверху «Положить» -- что
               можно завести, снизу «В схеме» -- что уже заведено. Владелец
               говорит об этом разделе как о наборе готовых внешних штук
               («по аналогии с фильтрами и масками в блендере»), и третьей
               двери, когда она появится, хватит строки в верхнем списке --
               перестраивать вкладку под неё не придётся. */
            <div className="sb-list">
              <div className="sb-section">Положить</div>
              <p className="sb-note">
                Сенсор вносит в схему величину снаружи, мотор выносит наружу
                частоту клетки. На холсте у них своя фигура: у сенсора острый
                конец смотрит в схему, у мотора вдавлен.
              </p>
              {/* Чем дверь трогают -- здесь же, рядом с «+» (#573). Прежде в
                  этом разделе были только фигуры, и человек, положивший
                  сенсор, не узнавал, что дальше нужна кнопка: порядок «сенсор
                  -> кнопка -> прогон» не был рассказан нигде. */}
              <p className="sb-note">
                Сенсор нажимают кнопкой: заведите дверь — и под холстом
                появится полоса кнопок. Мотор в той же полосе — лампочка, а
                кнопка, привязанная и к сенсору, и к мотору, замыкает петлю:
                сеть трогает мир и чувствует собственное действие.
              </p>
              <div className="sb-row">
                <span className="sb-mini sb-cell-shape">
                  <svg viewBox="0 0 40 24" role="img" aria-label="сенсор">
                    <polygon className="sb-door-shape" points="4,6 30,6 36,12 30,18 4,18" />
                  </svg>
                </span>
                <span className="sb-row-text" title={glossary.sensor}>
                  <span className="sb-row-name">Сенсор</span>
                  <span className="mono sb-level">дверь снаружи внутрь</span>
                </span>
                <button
                  type="button"
                  className="sb-plus"
                  title="Положить сенсор на холст. Соединяется с клеткой так же, как клетка с клеткой: щелчок по его выходу, потом по клетке"
                  onClick={() => pick(() => void putDoor(() => control.insertSensor(), 'sensor'))}
                >
                  +
                </button>
              </div>
              <div className="sb-row">
                <span className="sb-mini sb-cell-shape">
                  <svg viewBox="0 0 40 24" role="img" aria-label="мотор">
                    <polygon className="sb-door-shape" points="4,6 36,6 36,18 4,18 10,12" />
                  </svg>
                </span>
                <span className="sb-row-text" title={glossary.motor}>
                  <span className="sb-row-name">Мотор</span>
                  <span className="mono sb-level">
                    {chosenNeuron ? `смотрит на ${chosenNeuron}` : 'выберите клетку'}
                  </span>
                </span>
                {/* Цель обязательна, и это не недоделка вкладки, а устройство
                    самой вещи: мотор без клетки не существует -- он и есть
                    «смотрю на эту точку». Сенсор же снаружи и до всякой схемы
                    полон, поэтому кладётся один. Выбрать клетку можно, не
                    уходя отсюда: щелчком по холсту -- вкладка при этом
                    остаётся открытой, и подпись строки говорит, на какую
                    клетку мотор сядет. */}
                <button
                  type="button"
                  className="sb-plus"
                  disabled={!chosenNeuron}
                  title={
                    chosenNeuron
                      ? `Положить мотор, смотрящий на клетку ${chosenNeuron}`
                      : 'Мотор смотрит на клетку — выберите её на холсте или в «Объектах»'
                  }
                  onClick={() =>
                    pick(
                      () =>
                        void putDoor(
                          () => control.insertMotor(chosenNeuron as string, null),
                          'motor',
                        ),
                    )
                  }
                >
                  +
                </button>
              </div>

              {/* Что уже заведено -- здесь же, а не только в дереве объектов:
                  вкладка, из которой дверь кладут, обязана показывать, какие
                  двери в схеме уже есть, иначе второй сенсор заводят, не зная
                  о первом. Строки те же и выбирают то же, что строки дерева, --
                  щелчок открывает объект в свойствах и подсвечивает его на
                  холсте. */}
              <div className="sb-section">В схеме</div>
              {project.sensors.length || project.motors.length ? (
                <>
                  {project.sensors.map((sensor) => (
                    <Row
                      key={sensor.id}
                      label={`${sensor.id} · ${sensor.story}`}
                      kind="сенсор"
                      hint={glossary.sensor}
                      on={selected?.kind === 'sensor' && selected.id === sensor.id}
                      onPick={() =>
                        pick(() => control.select({ kind: 'sensor', id: sensor.id }))
                      }
                    />
                  ))}
                  {project.motors.map((motor) => (
                    <Row
                      key={motor.id}
                      label={`${motor.id} · ${where(motor.source)} · ${motor.story}`}
                      kind="мотор"
                      hint={glossary.motor}
                      on={selected?.kind === 'motor' && selected.id === motor.id}
                      onPick={() => pick(() => control.select({ kind: 'motor', id: motor.id }))}
                    />
                  ))}
                </>
              ) : (
                <p className="sb-hint">
                  Дверей наружу в схеме пока нет. Положите сенсор — и сеть
                  можно будет потрогать кнопкой под холстом.
                </p>
              )}
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
                  onPick={() => pick(() => control.select({ kind: 'block', id: block.id }))}
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
                  onPick={() => pick(() => control.select({ kind: 'neuron', id: neuron.id }))}
                />
              ))}
              {project.links.map((link) => (
                <Row
                  key={link.id}
                  label={`${where(link.source)} → ${where(link.target)}`}
                  kind="связь"
                  on={selected?.kind === 'link' && selected.id === link.id}
                  onPick={() => pick(() => control.select({ kind: 'link', id: link.id }))}
                />
              ))}
              {/* У стимула в подписи стоит протокол словами, а не только
                  адрес: вопрос «почему спайки ложатся пачками» задают, глядя
                  на растр, и ответ обязан быть на том же экране, а не через
                  щелчок по объекту (#553). Слова считает сервер -- он же и
                  объясняет род наведением. */}
              {project.stimuli.map((drive) => (
                <Row
                  key={drive.id}
                  label={`${drive.id} → ${where(drive.target)} · ${drive.protocol}`}
                  kind="стимул"
                  hint={driveHint(glossary, drive.kind)}
                  on={selected?.kind === 'stimulus' && selected.id === drive.id}
                  onPick={() => pick(() => control.select({ kind: 'stimulus', id: drive.id }))}
                />
              ))}
              {project.recordings.map((record) => (
                <Row
                  key={record.id}
                  label={`${record.id} · ${where(record.target)}`}
                  kind="запись"
                  on={selected?.kind === 'recording' && selected.id === record.id}
                  onPick={() => pick(() => control.select({ kind: 'recording', id: record.id }))}
                />
              ))}
              {/* Двери наружу -- такие же объекты проекта, как стимул и запись,
                  и в дереве стоят рядом с ними.

                  Теперь они и выбираются (#571): у сенсора появилась фигура на
                  холсте, и щелчок по строке обязан открывать то же самое, что
                  щелчок по фигуре, -- иначе в дереве был бы второй, более
                  бедный способ смотреть на тот же объект. В #562 они не
                  выбирались нарочно: править у них было нечего, пока род и
                  числа задавал только сервер умолчаниями. */}
              {project.sensors.map((sensor) => (
                <Row
                  key={sensor.id}
                  label={`${sensor.id} · ${sensor.story}`}
                  kind="сенсор"
                  hint={glossary.sensor}
                  on={selected?.kind === 'sensor' && selected.id === sensor.id}
                  onPick={() => pick(() => control.select({ kind: 'sensor', id: sensor.id }))}
                />
              ))}
              {project.motors.map((motor) => (
                <Row
                  key={motor.id}
                  label={`${motor.id} · ${where(motor.source)} · ${motor.story}`}
                  kind="мотор"
                  hint={glossary.motor}
                  on={selected?.kind === 'motor' && selected.id === motor.id}
                  onPick={() => pick(() => control.select({ kind: 'motor', id: motor.id }))}
                />
              ))}
            </div>
          )}
        </aside>

        <section className="sb-canvas">
          <Legend glossary={glossary} />
          <Canvas
            blocks={project.blocks}
            neurons={project.neurons}
            links={project.links}
            // Слой рисуется одним узлом с сеткой активности (#583): какие
            // клетки за ним стоят, знает собранная сеть, а как они сейчас
            // горят -- растр сессии.
            populations={project.populations ?? []}
            onPickLayer={(id) => control.select({ kind: 'layer', id })}
            spikes={spikes}
            elapsed={time}
            // Драйв и записи едут на холст наравне со связями (#502): это
            // часть схемы, а не подробность её настройки. Длительность --
            // ради окна работы драйва: короче прогона оно объясняет, почему
            // растр пуст в начале, а равное прогону писать не о чем.
            stimuli={project.stimuli}
            recordings={project.recordings}
            // Граница с миром едет на холст наравне с драйвом и записями
            // (#571): до этого она была единственной вещью схемы, которой на
            // схеме нет, -- и даже стрелка от сенсора к клетке не рисовалась,
            // потому что холст не знал, где стоит её источник.
            sensors={project.sensors}
            motors={project.motors}
            duration={project.run.duration}
            glossary={glossary}
            cells={cells}
            palette={palette}
            selected={selected}
            pending={pending}
            opened={opened}
            onPickBlock={(id) => control.select({ kind: 'block', id })}
            onPickNeuron={(id) => control.select({ kind: 'neuron', id })}
            onPickLink={(id) => control.select({ kind: 'link', id })}
            // Знак на холсте открывает тот же объект, что строка в дереве:
            // второй способ править стимул заводить не из чего.
            onPickDrive={(id) => control.select({ kind: 'stimulus', id })}
            onPickRecord={(id) => control.select({ kind: 'recording', id })}
            onPickSensor={(id) => control.select({ kind: 'sensor', id })}
            onPickMotor={(id) => control.select({ kind: 'motor', id })}
            onPickEndpoint={(instance, port) =>
              void control.touchEndpoint(instance, port)
            }
            onMove={(id, position) => void control.move(id, position)}
            onToggleBlock={(id) => control.toggleBlock(id)}
            // Та же операция, что и кнопка в панели свойств, -- второй
            // реализации разбора не заводим. Разница только в дороге: на холст
            // человек смотрит с первой секунды, а панель свойств открывается
            // уже после выбора блока (#549).
            onUngroupBlock={(id) => void control.ungroup(id)}
            // Окно холста живёт в состоянии, а не в самом холсте: в него
            // смотрит `free()`, выбирая место новому объекту (#545).
            view={canvasView}
            onView={(next) => control.setView(next)}
            onEmpty={() => control.select(null)}
          />
        </section>

        {/* Правая панель -- только выбранный объект (#569). Правило написано
            в самой `Properties`, и держится оно здесь: всё, что не исчезает
            вместе со снятым выделением, стоит в другом месте -- проект слева
            сверху, числа прогона у дорожек. */}
        <aside className="panel sb-right">
          <Properties
            selection={selected}
            project={project}
            cells={cells}
            spikes={spikes}
            elapsed={time}
            glossary={glossary}
            palette={palette}
          />
        </aside>
      </div>

      {/* Кнопки -- между холстом и активностью сети: на них смотрят вместе со
          схемой и с растром. Схема без сенсоров и моторов панели не получает
          вовсе -- решает это сама панель по спискам проекта, и выглядит такая
          схема ровно как раньше.

          `key` по проекту: кнопки помнятся отдельно для каждого, и панель, не
          пересозданная при смене проекта, показывала бы чужие. */}
      {/* Панель поля -- ниже кнопок и по той же причине, по которой кнопки
          стоят под холстом: на неё смотрят вместе со схемой и растром. Схемы
          без полей она не касается вовсе -- решает это сама панель по списку
          собранной сети (#581).

          Кадры спрашиваются при появлении поля в проекте: сессия могла идти и
          до того, как панель открыли, и кадр на поле уже держаться. */}
      <FieldRow
        fields={project.fields ?? []}
        spikes={spikes}
        elapsed={time}
        live={Boolean(simId)}
        frames={frames}
        onShow={(field, what) => void sim.show(field, what)}
      />

      <ButtonBoard
        key={project.id}
        project={project.id}
        sensors={project.sensors}
        motors={project.motors}
        values={pressed}
        output={acted}
        live={Boolean(simId)}
        // Пустому проекту полоса не нужна вовсе: там кнопок ещё не ищут.
        scheme={Boolean(project.blocks.length || project.neurons.length)}
        onSense={(values) => void sim.sense(values)}
      />

      {/* Таймлайн живёт в прибитой снизу панели, а не под холстом: иначе он
          уезжает за край экрана вместе с транспортом (#504).

          Управление временем стоит в шапке этой же панели (#569). В #504
          второго транспорта здесь не заводили нарочно -- два «управления
          временем» на одном экране были бы двумя воплощениями одного понятия.
          Теперь это не второй, а единственный: наверху его не осталось.
          Владелец сказал прямо, что пуск и стоп относятся к таймлайну, и это
          верно -- они двигают ровно то время, которое нарисовано здесь.

          В шапке, а не в теле: тело сворачивается в полоску, а управление
          временем обязано оставаться на виду во время прогона. Числа прогона,
          наоборот, в теле: их задают до пуска, и прятать их вместе с
          дорожками не жалко. */}
      <ActivityPanel
        summary={summary(cells, spikes, time, Boolean(duration))}
        controls={
          <Transport
            state={simState}
            time={time}
            duration={duration || project.run.duration}
            busy={busy}
            restart={stale}
            onStart={() => void start()}
            onPause={() => void sim.pause()}
            onReset={() => void sim.reset()}
            onStep={(delta) => void sim.step(delta)}
          />
        }
        settings={<RunSettings run={project.run} />}
      >
        <Timeline
          duration={duration || project.run.duration}
          time={time}
          dt={dt}
          order={loose}
          layers={layerLanes}
          spikes={spikes}
          traces={traces}
          inhibitory={inhibitory}
          onSeek={(moment) => void sim.seek(moment)}
          disabled={!duration}
        />
      </ActivityPanel>
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

  /**
   * Положить тип проекта в каталог (#567). Форма закрывается на удачном ответе.
   *
   * Палитру перечитывать не нужно: ответ маршрута -- весь каталог, и состояние
   * песочницы уже заменило им `cells`. Второй запрос спросил бы то же самое
   * ещё раз и мог бы принести другое -- каталог правят и мимо этого экрана.
   */
  async function adopt(draft: CellDraft): Promise<void> {
    if (await control.putCellIntoCatalog(draft)) setAdopting(null)
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

/**
 * Что панель говорит о себе свёрнутой.
 *
 * Свёрнутая панель отдаёт холст схеме целиком, и строка в ней -- единственное,
 * что остаётся от прогона на экране. Поэтому в ней то, ради чего таймлайн и
 * разворачивают: сколько клеток и как часто они разряжаются. Частота средняя
 * по клеткам -- панель в одну строку, и перечислить их все в ней негде.
 */
function summary(
  cells: Record<string, CellState>,
  spikes: Record<string, number[]>,
  elapsed: number,
  ran: boolean,
): string {
  const count = Object.keys(cells).length
  if (!ran || count === 0) return 'прогона ещё не было'
  const fired = Object.values(spikes).reduce((sum, times) => sum + times.length, 0)
  const rate = elapsed > 0 ? (fired / count / elapsed) * 1000 : 0
  return `${counted(count, CELLS)} · ${rate.toFixed(0)} Гц`
}

/**
 * Что сказать про блок, приехавший с карточки (#526).
 *
 * Отдельной строкой, потому что по проекту этого не видно: блок на холсте
 * выглядит так же, как вставленный из панели, а драйв и записи лежат на
 * вкладке «Объекты», куда человек в этот момент ещё не смотрел. Числа названы
 * прямо -- они и есть то, за чем шли с карточки: те же 250 Гц и то же зерно
 * дают ту же картину, а не похожую.
 *
 * Паттерн без витрины получает честный ответ, а не молчание: «блок лёг, но
 * спайкать его нечем» -- это то, что человек всё равно узнает через минуту,
 * когда прогон выйдет пустым.
 */
function arrival(
  label: string,
  stimuli: number,
  recordings: number,
  duration: number,
  seed: number,
): string {
  if (stimuli === 0 && recordings === 0) {
    return (
      `Блок «${label}» в проекте. Витрины у этого паттерна нет, поэтому блок ` +
      'молчит: драйв ему нужно завести самому — «Стимул» в панели свойств.'
    )
  }
  return (
    `Блок «${label}» в проекте вместе с витриной карточки — стимулы: ${stimuli}, ` +
    `записи: ${recordings}, прогон ${duration} мс, зерно ${seed}. ` +
    'Это обычные объекты проекта: их правят панелью свойств и убирают, ' +
    'как любые другие.'
  )
}

/**
 * Подсказка кнопки «назад»: что именно отменится (#570).
 *
 * Отдельной функцией, а не строкой в разметке: правило тут не механическое --
 * у кнопки три состояния («нечего», «есть что, и оно названо», «есть что, но
 * сервер старее страницы и подписи не прислал»), и подсказка обязана быть
 * верной во всех трёх. Клавиша названа в каждом: о ней узнают отсюда, а не из
 * списка сочетаний, которого в песочнице нет.
 */
export function undoTitle(can: boolean, label?: string | null): string {
  if (!can) return 'Отменять нечего: история пуста'
  return label
    ? `Отменить: ${label} (Ctrl+Z)`
    : 'Отменить последнее действие (Ctrl+Z)'
}

export function redoTitle(can: boolean, label?: string | null): string {
  if (!can) return 'Возвращать нечего: отменённого нет'
  return label
    ? `Вернуть: ${label} (Ctrl+Shift+Z)`
    : 'Вернуть отменённое (Ctrl+Shift+Z)'
}

/** Имя нового проекта. Одинаковые имена в списке делают его бесполезным. */
function nextName(list: Array<{ name: string }>): string {
  const taken = new Set(list.map((row) => row.name))
  let number = list.length + 1
  while (taken.has(`Проект ${number}`)) number += 1
  return `Проект ${number}`
}

/**
 * Список для выпадающего меню: открытый проект в нём есть всегда и зовётся
 * своим именем.
 *
 * Именно своим, а не тем, что стоит в списке. Список читается из хранилища, а
 * переименование (#563) живёт в открытом проекте, пока его не сохранили, -- и
 * строка меню показывала бы прежнее имя рядом с панелью свойств, где уже
 * новое. Правда об открытом проекте одна, и она в нём самом; остальные строки
 * остаются такими, какими лежат на диске.
 */
function rows(
  list: Array<{ id: string; name: string }>,
  project: { id: string; name: string },
): Array<{ id: string; name: string }> {
  if (!list.some((row) => row.id === project.id)) return [project, ...list]
  return list.map((row) => (row.id === project.id ? { ...row, name: project.name } : row))
}

/**
 * Легенда знаков над холстом -- как в макете (`Page MVP.dc.html`, SANDBOX).
 *
 * Схема говорит цветом и формой, и расшифровки у них не было нигде: красная
 * линия с плашкой значит «торможение» только для того, кто это уже знает.
 * Строка стоит над холстом, а не в панели справа: объясняет она холст, а
 * панель показывает один выбранный объект.
 *
 * Пять знаков, а не четыре, как в макете: макет рисовался до того, как драйв
 * и запись вообще появились на схеме (#502). «Паттерн» из макета сюда не
 * переехал -- блок подписан своим именем прямо на коробке, и отдельная
 * строчка про него объясняла бы то, что и так написано.
 *
 * Строка про драйв -- не подпись знака, а ответ на вопрос, который в
 * карточке и назван главным: что такое драйв и почему его нет во вставленном
 * блоке. Текст приходит с сервера (`protocols.STIMULUS_NOTE`) вместе со
 * всеми прочими объяснениями: тот же вопрос задают наведением на сам знак, и
 * два ответа на него разошлись бы.
 */
function Legend({ glossary }: { glossary: Glossary }) {
  const marks: Array<{ kind: string; label: string; hint?: string }> = [
    { kind: 'exc', label: 'возбуждение', hint: receptorHint(glossary, 'ampa') },
    { kind: 'inh', label: 'торможение', hint: receptorHint(glossary, 'gaba_a') },
    { kind: 'mod', label: 'модуляция', hint: glossary.port?.mod },
    { kind: 'drive', label: 'драйв', hint: glossary.stimulus },
    { kind: 'record', label: 'запись', hint: glossary.recording },
  ]
  return (
    <div className="sb-legend">
      {marks.map((mark) => (
        <span key={mark.kind} className="sb-legend-item" title={mark.hint}>
          <span className={`sb-legend-mark is-${mark.kind}`} />
          {mark.label}
        </span>
      ))}
      {glossary.stimulus ? (
        <span className="sb-legend-note">{glossary.stimulus}</span>
      ) : null}
    </div>
  )
}

function Row({
  label,
  kind,
  hint,
  on,
  onPick,
}: {
  label: string
  kind: string
  /** Расшифровка подписи: что это за объект и чем он отличается от соседних. */
  hint?: string
  on: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      className={`sb-row sb-pick${on ? ' is-on' : ''}`}
      title={hint}
      onClick={onPick}
    >
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
