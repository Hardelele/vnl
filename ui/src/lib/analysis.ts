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

/**
 * Подписи временной шкалы: круглые тики плюс конец прогона (#552).
 *
 * Круглые тики кончаются там, где кончается ряд 1-2-5: на прогоне в 340 мс шаг
 * 50 доводит до 300, и шкала выглядит так, будто прогон на 300 и кончился.
 * Дорожки при этом нарисованы до 340 -- правый край поля и есть конец, -- то
 * есть подпись противоречит тому, что под ней нарисовано.
 *
 * Разобранная альтернатива -- подбирать шаг так, чтобы он делил прогон нацело.
 * Тогда на 340 мс тики встали бы по 34 или 68 мс, и шкала читалась бы числами,
 * которые ничего не значат: «где 200 мс» -- обычный вопрос, а «где 204 мс» --
 * нет. Круглый шаг важнее ровного конца, поэтому конец добавляется отдельной
 * подписью, а не переделывает всю сетку.
 *
 * Последний круглый тик, стоящий вплотную к концу, убирается: две подписи в
 * одно место нечитаемы, а выбор между ними очевиден -- длину прогона называет
 * только одна. Линии сетки при этом остаются на круглых тиках: они размечают
 * поле, и убирать линию из-за тесноты подписей значило бы менять разметку
 * ради подписи.
 */
export function scaleMarks(duration: number, targetTicks = 6): number[] {
  const out = ticks(duration, targetTicks)
  const last = out[out.length - 1] ?? 0
  if (duration - last < 1e-9) return out
  if (duration - last < niceStep(duration, targetTicks) / 2) out.pop()
  out.push(Number(duration.toFixed(6)))
  return out
}
