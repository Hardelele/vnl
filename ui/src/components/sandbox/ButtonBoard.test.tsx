/**
 * Панель кнопок: нажатие, отпускание, лампочка мотора и отсутствие панели
 * там, где привязывать нечего (#562), и петля через внешний мир -- одна
 * кнопка, привязанная и к мотору, и к сенсору (#574).
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
import { boardController, rememberButtons, type BoardButton } from '../../state/board'

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
  scheme?: boolean
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
        scheme={shown.scheme ?? true}
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
        scheme={shown.scheme ?? true}
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

const GAS: BoardButton = {
  id: 'btn1',
  name: 'Газ',
  sensor: 'key',
  motor: null,
  key: 'KeyG',
}
const LAMP: BoardButton = { id: 'btn2', name: 'Ход', sensor: null, motor: 'out', key: null }
/** Кнопка петли: та же дверь внутрь и та же дверь наружу на одной кнопке (#574). */
const LOOP: BoardButton = { id: 'btn3', name: 'Петля', sensor: 'key', motor: 'out', key: 'KeyL' }

beforeEach(() => {
  localStorage.clear()
  // Список кнопок теперь общий на экран (#576) и переживает размонтирование
  // панели -- как ему и положено. Проверка кладёт кнопки прямо в хранилище,
  // значит и прочитать их экран должен заново.
  boardController.forget()
  sent = []
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host.remove()
})

describe('панель появляется только там, где есть что привязывать', () => {
  it('пустой проект панели не получает вовсе', async () => {
    // На пустом холсте кнопок не ищут: человек смотрит в палитру, а не под
    // холст, и строка про сенсоры была бы ответом на незаданный вопрос.
    await mount({ sensors: [], motors: [], scheme: false })

    expect(host.querySelector('.bb')).toBeNull()
  })

  it('в схеме без дверей на месте полосы -- строка, где их взять (#573)', async () => {
    // Раньше полосы не было вовсе, и человек, искавший кнопки, не узнавал,
    // что сперва нужна дверь: возможность есть, дороги к ней нет.
    await mount({ sensors: [], motors: [] })

    expect(host.querySelector('.bb')).not.toBeNull()
    expect(host.querySelector('.bb-note')?.textContent).toContain('Внешнее')
    // Нажимать при этом нечего: кнопок нет, и «+» тоже -- привязывать не к чему.
    expect(host.querySelector('.bb-add')).toBeNull()
    expect(keys()).toHaveLength(0)
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

  it('выключенная кнопка объясняет себя на себе, а не только строкой рядом (#576)', async () => {
    // Серый цвет читается как «привязка сломалась» -- владелец так и прочёл, и
    // пошёл заводить вторую кнопку. Причина проходит сама, и сказать об этом
    // надо на той кнопке, которая погасла: строка рядом относится ко всем.
    saved(GAS)
    await mount({ live: false })

    const key = keys()[0]!
    expect(key.className).toContain('is-waiting')
    expect(key.querySelector('.bb-sub')?.textContent).toBe('нужен прогон')
    expect(key.querySelector('.bb-press')?.getAttribute('title')).toContain('Привязка цела')

    // Прогон пошёл -- кнопка снова кнопка, и объяснение ушло.
    await again({ live: true })
    expect(keys()[0]!.className).not.toContain('is-waiting')
    expect(keys()[0]!.querySelector('.bb-sub')?.textContent).toBe('G')
  })

  it('кнопка с потерянной дверью говорит о потере, а не «нужен прогон»', async () => {
    // Две причины, которые раньше выглядели одинаково серыми: эта не проходит
    // сама, и путать их нельзя.
    saved(GAS)
    await mount({ sensors: [] })

    expect(keys()[0]!.querySelector('.bb-sub')?.textContent).toBe('двери нет')
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
    const fields = [...host.querySelectorAll('.bb-new select')] as HTMLSelectElement[]
    // В списках ровно то, что пришло с сервера: выдумывать двери нельзя.
    expect(fields.map((field) => [...field.options].map((item) => item.value))).toEqual([
      ['', 'key'],
      ['', 'out'],
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

describe('петля: одна кнопка -- и мотор, и сенсор (#574)', () => {
  it('мотор отдал ненулевое -- сенсор получил единицу', async () => {
    saved(LOOP)
    await mount({ output: { out: 40 } })

    expect(sent).toEqual([{ key: 1 }])
  })

  it('мотор замолчал -- сенсор получил ноль', async () => {
    saved(LOOP)
    await mount({ output: { out: 40 }, values: { key: 1 } })
    expect(sent).toEqual([])

    await again({ output: { out: 0 }, values: { key: 1 } })

    expect(sent).toEqual([{ key: 0 }])
  })

  it('петля подаёт разницу, а не своё же значение по разу на ответ', async () => {
    // Иначе поток входа забился бы сотней одинаковых событий, каждое из
    // которых стирает записанное после себя будущее. Это же и есть молчание
    // на перемотке: там величину держит запись, и разницы нет.
    saved(LOOP)
    await mount({ output: { out: 40 }, values: { key: 1 } })

    await again({ output: { out: 40 }, values: { key: 1 } })
    await again({ output: { out: 41 }, values: { key: 1 } })

    expect(sent).toEqual([])
  })

  it('палец на кнопке, которую держит петля, второй единицы не шлёт', async () => {
    saved(LOOP)
    await mount({ output: { out: 40 }, values: { key: 1 } })

    pressAt(0)

    expect(sent).toEqual([])
  })

  it('палец убран, а мотор держит -- бит не гаснет: это «или», а не спор', async () => {
    saved(LOOP)
    await mount()

    pressAt(0)
    expect(sent).toEqual([{ key: 1 }])
    // Сеть ответила: мотор пошёл, величина держится.
    await again({ output: { out: 40 }, values: { key: 1 } })
    releaseAt(0)

    expect(sent).toEqual([{ key: 1 }])
  })

  it('мотор замолчал, а палец держит -- петля не гасит чужой бит', async () => {
    saved(LOOP)
    await mount()

    pressAt(0)
    await again({ output: { out: 0 }, values: { key: 1 } })

    expect(sent).toEqual([{ key: 1 }])
  })

  it('без сессии петля молчит: подавать некуда', async () => {
    saved(LOOP)
    await mount({ output: { out: 40 }, live: false })

    expect(sent).toEqual([])
  })

  it('кнопка петли читается как петля и показывает, кто её держит', async () => {
    saved(LOOP)
    await mount({ output: { out: 40 }, values: { key: 1 } })

    const key = keys()[0]!
    expect(key.className).toContain('is-loop')
    expect(key.querySelector('.bb-loop')).not.toBeNull()
    // Держит петля -- знак горит, и подсказка говорит, что рукой не погасить.
    expect(key.querySelector('.bb-loop')?.className).toContain('is-held')
    expect(key.querySelector('.bb-press')?.getAttribute('title')).toContain('петля')

    // Мотор замолчал, бит сняли -- знак на месте, но уже не горит.
    await again({ output: { out: 0 }, values: { key: 0 } })
    expect(keys()[0]!.querySelector('.bb-loop')?.className).not.toContain('is-held')
  })

  it('у кнопки петли убрали мотор -- она остаётся рабочим пальцем и говорит об этом', async () => {
    saved(LOOP)
    await mount({ motors: [] })

    expect(keys()[0]!.className).toContain('is-lost')
    expect(keys()[0]!.querySelector('.bb-press')?.getAttribute('title')).toContain('мотора out')
  })

  it('петля заводится из формы: две привязки разом', async () => {
    await mount()

    act(() => {
      ;(host.querySelector('.bb-add') as HTMLElement).click()
    })
    const fields = [...host.querySelectorAll('.bb-new select')] as HTMLSelectElement[]
    act(() => {
      fields[1]!.value = 'out'
      fields[1]!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    act(() => {
      ;(host.querySelector('.bb-new') as HTMLFormElement).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })

    expect(keys()).toHaveLength(1)
    expect(keys()[0]!.className).toContain('is-loop')
  })

  it('кнопка без единой привязки не заводится: делать ей нечего', async () => {
    await mount()

    act(() => {
      ;(host.querySelector('.bb-add') as HTMLElement).click()
    })
    const fields = [...host.querySelectorAll('.bb-new select')] as HTMLSelectElement[]
    act(() => {
      fields[0]!.value = ''
      fields[0]!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const submit = host.querySelector('.bb-new button[type="submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })
})
