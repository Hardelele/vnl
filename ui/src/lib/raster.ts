/**
 * Активность слоя: 576 дорожек растра -> одна картинка и одно число (#583).
 *
 * Слой — это обычные клетки, и всё, что про них известно, приходит из сессии
 * россыпью: спайки по каждой. Смотреть на эту россыпь нельзя — 576 дорожек не
 * помещаются ни на холст, ни на таймлайн, — а вопросов к слою всего два:
 * **кто сейчас горит** (картинка по сетке) и **сколько их** (число).
 *
 * Считается это здесь, в браузере, и это не нарушение правила «считает
 * Python»: растр — не новая правда о сети, а тот же растр сессии, разложенный
 * по сетке. Отправлять его с сервера значило бы слать 576 чисел на каждый кадр
 * показа ради картинки, которая целиком выводится из уже пришедшего.
 *
 * Окно 50 мс — то же, что у мотора, и по той же причине: разряд занимает один
 * шаг из полусотни, приходящихся на кадр показа, и мгновенный срез мигал бы
 * целиком (#581).
 */

/** За какое окно модельного времени считается активность, мс. */
export const WINDOW_MS = 50

/** Разрядилась ли клетка в окне, которое кончается на `now`. */
export function firedIn(
  spikes: number[] | undefined,
  now: number,
  window = WINDOW_MS,
): boolean {
  if (!spikes || !spikes.length) return false
  const from = now - window
  // С конца: свежие разряды лежат в хвосте, и перебирать 576 дорожек целиком
  // на каждом кадре показа было бы дорого зря.
  for (let at = spikes.length - 1; at >= 0; at -= 1) {
    const time = spikes[at] ?? 0
    if (time > now) continue
    if (time < from) return false
    return true
  }
  return false
}

/** Сколько раз клетка разрядилась в окне — им меряется, насколько ярко. */
export function firesIn(
  spikes: number[] | undefined,
  now: number,
  window = WINDOW_MS,
): number {
  if (!spikes || !spikes.length) return 0
  const from = now - window
  let count = 0
  for (let at = spikes.length - 1; at >= 0; at -= 1) {
    const time = spikes[at] ?? 0
    if (time > now) continue
    if (time < from) break
    count += 1
  }
  return count
}

export interface Raster {
  /** Яркость каждой клетки слоя по порядку: 0 — молчит, 1 — разряд в окне. */
  light: number[]
  /** Сколько клеток разрядилось: то самое «111 из 576». */
  awake: number
  /** Сколько всего клеток в слое. */
  total: number
}

/**
 * Растр слоя на момент: кто горит и сколько их.
 *
 * Яркость ступенчатая, а не «во сколько раз чаще соседа»: слой смотрят, чтобы
 * увидеть форму — какие клетки отвечают, — и нормировка по самой активной
 * превратила бы ровный отклик в шум из-за одного разряда лишнего.
 */
export function rasterOf(
  spikes: Record<string, number[]>,
  members: string[],
  now: number,
  window = WINDOW_MS,
): Raster {
  const light: number[] = new Array(members.length).fill(0)
  let awake = 0
  for (let at = 0; at < members.length; at += 1) {
    const name = members[at]
    if (!name) continue
    const fires = firesIn(spikes[name], now, window)
    if (!fires) continue
    awake += 1
    // Две вспышки за окно ярче одной, но не вдвое: разница между «отвечает» и
    // «отвечает часто» должна быть видна, не перебивая саму форму.
    light[at] = fires > 1 ? 1 : 0.72
  }
  return { light, awake, total: members.length }
}

/**
 * Кривая «сколько клеток слоя разрядилось» по времени — дорожка таймлайна.
 *
 * Считается по всем спайкам слоя разом, а не по клеткам: 576 проходов по
 * времени превратились бы в 576 кривых, из которых на экране одна.
 * Шаг — сколько миллисекунд приходится на точку; берётся из ширины дорожки,
 * чтобы не считать того, чего не нарисовать.
 */
export function countsOf(
  spikes: Record<string, number[]>,
  members: string[],
  duration: number,
  step: number,
  window = WINDOW_MS,
): number[] {
  const points = Math.max(1, Math.ceil(duration / step))
  const counts: number[] = new Array(points + 1).fill(0)
  for (const name of members) {
    const times = spikes[name]
    if (!times || !times.length) continue
    // Клетка считается один раз в каждой точке, сколько бы разрядов ни
    // попало в окно: дорожка отвечает на «сколько клеток отозвалось» -- тем
    // же числом, что стоит подписью и горит на растре. Поэтому окна разрядов
    // сливаются, а не складываются.
    let from = -1
    let to = -1
    for (const time of times) {
      const start = Math.max(0, Math.floor(time / step))
      const stop = Math.min(points, Math.floor((time + window) / step))
      if (from < 0) {
        from = start
        to = stop
        continue
      }
      if (start <= to + 1) {
        to = Math.max(to, stop)
        continue
      }
      for (let at = from; at <= to; at += 1) counts[at] = (counts[at] ?? 0) + 1
      from = start
      to = stop
    }
    if (from >= 0) {
      for (let at = from; at <= to; at += 1) counts[at] = (counts[at] ?? 0) + 1
    }
  }
  return counts
}

/**
 * Растр -> картинка для узла слоя.
 *
 * Одна `<image>` вместо 576 прямоугольников: узел перерисовывается на каждом
 * кадре показа, и полтысячи SVG-фигур на кадр — это те же 576 узлов, от
 * которых слой и заводился избавить.
 *
 * Пиксели рисуются один в один по сетке, а растягивает их сам SVG (атрибутом
 * ширины): так картинка остаётся чёткой на любом размере узла и не зависит от
 * плотности экрана.
 */
export function rasterImage(
  light: number[],
  rows: number,
  cols: number,
  color: [number, number, number] = [56, 142, 96],
): string | null {
  if (!rows || !cols) return null
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const paper = canvas.getContext('2d')
  if (!paper) return null
  const image = paper.createImageData(cols, rows)
  for (let at = 0; at < rows * cols; at += 1) {
    const value = light[at] ?? 0
    if (value <= 0) continue
    image.data[at * 4] = color[0]
    image.data[at * 4 + 1] = color[1]
    image.data[at * 4 + 2] = color[2]
    image.data[at * 4 + 3] = Math.round(Math.min(1, value) * 255)
  }
  paper.putImageData(image, 0, 0)
  return canvas.toDataURL()
}
