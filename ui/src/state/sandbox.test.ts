/**
 * Настройки песочницы: что уходит на сервер и что панель показывает потом.
 *
 * Порты подменены, поэтому проверяется именно договор между панелью и
 * сервером: адрес, состав тела запроса и то, что состояние заменяется ответом
 * целиком. Считать новое состояние самим интерфейсом нельзя -- тогда у проекта
 * стало бы две правды.
 */

import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '../model/catalog'
import type { SandboxState } from '../model/sandbox'
import { createSandboxController, type SandboxPorts } from './sandbox'
import type { PointModel } from '../model/types'

const POINT: PointModel = {
  kind: 'lif',
  vRest: -65,
  vReset: -65,
  vThreshold: -50,
  tauM: 10,
  rIn: 100,
  refractory: 2,
  adaptation: 0,
  tauAdaptation: 100,
  deltaT: 2,
  vPeak: -40,
  tauW: 144,
  wCoupling: 4,
  wIncrement: 0.0805,
}

function project(patch: Partial<SandboxState> = {}): SandboxState {
  return {
    schema: 1,
    id: 's1',
    name: 'Проба',
    blocks: [
      {
        id: 'ffi',
        patternId: 'ffi',
        label: 'FFI',
        position: [0, 0],
        ports: [],
        counts: { neurons: 3, contacts: 2 },
        scheme: { neurons: [], edges: [] },
        cells: [
          { type: 'pyr_l5', neurons: ['E'], inhibitory: false, pointModel: POINT },
        ],
        contacts: [],
      },
    ],
    neurons: [],
    cellTypes: [],
    links: [],
    stimuli: [
      {
        id: 'drive1',
        target: { instance: 'ffi', port: 'in', section: 'soma', fraction: 0.5 },
        kind: 'poisson',
        receptor: 'ampa',
        rate: 250,
        amplitude: 1.5,
        times: [],
        protocol: 'пуассоновский, в среднем 250 Гц',
        start: 0,
        stop: 500,
        n: 0,
        freq: 0,
        isi: 0,
        duration: 0,
        bursts: 0,
        burst_period: 0,
        repeats: 1,
        period: 0,
        recovery: 0,
      },
    ],
    sensors: [],
    motors: [],
    recordings: [
      {
        id: 'r1',
        target: { instance: 'ffi', port: 'out', section: 'soma', fraction: 0.5 },
        var: 'v',
      },
    ],
    run: { dt: 0.1, duration: 500, level: 'L1', seed: 1 },
    dirty: false,
    canUndo: false,
    canRedo: false,
    problems: [],
    warnings: [],
    // Что сервер предложит в форме «Сохранить как паттерн».
    portHints: [
      {
        name: 'in_ffi_IN',
        direction: 'in',
        site: { instance: 'ffi/IN', section: 'soma', fraction: 0.5 },
        note: 'входящих связей нет — похоже на вход',
      },
    ],
    fingerprint: 'abc123',
    updatedAt: '',
    ...patch,
  }
}

/** Контроллер с открытым проектом и подменёнными портами. */
async function opened(ports: Partial<SandboxPorts> = {}) {
  const control = createSandboxController({
    open: vi.fn().mockResolvedValue(project()),
    ...ports,
  })
  await control.open('s1')
  return control
}

describe('настройки блока', () => {
  it('переименовывает экземпляр и берёт ответ сервера целиком', async () => {
    const rename = vi.fn().mockResolvedValue(project({ dirty: true }))
    const control = await opened({ rename })

    await control.rename('ffi', 'Вход')

    expect(rename).toHaveBeenCalledWith('s1', 'ffi', 'Вход')
    expect(control.store.getState().project?.dirty).toBe(true)
  })

  it('пустую подпись до сервера не доводит', async () => {
    const rename = vi.fn()
    const control = await opened({ rename })

    await control.rename('ffi', '   ')

    expect(rename).not.toHaveBeenCalled()
  })

  it('правит параметры мембраны по типу клетки, а не по нейрону', async () => {
    const cell = vi.fn().mockResolvedValue(project())
    const control = await opened({ cell })

    await control.setCell('ffi', 'pyr_l5', { vThreshold: -44 })

    expect(cell).toHaveBeenCalledWith('s1', 'ffi', 'pyr_l5', { vThreshold: -44 })
  })

  it('правит контакт внутри блока по адресу объекта, а не связи (#531)', async () => {
    // Контакт живёт в снимке экземпляра, а не в `sandbox.links`, поэтому
    // маршрут у него свой -- но поля те же три, что у связи холста: связь есть
    // связь, с какой бы стороны коробки она ни была нарисована.
    const contact = vi.fn().mockResolvedValue(project({ dirty: true }))
    const control = await opened({ contact })

    await control.setContact('ffi', 'c2', { delay: 4 })

    expect(contact).toHaveBeenCalledWith('s1', 'ffi', 'c2', { delay: 4 })
    expect(control.store.getState().project?.dirty).toBe(true)
  })
})

describe('раскладка (#543)', () => {
  it('отправляет места всех объектов одной операцией', async () => {
    // Одной, а не по сдвигу на узел: раскладка -- одно действие человека, и
    // «Отменить» обязано возвращать прежние места целиком.
    const arrange = vi.fn().mockResolvedValue(project({ dirty: true }))
    const move = vi.fn()
    const control = await opened({ arrange, move })

    await control.arrange(async () => ({ ffi: [12, 30], x: [252, 30] }))

    expect(arrange).toHaveBeenCalledWith('s1', { ffi: [12, 30], x: [252, 30] })
    expect(move).not.toHaveBeenCalled()
    expect(control.store.getState().project?.dirty).toBe(true)
  })

  it('пустую раскладку до сервера не доводит', async () => {
    const arrange = vi.fn()
    const control = await opened({ arrange })

    await control.arrange(async () => ({}))

    expect(arrange).not.toHaveBeenCalled()
    expect(control.store.getState().busy).toBe(false)
  })

  it('несчитанная раскладка -- обычный отказ, а не зависшая занятость', async () => {
    const arrange = vi.fn()
    const control = await opened({ arrange })

    await control.arrange(async () => {
      throw new Error('ELK не загрузился')
    })

    expect(arrange).not.toHaveBeenCalled()
    expect(control.store.getState().busy).toBe(false)
    expect(control.store.getState().error).toBe('ELK не загрузился')
  })
})

describe('разбор блока (#532)', () => {
  it('снимает выделение и раскрытие: блока с этим именем больше нет', async () => {
    const ungroup = vi.fn().mockResolvedValue(project({ blocks: [] }))
    const control = await opened({ ungroup })
    control.select({ kind: 'block', id: 'ffi' })
    control.toggleBlock('ffi')

    await control.ungroup('ffi')

    expect(ungroup).toHaveBeenCalledWith('s1', 'ffi', {})
    expect(control.store.getState().selected).toBeNull()
    expect(control.store.getState().opened).toEqual([])
    expect(control.store.getState().project?.blocks).toEqual([])
  })

  it('места клеткам считает интерфейс -- слоями, а не сеткой (#554)', async () => {
    // Человек видел внутри коробки схему слоями; сетка «лишь бы не в кучу»
    // ставила бы ту же схему иначе, и он читал бы две разные картинки.
    const ungroup = vi.fn().mockResolvedValue(project({ blocks: [] }))
    const laid = project()
    const [block] = laid.blocks
    if (!block) throw new Error('нет блока')
    block.position = [400, 200]
    block.scheme = {
      neurons: [
        { id: 'IN', inhibitory: false },
        { id: 'E', inhibitory: false },
        { id: 'I', inhibitory: true },
      ],
      edges: [
        { id: 'c1', from: 'IN', to: 'E', kind: 'exc' },
        { id: 'c2', from: 'IN', to: 'I', kind: 'exc' },
        { id: 'c3', from: 'I', to: 'E', kind: 'inh' },
      ],
    }
    const control = await opened({ ungroup, open: vi.fn().mockResolvedValue(laid) })

    await control.ungroup('ffi')

    const places = vi.mocked(ungroup).mock.calls[0]?.[2] as
      | Record<string, [number, number]>
      | undefined
    if (!places) throw new Error('места не отправлены')
    // IN -> I -> E: три слоя, три столбца слева направо и вокруг места блока.
    expect(places.IN?.[0]).toBeLessThan(places.I?.[0] ?? 0)
    expect(places.I?.[0]).toBeLessThan(places.E?.[0] ?? 0)
    expect(places.I).toEqual([400, 200])
  })
})

describe('настройки стимула и записи', () => {
  it('меняет частоту и окно драйва', async () => {
    const driveParams = vi.fn().mockResolvedValue(project())
    const control = await opened({ driveParams })

    await control.setDrive('drive1', { rate: 40, start: 20, stop: 200 })

    expect(driveParams).toHaveBeenCalledWith('s1', 'drive1', {
      rate: 40,
      start: 20,
      stop: 200,
    })
  })

  it('меняет записываемую величину', async () => {
    const recordVar = vi.fn().mockResolvedValue(project())
    const control = await opened({ recordVar })

    await control.setRecord('r1', 'g_inh')

    expect(recordVar).toHaveBeenCalledWith('s1', 'r1', 'g_inh')
  })
})

describe('параметры прогона', () => {
  it('уходят на сервер и возвращаются в состояние', async () => {
    const next = project({ run: { dt: 0.25, duration: 120, level: 'L1', seed: 11 } })
    const run = vi.fn().mockResolvedValue(next)
    const control = await opened({ run })

    await control.setRun({ duration: 120, dt: 0.25, seed: 11 })

    expect(run).toHaveBeenCalledWith('s1', { duration: 120, dt: 0.25, seed: 11 })
    expect(control.store.getState().project?.run.duration).toBe(120)
  })

  it('отказ сервера показывается, а прежние числа остаются', async () => {
    const run = vi.fn().mockRejectedValue(new Error('шаг должен быть больше нуля'))
    const control = await opened({ run })

    await control.setRun({ dt: 0 })

    const state = control.store.getState()
    expect(state.error).toBe('шаг должен быть больше нуля')
    expect(state.project?.run.dt).toBe(0.1)
  })

  it('без открытого проекта ничего не посылает', async () => {
    const run = vi.fn()
    const control = createSandboxController({ run })

    await control.setRun({ duration: 10 })

    expect(run).not.toHaveBeenCalled()
  })
})

describe('отказ по входу', () => {
  it('закрытая песочница -- это нужен вход, а не молчащий сервер', async () => {
    const control = createSandboxController({
      open: vi.fn().mockRejectedValue(new ApiError('нужен вход', 401)),
    })

    await control.open('s1')

    const state = control.store.getState()
    // Песочница закрыта целиком, включая чтение: проект -- чужая работа. Экран
    // обязан предложить вход, поэтому отказ отличается от «сервер не запущен».
    expect(state.denied).toBe(true)
    expect(state.offline).toBe(false)
    expect(state.project).toBeNull()
  })

  it('сессия, кончившаяся посреди работы, не выбрасывает проект с экрана', async () => {
    const control = await opened({
      save: vi.fn().mockRejectedValue(new ApiError('нужен вход', 401)),
    })

    await control.save()

    const state = control.store.getState()
    // Схема на холсте никуда не делась, и потерять её из-за истёкшей сессии
    // человек не должен: сказать надо про вход, а не убрать работу.
    expect(state.denied).toBe(true)
    expect(state.project?.id).toBe('s1')
  })
})


describe('сохранение паттерном', () => {
  const PORT = {
    name: 'вход',
    direction: 'in' as const,
    site: { instance: 'ffi/IN', section: 'soma', fraction: 0.5 },
    note: '',
  }

  it('порты и ступень уходят как введены, а проект не подменяется', async () => {
    const asPattern = vi
      .fn()
      .mockResolvedValue({ id: 'cepochka', name: 'Цепочка', levelName: 'Сети' })
    const control = await opened({ asPattern })

    const done = await control.saveAsPattern({
      name: 'Цепочка',
      level: 'L3',
      ports: [PORT],
    })

    expect(done).toBe(true)
    expect(asPattern).toHaveBeenCalledWith('s1', {
      name: 'Цепочка',
      level: 'L3',
      ports: [PORT],
    })
    const state = control.store.getState()
    // Песочница от сохранения не меняется: подменить её паттерном было бы
    // неправдой о том, что сейчас на холсте.
    expect(state.project?.id).toBe('s1')
    // А вот сказать «получилось» обязательно: на экране иначе ничего не менялось.
    expect(state.saved).toEqual({ id: 'cepochka', name: 'Цепочка', levelName: 'Сети' })
  })

  it('отказ сервера виден, и «получилось» не появляется', async () => {
    const control = await opened({
      asPattern: vi.fn().mockRejectedValue(new Error('паттерн без портов не подключить')),
    })

    const done = await control.saveAsPattern({ name: 'Никак', level: 'L0', ports: [] })

    expect(done).toBe(false)
    const state = control.store.getState()
    expect(state.error).toContain('без портов')
    expect(state.saved).toBeNull()
  })

  it('без открытого проекта ничего не посылает', async () => {
    const asPattern = vi.fn()
    const control = createSandboxController({ asPattern })

    expect(await control.saveAsPattern({ name: 'x', level: 'L0', ports: [] })).toBe(false)
    expect(asPattern).not.toHaveBeenCalled()
  })
})

describe('палитра клеток', () => {
  const PV = {
    id: 'pv',
    name: 'Корзинчатый интернейрон PV',
    note: 'Быстрое торможение',
    tags: ['inhibitory'],
    transmitter: 'gaba',
    inhibitory: true,
    builtin: true,
    source: null,
    pointModel: POINT,
    morphology: { name: 'point', isPoint: true, sections: [] },
  }

  it('спрашивается отдельно от библиотеки и ложится в состояние', async () => {
    const cells = vi.fn().mockResolvedValue([PV])
    const control = createSandboxController({ cells })

    await control.refreshCells()

    expect(control.store.getState().cells).toEqual([PV])
  })

  it('кладёт клетку туда, где нет соседа, и не придумывает ей имя', async () => {
    const addNeuron = vi.fn().mockResolvedValue(project())
    const control = await opened({ addNeuron })

    await control.insertCell('pv')

    // Блок в проекте уже один, значит клетка ложится на следующее место, а не
    // поверх него. Имя подбирает сервер: он один знает, что занято блоками.
    expect(addNeuron).toHaveBeenCalledWith('s1', 'pv', [280, 60])
  })
})

/**
 * Окно холста: прокрутка и приближение (#545).
 *
 * Проверяется ровно то, чем окно отличается от схемы: оно никуда не ездит,
 * ничего не старит -- и при этом в него смотрит размещение нового объекта.
 */
describe('окно холста', () => {
  it('прокрутка и приближение не ездят на сервер и не трогают проект', async () => {
    const move = vi.fn()
    const control = await opened({ move })
    const before = control.store.getState().project

    control.setView({ x: 900, y: 400, width: 600, height: 300 })

    // Место объекта -- часть проекта и от приближения не меняется. Прогон от
    // этого не стареет тоже: `fingerprint` считается по собранной модели, а
    // окна в ней нет.
    expect(move).not.toHaveBeenCalled()
    expect(control.store.getState().project).toBe(before)
    expect(control.store.getState().view).toEqual({
      x: 900,
      y: 400,
      width: 600,
      height: 300,
    })
  })

  it('новая клетка ложится в видимую часть, а не по сетке от нуля', async () => {
    const addNeuron = vi.fn().mockResolvedValue(project())
    const control = await opened({ addNeuron })

    // Уехали прокруткой далеко от начала координат.
    control.setView({ x: 2000, y: 1000, width: 760, height: 420 })
    await control.insertCell('pv')

    // Прежняя сетка положила бы клетку на [280, 60] -- то есть за краем окна,
    // где её не видно и не найти (#545).
    expect(addNeuron).toHaveBeenCalledWith('s1', 'pv', [2280, 1060])
  })

  it('в узком окне ряд короче, и объект всё равно остаётся на виду', async () => {
    const addNeuron = vi.fn().mockResolvedValue(project())
    const control = await opened({ addNeuron })

    // Окно шириной в одно место: второй объект идёт не вправо, а вниз.
    control.setView({ x: 0, y: 0, width: 300, height: 420 })
    await control.insertCell('pv')

    expect(addNeuron).toHaveBeenCalledWith('s1', 'pv', [60, 200])
  })

  it('открытие проекта возвращает прокрутку к началу, но не приближение', async () => {
    const control = await opened({})
    control.setView({ x: 900, y: 400, width: 600, height: 300 })

    await control.open('s1')

    // Объекты другого проекта стоят в другом месте, и прокрутка к ним не
    // относится. Приближение -- про экран человека, и его никто не просил
    // менять; размер окна вдобавок уже померен областью.
    expect(control.store.getState().view).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 300,
    })
  })
})

describe('соединение', () => {
  it('клетка соединяется точкой на себе: порт пустой', async () => {
    const connect = vi.fn().mockResolvedValue(project())
    const control = await opened({ connect })

    await control.touchEndpoint('E', null)
    expect(control.store.getState().pending).toEqual({ instance: 'E', port: null })
    expect(connect).not.toHaveBeenCalled()

    await control.touchEndpoint('I', null)

    expect(connect).toHaveBeenCalledWith(
      's1',
      { instance: 'E', port: null },
      { instance: 'I', port: null },
    )
    expect(control.store.getState().pending).toBeNull()
  })

  it('один автомат на порт блока и на точку клетки', async () => {
    const connect = vi.fn().mockResolvedValue(project())
    const control = await opened({ connect })

    await control.touchEndpoint('ffi', 'out')
    await control.touchEndpoint('E', null)

    // Блок с клеткой соединяется тем же движением: разведи это на два автомата
    // -- и такая связь не принадлежала бы ни одному.
    expect(connect).toHaveBeenCalledWith(
      's1',
      { instance: 'ffi', port: 'out' },
      { instance: 'E', port: null },
    )
  })

  it('повторный щелчок по той же точке отменяет начатое', async () => {
    const connect = vi.fn()
    const control = await opened({ connect })

    await control.touchEndpoint('E', null)
    await control.touchEndpoint('E', null)

    expect(connect).not.toHaveBeenCalled()
    expect(control.store.getState().pending).toBeNull()
  })
})

describe('драйв и запись на клетку', () => {
  it('идут на саму клетку, а не на её порт', async () => {
    const stimulate = vi.fn().mockResolvedValue(project())
    const record = vi.fn().mockResolvedValue(project())
    const control = await opened({ stimulate, record })

    await control.stimulate('E', null)
    await control.record('E', null)

    expect(stimulate).toHaveBeenCalledWith('s1', { instance: 'E', port: null })
    expect(record).toHaveBeenCalledWith('s1', { instance: 'E', port: null })
  })
})

describe('раскрытие блока', () => {
  it('остаётся на экране: ни запроса, ни отметки «не сохранено»', async () => {
    const control = await opened()
    const before = control.store.getState().project

    control.toggleBlock('ffi')

    expect(control.store.getState().opened).toEqual(['ffi'])
    // Блок и так считается насквозь -- `compose` разворачивает его нейроны в
    // общую сеть. Раскрытие только показывает это, поэтому проект тот же
    // объект: попади оно в песочницу, щелчок делал бы проект несохранённым, а
    // отпечаток -- устаревшим.
    expect(control.store.getState().project).toBe(before)
    expect(control.store.getState().project?.fingerprint).toBe('abc123')

    control.toggleBlock('ffi')
    expect(control.store.getState().opened).toEqual([])
  })

  it('забывается вместе с проектом: в другом те же имена -- другие блоки', async () => {
    const control = await opened()
    control.toggleBlock('ffi')

    await control.open('s1')

    expect(control.store.getState().opened).toEqual([])
  })

  it('внутренний узел соединяется тем же автоматом, что порт и сома', async () => {
    const connect = vi.fn().mockResolvedValue(project())
    const control = await opened({ connect })

    await control.touchEndpoint('E', null)
    await control.touchEndpoint('ffi/I', null)

    // Имя сетевое, порта нет: `ffi/I` -- ровно то, чем нейрон блока зовётся в
    // собранной модели, и второго вида адреса для него заводить нельзя.
    expect(connect).toHaveBeenCalledWith(
      's1',
      { instance: 'E', port: null },
      { instance: 'ffi/I', port: null },
    )
  })
})

describe('паттерн с карточки (#526)', () => {
  it('едет блоком вместе с витриной, одним запросом', async () => {
    // Одним, а не «вставить блок» плюс несколько «добавить стимул»: витрина
    // -- часть одного действия человека, и «Отменить» обязано возвращать
    // проект к тому, что было до перехода, а не оставлять драйв, целящийся в
    // исчезнувший блок.
    const addBlock = vi.fn().mockResolvedValue(project({ dirty: true }))
    const control = await opened({ addBlock })

    await control.bring('ffi')

    expect(addBlock).toHaveBeenCalledWith('s1', 'ffi', expect.anything(), true)
    expect(addBlock).toHaveBeenCalledTimes(1)
    expect(control.store.getState().project?.dirty).toBe(true)
  })

  it('кнопка «+» в панели библиотеки витрину по-прежнему не тащит', async () => {
    // Два ответа на один вопрос должны расходиться заметно: там просьба «дай
    // кусок схемы в мою сеть», и чужой драйв в ней спорил бы с собственным
    // входом.
    const addBlock = vi.fn().mockResolvedValue(project())
    const control = await opened({ addBlock })

    await control.insert('ffi')

    expect(addBlock).toHaveBeenCalledWith('s1', 'ffi', expect.anything(), false)
  })
})

describe('имя, копия и удаление выбранного (#563)', () => {
  /** Клетка на холсте -- то, у чего есть имя-адрес и что дублируют. */
  const cell = (id: string) => ({
    id,
    cellType: 'relay',
    position: [0, 0] as [number, number],
    inhibitory: false,
    pointModel: POINT,
  })

  it('переименовывает клетку и оставляет выделение на ней', async () => {
    // Имя клетки -- её адрес, и после правки выделение обязано переехать на
    // новое: человек переименовал то, на что смотрит, и панель свойств из-под
    // него исчезать не должна.
    const renameNeuron = vi
      .fn()
      .mockResolvedValue(project({ neurons: [cell('вход')], dirty: true }))
    const control = await opened({
      open: vi.fn().mockResolvedValue(project({ neurons: [cell('relay')] })),
      renameNeuron,
    })
    control.select({ kind: 'neuron', id: 'relay' })

    await control.renameNeuron('relay', 'вход')

    expect(renameNeuron).toHaveBeenCalledWith('s1', 'relay', 'вход')
    expect(control.store.getState().selected).toEqual({ kind: 'neuron', id: 'вход' })
  })

  it('пустое и то же самое имя до сервера не доводит', async () => {
    const renameNeuron = vi.fn()
    const control = await opened({ renameNeuron })

    await control.renameNeuron('relay', '  ')
    await control.renameNeuron('relay', 'relay')

    expect(renameNeuron).not.toHaveBeenCalled()
  })

  it('переименовывает проект и берёт ответ сервера целиком', async () => {
    const renameProject = vi.fn().mockResolvedValue(project({ name: 'Опыт 3' }))
    const control = await opened({ renameProject })

    await control.renameProject('  Опыт 3  ')

    expect(renameProject).toHaveBeenCalledWith('s1', 'Опыт 3')
    expect(control.store.getState().project?.name).toBe('Опыт 3')
  })

  it('дублирует объект и выделяет копию, а не оригинал', async () => {
    // Иначе следующее «дублировать» делало бы третью копию того же самого
    // вместо того, чтобы продолжать начатое. Имя копии раздаёт сервер, и
    // берётся оно из ответа, а не угадывается здесь.
    const duplicate = vi
      .fn()
      .mockResolvedValue(project({ neurons: [cell('relay'), cell('relay2')] }))
    const control = await opened({
      open: vi.fn().mockResolvedValue(project({ neurons: [cell('relay')] })),
      duplicate,
    })

    await control.duplicate('relay')

    expect(duplicate).toHaveBeenCalledWith('s1', 'relay')
    expect(control.store.getState().selected).toEqual({ kind: 'neuron', id: 'relay2' })
  })
})

describe('типы клеток самого проекта (#564)', () => {
  it('кладутся своим полем, а не через каталог', async () => {
    // Каталог и типы проекта -- разные источники, и одноимённый тип в них
    // бывает разным: разбор блока кладёт в проект `relay_2`, когда его
    // `relay` не совпал с проектным.
    const addNeuronOfType = vi.fn().mockResolvedValue(project({ dirty: true }))
    const addNeuron = vi.fn()
    const control = await opened({ addNeuronOfType, addNeuron })

    await control.insertCellOfType('target')

    expect(addNeuronOfType).toHaveBeenCalledWith('s1', 'target', expect.anything())
    expect(addNeuron).not.toHaveBeenCalled()
    expect(control.store.getState().project?.dirty).toBe(true)
  })

  it('каталожная клетка по-прежнему кладётся своей дорогой', async () => {
    const addNeuron = vi.fn().mockResolvedValue(project())
    const addNeuronOfType = vi.fn()
    const control = await opened({ addNeuron, addNeuronOfType })

    await control.insertCell('pyr')

    expect(addNeuron).toHaveBeenCalledWith('s1', 'pyr', expect.anything())
    expect(addNeuronOfType).not.toHaveBeenCalled()
  })
})

describe('подтверждение драйва и записи приходит туда, куда смотрят (#502)', () => {
  /** Проект с уже готовым стимулом и ответом, в котором появился второй. */
  function withDrive(id: string, instance: string, port: string | null) {
    const first = project().stimuli[0]!
    return {
      ...project(),
      stimuli: [first, { ...first, id, target: { ...first.target, instance, port } }],
    }
  }

  it('созданный стимул сразу становится выбранным', async () => {
    // Прежде выделение не менялось вовсе: панель свойств продолжала
    // показывать блок, холст не менялся ничем, и единственным
    // подтверждением была строка в другой вкладке.
    const stimulate = vi.fn().mockResolvedValue(withDrive('drive2', 'E', null))
    const control = await opened({ stimulate })

    await control.stimulate('E', null)

    expect(stimulate).toHaveBeenCalledWith('s1', { instance: 'E', port: null })
    expect(control.store.getState().selected).toEqual({
      kind: 'stimulus',
      id: 'drive2',
    })
  })

  it('второй драйв на тот же порт не заводится, а открывает первый', async () => {
    // Кнопка нажимается дважды легко -- на холсте до сих пор ничего не
    // менялось, -- и в проекте оказывались два стимула на один порт, то есть
    // вдвое больше входа, чем человек думал.
    const stimulate = vi.fn()
    const control = await opened({ stimulate })

    await control.stimulate('ffi', 'in')

    expect(stimulate).not.toHaveBeenCalled()
    expect(control.store.getState().selected).toEqual({
      kind: 'stimulus',
      id: 'drive1',
    })
  })

  it('драйв на соседний порт того же блока -- это другой драйв', async () => {
    // Повтор ищется по точке, а не по объекту холста: у коробки портов
    // пятеро, и драйв на каждый -- свой вход в схему.
    const stimulate = vi.fn().mockResolvedValue(withDrive('drive2', 'ffi', 'tonic'))
    const control = await opened({ stimulate })

    await control.stimulate('ffi', 'tonic')

    expect(stimulate).toHaveBeenCalledWith('s1', { instance: 'ffi', port: 'tonic' })
    expect(control.store.getState().selected).toEqual({
      kind: 'stimulus',
      id: 'drive2',
    })
  })

  it('созданная запись тоже становится выбранной', async () => {
    const answer = {
      ...project(),
      recordings: [
        ...project().recordings,
        { id: 'r9', target: { instance: 'E', port: null, section: 'soma', fraction: 0.5 }, var: 'v' },
      ],
    } as unknown as SandboxState
    const record = vi.fn().mockResolvedValue(answer)
    const control = await opened({ record })

    await control.record('E', null)

    expect(control.store.getState().selected).toEqual({ kind: 'recording', id: 'r9' })
  })
})
