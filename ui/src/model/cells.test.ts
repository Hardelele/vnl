/**
 * Каталог типов клеток и адреса операций над клеткой на холсте.
 *
 * Проверяется договор с сервером: по какому адресу спрашивают палитру, что
 * уходит в теле при добавлении клетки и куда идёт правка мембраны. Собственных
 * решений здесь у интерфейса нет -- ни списка клеток, ни тормозности: и то и
 * другое считает Python, а вторая реализация разошлась бы с первой незаметно.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { adoptCell, loadCells } from './cells'
import { addNeuron, moveObject, setCellParams } from './sandbox'
import type { CellKind } from './types'

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('палитра клеток', () => {
  it('спрашивается отдельно от библиотеки паттернов', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ schema: 1, cells: [PV] }))
    vi.stubGlobal('fetch', fetcher)

    const cells = await loadCells()

    const [url] = fetcher.mock.calls[0] as [string]
    expect(url).toBe('/api/cells')
    // Тормозность приходит с сервера: от неё зависит фигура на холсте.
    expect(cells.map((cell) => cell.inhibitory)).toEqual([true])
  })
})

describe('клетка на холсте', () => {
  it('кладётся по имени типа и с местом, а параметры мембраны не шлёт', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ schema: 1, neurons: [] }))
    vi.stubGlobal('fetch', fetcher)

    await addNeuron('s1', 'pv', [60, 40])

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sandboxes/s1/neurons')
    expect(init.method).toBe('POST')
    // Ни порога, ни имени: имя подберёт сервер -- он один знает, что занято
    // блоками, а мембрану правят потом, уже в этой песочнице.
    expect(JSON.parse(String(init.body))).toEqual({ cell: 'pv', position: [60, 40] })
  })

  it('мембрана правится по объекту, а не по блоку', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ schema: 1 }))
    vi.stubGlobal('fetch', fetcher)

    await setCellParams('s1', 'E', 'pyr', { vThreshold: -44 })

    // Путь говорит «объект»: то же место правит и тип внутри блока, и тип
    // отдельной клетки. Маршрут, врущий о том, что принимает, однажды заставил
    // бы завести второй такой же.
    const [url] = fetcher.mock.calls[0] as [string]
    expect(url).toBe('/api/sandboxes/s1/objects/E/cells/pyr')
  })

  it('двигается тем же маршрутом, что блок', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ schema: 1 }))
    vi.stubGlobal('fetch', fetcher)

    await moveObject('s1', 'E', [220, 90])

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sandboxes/s1/move')
    expect(JSON.parse(String(init.body))).toEqual({ id: 'E', position: [220, 90] })
  })
})

describe('тип проекта уезжает в каталог (#567)', () => {
  it('кладётся по адресу каталога и называет проект, а не мембрану', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ schema: 1, cells: [PV] }))
    vi.stubGlobal('fetch', fetcher)

    await adoptCell('s1', {
      type: 'target',
      name: 'Клетка-мишень',
      note: 'куда сходится схема',
    })

    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    // Тот же адрес, что у чтения: список клеток и место, куда клетку кладут,
    // -- одна вещь.
    expect(url).toBe('/api/cells')
    expect(init.method).toBe('POST')
    // Мембраны в теле нет: её сервер возьмёт из названного проекта. Иначе в
    // каталог можно было бы положить клетку, которой в проекте не стоит.
    expect(JSON.parse(String(init.body))).toEqual({
      sandbox: 's1',
      type: 'target',
      name: 'Клетка-мишень',
      note: 'куда сходится схема',
      replace: false,
    })
  })

  it('подтверждённое перекрытие уходит отдельным полем', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ schema: 1, cells: [PV] }))
    vi.stubGlobal('fetch', fetcher)

    await adoptCell('s1', {
      type: 'pv',
      name: 'Свой PV',
      note: 'из этого блока',
      replace: true,
    })

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).replace).toBe(true)
  })

  it('возвращает весь каталог: порядок списка держит сервер', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ schema: 1, cells: [PV] })))

    const cells = await adoptCell('s1', { type: 'target', name: 'М', note: 'н' })

    expect(cells.map((cell) => cell.id)).toEqual(['pv'])
  })
})
