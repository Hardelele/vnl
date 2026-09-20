/**
 * Панель кнопок: нажатие, отпускание, лампочка мотора и отсутствие панели
 * там, где привязывать нечего (#562).
 *
 * Здесь настоящий React и настоящая разметка, потому что проверяется именно
 * поведение панели: что уходит в сессию на нажатие и отпускание, чем горит
 * кнопка и откуда она берёт это «горит». Флаг внутри компонента тут не
 * проверить -- своего «нажато» у панели и нет.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ButtonBoard } from './ButtonBoard'
import type { SandboxMotor, SandboxSensor } from '../../model/sandbox'
import { rememberButtons, type BoardButton } from '../../state/board'

const KEY: SandboxSensor = {
  id: 'key',
  kind: 'rate',
  story: 'частота, 100 Гц при 1',
  to: 100,
  position: [0, 0],
}

const OUT: SandboxMotor = {
  id: 'out',
  kind: 'rate',
  story: 'частота за окно 50 мс',
  unit: 'Гц',
  window: 50,
  source: { instance: 'MN', port: null, section: 'soma', fraction: 0.5 },
  position: [0, 0],
}

let root: Root | null = null
let host: HTMLElement
/** Что ушло в сессию: панель ничего не считает, она подаёт. */
let sent: Array<Record<string, number>> = []

interface Shown {
  sensors?: SandboxSensor[]
  motors?: SandboxMotor[]
  values?: Record<string, number>
  output?: Record<string, number>
  live?: boolean
}

async function mount(shown: Shown = {}): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <ButtonBoard
        project="p1"
        sensors={shown.sensors ?? [KEY]}
        motors={shown.motors ?? [OUT]}
        values={shown.values ?? {}}
        output={shown.output ?? {}}
        live={shown.live ?? true}
        onSense={(values) => sent.push(values)}
      />,
    )
  })
}

/** Перерисовать с новым ответом сессии -- как делает экран на каждом кадре. */
async function again(shown: Shown): Promise<void> {
  await act(async () => {
    root!.render(
      <ButtonBoard
        project="p1"
        sensors={shown.sensors ?? [KEY]}
        motors={shown.motors ?? [OUT]}
        values={shown.values ?? {}}
        output={shown.output ?? {}}
        live={shown.live ?? true}
        onSense={(values) => sent.push(values)}
      />,
    )
  })
}

function keys(): HTMLElement[] {
  return [...host.querySelectorAll('.bb-key')] as HTMLElement[]
}

function pressAt(index: number): void {
  const button = keys()[index]!.querySelector('.bb-press') as HTMLElement
  act(() => {
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  })
}

function releaseAt(index: number): void {
  const button = keys()[index]!.querySelector('.bb-press') as HTMLElement
  act(() => {
    button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
  })
}

function saved(...buttons: BoardButton[]): void {
  rememberButtons('p1', buttons)
}

const GAS: BoardButton = { id: 'btn1', name: 'Газ', role: 'sensor', bind: 'key', key: 'KeyG' }
const LAMP: BoardButton = { id: 'btn2', name: 'Ход', role: 'motor', bind: 'out', key: null }

beforeEach(() => {
  localStorage.clear()
  sent = []
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host.remove()
})

describe('панель появляется только там, где есть что привязывать', () => {
  it('схема без сенсоров и моторов выглядит как раньше -- панели нет', async () => {
    await mount({ sensors: [], motors: [] })

    expect(host.querySelector('.bb')).toBeNull()
  })

  it('один сенсор -- и панель уже есть', async () => {
    await mount({ motors: [] })

    expect(host.querySelector('.bb')).not.toBeNull()
  })
})

describe('нажатие и отпускание', () => {
  it('нажали -- ушла единица, отпустили -- ноль', async () => {
    saved(GAS)
    await mount()

    pressAt(0)
    expect(sent).toEqual([{ key: 1 }])

    releaseAt(0)
    expect(sent).toEqual([{ key: 1 }, { key: 0 }])
  })

  it('удержание -- одна единица, а не поток: повтор не шлётся', async () => {
    // Иначе автоповтор клавиши превратил бы одно нажатие в сотню записей
    // поданного, и повторить опыт по записи было бы нечем.
    saved(GAS)
    await mount()

    pressAt(0)
    pressAt(0)

    expect(sent).toEqual([{ key: 1 }])
  })

  it('клавиша нажимает ту же кнопку и тем же значением', async () => {
    saved(GAS)
    await mount()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true }))
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyG', bubbles: true }))
    })

    expect(sent).toEqual([{ key: 1 }, { key: 0 }])
  })

  it('окно ушло из фокуса -- зажатое отпускается само', async () => {
    // `keyup` до окна уже не дойдёт, и сенсор остался бы нажатым навсегда.
    saved(GAS)
    await mount()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true }))
    })
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    expect(sent).toEqual([{ key: 1 }, { key: 0 }])
  })

  it('без сессии нажимать некуда, и панель говорит об этом', async () => {
    saved(GAS)
    await mount({ live: false })

    pressAt(0)

    expect(sent).toEqual([])
    expect(host.querySelector('.bb-note')?.textContent).toContain('запустите')
  })
})

describe('кнопка горит по ответу сессии, а не по пальцу', () => {
  it('сенсорная горит, пока сессия говорит, что величину держат', async () => {
    saved(GAS)
    await mount({ values: { key: 1 } })

    expect(keys()[0]!.className).toContain('is-on')

    // Перемотка назад: палец с кнопки никто не убирал, а прогон стоит на
    // моменте до нажатия -- и кнопка обязана погаснуть.
    await again({ values: { key: 0 } })
    expect(keys()[0]!.className).not.toContain('is-on')
  })

  it('моторная горит, пока мотор отдаёт ненулевое, и показывает число', async () => {
    saved(LAMP)
    await mount({ output: { out: 40 } })

    expect(keys()[0]!.className).toContain('is-on')
    expect(keys()[0]!.textContent).toContain('40 Гц')

    await again({ output: { out: 0 } })
    expect(keys()[0]!.className).not.toContain('is-on')
  })

  it('моторная не нажимается: подавать ей нечего', async () => {
    saved(LAMP)
    await mount({ output: { out: 40 } })

    pressAt(0)

    expect(sent).toEqual([])
  })
})

describe('кнопки заводят и убирают', () => {
  it('заведённая кнопка привязана к двери из ответа сервера', async () => {
    await mount()

    act(() => {
      ;(host.querySelector('.bb-add') as HTMLElement).click()
    })
    const choice = host.querySelector('.bb-new select') as HTMLSelectElement
    // В списке ровно то, что пришло с сервера: выдумывать двери нельзя.
    expect([...choice.options].map((item) => item.value)).toEqual([
      'sensor:key',
      'motor:out',
    ])

    act(() => {
      ;(host.querySelector('.bb-new') as HTMLFormElement).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })

    expect(keys()).toHaveLength(1)
    pressAt(0)
    expect(sent).toEqual([{ key: 1 }])
  })

  it('кнопки переживают перезагрузку страницы: они в браузере, а не в схеме', async () => {
    saved(GAS, LAMP)
    await mount()

    expect(keys().map((item) => item.querySelector('.bb-name')?.textContent)).toEqual([
      'Газ',
      'Ход',
    ])
  })

  it('дверь убрали из схемы -- кнопка остаётся и говорит об этом', async () => {
    // Прятать её нельзя: человек искал бы пропавшую кнопку, а пропал сенсор.
    saved(GAS)
    await mount({ sensors: [] })

    expect(keys()[0]!.className).toContain('is-lost')
    expect((keys()[0]!.querySelector('.bb-press') as HTMLButtonElement).disabled).toBe(true)
  })

  it('убранная кнопка не возвращается после перерисовки', async () => {
    saved(GAS)
    await mount()

    act(() => {
      ;(keys()[0]!.querySelector('.bb-drop') as HTMLElement).click()
    })

    expect(keys()).toHaveLength(0)
    await again({})
    expect(keys()).toHaveLength(0)
  })
})
