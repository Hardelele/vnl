/**
 * Активность слоя: растр, счёт и кривая (#583).
 *
 * Проверяется то, на чём держится чтение слоя: окно, в котором разряд виден;
 * число, которое стоит подписью; и кривая, которая не врёт про количество.
 */

import { describe, expect, it } from 'vitest'

import { countsOf, firedIn, firesIn, rasterOf } from './raster'

describe('окно активности', () => {
  it('разряд виден 50 мс и ни миллисекундой дольше', () => {
    expect(firedIn([95], 100)).toBe(true)
    expect(firedIn([50], 100)).toBe(true)
    expect(firedIn([49], 100)).toBe(false)
    // Будущего в окне нет: перемотали назад -- разряд ещё не случился.
    expect(firedIn([140], 100)).toBe(false)
  })

  it('считает разряды в окне, а не все подряд', () => {
    expect(firesIn([10, 60, 80, 95], 100)).toBe(3)
    expect(firesIn(undefined, 100)).toBe(0)
  })
})

describe('растр слоя', () => {
  it('горят те клетки, что разрядились, и счёт совпадает с ними', () => {
    const raster = rasterOf(
      { a: [90], b: [10], c: [95, 99] },
      ['a', 'b', 'c', 'd'],
      100,
    )
    expect(raster.awake).toBe(2)
    expect(raster.total).toBe(4)
    expect(raster.light[0]).toBeGreaterThan(0)
    expect(raster.light[1]).toBe(0)
    // Две вспышки за окно ярче одной -- но обе видны.
    expect(raster.light[2]).toBeGreaterThan(raster.light[0] ?? 0)
  })

  it('молчащий слой не светится вовсе', () => {
    const raster = rasterOf({}, ['a', 'b'], 100)
    expect(raster.awake).toBe(0)
    expect(raster.light).toEqual([0, 0])
  })
})

describe('кривая слоя', () => {
  it('клетка считается один раз, сколько бы раз ни разрядилась в окне', () => {
    // Три разряда подряд у одной клетки -- это по-прежнему одна отозвавшаяся
    // клетка: дорожка отвечает тем же числом, что стоит подписью.
    const counts = countsOf({ a: [10, 20, 30] }, ['a'], 100, 10)
    expect(Math.max(...counts)).toBe(1)
  })

  it('две клетки в одном окне дают двойку', () => {
    const counts = countsOf({ a: [10], b: [12] }, ['a', 'b'], 100, 10)
    expect(Math.max(...counts)).toBe(2)
  })

  it('после окна кривая возвращается к нулю', () => {
    const counts = countsOf({ a: [10] }, ['a'], 200, 10)
    expect(counts[counts.length - 1]).toBe(0)
  })
})
