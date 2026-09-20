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

import { OfflineError, isDenied } from '../model/catalog'
import { loadCells } from '../model/cells'
import { NO_GLOSSARY, loadGlossary } from '../model/glossary'
import {
  addBlock,
  addNeuron,
  addRecording,
  addStimulus,
  arrangeObjects,
  connect,
  createSandbox,
  listSandboxes,
  moveObject,
  openSandbox,
  removeObject,
  renameBlock,
  save,
  saveAsPattern,
  setCellParams,
  setContactParams,
  setLinkParams,
  setRecordingVar,
  setRunParams,
  setStimulusParams,
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
  kind: 'block' | 'neuron' | 'link' | 'stimulus' | 'recording'
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
}

const EMPTY: SandboxView = {
  list: [],
  project: null,
  cells: [],
  glossary: NO_GLOSSARY,
  selected: null,
  pending: null,
  opened: [],
  busy: false,
  error: null,
  offline: false,
  denied: false,
  saved: null,
}

export interface SandboxPorts {
  list: typeof listSandboxes
  arrange: typeof arrangeObjects
  create: typeof createSandbox
  open: typeof openSandbox
  addBlock: typeof addBlock
  cells: typeof loadCells
  glossary: typeof loadGlossary
  addNeuron: typeof addNeuron
  connect: typeof connect
  params: typeof setLinkParams
  contact: typeof setContactParams
  rename: typeof renameBlock
  cell: typeof setCellParams
  move: typeof moveObject
  stimulate: typeof addStimulus
  driveParams: typeof setStimulusParams
  record: typeof addRecording
  recordVar: typeof setRecordingVar
  run: typeof setRunParams
  ungroup: typeof ungroupBlock
  remove: typeof removeObject
  undo: typeof undo
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
  glossary: loadGlossary,
  addNeuron,
  connect,
  params: setLinkParams,
  contact: setContactParams,
  rename: renameBlock,
  cell: setCellParams,
  move: moveObject,
  stimulate: addStimulus,
  driveParams: setStimulusParams,
  record: addRecording,
  recordVar: setRecordingVar,
  run: setRunParams,
  ungroup: ungroupBlock,
  remove: removeObject,
  undo,
  save,
  asPattern: saveAsPattern,
}

/**
 * Куда положить следующий объект, чтобы он не лёг поверх соседа.
 *
 * Считаются и блоки, и клетки: место на холсте у них одно, и нумеровать их
 * по отдельности значило бы класть первую клетку ровно на первый блок.
 */
function free(project: SandboxState | null): [number, number] {
  const index = (project?.blocks.length ?? 0) + (project?.neurons.length ?? 0)
  return [60 + (index % 3) * 220, 60 + Math.floor(index / 3) * 140]
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
    // имена принадлежат другим блокам.
    store.setState({ busy: true, selected: null, pending: null, opened: [] })
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
      return act((id) =>
        io.addBlock(id, pattern, free(store.getState().project), false),
      )
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
     */
    bring(pattern: string): Promise<void> {
      return act((id) => io.addBlock(id, pattern, free(store.getState().project), true))
    },

    /**
     * Положить клетку из палитры.
     *
     * Имя клетке подбирает сервер: он один знает, какие имена уже заняты
     * блоками, а столкновение с ними всплыло бы иначе только на запуске.
     */
    insertCell(cell: string): Promise<void> {
      return act((id) => io.addNeuron(id, cell, free(store.getState().project)))
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

    setCell: (object: string, type: string, params: Partial<PointModel>) =>
      act((id) => io.cell(id, object, type, params)),

    /** Драйв и запись на конец связи: порт блока или точка клетки (`port: null`). */
    stimulate: (instance: string, port: string | null) =>
      act((id) => io.stimulate(id, { instance, port })),

    setDrive: (stimulus: string, params: DriveParams) =>
      act((id) => io.driveParams(id, stimulus, params)),

    record: (instance: string, port: string | null) =>
      act((id) => io.record(id, { instance, port })),

    setRecord: (recording: string, variable: RecordedVar) =>
      act((id) => io.recordVar(id, recording, variable)),

    setRun: (params: Partial<RunSpec>) => act((id) => io.run(id, params)),

    /**
     * Разобрать блок на клетки и связи (#532).
     *
     * Выделение снимается: блока с этим именем больше нет, и панель свойств
     * показывала бы пустоту. Раскрытие тоже забывается -- раскрывать стало
     * нечего.
     */
    ungroup: (block: string) =>
      act((id) => io.ungroup(id, block), {
        selected: null,
        opened: store.getState().opened.filter((item) => item !== block),
      }),

    remove: (object: string) => act((id) => io.remove(id, object), { selected: null }),

    undo: () => act((id) => io.undo(id), { selected: null }),
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

    /** Убрать отметку об удачном сохранении: форму открывают заново. */
    forgetSaved(): void {
      store.setState({ saved: null })
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
