/**
 * Панель свойств блока: на какие порты вешается драйв и запись (#533).
 *
 * Проверяется настоящая разметка, а не «функция вернула true»: кнопки тут и
 * есть весь интерфейс модуляторного входа. Пока их не было, `gate` и
 * `dopamine` у `disinhibition` были мертвы -- подать на них было нечего и
 * посмотреть на них было нечего, хотя сервер оба действия принимает.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Properties } from './Properties'
import type { SandboxBlock, SandboxState } from '../../model/sandbox'
import type { PatternPort, PointModel } from '../../model/types'

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
}

function port(name: string, direction: PatternPort['direction'], cell: string): PatternPort {
  return { name, direction, site: { instance: cell, section: 'soma', fraction: 0.5 }, note: '' }
}

/** Порты настоящие -- те же, что у `disinhibition` в библиотеке. */
const BLOCK: SandboxBlock = {
  id: 'dis',
  patternId: 'disinhibition',
  label: 'Растормаживание',
  position: [0, 0],
  ports: [
    port('in', 'in', 'IN'),
    port('tonic', 'in', 'SST'),
    port('gate', 'mod', 'VIP'),
    port('dopamine', 'mod', 'VTA'),
    port('out', 'out', 'PYR'),
  ],
  counts: { neurons: 5, contacts: 3 },
  scheme: { neurons: [], edges: [] },
  cells: [{ type: 'pyr', neurons: ['PYR'], inhibitory: false, pointModel: POINT }],
}

const PROJECT = {
  blocks: [BLOCK],
  neurons: [],
  links: [],
  stimuli: [],
  recordings: [],
} as unknown as SandboxState

let root: Root | null = null
let host: HTMLElement

async function mount() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <Properties selection={{ kind: 'block', id: 'dis' }} project={PROJECT} cells={{}} />,
    )
  })
}

/** Подписи кнопок действия: драйв, запись и «убрать блок» идут одним списком. */
function actions(): string[] {
  return [...host.querySelectorAll('.sb-actions button')].map(
    (node) => node.textContent ?? '',
  )
}

beforeEach(() => {
  root = null
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

describe('порты блока в панели свойств', () => {
  it('драйв вешается и на вход, и на модулятор', async () => {
    await mount()

    // `gate` и `dopamine` -- это VIP и VTA: обычные клетки, которые принимают
    // стимул наравне с IN. Без драйва на `gate` растормаживания не увидеть.
    expect(actions()).toEqual(
      expect.arrayContaining([
        'Драйв на in',
        'Драйв на tonic',
        'Драйв на модулятор gate',
        'Драйв на модулятор dopamine',
      ]),
    )
  })

  it('записывается и выход, и модулятор', async () => {
    await mount()

    expect(actions()).toEqual(
      expect.arrayContaining([
        'Записывать out',
        'Записывать модулятор gate',
        'Записывать модулятор dopamine',
      ]),
    )
  })

  it('модуляторный вход в подписи отличается от обычного', async () => {
    await mount()

    // На блоке с четырьмя входами по подписи должно быть понятно, куда бьёшь:
    // драйв на `gate` снимает тормоз, драйв на `in` возбуждает.
    expect(actions()).not.toContain('Драйв на gate')
    expect(actions()).not.toContain('Записывать модулятор out')
  })
})
