/**
 * Картинка -> кадр величин для поля сенсоров (#581).
 *
 * Режет браузер, а не сервер, и это то же решение, что и во всём движке
 * источников (#580): декодирование живёт **за** дверью, а через границу идут
 * числа от 0 до 1. Браузер здесь — такая же программа-источник, как
 * `tools/eye.py`, только уже открытая у человека: файл никуда не уходит, на
 * сервер едет готовый кадр, а ядро по-прежнему не знает ни про PNG, ни про
 * JPEG.
 *
 * Числа обязаны совпадать с теми, что даёт `tools/eye.py` на той же картинке,
 * — иначе «посмотреть» и «посчитать» разойдутся молча, и разойдутся именно
 * там, где человек будет уверен, что смотрит на свой опыт. Поэтому здесь
 * повторён его порядок действий: уменьшение вчетверо крупнее сетки, перевод в
 * линейный свет, усреднение блоками уже в линейном.
 */

/** Во сколько раз крупнее сетки режем перед переводом в линейный свет. */
const OVERSAMPLE = 4

/** Веса яркости для линейного RGB (Rec. 709) — те же, что в `tools`. */
const LUMA = [0.2126, 0.7152, 0.0722] as const

/**
 * sRGB -> линейный свет, по стандарту.
 *
 * Байт в файле — не количество света, а число, заранее сжатое под глаз: 128 —
 * это не половина яркости, а примерно пятая её часть. Сенсор меряет свет, и
 * без этого перевода серая половина картинки давала бы вдвое более частый
 * поток импульсов, чем должна.
 */
const LINEAR: number[] = Array.from({ length: 256 }, (_, value) => {
  const part = value / 255
  return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
})

export interface FrameOptions {
  rows: number
  cols: number
  /** Сколько величин на пиксель: 1 — яркость, 3 — r, g, b. */
  channels: number
}

/**
 * Готовые пиксели (canvas) -> кадр величин.
 *
 * Отдельно от чтения файла, чтобы это можно было проверить числом без
 * браузера: `ImageData` — обычный массив, и тест подаёт его руками.
 */
export function frameOf(
  image: { data: Uint8ClampedArray; width: number; height: number },
  { rows, cols, channels }: FrameOptions,
): number[] {
  const out: number[] = []
  const area = OVERSAMPLE * OVERSAMPLE
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let red = 0
      let green = 0
      let blue = 0
      for (let dy = 0; dy < OVERSAMPLE; dy += 1) {
        for (let dx = 0; dx < OVERSAMPLE; dx += 1) {
          const x = Math.min(image.width - 1, col * OVERSAMPLE + dx)
          const y = Math.min(image.height - 1, row * OVERSAMPLE + dy)
          const at = (y * image.width + x) * 4
          red += LINEAR[image.data[at] ?? 0] ?? 0
          green += LINEAR[image.data[at + 1] ?? 0] ?? 0
          blue += LINEAR[image.data[at + 2] ?? 0] ?? 0
        }
      }
      red /= area
      green /= area
      blue /= area
      if (channels <= 1) {
        out.push(LUMA[0] * red + LUMA[1] * green + LUMA[2] * blue)
      } else {
        out.push(red, green, blue)
      }
    }
  }
  return out
}

/**
 * Файл картинки -> кадр величин.
 *
 * Через `createImageBitmap`, а не `<img>` с загрузкой по ссылке: файл остаётся
 * файлом, никакого адреса у него не появляется, и ничего никуда не уходит.
 */
export async function frameOfFile(
  file: Blob,
  options: FrameOptions,
): Promise<number[]> {
  const bitmap = await createImageBitmap(file)
  try {
    const width = options.cols * OVERSAMPLE
    const height = options.rows * OVERSAMPLE
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const paper = canvas.getContext('2d')
    if (!paper) throw new Error('браузер не дал холста, на котором режут картинку')
    // Картинка вписывается целиком, а не обрезается: человек выбрал её всю, и
    // отрезать половину значило бы показать сети не то, что он выбрал.
    paper.drawImage(bitmap, 0, 0, width, height)
    return frameOf(paper.getImageData(0, 0, width, height), options)
  } finally {
    bitmap.close()
  }
}
