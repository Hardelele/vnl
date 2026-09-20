/**
 * Нижняя панель: её тянут за границу, сворачивают в полоску, и высота её
 * переживает перезагрузку страницы.
 *
 * Здесь настоящий React и настоящая разметка, потому что проверяется именно
 * поведение окна: высота в стилях, содержимое внутри панели, а не флаг в
 * состоянии компонента.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ActivityPanel } from './ActivityPanel'
import { PANEL_HEIGHT, rememberPanelHeight } from '../../state/desk'

let root: Root | null = null
let host: HTMLElement

async function mount(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <ActivityPanel
        summary="4 клетки · 9 Гц"
        controls={<button type="button" className="probe-run">Запустить</button>}
        settings={<span className="probe-run-params">Длительность</span>}
      >
        <p className="probe">дорожки</p>
      </ActivityPanel>,
    )
  })
}

function panel(): HTMLElement {
  return host.querySelector('.ap') as HTMLElement
}

function height(): number {
  return Number.parseInt(panel().style.height, 10)
}

/** Тянем границу: pointerdown по ручке, движение и отпускание -- по окну. */
function drag(by: number): void {
  const grip = host.querySelector('.ap-grip') as HTMLElement
  act(() => {
    grip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 500 }))
  })
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 500 - by }))
  })
  act(() => {
    window.dispatchEvent(new MouseEvent('pointerup', { clientY: 500 - by }))
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  act(() => root?.unmount())
  host.remove()
  root = null
  localStorage.clear()
})

describe('панель активности', () => {
  it('открывается на запомненной высоте', async () => {
    rememberPanelHeight(300)
    await mount()

    expect(height()).toBe(300)
    expect(host.querySelector('.probe')).not.toBeNull()
  })

  it('граница тянется, и высота переживает перезагрузку', async () => {
    await mount()
    expect(height()).toBe(PANEL_HEIGHT)

    // Вверх -- значит выше: панель растёт к шапке.
    drag(60)
    expect(height()).toBe(PANEL_HEIGHT + 60)

    // «Перезагрузка страницы» -- новое дерево с тем же хранилищем.
    act(() => root?.unmount())
    await mount()
    expect(height()).toBe(PANEL_HEIGHT + 60)
  })

  it('сворачивается в полоску со сводкой, а не исчезает', async () => {
    await mount()

    const fold = host.querySelector('.ap-fold') as HTMLButtonElement
    act(() => fold.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    // Дорожек нет, но панель на месте и говорит, что в ней.
    expect(host.querySelector('.probe')).toBeNull()
    expect(panel().className).toContain('is-folded')
    expect(host.querySelector('.ap-sum')?.textContent).toBe('4 клетки · 9 Гц')
    // Тянуть свёрнутую полоску не за что.
    expect(host.querySelector('.ap-grip')).toBeNull()

    act(() =>
      (host.querySelector('.ap-fold') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      ),
    )
    expect(host.querySelector('.probe')).not.toBeNull()
  })

  it('управление временем остаётся на виду и у свёрнутой панели (#569)', async () => {
    // Транспорт переехал сюда из верхней полосы, и ровно это нельзя сломать:
    // «Запустить» и «Пауза» обязаны быть на виду во время прогона (#504).
    // Поэтому он в шапке, которая видна всегда, а не в теле, которое
    // сворачивается.
    await mount()
    expect(host.querySelector('.ap-controls .probe-run')).not.toBeNull()

    const fold = host.querySelector('.ap-fold') as HTMLButtonElement
    act(() => fold.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(panel().className).toContain('is-folded')
    expect(host.querySelector('.ap-controls .probe-run')).not.toBeNull()
  })

  it('числа прогона стоят над дорожками и сворачиваются вместе с ними (#569)', async () => {
    // Они не управление, а настройка: их задают до пуска, и к свёрнутой
    // панели приходят смотреть, а не настраивать.
    await mount()
    const run = host.querySelector('.ap-run .probe-run-params')
    expect(run).not.toBeNull()
    // Над дорожками, а не под ними: сперва «сколько считать», потом сам счёт.
    const body = host.querySelector('.ap-body') as HTMLElement
    expect(body.firstElementChild?.className).toBe('ap-run')

    const fold = host.querySelector('.ap-fold') as HTMLButtonElement
    act(() => fold.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(host.querySelector('.ap-run')).toBeNull()
  })
})
