import { describe, expect, it } from 'vitest'

import {
  conductanceBalance,
  downsample,
  extentOf,
  niceStep,
  spikeTriggeredAverage,
  ticks,
} from './analysis'

describe('усреднённый отклик', () => {
  it('вытаскивает форму из шума', () => {
    // Трасса: ровный фон и одинаковый горб через 5 мс после каждого события.
    const dt = 0.5
    const samples = 2000
    const trace = new Array<number>(samples).fill(-65)
    const spikes = [100, 200, 300, 400]
    for (const time of spikes) {
      const centre = time / dt
      for (let i = 0; i < 20; i += 1) {
        trace[centre + 10 + i] = -65 + 5 * Math.exp(-i / 6)
      }
    }

    const window = spikeTriggeredAverage(trace, spikes, dt, 10, 30)
    expect(window).not.toBeNull()
    expect(window?.count).toBe(4)

    const peak = Math.max(...(window?.mean ?? []))
    expect(peak).toBeGreaterThan(-61)
    // До события фон нетронут.
    expect(window?.mean[0]).toBeCloseTo(-65, 5)
  })

  it('пропускает окна, не помещающиеся в трассу', () => {
    const trace = new Array<number>(100).fill(0)
    // Спайк на самом краю: полного окна вокруг него нет.
    expect(spikeTriggeredAverage(trace, [0.1], 0.1, 20, 20)).toBeNull()
  })

  it('без спайков источника отклика нет', () => {
    expect(spikeTriggeredAverage(new Array(100).fill(0), [], 0.1)).toBeNull()
  })
})

describe('баланс проводимостей', () => {
  it('вычитает торможение из возбуждения точка в точку', () => {
    expect(conductanceBalance([1, 2, 3], [0.5, 2, 5])).toEqual([0.5, 0, -2])
  })

  it('без одной из записей не считается', () => {
    expect(conductanceBalance([1], undefined)).toBeNull()
    expect(conductanceBalance(undefined, [1])).toBeNull()
  })
})

describe('прореживание', () => {
  it('сохраняет одиночный всплеск', () => {
    // Всплеск шириной в один отсчёт -- ровно то, что теряет простое «каждое N-е».
    const values = new Array<number>(10000).fill(0)
    values[4321] = 7

    const thinned = downsample(values, 0.1, 100)
    const peak = Math.max(...thinned.map(([, value]) => value))
    expect(peak).toBe(7)
    expect(thinned.length).toBeLessThan(values.length / 10)
  })

  it('сохраняет и провал, и пик в одном столбце', () => {
    const values = new Array<number>(1000).fill(0)
    values[10] = -3
    values[11] = 4

    const thinned = downsample(values, 1, 20)
    const seen = thinned.map(([, value]) => value)
    expect(Math.min(...seen)).toBe(-3)
    expect(Math.max(...seen)).toBe(4)
  })

  it('короткую трассу отдаёт как есть', () => {
    expect(downsample([1, 2, 3], 0.5, 100)).toEqual([
      [0, 1],
      [0.5, 2],
      [1, 3],
    ])
  })
})

describe('шкалы', () => {
  it('берёт круглый шаг из ряда 1-2-5', () => {
    expect(niceStep(400, 6)).toBe(100)
    expect(niceStep(600, 6)).toBe(100)
    expect(niceStep(9, 6)).toBe(2)
  })

  it('размечает время от нуля до конца прогона', () => {
    expect(ticks(400)).toEqual([0, 100, 200, 300, 400])
  })

  it('не схлопывает шкалу на постоянном значении', () => {
    const extent = extentOf([5, 5, 5])
    expect(extent.high).toBeGreaterThan(extent.low)
  })
})
