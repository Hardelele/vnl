import { describe, expect, it, vi } from 'vitest'

import { OfflineError } from '../model/catalog'
import { createCatalogController, type CatalogPorts } from './catalog'
import type { Catalog, CatalogLevel, PatternDetail } from '../model/types'

function catalogWith(ids: string[]): Catalog {
  return {
    schema: 1,
    query: { text: '', levels: [], statuses: [] },
    total: ids.length,
    matched: ids.length,
    levels: [],
    statuses: [],
    patterns: ids.map((id) => ({
      id,
      name: id,
      level: 'L2' as CatalogLevel,
      levelName: 'Микросхемы',
      status: 'ready' as const,
      statusName: 'Готов',
      ports: [],
      counts: { neurons: 0, contacts: 0, ports: 0 },
      scheme: { neurons: [], edges: [] },
      demo: null,
      problems: [],
      createdAt: '',
      updatedAt: '',
    })),
  }
}

/** Отложенные вызовы держим в руках: тест не должен ждать настоящую паузу. */
function manualClock() {
  const queue: Array<() => void> = []
  const schedule: CatalogPorts['schedule'] = (run) => {
    queue.push(run)
    const mine = queue.length - 1
    return () => {
      queue[mine] = () => {}
    }
  }
  return {
    schedule,
    tick() {
      const pending = [...queue]
      queue.length = 0
      for (const run of pending) run()
    },
  }
}

describe('набор в поиске', () => {
  it('не посылает запрос на каждую букву', async () => {
    const clock = manualClock()
    const load = vi.fn().mockResolvedValue(catalogWith([]))
    const control = createCatalogController({ load, schedule: clock.schedule })

    control.search('f')
    control.search('ff')
    control.search('ffi')
    expect(load).not.toHaveBeenCalled()

    clock.tick()
    await Promise.resolve()

    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith({ text: 'ffi', levels: [], statuses: [] })
  })

  it('набранное видно сразу, не дожидаясь ответа', () => {
    const control = createCatalogController({ schedule: manualClock().schedule })
    control.search('тор')
    expect(control.store.getState().text).toBe('тор')
  })
})

describe('гонка ответов', () => {
  it('поздний ответ на старый запрос не затирает свежий', async () => {
    const answers = new Map<string, Catalog>([
      ['ff', catalogWith(['старое'])],
      ['ffi', catalogWith(['свежее'])],
    ])
    // Ответ на «ff» держим до последнего: executor выполняется сразу, поэтому
    // отпускающая функция готова к моменту запроса.
    let releaseSlow = () => {}
    const slowAnswer = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    const load: CatalogPorts['load'] = async (query) => {
      if (query.text === 'ff') await slowAnswer
      return answers.get(query.text ?? '') as Catalog
    }
    const clock = manualClock()
    const control = createCatalogController({ load, schedule: clock.schedule })

    control.search('ff')
    clock.tick()
    control.search('ffi')
    clock.tick()
    await Promise.resolve()
    await Promise.resolve()

    // Медленный ответ на «ff» приходит последним -- и должен быть отброшен.
    releaseSlow()
    await Promise.resolve()
    await Promise.resolve()

    const ids = control.store.getState().catalog?.patterns.map((item) => item.id)
    expect(ids).toEqual(['свежее'])
  })
})

describe('фильтры', () => {
  it('чип спрашивает библиотеку сразу', async () => {
    const load = vi.fn().mockResolvedValue(catalogWith([]))
    const control = createCatalogController({ load, schedule: manualClock().schedule })

    control.toggleLevel('L1')
    await Promise.resolve()

    expect(load).toHaveBeenCalledWith({ text: '', levels: ['L1'], statuses: [] })
  })

  it('повторное нажатие снимает чип', async () => {
    const load = vi.fn().mockResolvedValue(catalogWith([]))
    const control = createCatalogController({ load, schedule: manualClock().schedule })

    control.toggleLevel('L3')
    control.toggleLevel('L3')
    await Promise.resolve()

    expect(control.store.getState().levels).toEqual([])
  })

  it('сброс убирает и текст, и чипы', async () => {
    const control = createCatalogController({
      load: vi.fn().mockResolvedValue(catalogWith([])),
      schedule: manualClock().schedule,
    })

    control.search('pv')
    control.toggleStatus('draft')
    control.clearFilters()

    expect(control.store.getState()).toMatchObject({
      text: '',
      levels: [],
      statuses: [],
    })
  })
})

describe('черновик', () => {
  it('после создания список перечитывается', async () => {
    const load = vi.fn().mockResolvedValue(catalogWith(['новый']))
    const add = vi.fn().mockResolvedValue({ id: 'новый' } as PatternDetail)
    const control = createCatalogController({
      load,
      add,
      schedule: manualClock().schedule,
    })

    const created = await control.addDraft('Новый')

    expect(created?.id).toBe('новый')
    expect(add).toHaveBeenCalledWith('Новый', 'L2')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('отказ сервера попадает на экран, а не в консоль', async () => {
    const control = createCatalogController({
      load: vi.fn().mockResolvedValue(catalogWith([])),
      add: vi.fn().mockRejectedValue(new Error("уровень 'L9' не из каталога")),
      schedule: manualClock().schedule,
    })

    const created = await control.addDraft('x')

    expect(created).toBeNull()
    expect(control.store.getState().error).toContain('L9')
  })
})

describe('сервер не запущен', () => {
  it('отмечается отдельно от прочих ошибок', async () => {
    const control = createCatalogController({
      load: vi.fn().mockRejectedValue(new OfflineError(new TypeError('failed'))),
      schedule: manualClock().schedule,
    })

    await control.refresh()

    const state = control.store.getState()
    expect(state.offline).toBe(true)
    expect(state.error).toContain('vnl serve')
    expect(state.loading).toBe(false)
  })
})

describe('закрытый экран', () => {
  it('отложенный запрос не уходит после dispose', async () => {
    const clock = manualClock()
    const load = vi.fn().mockResolvedValue(catalogWith([]))
    const control = createCatalogController({ load, schedule: clock.schedule })

    control.search('ffi')
    control.dispose()
    clock.tick()
    await Promise.resolve()

    expect(load).not.toHaveBeenCalled()
  })
})
