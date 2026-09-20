/**
 * Транспорт: шаг по времени кнопками и стрелками.
 *
 * Настоящий React и настоящие события, потому что проверяется именно жест:
 * величина шага, знак, крупный шаг с Shift и то, у кого стрелка не отбирается
 * (#537). Пуск, пауза и сброс здесь не проверяются -- они и были.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { BIG_STEP_MS, STEP_MS, Transport, type TransportProps } from './Transport'

let root: Root | null = null
let host: HTMLElement
let steps: number[] = []

async function mount(extra: Partial<TransportProps> = {}): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <Transport
        state="paused"
        time={20}
        duration={400}
        busy={false}
        onStart={() => undefined}
        onPause={() => undefined}
        onReset={() => undefined}
        onStep={(delta) => steps.push(delta)}
        {...extra}
      />,
    )
  })
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (item) => item.getAttribute('aria-label') === label,
  )
  if (!found) throw new Error(`нет кнопки «${label}»`)
  return found as HTMLButtonElement
}

const BACK = 'Шаг назад на миллисекунду'
const FORWARD = 'Шаг вперёд на миллисекунду'

async function press(key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
  })
}

afterEach(() => {
  act(() => root?.unmount())
  host.remove()
  root = null
  steps = []
})

describe('шаг по времени', () => {
  it('кнопки двигают на миллисекунду в обе стороны', async () => {
    await mount()

    await act(async () => button(BACK).click())
    await act(async () => button(FORWARD).click())

    expect(steps).toEqual([-STEP_MS, STEP_MS])
  })

  it('стрелки шагают так же, как кнопки', async () => {
    await mount()

    await press('ArrowRight')
    await press('ArrowLeft')

    expect(steps).toEqual([STEP_MS, -STEP_MS])
  })

  it('с Shift шаг крупный', async () => {
    await mount()

    await press('ArrowRight', { shiftKey: true })

    expect(steps).toEqual([BIG_STEP_MS])
  })

  it('с Ctrl не шагает: это чужое сочетание', async () => {
    // Ctrl с колесом на таймлайне приближает время (#548), Ctrl со стрелкой --
    // ходьба по словам. Жесты не должны спорить.
    await mount()

    await press('ArrowRight', { ctrlKey: true })
    await press('ArrowLeft', { metaKey: true })

    expect(steps).toEqual([])
  })

  it('в поле ввода стрелка принадлежит тексту', async () => {
    await mount()
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()

    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    field.remove()

    expect(steps).toEqual([])
  })

  it('с начала назад шагать некуда', async () => {
    await mount({ time: 0 })

    expect(button(BACK).disabled).toBe(true)
    await press('ArrowLeft')

    expect(steps).toEqual([])
  })

  it('с конца вперёд шагать некуда', async () => {
    await mount({ time: 400, duration: 400, state: 'finished' })

    expect(button(FORWARD).disabled).toBe(true)
    await press('ArrowRight')

    expect(steps).toEqual([])
  })

  it('пока сессия занята, шаг не повторяется', async () => {
    await mount({ busy: true })

    expect(button(FORWARD).disabled).toBe(true)
    await press('ArrowRight')

    expect(steps).toEqual([])
  })
})
