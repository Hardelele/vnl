/**
 * Резка картинки в браузере (#581).
 *
 * Проверяется одно: числа те же, что даёт `tools/eye.py`. Расхождение здесь
 * было бы худшего сорта — «посмотреть» и «посчитать» разошлись бы молча, и
 * ровно там, где человек уверен, что смотрит на свой опыт.
 */

import { describe, expect, it } from 'vitest'

import { frameOf } from './frame'

/** Картинка одного цвета размером ровно под сетку `rows`x`cols` (с запасом). */
function flat(
  rows: number,
  cols: number,
  color: [number, number, number],
): { data: Uint8ClampedArray; width: number; height: number } {
  const width = cols * 4
  const height = rows * 4
  const data = new Uint8ClampedArray(width * height * 4)
  for (let at = 0; at < width * height; at += 1) {
    data[at * 4] = color[0]
    data[at * 4 + 1] = color[1]
    data[at * 4 + 2] = color[2]
    data[at * 4 + 3] = 255
  }
  return { data, width, height }
}

describe('кадр из картинки', () => {
  it('белое даёт единицу, чёрное -- ноль', () => {
    const white = frameOf(flat(2, 2, [255, 255, 255]), {
      rows: 2,
      cols: 2,
      channels: 1,
    })
    const black = frameOf(flat(2, 2, [0, 0, 0]), { rows: 2, cols: 2, channels: 1 })
    expect(white).toEqual([1, 1, 1, 1])
    expect(black).toEqual([0, 0, 0, 0])
  })

  it('серое sRGB -- это пятая часть света, а не половина', () => {
    const [value] = frameOf(flat(1, 1, [128, 128, 128]), {
      rows: 1,
      cols: 1,
      channels: 1,
    })
    // 0.2159 -- линейный свет для байта 128 по стандарту sRGB. Возьми мы
    // 128/255, поле получало бы вдвое более частый поток, чем должно.
    expect(value).toBeCloseTo(0.2159, 3)
  })

  it('красное в яркости весит столько, сколько весит красный', () => {
    const [value] = frameOf(flat(1, 1, [255, 0, 0]), {
      rows: 1,
      cols: 1,
      channels: 1,
    })
    // Тот же вес, что у `tools/vnl_frame.py`: Rec. 709, красный -- 0.2126.
    expect(value).toBeCloseTo(0.2126, 4)
  })

  it('в цвете у пикселя три величины, и порядок их -- r, g, b', () => {
    const frame = frameOf(flat(1, 1, [255, 0, 0]), {
      rows: 1,
      cols: 1,
      channels: 3,
    })
    expect(frame).toHaveLength(3)
    expect(frame[0]).toBeCloseTo(1, 6)
    expect(frame[1]).toBeCloseTo(0, 6)
    expect(frame[2]).toBeCloseTo(0, 6)
  })

  it('кадр ровно по сетке: столько величин, сколько ждёт поле', () => {
    const frame = frameOf(flat(24, 24, [255, 255, 255]), {
      rows: 24,
      cols: 24,
      channels: 1,
    })
    expect(frame).toHaveLength(576)
  })
})
