/**
 * Счёт для инспектора: то, чего нет в выгрузке и что зависит от выбора.
 *
 * Сюда попадает только то, что нельзя посчитать заранее: усреднение вокруг
 * спайков конкретного входа, баланс проводимостей, прореживание под ширину
 * конкретного графика. Всё остальное считает симулятор.
 */

export interface Window {
  /** Смещение от спайка в мс: отрицательное -- до него. */
  offsets: number[]
  /** Среднее значение по всем окнам. */
  mean: number[]
  /** Сколько окон усреднено. */
  count: number
}

/**
 * Усреднённый отклик: что происходит с трассой вокруг спайков источника.
 *
 * Это и есть ответ на вопрос «что делает с клеткой вот этот вход»: одиночное
 * событие тонет в шуме, а среднее по десяткам окон показывает форму.
 */
export function spikeTriggeredAverage(
  trace: number[],
  spikeTimes: number[],
  dt: number,
  before = 20,
  after = 40,
): Window | null {
  const back = Math.round(before / dt)
  const forward = Math.round(after / dt)
  const width = back + forward + 1

  const sum = new Array<number>(width).fill(0)
  let count = 0

  for (const time of spikeTimes) {
    const centre = Math.round(time / dt)
    if (centre - back < 0 || centre + forward >= trace.length) continue
    for (let i = 0; i < width; i += 1) {
      sum[i] = (sum[i] as number) + (trace[centre - back + i] as number)
    }
    count += 1
  }
  if (count === 0) return null

  const offsets = new Array<number>(width)
  const mean = new Array<number>(width)
  for (let i = 0; i < width; i += 1) {
    offsets[i] = (i - back) * dt
    mean[i] = (sum[i] as number) / count
  }
  return { offsets, mean, count }
}

/** Баланс входа: возбуждение минус торможение, точка в точку. */
export function conductanceBalance(
  excitation: number[] | undefined,
  inhibition: number[] | undefined,
): number[] | null {
  if (!excitation || !inhibition) return null
  const length = Math.min(excitation.length, inhibition.length)
  const out = new Array<number>(length)
  for (let i = 0; i < length; i += 1) {
    out[i] = (excitation[i] as number) - (inhibition[i] as number)
  }
  return out
}

export interface Extent {
  low: number
  high: number
}

export function extentOf(values: number[], pad = 0): Extent {
  if (values.length === 0) return { low: 0, high: 1 }
  let low = Infinity
  let high = -Infinity
  for (const value of values) {
    if (value < low) low = value
    if (value > high) high = value
  }
  if (high - low < 1e-9) high = low + 1
  const margin = (high - low) * pad
  return { low: low - margin, high: high + margin }
}

/**
 * Прореживание по столбцам с сохранением минимума и максимума.
 *
 * Простое «каждое N-е» съедало бы спайк: он живёт один шаг dt. Здесь в каждом
 * столбце остаются обе крайние точки, поэтому форма всплеска выживает.
 */
export function downsample(
  values: number[],
  dt: number,
  columns: number,
): Array<[number, number]> {
  if (values.length <= columns * 2) {
    return values.map((value, index) => [index * dt, value])
  }
  const out: Array<[number, number]> = []
  const step = values.length / columns
  for (let column = 0; column < columns; column += 1) {
    const from = Math.floor(column * step)
    const to = Math.min(Math.floor((column + 1) * step), values.length)
    if (to <= from) continue

    let minIndex = from
    let maxIndex = from
    for (let i = from; i < to; i += 1) {
      if ((values[i] as number) < (values[minIndex] as number)) minIndex = i
      if ((values[i] as number) > (values[maxIndex] as number)) maxIndex = i
    }
    const first = Math.min(minIndex, maxIndex)
    const second = Math.max(minIndex, maxIndex)
    out.push([first * dt, values[first] as number])
    if (second !== first) out.push([second * dt, values[second] as number])
  }
  return out
}

/** Круглый шаг сетки из ряда 1-2-5 -- подписи должны быть читаемыми. */
export function niceStep(span: number, targetTicks = 6): number {
  const raw = span / Math.max(targetTicks, 1)
  if (raw <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  for (const factor of [1, 2, 5, 10]) {
    if (raw <= factor * magnitude) return factor * magnitude
  }
  return 10 * magnitude
}

export function ticks(duration: number, targetTicks = 6): number[] {
  const step = niceStep(duration, targetTicks)
  const out: number[] = []
  for (let time = 0; time <= duration + 1e-9; time += step) {
    out.push(Number(time.toFixed(6)))
  }
  return out
}
