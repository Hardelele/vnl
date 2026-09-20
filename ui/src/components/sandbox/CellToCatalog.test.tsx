/**
 * Форма «в каталог» (#567): что она спрашивает и чего не отпускает без ответа.
 *
 * Проверяется не разметка, а правила: каталожная запись без имени и без
 * объяснения бессмысленна (#541), а перекрытие клетки, уже лежащей под этим
 * именем, -- отдельный вопрос человеку, а не мелкий шрифт под кнопкой.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CellToCatalog } from './CellToCatalog'
import type { CellKind } from '../../model/types'

const PV: CellKind = {
  id: 'pv',
  name: 'Корзинчатый интернейрон PV',
  note: 'Быстрое торможение',
  tags: ['inhibitory'],
  transmitter: 'gaba',
  inhibitory: true,
  builtin: true,
  source: null,
  pointModel: {
    kind: 'lif',
    vRest: -65,
    vReset: -65,
    vThreshold: -52,
    tauM: 6,
    rIn: 100,
    refractory: 1,
    adaptation: 0,
    tauAdaptation: 100,
    deltaT: 2,
    vPeak: -40,
    tauW: 144,
    wCoupling: 4,
    wIncrement: 0.0805,
  },
  morphology: { name: 'point', isPoint: true, sections: [] },
}

let root: Root | null = null
let host: HTMLElement

async function mount(
  type: string,
  onPut = vi.fn(),
  standing?: CellKind,
): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <CellToCatalog
        type={type}
        standing={standing}
        busy={false}
        onPut={onPut}
        onCancel={vi.fn()}
      />,
    )
  })
  return host
}

/** Набрать в поле: React слушает `input`, а не присваивание значения. */
async function type(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!
    setter.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const submit = () => host.querySelector('button[type="submit"]') as HTMLButtonElement
const nameField = () => host.querySelector('input[type="text"]') as HTMLInputElement
const noteField = () => host.querySelector('textarea') as HTMLTextAreaElement

beforeEach(() => {
  host = document.createElement('div')
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host.remove()
})

describe('форма «в каталог»', () => {
  it('не отпускает клетку без имени и без объяснения', async () => {
    await mount('target')
    expect(submit().disabled).toBe(true)

    await type(nameField(), 'Клетка-мишень')
    // Одного имени мало: каталог без `note` -- список слов, по которым не выбрать.
    expect(submit().disabled).toBe(true)

    await type(noteField(), 'Куда сходится схема.')
    expect(submit().disabled).toBe(false)
  })

  it('поля пустые, а не заполнены идентификатором', async () => {
    await mount('target')
    // Подставленное «target» человек оставил бы как есть, и в каталоге легла
    // бы строка, которую по имени не выбрать, -- ровно то, от чего уходили.
    expect(nameField().value).toBe('')
    expect(noteField().value).toBe('')
  })

  it('отдаёт имя и объяснение без окружающих пробелов', async () => {
    const onPut = vi.fn()
    await mount('target', onPut)
    await type(nameField(), '  Клетка-мишень  ')
    await type(noteField(), ' Куда сходится схема. ')

    await act(async () => {
      submit().click()
    })

    expect(onPut).toHaveBeenCalledWith({
      type: 'target',
      name: 'Клетка-мишень',
      note: 'Куда сходится схема.',
      replace: false,
    })
  })

  it('называет клетку, которую перекроет, и ждёт подтверждения', async () => {
    const onPut = vi.fn()
    await mount('pv', onPut, PV)
    await type(nameField(), 'Свой PV')
    await type(noteField(), 'Из этого блока.')

    // Имя и объяснение есть, но вопрос о перекрытии не отвечен.
    expect(submit().disabled).toBe(true)
    expect(host.textContent).toContain('Корзинчатый интернейрон PV')
    expect(host.textContent).toContain('встроенная')

    const confirm = host.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement
    await act(async () => {
      confirm.click()
    })
    expect(submit().disabled).toBe(false)

    await act(async () => {
      submit().click()
    })
    expect(onPut).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pv', replace: true }),
    )
  })

  it('без столкновения о перекрытии не спрашивает', async () => {
    await mount('target')
    expect(host.querySelector('input[type="checkbox"]')).toBe(null)
  })
})
