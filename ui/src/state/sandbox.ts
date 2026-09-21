/**
 * Состояние песочницы в интерфейсе.
 *
 * Хранится ровно то, что пришло с сервера, плюс выделение -- оно живёт только
 * на экране и серверу не нужно. Каждая операция заменяет состояние целиком:
 * дописывать изменения руками значило бы считать проект во второй раз, уже
 * по-своему.
 *
 * Соединение -- маленький автомат: щелчок по порту запоминает источник,
 * второй щелчок создаёт связь. Держать это в состоянии, а не в компоненте,
 * нужно затем, чтобы дерево объектов и холст одинаково понимали, что сейчас
 * происходит.
 */

import { useSyncExternalStore } from 'react'

import { layeredPlaces } from '../lib/miniature'
import { OfflineError, isDenied } from '../model/catalog'
import { adoptCell, loadCells } from '../model/cells'
import type { CellDraft } from '../model/cells'
import { NO_GLOSSARY, loadGlossary } from '../model/glossary'
import {
  addBlock,
  addMotor,
  addNeuron,
  addNeuronOfType,
  addRecording,
  addSensor,
  addStimulus,
  arrangeObjects,
  connect,
  createSandbox,
  duplicateObject,
  listSandboxes,
  moveObject,
  openSandbox,
  removeObject,
  renameBlock,
  renameNeuron,
  renameProject,
  save,
  saveAsPattern,
  setCellParams,
  setContactParams,
  setLinkParams,
  setMotorParams,
  setRecordingVar,
  setRunParams,
  setSensorParams,
  setStimulusParams,
  redo,
  undo,
  ungroupBlock,
  type ContactParams,
  type DriveParams,
  type PatternDraft,
  type Places,
  type SandboxRow,
  type SandboxState,
} from '../model/sandbox'
import type { CellKind, Glossary, PointModel, RecordedVar, RunSpec } from '../model/types'
import { createStore } from './store'

/**
 * Что выбрано на холсте.
 *
 * Клетка -- отдельный род, а не блок из одного нейрона: у неё нет ни портов,
 * ни карточки, ни Fork, зато есть параметры мембраны. Панель свойств у них
 * общего не имеет ничего, и сводить их к одному роду пришлось бы ветвлением
 * внутри каждого поля.
 */
export interface Selection {
  kind:
    | 'block'
    | 'neuron'
    | 'link'
    | 'stimulus'
    | 'recording'
    | 'sensor'
    | 'motor'
    // Слой -- свой род, а не клетка и не блок (#583): у него нет ни мембраны
    // одной клетки, ни портов блока, зато есть сетка и число отозвавшихся.
    | 'layer'
  id: string
}

/**
 * Начатое соединение: откуда тянем.
 *
 * Порт может быть пустым -- это конец связи на самой клетке (сома). У клетки
 * портов нет, и придумывать ей фиктивный значило бы врать о том, как устроена
 * связь: сервер и так принимает конец без порта.
 */
export interface Pending {
  instance: string
  port: string | null
}

/**
 * Прямоугольник координат схемы, показанный на холсте, -- он же `viewBox`.
 *
 * Единица холста -- пиксель экрана при приближении «один к одному»; отсюда
 * `width`/`height` в единицах, а не в долях: приближение это отношение
 * пиксельного размера области к `width`, и держать его отдельным числом
 * значило бы завести второе место, где написано, насколько всё увеличено.
 */
export interface CanvasView {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Окно до первого измерения области.
 *
 * Те самые `760x420`, что были жёстким размером холста: проекты, сложенные
 * при них, целиком попадают в окно с первого кадра. Живёт это значение ровно
 * до того, как холст померит себя, -- дальше размер окна задаёт область.
 */
export const START_VIEW: CanvasView = { x: 0, y: 0, width: 760, height: 420 }

export interface SandboxView {
  list: SandboxRow[]
  project: SandboxState | null
  /**
   * Палитра типов клеток. Держится рядом с проектом, а не в состоянии
   * библиотеки: клетка -- не паттерн, и фильтры каталога к ней не применимы.
   */
  cells: CellKind[]
  /**
   * Расшифровка подписей: рецепторы, мембрана, контакт, порты (#541).
   *
   * Рядом с палитрой, а не в состоянии библиотеки, по той же причине: её
   * спрашивает панель свойств песочницы. Пустая до ответа сервера -- экран
   * обязан работать и без подсказок, они объясняют, а не управляют.
   */
  glossary: Glossary
  selected: Selection | null
  pending: Pending | null
  /**
   * Блоки, раскрытые на холсте: видна начинка, а не коробка.
   *
   * Живёт только на экране и на сервер не уходит. Раскрытие -- показ, а не
   * схема: попади оно в песочницу, щелчок по треугольнику делал бы проект
   * «не сохранённым» (`dirty` считается сравнением `to_plain`), а прогон
   * пришлось бы отдельно защищать от устаревания -- `fingerprint` считается по
   * собранной модели, и раскрытие в неё не входит. Поэтому здесь, рядом с
   * выделением, которое серверу тоже не нужно.
   */
  opened: string[]
  /**
   * Окно холста: какой кусок координат схемы сейчас показан.
   *
   * Холст был картинкой `760x420`, которую вписывали в свою область с
   * сохранением пропорций. Из этого следовали две беды сразу: схема меняла
   * размер от высоты нижней панели (тянут границу -- едет вся схема, хотя
   * место объектов то же), а за пределами `760x420` ничего не существовало --
   * ни прокрутки, ни приближения, и после десятка объектов сетка размещения
   * клала уже за краем (#545).
   *
   * Теперь холст -- окно: `viewBox` и есть этот прямоугольник, в единицах
   * схемы, а его размер в пикселях меряет сам холст. От высоты панели меняется
   * `height` этого окна -- то есть сколько схемы видно, а не какого она
   * размера.
   *
   * Лежит рядом с `opened` и по той же причине: это показ, а не схема. На
   * сервер не уходит, `dirty` от него не появляется, `fingerprint` не
   * меняется, прогон не старится. Сюда же смотрит `free()`: новый объект
   * кладётся в видимое место, а не по абсолютной сетке 3xN.
   */
  view: CanvasView
  busy: boolean
  error: string | null
  offline: boolean
  /** Отказ был «нужен вход»: поправимо входом, а не перезапуском сервера. */
  denied: boolean
  /**
   * Что получилось у последнего «Сохранить как паттерн»: имя и ступень.
   *
   * Держится в состоянии, а не в компоненте: сохранение -- единственное
   * действие песочницы, после которого ничего на экране не меняется (проект тот
   * же), и без прямого «готово, паттерн такой-то» человек не узнает, случилось
   * ли оно вообще.
   */
  saved: { id: string; name: string; levelName: string } | null
  /**
   * Что получилось у последнего «в каталог»: имя записи и её идентификатор (#567).
   *
   * Держится здесь по той же причине, что и `saved`: каталог пополняется, а
   * проект остаётся прежним, и по экрану песочницы не видно, случилось ли
   * что-нибудь. Палитра слева при этом меняется -- в ней появляется строка, --
   * но вкладка может быть открыта другая, да и найти новую строку среди
   * знакомых глазами не всегда просто.
   */
  adopted: { id: string; name: string } | null
}

const EMPTY: SandboxView = {
  list: [],
  project: null,
  cells: [],
  glossary: NO_GLOSSARY,
  selected: null,
  pending: null,
  opened: [],
  view: START_VIEW,
  busy: false,
  error: null,
  offline: false,
  denied: false,
  saved: null,
  adopted: null,
}

export interface SandboxPorts {
  list: typeof listSandboxes
  arrange: typeof arrangeObjects
  create: typeof createSandbox
  open: typeof openSandbox
  addBlock: typeof addBlock
  cells: typeof loadCells
  adopt: typeof adoptCell
  glossary: typeof loadGlossary
  addNeuron: typeof addNeuron
  addNeuronOfType: typeof addNeuronOfType
  connect: typeof connect
  params: typeof setLinkParams
  contact: typeof setContactParams
  rename: typeof renameBlock
  renameNeuron: typeof renameNeuron
  renameProject: typeof renameProject
  duplicate: typeof duplicateObject
  cell: typeof setCellParams
  move: typeof moveObject
  stimulate: typeof addStimulus
  sensor: typeof addSensor
  motor: typeof addMotor
  sensorParams: typeof setSensorParams
  motorParams: typeof setMotorParams
  driveParams: typeof setStimulusParams
  record: typeof addRecording
  recordVar: typeof setRecordingVar
  run: typeof setRunParams
  ungroup: typeof ungroupBlock
  remove: typeof removeObject
  undo: typeof undo
  redo: typeof redo
  save: typeof save
  asPattern: typeof saveAsPattern
}

const DEFAULT_PORTS: SandboxPorts = {
  list: listSandboxes,
  arrange: arrangeObjects,
  create: createSandbox,
  open: openSandbox,
  addBlock,
  cells: loadCells,
  adopt: adoptCell,
  glossary: loadGlossary,
  addNeuron,
  addNeuronOfType,
  connect,
  params: setLinkParams,
  contact: setContactParams,
  rename: renameBlock,
  renameNeuron,
  renameProject,
  duplicate: duplicateObject,
  cell: setCellParams,
  move: moveObject,
  stimulate: addStimulus,
  sensor: addSensor,
  motor: addMotor,
  sensorParams: setSensorParams,
  motorParams: setMotorParams,
  driveParams: setStimulusParams,
  record: addRecording,
  recordVar: setRecordingVar,
  run: setRunParams,
  ungroup: ungroupBlock,
  remove: removeObject,
  undo,
  redo,
  save,
  asPattern: saveAsPattern,
}

/**
 * Шаг сетки размещения и отступ от края окна.
 *
 * Шаг чуть меньше самого широкого объекта (раскрытый блок 236x152) и заметно
 * больше свёрнутого (150x62): раскрытые рядом чуть перекрываются, но сетка --
 * прикидка «куда положить», а не раскладка. Отступ -- чтобы первый объект не
 * прилипал к краю окна и не наезжал на подписи портов; те же числа, что были
 * в абсолютной сетке до #545, чтобы место первых объектов не поехало.
 */
const SLOT = { x: 220, y: 140, margin: 60 }
/**
 * Сдвиг следующего захода, когда места в окне кончились.
 *
 * Больше половины фигуры клетки (74x38): иначе второй заход ложится на первый
 * так плотно, что подписи перекрываются и читается одна из двух. Меньше
 * четверти шага сетки: иначе последний заход вылезает за край окна -- ровно за
 * тот край, от которого мы и уходили.
 */
const PASS = { x: 48, y: 36 }

/**
 * Шаг, которым ложатся клетки разобранного блока.
 *
 * Те же числа, что были на сервере (`UNGROUP_STEP` в `vnl/patterns.py`):
 * меняется не расстояние между клетками, а то, какая клетка куда попадает.
 * Фигура клетки 74x38, и шаг оставляет между ними полсотни пикселей -- ровно
 * столько, чтобы дуга связи прошла между соседями, а не по ним.
 */
const UNGROUP_STEP = { x: 120, y: 90 }

/**
 * Смотрит ли объект в ту же точку, куда только что ткнули (#502).
 *
 * Конец связи в ответе несёт ещё и `section` с `fraction`, но сравниваются
 * только имя и порт: кнопка «Драйв на in» адресует именно их, а точку на
 * клетке подставляет сервер. Сравнивай мы всё четыре поля -- «тот же порт»
 * перестал бы значить «тот же порт» в тот день, когда у клетки появятся
 * ветви и драйв попросят вешать на них.
 */
function sameEnd(
  target: { instance: string; port: string | null },
  instance: string,
  port: string | null,
): boolean {
  return target.instance === instance && (target.port ?? null) === port
}

/**
 * Куда положить следующий объект, чтобы он не лёг поверх соседа.
 *
 * Считаются и блоки, и клетки, и двери наружу: место на холсте у них одно, и
 * нумеровать их по отдельности значило бы класть первую клетку ровно на первый
 * блок. Двери попали в счёт вместе с фигурой (#571): пока их на холсте не
 * рисовали, они места и не занимали, а теперь сенсор, положенный вторым,
 * ложился ровно на мотор, положенный первым, -- и одного из двух было не
 * видно вовсе.
 *
 * Кладётся в видимую часть, а не по абсолютной сетке от нуля: холст стал
 * окном, и объект, положенный по старой сетке «три в ряд», после десятка
 * соседей появлялся бы за краем окна -- то есть нигде (#545). Сколько мест
 * в ряду и сколько рядов, решает само окно; когда они кончаются, начинается
 * новый заход, сдвинутый по диагонали, -- так новый объект не ложится точно
 * на старый и всё равно остаётся на виду.
 *
 * Сетка при этом остаётся грубой прикидкой, а не раскладкой: разложить схему
 * по-настоящему умеет «Разложить» (#543), и повторять её здесь, в месте, где
 * известно только число объектов, было бы второй раскладкой.
 */
function free(project: SandboxState | null, view: CanvasView): [number, number] {
  const index =
    (project?.blocks.length ?? 0) +
    (project?.neurons.length ?? 0) +
    (project?.sensors.length ?? 0) +
    (project?.motors.length ?? 0)
  const cols = Math.max(1, Math.floor((view.width - SLOT.margin) / SLOT.x))
  const rows = Math.max(1, Math.floor((view.height - SLOT.margin) / SLOT.y))
  const slot = index % (cols * rows)
  // Заходов четыре, дальше по кругу: пятый сдвиг вывел бы объект за край окна.
  const pass = Math.floor(index / (cols * rows)) % 4
  return [
    Math.round(view.x + SLOT.margin + (slot % cols) * SLOT.x + pass * PASS.x),
    Math.round(view.y + SLOT.margin + Math.floor(slot / cols) * SLOT.y + pass * PASS.y),
  ]
}

export function createSandboxController(ports: Partial<SandboxPorts> = {}) {
  const io = { ...DEFAULT_PORTS, ...ports }
  const store = createStore<SandboxView>({ ...EMPTY })

  const fail = (reason: unknown): void => {
    store.setState({
      busy: false,
      error: reason instanceof Error ? reason.message : String(reason),
      offline: reason instanceof OfflineError,
      denied: isDenied(reason),
    })
  }

  /** Операция над проектом: занятость, единый разбор отказа, новое состояние. */
  const act = async (
    run: (id: string) => Promise<SandboxState>,
    after: Partial<SandboxView> = {},
  ): Promise<void> => {
    const project = store.getState().project
    if (!project) return
    store.setState({ busy: true })
    try {
      const next = await run(project.id)
      store.setState({
        project: next,
        busy: false,
        error: null,
        offline: false,
        denied: false,
        ...after,
      })
    } catch (reason) {
      fail(reason)
    }
  }

  const openProject = async (loader: () => Promise<SandboxState>): Promise<void> => {
    // Раскрытые блоки забываются вместе с проектом: в другом проекте те же
    // имена принадлежат другим блокам. Прокрутка холста возвращается к началу
    // координат по той же причине -- объекты другого проекта стоят в другом
    // месте, -- а приближение остаётся: оно про экран человека, а не про
    // проект, и размер окна (`width`/`height`) уже померен областью.
    const { view } = store.getState()
    store.setState({
      busy: true,
      selected: null,
      pending: null,
      opened: [],
      view: { ...view, x: 0, y: 0 },
    })
    try {
      const project = await loader()
      store.setState({ project, busy: false, error: null, offline: false, denied: false })
    } catch (reason) {
      fail(reason)
    }
  }

  return {
    store,

    async refreshList(): Promise<void> {
      try {
        store.setState({ list: await io.list(), error: null, offline: false, denied: false })
      } catch (reason) {
        fail(reason)
      }
    },

    open: (id: string) => openProject(() => io.open(id)),

    /** Новый проект сразу открывается, а список пополняется -- он в панели. */
    async create(name: string): Promise<void> {
      await openProject(() => io.create(name))
      try {
        store.setState({ list: await io.list() })
      } catch {
        // Список не обновился -- это неудобство, а не потеря: проект открыт.
      }
    },

    /** Выйти из проекта к списку. Сам проект остаётся на диске. */
    close(): void {
      store.setState({
        project: null,
        selected: null,
        pending: null,
        opened: [],
        error: null,
      })
    },

    /** Палитра клеток. Спрашивается отдельно от библиотеки: это другой каталог. */
    async refreshCells(): Promise<void> {
      try {
        store.setState({ cells: await io.cells(), error: null, offline: false, denied: false })
      } catch (reason) {
        fail(reason)
      }
    },

    /**
     * Расшифровка подписей. Спрашивается один раз на открытие экрана: это
     * реестр, а не состояние проекта, -- он не меняется ни от правки схемы,
     * ни от того, что в хранилище положили свою клетку.
     *
     * Отказ здесь не занимает экран сообщением: без подсказок песочница
     * работает ровно так же, как работала до #541, и объявлять её сломанной
     * из-за пропавшей справки было бы неверно.
     */
    async refreshGlossary(): Promise<void> {
      try {
        store.setState({ glossary: await io.glossary() })
      } catch {
        store.setState({ glossary: NO_GLOSSARY })
      }
    },

    /**
     * Вставить паттерн. Место выбирается так, чтобы блоки не ложились друг на друга.
     *
     * Витрина не едет, и `false` стоит явно, а не умолчанием: рядом есть
     * `bring`, у которой ответ другой, и молчание блока здесь -- решение, а не
     * недосмотр.
     */
    insert(pattern: string): Promise<void> {
      const { project, view } = store.getState()
      return act((id) => io.addBlock(id, pattern, free(project, view), false))
    },

    /**
     * Принести паттерн с его карточки: блок вместе с витриной (#526).
     *
     * Отдельное действие, а не `insert` с флажком, потому что это другая
     * просьба человека. «+» в панели «Библиотека» значит «дай кусок схемы в
     * мою сеть», и чужой драйв там лишний. Переход с карточки значит «дай то
     * же самое, но чтобы покрутить», и без витрины блок приезжает молчащим:
     * чтобы увидеть ровно то, что было на карточке, пришлось бы заводить
     * драйв и подбирать числа заново.
     *
     * Один запрос, а не вставка плюс несколько «добавить стимул»: операция
     * над проектом идёт через `Project`, иначе «Отменить» разбиралось бы по
     * одному стимулу и первый же шаг оставил бы драйв, целящийся в
     * исчезнувший блок.
     *
     * Место берётся так же, как у `insert`, -- по видимому окну холста (#545):
     * блок, приехавший с карточки, обязан оказаться там, куда человек смотрит,
     * а не за краем.
     */
    bring(pattern: string): Promise<void> {
      const { project, view } = store.getState()
      return act((id) => io.addBlock(id, pattern, free(project, view), true))
    },

    /**
     * Положить клетку из палитры.
     *
     * Имя клетке подбирает сервер: он один знает, какие имена уже заняты
     * блоками, а столкновение с ними всплыло бы иначе только на запуске.
     */
    insertCell(cell: string): Promise<void> {
      const { project, view } = store.getState()
      return act((id) => io.addNeuron(id, cell, free(project, view)))
    },

    /**
     * Положить клетку типа, который уже есть в этом проекте (#564).
     *
     * Отдельное действие, а не `insertCell` с флажком: это другой источник
     * типа, а не другой способ спросить каталог. Тип берётся существующий --
     * правка порога у новой клетки задевает всех клеток этого типа в проекте,
     * как и было до того, как её положили.
     */
    insertCellOfType(type: string): Promise<void> {
      const { project, view } = store.getState()
      return act((id) => io.addNeuronOfType(id, type, free(project, view)))
    },

    /**
     * Щелчок по концу связи: первый запоминает источник, второй создаёт связь.
     *
     * Один автомат на порт блока и на точку клетки. Разводить их на два
     * значило бы, что соединение блока с клеткой не принадлежит ни одному.
     */
    async touchEndpoint(instance: string, port: string | null): Promise<void> {
      const { pending } = store.getState()
      if (!pending) {
        store.setState({ pending: { instance, port } })
        return
      }
      if (pending.instance === instance && pending.port === port) {
        store.setState({ pending: null })
        return
      }
      const source = pending
      store.setState({ pending: null })
      await act((id) => io.connect(id, source, { instance, port }))
    },

    cancelPending(): void {
      store.setState({ pending: null })
    },

    /**
     * Раскрыть или свернуть блок на холсте.
     *
     * Ничего не отправляет и ничего не меняет в схеме: блок и так считается
     * насквозь -- его нейроны разворачиваются в общую сеть (`compose`). Это
     * только показ, поэтому ни шага отмены, ни отметки «не сохранено» здесь
     * быть не должно, а значит и маршрута к серверу.
     */
    toggleBlock(block: string): void {
      const { opened } = store.getState()
      store.setState({
        opened: opened.includes(block)
          ? opened.filter((id) => id !== block)
          : [...opened, block],
      })
    },

    /**
     * Куда смотрит холст: прокрутка, приближение и новый размер области.
     *
     * Как и раскрытие, никуда не отправляется. Место объекта -- часть проекта
     * и от приближения не меняется; приближение и прокрутка меняют только то,
     * какой кусок схемы виден, поэтому ни шага отмены, ни отметки «не
     * сохранено», ни устаревания прогона здесь быть не должно (#545).
     *
     * Ходит через состояние, а не живёт в самом холсте, потому что смотрит
     * сюда не только холст: `free()` кладёт новый объект в видимое место.
     */
    setView(view: CanvasView): void {
      store.setState({ view })
    },

    select(selection: Selection | null): void {
      store.setState({ selected: selection })
    },

    move: (object: string, position: [number, number]) =>
      act((id) => io.move(id, object, position)),

    /**
     * Разложить схему (#543).
     *
     * По требованию, а не на каждую вставку: человек расставил объекты по
     * смыслу, и новая клетка, перетасовавшая бы всю схему, отняла бы у него
     * эту работу. Кнопка -- его решение.
     *
     * Места приходят посчитанными: их считает холст, который один знает
     * размеры фигур и то, какие блоки сейчас раскрыты. Применяются они одной
     * операцией проекта -- иначе «Отменить» возвращало бы схему по одному
     * узлу, -- и сервер, как на любую операцию песочницы, отвечает состоянием
     * целиком.
     */
    async arrange(compute: () => Promise<Places>): Promise<void> {
      if (!store.getState().project) return
      store.setState({ busy: true })
      try {
        const places = await compute()
        if (!Object.keys(places).length) {
          store.setState({ busy: false })
          return
        }
        await act((id) => io.arrange(id, places))
      } catch (reason) {
        fail(reason)
      }
    },

    setParams: (link: string, params: ContactParams) =>
      act((id) => io.params(id, link, params)),

    /**
     * Параметры контакта внутри блока (#531).
     *
     * Отдельная операция, а не `setParams` с другим адресом: связь песочницы
     * живёт в `sandbox.links`, а контакт -- в снимке экземпляра, и маршруты у
     * них разные. Поля при этом те же: связь есть связь, где бы она ни была
     * нарисована.
     */
    setContact: (block: string, contact: string, params: ContactParams) =>
      act((id) => io.contact(id, block, contact, params)),

    /** Подпись блока. Пустую не отправляем: сервер её всё равно не примет. */
    rename(block: string, label: string): Promise<void> {
      if (!label.trim()) return Promise.resolve()
      return act((id) => io.rename(id, block, label))
    },

    /**
     * Имя клетки (#563). Оно же её адрес, поэтому ссылки чинит сервер.
     *
     * Выделение остаётся на клетке и переезжает на новое имя: человек
     * переименовал то, на что смотрит, и потерять панель свойств из-за этого
     * он не должен. Пустое имя не отправляется -- сервер его всё равно не
     * примет, а отказ ради пустого поля читался бы как поломка.
     */
    renameNeuron(neuron: string, name: string): Promise<void> {
      const chosen = name.trim()
      if (!chosen || chosen === neuron) return Promise.resolve()
      return act((id) => io.renameNeuron(id, neuron, chosen), {
        selected: { kind: 'neuron', id: chosen },
      })
    },

    /**
     * Имя проекта. Список проектов перечитывать незачем: он читается из
     * хранилища, а несохранённое имя туда ещё не доехало -- открытый проект
     * зовётся своим именем сам (`rows` в экране песочницы).
     */
    renameProject(name: string): Promise<void> {
      const chosen = name.trim()
      if (!chosen) return Promise.resolve()
      return act((id) => io.renameProject(id, chosen))
    },

    /**
     * Дублировать объект холста (#563).
     *
     * Выделение переходит на копию: её и двигают дальше, а оставлять его на
     * оригинале значило бы, что следующее «дублировать» делает третью копию
     * того же, а не продолжает начатое. Имя копии известно только из ответа,
     * поэтому берётся из него, а не угадывается здесь.
     */
    async duplicate(object: string): Promise<void> {
      const before = new Set(
        (store.getState().project?.neurons ?? [])
          .map((one) => one.id)
          .concat((store.getState().project?.blocks ?? []).map((one) => one.id)),
      )
      await act((id) => io.duplicate(id, object))
      const after = store.getState().project
      if (!after) return
      const fresh = [...after.neurons, ...after.blocks].find(
        (one) => !before.has(one.id),
      )
      if (fresh) {
        store.setState({
          selected: {
            kind: after.neurons.some((one) => one.id === fresh.id)
              ? 'neuron'
              : 'block',
            id: fresh.id,
          },
        })
      }
    },

    setCell: (object: string, type: string, params: Partial<PointModel>) =>
      act((id) => io.cell(id, object, type, params)),

    /**
     * Драйв на конец связи: порт блока или точку клетки (`port: null`).
     *
     * Созданный стимул сразу становится выбранным (#502). Прежде выделение не
     * менялось вовсе: человек нажимал «Драйв на in», панель свойств
     * продолжала показывать блок, холст не менялся ничем, и подтверждение
     * приходило единственной строкой в другой вкладке, куда для этого надо
     * переключиться. Теперь подтверждение приходит туда, куда человек
     * смотрит, -- и на холсте, знаком у цели, и в панели, полями стимула.
     *
     * Второй драйв на ту же точку не заводится, а открывает первый. Это и
     * есть «предложить поправить существующий» из карточки: кнопка нажимается
     * дважды легко -- на холсте до сих пор ничего не менялось, -- и в проекте
     * оказывались `drive1` и `drive2` на один порт, то есть вдвое больше
     * входа, чем человек думал.
     *
     * Отказом это не сделано нарочно. Два стимула на одну точку язык
     * принимает, и они осмысленны: пуассоновский фон плюс поезд на нём --
     * обычный опыт. Запрети это сервер -- песочница стала бы строже файла,
     * то есть завела бы схемы, которые можно написать, но нельзя собрать.
     * Поэтому правило живёт там, где живёт кнопка: второй драйв заводят
     * осознанно, из панели свойств уже выбранного стимула, а не случайным
     * повтором щелчка.
     */
    async stimulate(instance: string, port: string | null): Promise<void> {
      const project = store.getState().project
      if (!project) return
      const already = project.stimuli.find((one) => sameEnd(one.target, instance, port))
      if (already) {
        store.setState({ selected: { kind: 'stimulus', id: already.id } })
        return
      }
      const had = new Set(project.stimuli.map((one) => one.id))
      await act((id) => io.stimulate(id, { instance, port }))
      const fresh = store
        .getState()
        .project?.stimuli.find((one) => !had.has(one.id))
      // Имя выбирает сервер -- он один знает, что в проекте занято, -- поэтому
      // свежий ищется по ответу, а не угадывается здесь заранее.
      if (fresh) store.setState({ selected: { kind: 'stimulus', id: fresh.id } })
    },

    setDrive: (stimulus: string, params: DriveParams) =>
      act((id) => io.driveParams(id, stimulus, params)),

    /**
     * Сенсор на эту точку: дверь снаружи внутрь -- и сразу стрелка от неё
     * (#560, #562).
     *
     * Два обращения к серверу, а не одно: сенсор и связь от него -- разные
     * вещи, и объединять их маршрутом значило бы заводить второй способ
     * провести стрелку. Поэтому и «Отменить» на них два: сначала уходит
     * связь, потом сам сенсор. Это честная история проекта, а не пропуск --
     * сенсор без стрелки остаётся законным объектом, и убирать его вместе со
     * связью означало бы решить за человека, что он больше не нужен.
     *
     * Связь заводится сразу потому, что одинокий сенсор не делает ничего:
     * величина доходит до клетки только по стрелке, а второй дороги провести
     * её от сенсора -- фигуры на холсте у него пока нет -- в интерфейсе нет.
     *
     * Имя сенсора выбирает сервер: он один знает, что в проекте уже занято.
     * Отсюда и поиск свежего по ответу, а не угадывание имени заранее.
     */
    async addSensor(instance: string, port: string | null): Promise<void> {
      const { project, view } = store.getState()
      if (!project) return
      const had = new Set(project.sensors.map((item) => item.id))
      await act((id) => io.sensor(id, { position: free(project, view) }))
      const after = store.getState().project
      const fresh = after?.sensors.find((item) => !had.has(item.id))
      if (!fresh) return
      await act((id) => io.connect(id, { instance: fresh.id, port: null }, { instance, port }))
    },

    /** Мотор с этой точки: смотрит на неё, как запись, но отдаёт одно число. */
    addMotor: (instance: string, port: string | null) =>
      act((id) => {
        const { project, view } = store.getState()
        return io.motor(id, { instance, port }, { position: free(project, view) })
      }),

    /**
     * Положить сенсор из палитры -- так же, как кладут клетку (#571).
     *
     * Без связи и без цели: сенсор -- такая же деталь схемы, как клетка, и
     * кладут её на холст, а соединяют потом. Прежде завести сенсор можно было
     * только из свойств выбранной клетки, и человек, не знающий про ту кнопку,
     * не находил границу с миром вовсе -- ровно та же беда, что была с
     * раскрытием блока (#549).
     *
     * Второй дороги это не заводит: `addSensor` рядом делает то же самое плюс
     * стрелку, потому что там цель уже названа щелчком по клетке. Здесь цели
     * нет, и выдумывать её за человека нельзя -- он ещё не сказал, к чему
     * тянуть.
     *
     * Свежий сенсор сразу становится выбранным: панель свойств -- это
     * подтверждение того, что он появился, и место, где правят его род и
     * числа. Имя выбирает сервер, поэтому ищется он по ответу.
     */
    async insertSensor(): Promise<void> {
      const { project, view } = store.getState()
      if (!project) return
      const had = new Set(project.sensors.map((item) => item.id))
      await act((id) => io.sensor(id, { position: free(project, view) }))
      const fresh = store.getState().project?.sensors.find((item) => !had.has(item.id))
      if (fresh) store.setState({ selected: { kind: 'sensor', id: fresh.id } })
    },

    /**
     * Положить мотор, смотрящий на выбранную клетку (#571).
     *
     * Цель обязательна, и это не недоделка палитры, а устройство самой вещи:
     * мотор без клетки не существует -- он и есть «смотрю на эту точку».
     * Сенсор же снаружи и до всякой схемы полон, поэтому кладётся один.
     * Поэтому в палитре у мотора спрошена клетка, а у сенсора нет.
     */
    async insertMotor(instance: string, port: string | null): Promise<void> {
      const { project, view } = store.getState()
      if (!project) return
      const had = new Set(project.motors.map((item) => item.id))
      await act((id) => io.motor(id, { instance, port }, { position: free(project, view) }))
      const fresh = store.getState().project?.motors.find((item) => !had.has(item.id))
      if (fresh) store.setState({ selected: { kind: 'motor', id: fresh.id } })
    },

    /** Род и числа сенсора и мотора. Те же правила, что у драйва и записи. */
    setSensor: (sensor: string, params: { kind?: string; to?: number }) =>
      act((id) => io.sensorParams(id, sensor, params)),
    setMotor: (motor: string, params: { kind?: string; window?: number }) =>
      act((id) => io.motorParams(id, motor, params)),

    /**
     * Запись с точки. Созданная сразу становится выбранной -- как и драйв.
     *
     * Запрета на вторую запись с той же точки здесь нет, и это не забывчивость
     * (#502). Второй драйв удваивает вход, то есть молча меняет опыт; вторая
     * запись не меняет ничего -- она даёт вторую такую же дорожку. А вот `v` и
     * `g_exc` с одной клетки нужны постоянно: величину у первой меняют и жмут
     * ещё раз. Запрети это -- и второй величины с точки не снять вовсе.
     */
    async record(instance: string, port: string | null): Promise<void> {
      const project = store.getState().project
      if (!project) return
      const had = new Set(project.recordings.map((one) => one.id))
      await act((id) => io.record(id, { instance, port }))
      const fresh = store
        .getState()
        .project?.recordings.find((one) => !had.has(one.id))
      if (fresh) store.setState({ selected: { kind: 'recording', id: fresh.id } })
    },

    setRecord: (recording: string, variable: RecordedVar) =>
      act((id) => io.recordVar(id, recording, variable)),

    setRun: (params: Partial<RunSpec>) => act((id) => io.run(id, params)),

    /**
     * Разобрать блок на клетки и связи (#532).
     *
     * Выделение снимается: блока с этим именем больше нет, и панель свойств
     * показывала бы пустоту. Раскрытие тоже забывается -- раскрывать стало
     * нечего.
     *
     * Места клеткам считаются здесь и уезжают вместе с запросом. Раньше их
     * раздавал сервер сеткой «лишь бы не в кучу», и получалось вот что: внутри
     * коробки человек видел схему слоями, жал «разобрать» -- и та же схема
     * ложилась сеткой, которая про связи не знает вовсе. Раскладка у схемы
     * одна, и берётся она оттуда же, откуда нарисована начинка блока (#554).
     *
     * Вокруг места самого блока: схема остаётся там, где стояла коробка.
     */
    ungroup: (block: string) => {
      const item = store.getState().project?.blocks.find((one) => one.id === block)
      const places = item
        ? layeredPlaces(item.scheme, item.position, UNGROUP_STEP)
        : undefined
      return act((id) => io.ungroup(id, block, places), {
        selected: null,
        opened: store.getState().opened.filter((item) => item !== block),
      })
    },

    remove: (object: string) => act((id) => io.remove(id, object), { selected: null }),

    /**
     * Шаг назад и шаг вперёд по истории проекта (#570).
     *
     * Выделение снимается в обоих: объекта, на который смотрит панель свойств,
     * после шага истории может не быть вовсе -- он для того шага и возник.
     * Оставленное выделение показывало бы пустую панель или, хуже, свойства
     * другого объекта, занявшего то же имя.
     *
     * Состояние приходит целиком, как на любую операцию песочницы: считать
     * «что изменилось» в браузере -- значит считать проект во второй раз, уже
     * по-своему.
     */
    undo: () => act((id) => io.undo(id), { selected: null }),
    redo: () => act((id) => io.redo(id), { selected: null }),
    save: () => act((id) => io.save(id)),

    /**
     * «Сохранить как паттерн»: проект уезжает в библиотеку.
     *
     * Состояние проекта не заменяется: сохранение песочницу не меняет, и
     * подменять её ответом о другом объекте было бы неправдой. Меняется только
     * `saved` -- то, что человек прочтёт как «получилось».
     */
    async saveAsPattern(draft: PatternDraft): Promise<boolean> {
      const project = store.getState().project
      if (!project) return false
      store.setState({ busy: true, saved: null })
      try {
        const pattern = await io.asPattern(project.id, draft)
        store.setState({
          busy: false,
          error: null,
          offline: false,
          denied: false,
          saved: {
            id: pattern.id,
            name: pattern.name,
            levelName: pattern.levelName,
          },
        })
        return true
      } catch (reason) {
        fail(reason)
        return false
      }
    },

    /**
     * Положить тип клетки проекта в каталог (#567).
     *
     * Проект не меняется -- ни одного поля: в каталог уезжает копия типа, и
     * связи между ней и проектом после этого нет. Поэтому состояние песочницы
     * здесь и не заменяется, в отличие от всех операций над холстом: заменить
     * его ответом о каталоге было бы неправдой о том, что случилось.
     *
     * Заменяется палитра -- целиком тем списком, который прислал сервер.
     * Дописать новую строку руками было бы дешевле, но порядок каталога
     * держит `cells.catalog` (встроенные первыми, своя перекрывает встроенную
     * по идентификатору), и вторая реализация этого порядка разошлась бы с
     * первой ровно на перекрытии -- то есть на том случае, ради которого
     * `replace` и заводился.
     */
    async putCellIntoCatalog(draft: CellDraft): Promise<boolean> {
      const project = store.getState().project
      if (!project) return false
      store.setState({ busy: true, adopted: null })
      try {
        const cells = await io.adopt(project.id, draft)
        store.setState({
          busy: false,
          error: null,
          offline: false,
          denied: false,
          cells,
          adopted: { id: draft.type, name: draft.name.trim() },
        })
        return true
      } catch (reason) {
        fail(reason)
        return false
      }
    },

    /** Убрать отметку об удачном сохранении: форму открывают заново. */
    forgetSaved(): void {
      store.setState({ saved: null, adopted: null })
    },
  }
}

export type SandboxController = ReturnType<typeof createSandboxController>

export const sandboxController = createSandboxController()

/** Селектор обязан отдавать величину, а не собранный объект: см. `useCatalog`. */
export function useSandbox<S>(select: (state: SandboxView) => S): S {
  const { store } = sandboxController
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  )
}
