/**
 * Надпись о заряде: концы шкалы и уход ниже покоя.
 *
 * Проверяется смысл, а не формат строки: покой -- ноль, порог -- сто, ниже
 * покоя -- отмеченная величина, которую нельзя спутать с нулём.
 */

import { describe, expect, it } from 'vitest'

import { chargeLabel } from './charge'

describe('chargeLabel', () => {
  it('покой -- ноль процентов', () => {
    expect(chargeLabel(0)).toEqual({ text: '0%', below: false })
  })

  it('порог -- сто процентов', () => {
    expect(chargeLabel(1)).toEqual({ text: '100%', below: false })
  })

  it('треть пути читается третью', () => {
    expect(chargeLabel(0.333)?.text).toBe('33%')
  })

  it('ниже покоя -- отмеченная величина, а не ноль', () => {
    // Клетку увели на 18% ниже покоя: стрелка и признак `below` -- чтобы это
    // было видно, а не вычислялось из знака.
    expect(chargeLabel(-0.18)).toEqual({ text: '↓18%', below: true })
  })

  it('десятые доли не дрожат: кадры вокруг одной величины дают одну надпись', () => {
    // Сессия отвечает несколько раз в секунду, и «33.7%» рядом с «33.4%»
    // говорили бы об одном и том же, дёргая цифры.
    expect(chargeLabel(0.3341)?.text).toBe('33%')
    expect(chargeLabel(0.3309)?.text).toBe('33%')
  })

  it('шум последнего знака -- это покой, а не «ниже покоя»', () => {
    expect(chargeLabel(-0.004)).toEqual({ text: '0%', below: false })
  })

  it('адаптация поднимает порог, и доля выше ста не обрезается', () => {
    // Пирамида после спайка добирает до 110% номинала: это видимая работа
    // адаптации, и прятать её за «100%» нечестно.
    expect(chargeLabel(1.1)?.text).toBe('110%')
  })

  it('без состояния клетки писать нечего', () => {
    expect(chargeLabel(undefined)).toBeNull()
    expect(chargeLabel(null)).toBeNull()
    expect(chargeLabel(Number.NaN)).toBeNull()
  })
})
