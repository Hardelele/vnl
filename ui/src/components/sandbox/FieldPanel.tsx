/**
 * Панель поля: показать сети картинку и увидеть, чем она ответила (#581).
 *
 * Поле сенсоров (#580) принимает много величин разом, и кнопкой его не
 * нажмёшь: одно число легло бы в первый пиксель из 576. Панель — то место,
 * где поле получает кадр целиком: встроенную букву по имени или картинку,
 * выбранную у себя.
 *
 * ## Две половины, и это не украшение
 *
 * Слева — что подали, справа — чем ответил слой за полем. Показывать только
 * первое бессмысленно (картинку человек и так видел), только второе — тоже:
 * по одной сетке огоньков нельзя сказать, сеть так отвечает или картинка
 * такая пришла. Рядом они отвечают на вопрос, ради которого панель и делалась.
 *
 * ## Кто режет картинку
 *
 * Браузер (`lib/frame`). Файл никуда не уходит, на сервер едет готовый кадр
 * чисел — тот же договор, что у программ-источников в `tools/`: за дверью
 * знают про форматы, внутри — только про величины от 0 до 1. Встроенный
 * образец, наоборот, режется на сервере: по сети едет имя, а не 576 чисел, и
 * буква получается ровно та, про которую написаны числа в примерах.
 *
 * ## Почему отклик рисуется по клеткам слоя
 *
 * Схема со слоем — это 576 кружков; смотреть на них нечем, и в этой задаче
 * они такими и остаются. Сетка отклика — то же самое, но разложенное по той
 * сетке, по которой человек и думает о картинке: клетка [3,7] стоит там, где
 * пиксель [3,7].
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { frameOfFile } from '../../lib/frame'
import type { SandboxField } from '../../model/sandbox'
import { readSamples, type SampleInfo } from '../../model/samples'
import type { CellState } from '../../model/sim'

/** Сколько пикселей экрана на один пиксель поля. */
const SCALE = 6

/**
 * За какое окно модельного времени считается отклик, мс.
 *
 * Не «мгновенное состояние клетки»: разряд занимает один шаг из полусотни,
 * приходящихся на кадр показа, и по мгновенному значению сетка мигала бы --
 * то вся буква, то пусто, в зависимости от того, куда попал опрос. Окно --
 * то же решение, что у мотора (`MotorKind.window`), и число то же: 50 мс
 * ловит каждую пачку и не размазывает её по секунде.
 */
const WINDOW_MS = 50

export interface FieldPanelProps {
  fields: SandboxField[]
  /** Состояние клеток: им подсвечиваются те, кто ещё только идёт к порогу. */
  cells: Record<string, CellState>
  /** Растр сессии: по нему считается, кто ответил за окно. */
  spikes: Record<string, number[]>
  /** Пройденное модельное время, мс: от него отсчитывается окно. */
  elapsed: number
  /** Открыта ли сессия: без неё показывать кадр некуда. */
  live: boolean
  /** Кадры, которые сейчас держатся на полях: приходят по требованию. */
  frames: Record<string, number[]>
  onShow: (field: string, what: { sample: string } | { frame: number[] }) => void
}

/** Разрядилась ли клетка за окно, которое кончается на `now`. */
export function firedIn(
  spikes: number[] | undefined,
  now: number,
  window = WINDOW_MS,
): boolean {
  if (!spikes || !spikes.length) return false
  const from = now - window
  // С конца: свежие разряды лежат в хвосте, и на 576 дорожках перебирать
  // каждую целиком на каждом кадре показа было бы дорого зря.
  for (let at = spikes.length - 1; at >= 0; at -= 1) {
    const time = spikes[at] ?? 0
    if (time > now) continue
    if (time < from) return false
    return true
  }
  return false
}

/**
 * Насколько клетка отозвалась: 1 — разряд за окно, меньше — путь к порогу.
 *
 * Разряд считается по растру, а не по мгновенному состоянию: он занимает один
 * шаг из полусотни, приходящихся на кадр показа, и сетка, нарисованная по
 * мгновенному значению, мигала бы целиком. Заряд остаётся вторым слоем --
 * им видно, что клетка идёт к порогу, но ещё не дошла.
 */
export function lightOf(
  cell: CellState | undefined,
  spikes?: number[],
  now = 0,
): number {
  if (firedIn(spikes, now)) return 1
  if (!cell) return 0
  const level = Math.max(cell.peak, cell.charge)
  return level <= 0 ? 0 : Math.min(0.85, level)
}

/** Сколько клеток слоя ответило за окно — то самое «ответило N из 576». */
export function awakeOf(
  spikes: Record<string, number[]>,
  members: string[],
  now: number,
): number {
  return members.reduce(
    (count, name) => count + (firedIn(spikes[name], now) ? 1 : 0),
    0,
  )
}

/** Кадр -> чем он светится: яркость каждого пикселя, 0…1. */
export function pixelsOf(frame: number[], size: number, depth: number): number[] {
  const out: number[] = []
  for (let pixel = 0; pixel < size; pixel += 1) {
    if (depth <= 1) {
      out.push(frame[pixel] ?? 0)
      continue
    }
    let sum = 0
    for (let channel = 0; channel < depth; channel += 1) {
      sum += frame[pixel * depth + channel] ?? 0
    }
    out.push(sum / depth)
  }
  return out
}

function Grid({
  rows,
  cols,
  light,
  title,
}: {
  rows: number
  cols: number
  light: (row: number, col: number) => number
  title: string
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const paper = canvas.current?.getContext('2d')
    if (!paper) return
    paper.clearRect(0, 0, cols * SCALE, rows * SCALE)
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const value = light(row, col)
        if (value <= 0) continue
        paper.fillStyle = `rgba(120, 220, 160, ${Math.min(1, value)})`
        paper.fillRect(col * SCALE, row * SCALE, SCALE, SCALE)
      }
    }
  })

  return (
    <canvas
      ref={canvas}
      className="field-grid"
      width={cols * SCALE}
      height={rows * SCALE}
      role="img"
      aria-label={title}
    />
  )
}

export function FieldPanel({
  fields,
  cells,
  spikes,
  elapsed,
  live,
  frames,
  onShow,
}: FieldPanelProps) {
  const [samples, setSamples] = useState<SampleInfo[]>([])
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [trouble, setTrouble] = useState<string | null>(null)

  // Список образцов спрашивается один раз на открытую панель: он в пакете и на
  // ходу не меняется. Без полей не спрашивается вовсе -- панели тогда нет.
  useEffect(() => {
    if (!fields.length) return
    let alive = true
    readSamples()
      .then((found) => {
        if (alive) setSamples(found)
      })
      .catch(() => {
        // Не беда: показать свою картинку можно и без встроенного набора, а
        // ругаться на пустой список значило бы пугать там, где всё работает.
        if (alive) setSamples([])
      })
    return () => {
      alive = false
    }
  }, [fields.length])

  const pick = useCallback(
    async (field: SandboxField, file: File | undefined) => {
      if (!file) return
      try {
        const frame = await frameOfFile(file, {
          rows: field.grid[0],
          cols: field.grid[1],
          channels: field.channels.length || 1,
        })
        setTrouble(null)
        onShow(field.id, { frame })
      } catch (error) {
        setTrouble(
          error instanceof Error
            ? `картинку не прочитать: ${error.message}`
            : 'картинку не прочитать',
        )
      }
    },
    [onShow],
  )

  if (!fields.length) return null

  return (
    <section className="field-panel" aria-label="Поля">
      {fields.map((field) => {
        const [rows, cols] = field.grid
        const depth = field.channels.length || 1
        const shown = pixelsOf(frames[field.id] ?? [], rows * cols, depth)
        const layer = field.layer
        const awake = layer ? awakeOf(spikes, layer.members, elapsed) : 0
        const sample = chosen[field.id] ?? samples[0]?.id ?? ''
        return (
          <div className="field" key={field.id}>
            <header className="field-head">
              <b>{field.id}</b>
              <span className="field-story">{field.story}</span>
            </header>

            <div className="field-controls">
              <select
                aria-label="Образец"
                value={sample}
                disabled={!samples.length}
                onChange={(event) =>
                  setChosen({ ...chosen, [field.id]: event.target.value })
                }
              >
                {samples.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!live || !sample}
                onClick={() => onShow(field.id, { sample })}
              >
                Показать
              </button>
              <button
                type="button"
                disabled={!live}
                // Гасится поле тем же движением, что и показывается: кадром из
                // нулей. Отдельного «погасить» в языке нет и не нужно --
                // темнота это такая же картинка.
                onClick={() => onShow(field.id, { frame: new Array(field.size).fill(0) })}
              >
                Погасить
              </button>
              <label className="field-file">
                Своя картинка
                <input
                  type="file"
                  accept="image/*"
                  disabled={!live}
                  onChange={(event) => void pick(field, event.target.files?.[0])}
                />
              </label>
            </div>

            <div className="field-view">
              <figure>
                <Grid
                  rows={rows}
                  cols={cols}
                  title={`Кадр на поле ${field.id}`}
                  light={(row, col) => shown[row * cols + col] ?? 0}
                />
                <figcaption>
                  подано: {shown.filter((value) => value > 0).length} из {rows * cols}
                </figcaption>
              </figure>

              {layer ? (
                <figure>
                  <Grid
                    rows={layer.grid[0]}
                    cols={layer.grid[1]}
                    title={`Отклик слоя ${layer.id}`}
                    light={(row, col) => {
                      const member = layer.members[row * layer.grid[1] + col]
                      if (!member) return 0
                      return lightOf(cells[member], spikes[member], elapsed)
                    }}
                  />
                  <figcaption>
                    ответило: {awake} из {layer.members.length}
                  </figcaption>
                </figure>
              ) : (
                <p className="field-note">
                  Поле льёт не в слой, а в отдельные клетки — отклик смотрите на
                  схеме.
                </p>
              )}
            </div>

            {trouble ? <p className="field-trouble">{trouble}</p> : null}
          </div>
        )
      })}
    </section>
  )
}
