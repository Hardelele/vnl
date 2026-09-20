/**
 * Таймлайн: что на нём написано и что делает мышь.
 *
 * Здесь настоящий React и настоящая разметка, потому что проверяется именно
 * то, что видно и нажимается: имя дорожки -- кнопка только там, где щелчку
 * есть что открыть, полное имя стоит в подсказке всегда, а необратимый жест
 * назван словами (#504).
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TIMELINE_HINT, Timeline, momentAt } from './Timeline'

const ORDER = ['short_term_depression2/DEP', 'E2']
const SPIKES: Record<string, number[]> = { 'short_term_depression2/DEP': [10, 30], E2: [] }

let root: Root | null = null
let host: HTMLElement
let seeks: number[] = []

async function mount(
  extra: { onSelect?: (name: string) => void; onSeek?: (time: number) => void } = {},
): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <Timeline
        duration={400}
        time={0}
        dt={0.1}
        order={ORDER}
        spikes={SPIKES}
        traces={{}}
        inhibitory={{ E2: false }}
        onSeek={(moment) => seeks.push(moment)}
        {...extra}
      />,
    )
  })
}

function names(): HTMLElement[] {
  return [...host.querySelectorAll('.tl-name')] as HTMLElement[]
}

afterEach(() => {
  act(() => root?.unmount())
  host.remove()
  root = null
  seeks = []
  vi.restoreAllMocks()
})

describe('дорожка таймлайна', () => {
  it('без инспектора имя -- не кнопка, но с полной подсказкой', async () => {
    await mount()

    const [first] = names()
    expect(first?.tagName).toBe('SPAN')
    expect(first?.getAttribute('title')).toBe('short_term_depression2/DEP')
    expect(first?.className).not.toContain('is-pick')
  })

  it('имя клетки и приставка блока -- порознь, и приставка не съедает имя', async () => {
    await mount()

    const [first, second] = names()
    expect(first?.querySelector('.tl-cell')?.textContent).toBe('DEP')
    expect(first?.querySelector('.tl-owner')?.textContent).toBe('short_term_depression2')
    // У положенной руками клетки приставки нет -- и строки под именем тоже.
    expect(second?.querySelector('.tl-cell')?.textContent).toBe('E2')
    expect(second?.querySelector('.tl-owner')).toBeNull()
  })

  it('с инспектором имя становится кнопкой и открывает клетку', async () => {
    const picked: string[] = []
    await mount({ onSelect: (name) => picked.push(name) })

    const [first] = names()
    expect(first?.tagName).toBe('BUTTON')
    act(() => first?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(picked).toEqual(['short_term_depression2/DEP'])
  })

  it('поле дорожек объясняет свой необратимый жест', async () => {
    await mount()

    const field = host.querySelector('.tl-field')
    expect(field?.getAttribute('title')).toBe(TIMELINE_HINT)
  })
})

/**
 * Масштаб времени (#536).
 *
 * Главное здесь одно: щелчок обязан попадать в момент под курсором при
 * текущем масштабе и прокрутке. Это единственное место, где масштаб меняет не
 * показ, а поведение, -- остальное можно увидеть глазами, а промах перемотки
 * выглядит как исправная перемотка не туда.
 */
describe('масштаб времени', () => {
  it('момент считается по геометрии поля, а не по доле видимой ширины', () => {
    // Панель 700 px, прогон 400 мс, приближение 8x, прокручено на 1400 px:
    // поле шириной 5600 px уехало влево, и его левый край -- за экраном.
    const box = { left: -1400, width: 5600 }

    expect(momentAt(350, box, 400)).toBeCloseTo(125, 6)
    // Доля от видимой ширины дала бы 200 мс -- ровно та ошибка, ради которой
    // геометрию и берут у самого поля.
    expect((350 / 700) * 400).toBe(200)

    // Края не выпускают за прогон: указатель может стоять и левее начала.
    expect(momentAt(-2000, box, 400)).toBe(0)
    expect(momentAt(9000, box, 400)).toBe(400)
  })

  it('щелчок при масштабе и прокрутке перематывает в момент под курсором', async () => {
    await mount()

    const field = host.querySelector('.tl-field') as HTMLElement
    // Поле в 8 раз шире панели и уехало влево на 1400 px -- как после
    // приближения колесом и прокрутки вправо.
    vi.spyOn(field, 'getBoundingClientRect').mockReturnValue({
      left: -1400,
      width: 5600,
      top: 0,
      bottom: 64,
      right: 4200,
      height: 64,
      x: -1400,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    act(() => {
      field.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 350 }))
    })

    expect(seeks).toHaveLength(1)
    expect(seeks[0]).toBeCloseTo(125, 6)
  })

  /**
   * Геометрия панели как в браузере: колонка имён 176 px, поле 1264 px.
   * В jsdom все прямоугольники нулевые, а колесу надо знать, над чем оно.
   */
  function geometry(): void {
    const box = (left: number, width: number): DOMRect =>
      ({
        left,
        width,
        right: left + width,
        top: 0,
        bottom: 20,
        height: 20,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    vi.spyOn(host.querySelector('.tl-corner') as HTMLElement, 'getBoundingClientRect')
      .mockReturnValue(box(0, 176))
    vi.spyOn(host.querySelector('.tl-marks') as HTMLElement, 'getBoundingClientRect')
      .mockReturnValue(box(176, 1264))
  }

  function wheel(deltaY: number, clientX: number, ctrlKey = false): void {
    act(() => {
      ;(host.querySelector('.tl') as HTMLElement).dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          clientX,
          ctrlKey,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
  }

  it('голое колесо листает дорожки и не трогает масштаб (#548)', async () => {
    await mount()
    geometry()

    // И над колонкой имён, и над полем: раньше над полем голое колесо
    // приближало, и один жест значил два действия -- какое именно, зависело
    // от невидимого состояния. Упёршись в предел масштаба, тот же поворот
    // колеса вдруг доставался браузеру прокруткой, и выглядело это так, будто
    // вниз таймлайн листается, а вверх -- приближается.
    wheel(-240, 100)
    wheel(-240, 600)

    // Двенадцать дорожек иначе было бы нечем пройти: панель низкая, а колесо
    // -- единственный способ их прокрутить.
    expect((host.querySelector('.tl-zoom') as HTMLButtonElement).textContent).toBe('целиком')
  })

  it('Ctrl с колесом приближает, кнопка возвращает прогон целиком', async () => {
    await mount()

    const zoom = () => host.querySelector('.tl-zoom') as HTMLButtonElement
    const body = () => host.querySelector('.tl-body') as HTMLElement
    expect(zoom().textContent).toBe('целиком')
    expect(zoom().disabled).toBe(true)
    expect(body().style.width).toBe('')

    wheel(-100, 200, true)

    expect(zoom().textContent?.startsWith('×1.2')).toBe(true)
    expect(zoom().disabled).toBe(false)
    // Поле стало шире панели, колонка имён -- нет: она прибита слева.
    expect(body().style.width).toContain('var(--tl-name)')

    act(() => zoom().dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(zoom().textContent).toBe('целиком')
    expect(body().style.width).toBe('')
  })

  it('подписи шкалы густеют с приближением -- иначе их не было бы в окне', async () => {
    await mount()
    const marks = () => host.querySelectorAll('.tl-mark').length
    const before = marks()

    wheel(-600, 200, true)

    expect(marks()).toBeGreaterThan(before)
  })
})
