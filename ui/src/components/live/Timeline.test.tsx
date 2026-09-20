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
import { afterEach, describe, expect, it } from 'vitest'

import { TIMELINE_HINT, Timeline } from './Timeline'

const ORDER = ['short_term_depression2/DEP', 'E2']
const SPIKES: Record<string, number[]> = { 'short_term_depression2/DEP': [10, 30], E2: [] }

let root: Root | null = null
let host: HTMLElement

async function mount(extra: { onSelect?: (name: string) => void } = {}): Promise<void> {
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
        onSeek={() => undefined}
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
