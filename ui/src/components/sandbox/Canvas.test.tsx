/**
 * Клетка на холсте: фигура, точка подключения и связь между двумя клетками.
 *
 * Здесь настоящий React и настоящая разметка SVG, потому что проверяется
 * именно то, что видно: форма фигуры (тормозная квадратная, возбуждающая
 * скруглённая) и то, что конец связи у клетки идёт без порта. Проверкой
 * «функция вернула true» такое не поймать -- значение могло бы вовсе не
 * попасть в разметку.
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Canvas } from './Canvas'
import type { CellState } from '../../model/sim'
import type { SandboxBlock, SandboxLink, SandboxNeuron } from '../../model/sandbox'
import { START_VIEW, type CanvasView } from '../../state/sandbox'

const POINT = {
  kind: 'lif',
  vRest: -65,
  vReset: -65,
  vThreshold: -50,
  tauM: 10,
  rIn: 100,
  refractory: 2,
  adaptation: 0,
  tauAdaptation: 100,
}

function neuron(id: string, inhibitory: boolean, x: number): SandboxNeuron {
  return { id, cellType: id, position: [x, 100], inhibitory, pointModel: POINT }
}

/**
 * Блок FFI со своей начинкой.
 *
 * Схема приходит с сервера (`SandboxBlock.scheme`) вместе с тормозностью
 * каждой клетки: считать её здесь значило бы завести второе место, где это
 * слово означает своё.
 */
const FFI: SandboxBlock = {
  id: 'ffi',
  patternId: 'ffi',
  label: 'FFI',
  position: [300, 80],
  ports: [
    { name: 'in', direction: 'in', site: { instance: 'IN', section: 'soma', fraction: 0.5 }, note: '' },
    { name: 'out', direction: 'out', site: { instance: 'E', section: 'soma', fraction: 0.5 }, note: '' },
  ],
  counts: { neurons: 3, contacts: 3 },
  scheme: {
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
  },
  cells: [],
  contacts: [],
}

/** Связь снаружи прямо в тормозный нейрон блока, минуя порт `in`. */
const INTO_BLOCK: SandboxLink = {
  id: 'l2',
  source: { instance: 'E', port: null, section: 'soma', fraction: 0.5 },
  target: { instance: 'ffi/I', port: null, section: 'soma', fraction: 0.5 },
  receptor: 'ampa',
  inhibitory: false,
  weight: 1,
  delay: 1,
}

const LINK: SandboxLink = {
  id: 'l1',
  // У клетки порта нет: конец связи -- точка на ней самой.
  source: { instance: 'E', port: null, section: 'soma', fraction: 0.5 },
  target: { instance: 'I', port: null, section: 'soma', fraction: 0.5 },
  receptor: 'ampa',
  inhibitory: false,
  weight: 1,
  delay: 1,
}

/** Возврат: та же пара клеток, но связь идёт справа налево. */
const BACK: SandboxLink = { ...LINK, id: 'l3', source: LINK.target, target: LINK.source }

let root: Root | null = null
let host: HTMLElement

async function mount(props: Partial<Parameters<typeof Canvas>[0]> = {}) {
  const picked: Array<[string, string | null]> = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <Canvas
        blocks={[]}
        neurons={[neuron('E', false, 120), neuron('I', true, 360)]}
        links={[]}
        cells={{}}
        selected={null}
        pending={null}
        onPickBlock={vi.fn()}
        onPickNeuron={vi.fn()}
        onPickLink={vi.fn()}
        onPickEndpoint={(instance, port) => picked.push([instance, port])}
        onMove={vi.fn()}
        // Окно холста -- те же `760x420`, что были жёстким `viewBox` до #545:
        // проверки геометрии считались при них и должны считаться при них же.
        view={START_VIEW}
        onView={vi.fn()}
        onEmpty={vi.fn()}
        {...props}
      />,
    )
  })
  return picked
}

function inner(id: string): SVGGElement {
  const found = [...host.querySelectorAll('.cv-in-cell')].find(
    // Первый узел, а не весь текст: рядом лежит <title> с полным именем.
    (node) => node.querySelector('text')?.firstChild?.textContent === id,
  )
  if (!found) throw new Error(`внутри блока нет узла ${id}`)
  return found as SVGGElement
}

/** Область холста в пикселях: в jsdom её не меряют, и размер приходится задать. */
function rect(width: number, height: number): DOMRect {
  return {
    width,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect
}

function area(width: number, height: number) {
  return vi
    .spyOn(SVGElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(rect(width, height))
}

/**
 * Холст с настоящим окном: родитель применяет `onView`, как это делает экран.
 *
 * Нужен там, где проверяется не один вызов, а разговор: холст меняет окно,
 * родитель его принимает, холст рисует следующий кадр уже из нового. С
 * неподвижным окном (`mount`) второй шаг считался бы от прежнего размера.
 */
async function windowed(seen: CanvasView[]): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  function Screen() {
    const [view, setView] = useState<CanvasView>(START_VIEW)
    return (
      <Canvas
        blocks={[]}
        neurons={[]}
        links={[]}
        cells={{}}
        selected={null}
        pending={null}
        onPickBlock={vi.fn()}
        onPickNeuron={vi.fn()}
        onPickLink={vi.fn()}
        onPickEndpoint={vi.fn()}
        onMove={vi.fn()}
        onEmpty={vi.fn()}
        view={view}
        onView={(next) => {
          seen.push(next)
          setView(next)
        }}
      />
    )
  }

  await act(async () => {
    root!.render(<Screen />)
  })
}

/** Состояние клетки из сессии: доля и пик приходят с сервера, не считаются. */
function live(charge: number, spiked = false, peak = charge): CellState {
  return { v: -65 + charge * 15, spiked, charge, peak }
}

function cell(id: string): SVGGElement {
  const found = [...host.querySelectorAll('.cv-cell')].find((node) =>
    [...node.querySelectorAll('text')].some((text) =>
      text.textContent?.startsWith(id),
    ),
  )
  if (!found) throw new Error(`на холсте нет клетки ${id}`)
  return found as SVGGElement
}

beforeEach(() => {
  root = null
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

describe('клетка на холсте', () => {
  it('тормозная квадратная, возбуждающая скруглённая', async () => {
    await mount()

    // Обозначения те же, что в миниатюре каталога: разница читается и там,
    // где цвета нет.
    expect(cell('I').querySelector('rect')?.getAttribute('rx')).toBe('4')
    expect(cell('E').querySelector('rect')?.getAttribute('rx')).not.toBe('4')
    expect(cell('I').getAttribute('class')).toContain('is-inh')
    expect(cell('E').getAttribute('class')).not.toContain('is-inh')
  })

  it('соединяется точкой на себе, а не портом', async () => {
    const picked = await mount()

    act(() => {
      cell('E').querySelector('.cv-soma circle')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    // Порт пустой -- и это не пропуск: фиктивную «сому» пришлось бы
    // поддерживать и на сервере, где порта у клетки нет.
    expect(picked).toEqual([['E', null]])
  })

  it('светится по своему имени, без приставки блока', async () => {
    await mount({ cells: { E: live(1, true) } })

    expect(cell('E').getAttribute('class')).toContain('is-spiking')
    expect(cell('I').getAttribute('class')).not.toContain('is-spiking')
  })

  it('связь между двумя клетками рисуется, хотя портов у них нет', async () => {
    await mount({ links: [LINK] })

    // Прежний холст умел вести линию только между портами и на клетках молча
    // не рисовал ничего.
    expect(host.querySelectorAll('.cv-link .cv-wire')).toHaveLength(1)
  })

  it('связь справа налево уходит слева и приходит справа', async () => {
    // Клетки стоят на 120 и 360, фигура шириной 74. Прежде сторона была
    // прибита к роли конца -- провод выходил справа от `I` (397) и приходил
    // слева к `E` (83), то есть огибал обе клетки снаружи (#542).
    await mount({ links: [BACK] })

    const drawn = host.querySelector('.cv-link .cv-wire')?.getAttribute('d') ?? ''
    expect(drawn.startsWith('M 323 100 ')).toBe(true)
    expect(drawn.endsWith(' 157 100')).toBe(true)
  })

  it('связь слева направо уходит справа и приходит слева', async () => {
    await mount({ links: [LINK] })

    const drawn = host.querySelector('.cv-link .cv-wire')?.getAttribute('d') ?? ''
    expect(drawn.startsWith('M 157 100 ')).toBe(true)
    expect(drawn.endsWith(' 323 100')).toBe(true)
  })

  it('полоса попадания мышью -- та же кривая, что видимая', async () => {
    await mount({ links: [BACK] })

    const hit = host.querySelector('.cv-link .cv-hit')?.getAttribute('d')
    expect(hit).toBe(host.querySelector('.cv-link .cv-wire')?.getAttribute('d'))
  })

  it('пустой холст зовёт положить клетку, а не только вставить паттерн', async () => {
    await mount({ neurons: [] })

    expect(host.querySelector('.cv-empty')?.textContent).toContain('клетку')
  })
})

describe('блок на холсте', () => {
  it('свёрнутый показывает коробку со счётчиками, а не начинку', async () => {
    await mount({ blocks: [FFI] })

    expect(host.querySelectorAll('.cv-in-cell')).toHaveLength(0)
    expect(host.querySelector('.cv-sub')?.textContent).toContain('3 кл.')
  })

  it('раскрытый рисует начинку теми же обозначениями, что миниатюра', async () => {
    await mount({ blocks: [FFI], opened: ['ffi'] })

    expect(host.querySelectorAll('.cv-in-cell')).toHaveLength(3)
    // Тормозная квадратная, возбуждающая скруглённая -- разница читается и
    // там, где цвета нет.
    expect(inner('I').querySelector('rect')?.getAttribute('rx')).toBe('4')
    expect(inner('E').querySelector('rect')?.getAttribute('rx')).not.toBe('4')
    expect(inner('I').getAttribute('class')).toContain('is-inh')
    // Связи внутри блока рисуются тоже: без них видны точки, но не схема.
    expect(host.querySelectorAll('.cv-in-link .cv-in-wire')).toHaveLength(3)
    // Порты никуда не делись: они остаются названной точкой подключения.
    expect(host.querySelectorAll('.cv-port')).toHaveLength(2)
  })

  it('щелчок по внутреннему узлу даёт конец связи без порта', async () => {
    const picked = await mount({ blocks: [FFI], opened: ['ffi'] })

    act(() => {
      inner('I').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Имя сетевое: ровно так нейрон блока зовётся в собранной модели, и
    // придумывать ему второй вид адреса незачем.
    expect(picked).toEqual([['ffi/I', null]])
  })

  it('щелчок по внутреннему узлу не выбирает блок вместо узла', async () => {
    const chosen: string[] = []
    await mount({
      blocks: [FFI],
      opened: ['ffi'],
      onPickBlock: (id: string) => chosen.push(id),
    })

    act(() => {
      inner('E').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(chosen).toEqual([])
  })

  it('связь внутрь блока рисуется и входит в сам узел', async () => {
    await mount({ blocks: [FFI], links: [INTO_BLOCK], opened: ['ffi'] })
    const open = host.querySelector('.cv-link .cv-wire')?.getAttribute('d')

    act(() => root?.unmount())
    host.remove()
    await mount({ blocks: [FFI], links: [INTO_BLOCK] })
    const shut = host.querySelector('.cv-link .cv-wire')?.getAttribute('d')

    // Рисуется в обоих случаях: у свёрнутого блока узла на холсте нет, и связь
    // приводится к краю коробки -- прятать её нельзя, в схеме она есть.
    expect(open).toBeTruthy()
    expect(shut).toBeTruthy()
    // Но конец у неё разный: раскрытый блок показывает, куда связь вели.
    expect(open).not.toBe(shut)
  })

  it('переключатель раскрывает блок, а не меняет схему', async () => {
    const toggled: string[] = []
    await mount({ blocks: [FFI], onToggleBlock: (id: string) => toggled.push(id) })

    act(() => {
      host.querySelector('.cv-open .cv-open-pad')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    expect(toggled).toEqual(['ffi'])
  })

  it('у раскрытого блока светится разрядившийся узел, а не вся рамка', async () => {
    await mount({
      blocks: [FFI],
      opened: ['ffi'],
      cells: { 'ffi/I': live(1, true) },
    })

    expect(inner('I').getAttribute('class')).toContain('is-spiking')
    expect(inner('E').getAttribute('class')).not.toContain('is-spiking')
    expect(host.querySelector('.cv-block')?.getAttribute('class')).not.toContain(
      'is-spiking',
    )
  })
})

/**
 * Блок сам говорит, что его можно раскрыть и разобрать (#549).
 *
 * Обе возможности были и до задачи, но узнать о них было неоткуда: знак
 * раскрытия был безымянным кружком рядом с кружками портов, а разбор жил
 * только в панели свойств. Проверяется здесь не «функция вызвалась», а то,
 * что в разметке есть слова, по которым это находят глазами.
 */
describe('блок говорит о себе (#549)', () => {
  it('счётчик внутренностей сам и есть кнопка «показать, что внутри»', async () => {
    const toggled: string[] = []
    await mount({ blocks: [FFI], onToggleBlock: (id: string) => toggled.push(id) })

    // Счётчик никуда не делся: он по-прежнему говорит, сколько внутри.
    const peek = host.querySelector('.cv-open')
    expect(peek?.querySelector('.cv-sub')?.textContent).toContain('3 кл.')
    // Но теперь он ещё и зовёт: шеврон в подписи и слова в подсказке.
    expect(peek?.querySelector('.cv-sub')?.textContent).toContain('▾')
    expect(peek?.querySelector('title')?.textContent).toContain('что внутри')

    act(() => {
      peek?.querySelector('.cv-open-pad')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(toggled).toEqual(['ffi'])
  })

  it('без переключателя счётчик остаётся справкой и ни на что не зовёт', async () => {
    await mount({ blocks: [FFI] })

    // Холст рисуется и там, где проект не правят. Шеврон в этом случае обещал
    // бы дверь, которой нет.
    expect(host.querySelector('.cv-sub')?.textContent).not.toContain('▾')
    expect(host.querySelector('.cv-open')?.getAttribute('class')).toContain('is-mute')
  })

  it('знак раскрытия -- плашка с подписью, а не кружок, как порт', async () => {
    await mount({ blocks: [FFI], onToggleBlock: vi.fn() })

    // Ровно на этом человек и спотыкался: кружок рядом с кружками портов
    // читался как «добавить порт», а не «показать начинку».
    expect(host.querySelectorAll('.cv-open circle')).toHaveLength(0)
    expect(host.querySelector('.cv-open .cv-open-pad')?.tagName).toBe('rect')
  })

  it('двойной щелчок по коробке ведёт туда же, куда плашка', async () => {
    const toggled: string[] = []
    await mount({ blocks: [FFI], onToggleBlock: (id: string) => toggled.push(id) })

    act(() => {
      host.querySelector('.cv-block > rect')?.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true }),
      )
    })

    expect(toggled).toEqual(['ffi'])
  })

  it('двойной щелчок по внутреннему узлу блок не сворачивает', async () => {
    const toggled: string[] = []
    await mount({
      blocks: [FFI],
      opened: ['ffi'],
      onToggleBlock: (id: string) => toggled.push(id),
    })

    act(() => {
      inner('I').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    // Два щелчка «соединить» подряд -- это не приказ спрятать начинку в тот
    // самый момент, когда в неё целятся.
    expect(toggled).toEqual([])
  })

  it('у раскрытого блока плашка зовётся «свернуть»', async () => {
    await mount({ blocks: [FFI], opened: ['ffi'], onToggleBlock: vi.fn() })

    const shut = host.querySelector('.cv-open.is-shut')
    expect(shut?.querySelector('.cv-sub')?.textContent).toContain('свернуть')
  })

  it('у выбранного блока разбор находится прямо на холсте', async () => {
    const broken: string[] = []
    await mount({
      blocks: [FFI],
      selected: { kind: 'block', id: 'ffi' },
      onUngroupBlock: (id: string) => broken.push(id),
    })

    const act_ = host.querySelector('.cv-act')
    expect(act_?.querySelector('text')?.textContent).toBe('разобрать на клетки')
    // Подпись называет последствие, а не прячет его: блок перестаёт быть
    // блоком, и об этом сказано до щелчка, а не после.
    expect(act_?.querySelector('title')?.textContent).toContain(
      'перестанет быть блоком',
    )

    act(() => {
      act_?.querySelector('rect')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(broken).toEqual(['ffi'])
  })

  it('у невыбранного блока разбора на холсте нет', async () => {
    await mount({ blocks: [FFI], onUngroupBlock: vi.fn() })

    // Плашка под каждой коробкой превратила бы схему из десяти блоков в
    // список кнопок.
    expect(host.querySelectorAll('.cv-act')).toHaveLength(0)
  })

  it('порт называет себя портом, а узел внутри -- своим сетевым именем', async () => {
    await mount({ blocks: [FFI], opened: ['ffi'], onToggleBlock: vi.fn() })

    const port = [...host.querySelectorAll('.cv-port')][0]
    expect(port?.querySelector('title')?.textContent).toContain('порт')
    expect(inner('I').querySelector('title')?.textContent).toContain('ffi/I')
  })
})

describe('заряд клетки на холсте', () => {
  it('над фигурой стоит доля заряда в процентах', async () => {
    await mount({ cells: { E: live(0.33), I: live(0.66) } })

    // Вспышка говорит «разрядилась» и молчит о том, почему соседняя не
    // разрядилась: не хватило десяти процентов или вход до неё не дошёл.
    expect(cell('E').querySelector('.cv-level')?.textContent).toBe('33%')
    expect(cell('I').querySelector('.cv-level')?.textContent).toBe('66%')
  })

  it('надпись стоит над фигурой, а не в ней', async () => {
    await mount({ cells: { E: live(0.5) } })
    const level = cell('E').querySelector('.cv-level')
    const shape = cell('E').querySelector('rect')

    expect(Number(level?.getAttribute('y'))).toBeLessThan(
      Number(shape?.getAttribute('y')),
    )
  })

  it('клетка ниже покоя отмечена, а не показана нулём', async () => {
    await mount({ cells: { E: live(-0.2), I: live(0.8) } })
    const below = cell('E').querySelector('.cv-level')

    expect(below?.textContent).toBe('↓20%')
    expect(below?.classList.contains('is-below')).toBe(true)
    expect(
      cell('I').querySelector('.cv-level')?.classList.contains('is-below'),
    ).toBe(false)
  })

  it('заливка идёт по доле и обрезана по фигуре', async () => {
    await mount({ cells: { E: live(0.5), I: live(-0.2) } })

    expect(cell('E').querySelector('.cv-charge')?.getAttribute('opacity')).toBe('0.5')
    expect(cell('I').querySelector('.cv-charge')?.getAttribute('opacity')).toBe('0')
  })

  it('в кадре разряда написано сто процентов, а не значение после сброса', async () => {
    // Между кадрами движок делает полсотни шагов, разряд занимает один.
    // Правило кадра (`momentOf`) общее с карточкой паттерна: своей ветки для
    // песочницы нет -- иначе разряд, видимый на карточке, здесь пропал бы.
    await mount({ cells: { E: live(0, true, 1) } })

    expect(cell('E').querySelector('.cv-level')?.textContent).toBe('100%')
  })

  it('после перемотки показан настоящий заряд, а не сто процентов', async () => {
    // Перемотка -- не кадр: сервер начинает накопленное заново от достигнутого
    // состояния (#534), и давно разрядившаяся клетка приходит с `spiked: false`.
    await mount({ cells: { E: live(0, false, 0) } })

    expect(cell('E').querySelector('.cv-level')?.textContent).toBe('0%')
  })

  it('без ответа сессии надпись не выдумывается', async () => {
    await mount({ cells: {} })

    expect(host.querySelectorAll('.cv-level')).toHaveLength(0)
  })

  it('в раскрытом блоке заряд стоит над каждым внутренним узлом', async () => {
    await mount({
      blocks: [FFI],
      opened: ['ffi'],
      cells: { 'ffi/IN': live(0.2), 'ffi/E': live(0.4), 'ffi/I': live(0.6) },
    })

    expect(inner('IN').querySelector('.cv-in-level')?.textContent).toBe('20%')
    expect(inner('E').querySelector('.cv-in-level')?.textContent).toBe('40%')
    expect(inner('I').querySelector('.cv-in-level')?.textContent).toBe('60%')
  })

  it('свёрнутый блок заряда не показывает: у коробки его нет', async () => {
    await mount({
      blocks: [FFI],
      cells: { 'ffi/IN': live(0.2), 'ffi/E': live(0.4), 'ffi/I': live(0.6) },
    })

    // Средним по пятерым клеткам с разными порогами ничего не измеришь, а
    // число у порта прочли бы как заряд блока целиком. Остаётся вспышка, а
    // числа -- по щелчку на «+».
    expect(host.querySelectorAll('.cv-level')).toHaveLength(0)
    expect(host.querySelectorAll('.cv-in-level')).toHaveLength(0)
  })
})

describe('клетка на холсте объясняется подсказкой (#541)', () => {
  /** Каталог -- тот же, что приходит с `/api/cells`: `note` уже написан. */
  const PALETTE = [
    {
      id: 'I',
      name: 'Интернейрон SST',
      note: 'Медленное торможение, обычно по дендритам.',
      tags: ['inhibitory'],
      transmitter: 'gaba',
      inhibitory: true,
      builtin: true,
      source: null,
      pointModel: POINT,
      morphology: { name: 'point', isPoint: true, sections: [] },
    },
  ]

  it('наведение на клетку говорит, что она делает', async () => {
    await mount({ palette: PALETTE })

    const cell = [...host.querySelectorAll('.cv-cell')].find((node) =>
      node.querySelector('title')?.textContent?.includes('SST'),
    )
    expect(cell?.querySelector('title')?.textContent).toContain(
      'Медленное торможение',
    )
  })

  it('без каталога клетка называет хотя бы себя и свой тип', async () => {
    // Подсказка объясняет, а не управляет: до ответа сервера холст рисуется
    // так же, как рисовался.
    await mount()

    const cell = host.querySelector('.cv-cell title')
    expect(cell?.textContent).toContain('E')
  })
})

describe('перетаскивание по холсту', () => {
  it('клетка едет за курсором, когда область холста не той пропорции', async () => {
    // Холст вписан в область с сохранением пропорций, и масштаб задаёт та
    // сторона, которой не хватает. Область 1520x420 шире, чем холст 760x420,
    // поэтому упирается он в высоту: единиц холста в пикселе ровно один.
    // Счёт по одной ширине дал бы половину -- и клетка отставала бы от курсора
    // вдвое. Ровно это и случилось, когда высоту области стала задавать
    // тянущаяся нижняя панель.
    const moved: Array<[string, [number, number]]> = []
    const box = vi
      .spyOn(SVGElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 1520, height: 420, x: 0, y: 0, top: 0, left: 0,
        right: 1520, bottom: 420, toJSON: () => ({}) } as DOMRect)
    try {
      await mount({ onMove: (id, position) => moved.push([id, position]) })

      const grabbed = cell('E')
      await act(async () => {
        grabbed.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 100 }),
        )
        window.dispatchEvent(
          new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 140 }),
        )
        window.dispatchEvent(
          new MouseEvent('pointerup', { bubbles: true, clientX: 300, clientY: 140 }),
        )
      })

      // Клетка стояла на [120, 100]; курсор проехал 100 по X и 40 по Y.
      expect(moved).toEqual([['E', [220, 140]]])
    } finally {
      box.mockRestore()
    }
  })

  it('клетка едет за курсором и при приближении', async () => {
    // То же самое, но окно вдвое меньше области: единиц холста в пикселе --
    // половина. Перевод «пиксели -> единицы» один и тот же и в отрисовке, и в
    // перетаскивании, иначе объект отставал бы от курсора ровно во столько,
    // во сколько приближено (#544, #545).
    const moved: Array<[string, [number, number]]> = []
    const box = area(1520, 420)
    try {
      await mount({
        view: { x: 0, y: 0, width: 760, height: 210 },
        onMove: (id, position) => moved.push([id, position]),
      })

      await act(async () => {
        cell('E').dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 100 }),
        )
        window.dispatchEvent(
          new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 140 }),
        )
        window.dispatchEvent(
          new MouseEvent('pointerup', { bubbles: true, clientX: 300, clientY: 140 }),
        )
      })

      // Курсор проехал 100 пикселей по X и 40 по Y -- на приближении ×2 это
      // 50 и 20 единиц холста.
      expect(moved).toEqual([['E', [170, 120]]])
    } finally {
      box.mockRestore()
    }
  })
})

/**
 * Холст -- окно в координаты схемы (#545).
 *
 * Проверяется не «функция вернула число», а то, что видно: какой кусок
 * координат нарисован (`viewBox`), что от размера области меняется он, а не
 * размер схемы, и что жесты те же, что на таймлайне.
 */
describe('холст -- окно в схему (#545)', () => {
  it('viewBox -- это окно, а не жёсткие 760x420', async () => {
    await mount({ view: { x: 300, y: 120, width: 400, height: 200 } })

    expect(host.querySelector('.cv-svg')?.getAttribute('viewBox')).toBe(
      '300 120 400 200',
    )
  })

  it('область другой высоты меняет окно, а не приближение', async () => {
    // Ровно та беда, ради которой задача и заведена: человек тянет границу
    // нижней панели, а схема на холсте становится крупнее или мельче, хотя
    // место объектов то же.
    const seen: CanvasView[] = []
    const box = area(1520, 420)
    try {
      await windowed(seen)
      // Первое измерение: единица холста -- пиксель экрана.
      expect(seen.at(-1)).toEqual({ x: 0, y: 0, width: 1520, height: 420 })

      // Панель выросла, холсту осталось 300 пикселей высоты.
      box.mockReturnValue(rect(1520, 300))
      await act(async () => {
        window.dispatchEvent(new Event('resize'))
      })

      // Ширина окна та же -- значит приближение то же; поменялось только то,
      // сколько схемы видно по высоте.
      expect(seen.at(-1)).toEqual({ x: 0, y: 0, width: 1520, height: 300 })
    } finally {
      box.mockRestore()
    }
  })

  it('голое колесо листает схему, а Ctrl с колесом приближает', async () => {
    // Те же жесты, что на таймлайне после #548: два разных способа приближать
    // в одном экране -- это жест, значение которого зависит от того, над чем
    // держат курсор, а этого человек не помнит.
    const seen: CanvasView[] = []
    const box = area(1000, 500)
    try {
      await mount({
        view: { x: 0, y: 0, width: 1000, height: 500 },
        onView: (next: CanvasView) => seen.push(next),
      })
      const svg = host.querySelector('.cv-svg')!

      await act(async () => {
        svg.dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }),
        )
      })
      // Листает: окно того же размера, только уехало вниз.
      expect(seen.at(-1)).toEqual({ x: 0, y: 120, width: 1000, height: 500 })

      await act(async () => {
        svg.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: -100,
            clientX: 0,
            clientY: 0,
          }),
        )
      })
      // Приближает: окно стало меньше, значит схема крупнее.
      expect(seen.at(-1)!.width).toBeLessThan(1000)
      // Точка под курсором осталась на месте -- курсор стоял в левом верхнем
      // углу области, значит и угол окна не тронулся.
      expect(seen.at(-1)!.x).toBeCloseTo(0, 6)
      expect(seen.at(-1)!.y).toBeCloseTo(0, 6)
    } finally {
      box.mockRestore()
    }
  })

  it('пустой холст зовёт положить клетку посреди окна, а не посреди координат', async () => {
    await mount({
      blocks: [],
      neurons: [],
      view: { x: 1000, y: 500, width: 400, height: 200 },
    })
    const hint = host.querySelector('.cv-empty')

    // Уехав прокруткой, человек иначе видел бы просто ничего и не знал бы,
    // что делать.
    expect(hint?.textContent).toContain('Положите клетку')
    expect(Number(hint?.getAttribute('x'))).toBe(1200)
    expect(Number(hint?.getAttribute('y'))).toBe(600)
  })

  it('«вписать» показывает всю схему целиком', async () => {
    const seen: CanvasView[] = []
    const box = area(1000, 500)
    try {
      await mount({
        // Уехали далеко от схемы: назад по одному щелчку колеса не вернёшься.
        view: { x: 4000, y: 4000, width: 1000, height: 500 },
        onView: (next: CanvasView) => seen.push(next),
      })

      await act(async () => {
        host.querySelector('.cv-fit')?.dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        )
      })

      // Клетки стоят на 120 и 360, фигура 74x38: обе обязаны попасть в окно.
      const now = seen.at(-1)!
      expect(now.x).toBeLessThan(120 - 37)
      expect(now.y).toBeLessThan(100 - 19)
      expect(now.x + now.width).toBeGreaterThan(360 + 37)
      expect(now.y + now.height).toBeGreaterThan(100 + 19)
    } finally {
      box.mockRestore()
    }
  })

  it('пустое место тянется мышью, а щелчок по нему снимает выделение', async () => {
    const seen: CanvasView[] = []
    const dropped: number[] = []
    const box = area(1000, 500)
    try {
      await mount({
        view: { x: 0, y: 0, width: 1000, height: 500 },
        onView: (next: CanvasView) => seen.push(next),
        onEmpty: () => dropped.push(1),
      })
      const svg = host.querySelector('.cv-svg')!

      // Тяга: окно едет против руки -- схема едет за ней.
      await act(async () => {
        svg.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 300 }),
        )
        window.dispatchEvent(
          new MouseEvent('pointermove', { bubbles: true, clientX: 340, clientY: 260 }),
        )
        window.dispatchEvent(
          new MouseEvent('pointerup', { bubbles: true, clientX: 340, clientY: 260 }),
        )
      })
      expect(seen.at(-1)).toEqual({ x: 60, y: 40, width: 1000, height: 500 })
      // Рука уехала -- значит это было перетаскивание, а не щелчок.
      expect(dropped).toEqual([])

      // Щелчок без движения -- по-прежнему «снять выделение».
      await act(async () => {
        svg.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 300 }),
        )
        window.dispatchEvent(
          new MouseEvent('pointerup', { bubbles: true, clientX: 400, clientY: 300 }),
        )
      })
      expect(dropped).toEqual([1])
    } finally {
      box.mockRestore()
    }
  })

  it('на пустом холсте вписывать нечего, и кнопка об этом говорит', async () => {
    await mount({ blocks: [], neurons: [] })

    expect(host.querySelector('.cv-fit')?.hasAttribute('disabled')).toBe(true)
  })
})
