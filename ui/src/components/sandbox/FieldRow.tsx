/**
 * Строка поля: показать сети картинку и увидеть отклик, не заняв экран (#583).
 *
 * В #581 это была панель во всю ширину: два квадрата 144×144, список, кнопки,
 * выбор файла — и повтор всего этого на каждое поле. Занимала она треть
 * экрана, а отвечала на один вопрос: «что видит сеть и чем отвечает».
 *
 * Теперь это строка в полосе внешнего ввода-вывода, рядом с кнопками, —
 * туда же, где живут все прочие двери в мир. Свёрнуто: кадр и отклик по 24 px,
 * счёт «111 / 576», образец, файл, «Показать». Раскрыто: те же две сетки по
 * 144 px рядом, чтобы сравнить глазами.
 *
 * Два поля — переключатель в той же строке, а не второй блок: полоса под
 * холстом не резиновая, и повторять в ней одно и то же устройство нельзя.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { frameOfFile } from '../../lib/frame'
import { rasterImage, rasterOf } from '../../lib/raster'
import type { SandboxField } from '../../model/sandbox'
import { readSamples, type SampleInfo } from '../../model/samples'

/** Сторона сетки в свёрнутой строке и в раскрытом сравнении, px. */
const SMALL = 24
const LARGE = 144

export interface FieldRowProps {
  fields: SandboxField[]
  /** Растр сессии: по нему горит отклик слоя. */
  spikes: Record<string, number[]>
  /** Пройденное модельное время, мс. */
  elapsed: number
  /** Открыта ли сессия: без неё показывать кадр некуда. */
  live: boolean
  /** Кадры, которые сейчас держатся на полях: приходят по требованию. */
  frames: Record<string, number[]>
  onShow: (field: string, what: { sample: string } | { frame: number[] }) => void
}

/** Кадр -> яркость каждого пикселя, 0…1 (у цветного — среднее по каналам). */
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

/**
 * Сетка 24×24 картинкой.
 *
 * Той же `<image>`, что и слой на холсте: полтысячи прямоугольников в строке,
 * перерисовываемой на каждом кадре показа, — это ровно та цена, от которой
 * задача и избавляет.
 */
function Grid({
  rows,
  cols,
  light,
  side,
  title,
  tone,
}: {
  rows: number
  cols: number
  light: number[]
  side: number
  title: string
  tone: [number, number, number]
}) {
  const picture = useMemo(
    () => rasterImage(light, rows, cols, tone),
    [light, rows, cols, tone],
  )
  return (
    <span
      className="fr-grid"
      style={{ width: side, height: side }}
      role="img"
      aria-label={title}
      title={title}
    >
      {picture ? <img src={picture} alt="" width={side} height={side} /> : null}
    </span>
  )
}

/** Цвет кадра и цвет отклика: вход и ответ различаются на глаз. */
const SHOWN: [number, number, number] = [226, 232, 240]
const ANSWER: [number, number, number] = [56, 142, 96]

export function FieldRow({
  fields,
  spikes,
  elapsed,
  live,
  frames,
  onShow,
}: FieldRowProps) {
  const [samples, setSamples] = useState<SampleInfo[]>([])
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [trouble, setTrouble] = useState<string | null>(null)
  const file = useRef<HTMLInputElement | null>(null)

  // Список образцов спрашивается один раз: он лежит в пакете и на ходу не
  // меняется. Без полей не спрашивается вовсе — строки тогда нет.
  useEffect(() => {
    if (!fields.length) return
    let alive = true
    readSamples()
      .then((found) => {
        if (alive) setSamples(found)
      })
      .catch(() => {
        // Не беда: свою картинку можно показать и без встроенного набора, а
        // ругаться на пустой список значило бы пугать там, где всё работает.
        if (alive) setSamples([])
      })
    return () => {
      alive = false
    }
  }, [fields.length])

  const field = fields.find((item) => item.id === current) ?? fields[0]

  const pick = useCallback(
    async (target: SandboxField, chosenFile: File | undefined) => {
      if (!chosenFile) return
      try {
        const frame = await frameOfFile(chosenFile, {
          rows: target.grid[0],
          cols: target.grid[1],
          channels: target.channels.length || 1,
        })
        setTrouble(null)
        onShow(target.id, { frame })
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

  if (!fields.length || !field) return null

  const [rows, cols] = field.grid
  const depth = field.channels.length || 1
  const shown = pixelsOf(frames[field.id] ?? [], rows * cols, depth)
  const lit = shown.filter((value) => value > 0).length
  const layer = field.layer
  const raster = layer
    ? rasterOf(spikes, layer.members, elapsed)
    : { light: [], awake: 0, total: 0 }
  const sample = chosen[field.id] ?? samples[0]?.id ?? ''

  return (
    <section className={`fr${open ? ' is-open' : ''}`} aria-label="Поле">
      <div className="fr-line">
        <span className="fr-title">ПОЛЕ</span>

        {fields.length > 1 ? (
          <select
            className="fr-which"
            aria-label="Какое поле"
            value={field.id}
            onChange={(event) => setCurrent(event.target.value)}
          >
            {fields.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
        ) : (
          <span className="mono fr-name">{field.id}</span>
        )}

        {layer ? <span className="fr-arrow">→ {layer.id}</span> : null}

        <Grid
          rows={rows}
          cols={cols}
          light={shown}
          side={SMALL}
          tone={SHOWN}
          title={`Кадр на поле ${field.id}: ${lit} из ${rows * cols}`}
        />
        {layer ? (
          <Grid
            rows={layer.grid[0]}
            cols={layer.grid[1]}
            light={raster.light}
            side={SMALL}
            tone={ANSWER}
            title={`Отклик слоя ${layer.id}: ${raster.awake} из ${raster.total}`}
          />
        ) : null}

        {/* Одно число на строку: сколько клеток слоя отозвалось. Про кадр
            говорит сам кадр, а «сколько величин ненулевых» -- это то же
            самое, только словами. */}
        <span className="mono fr-count">
          {layer ? `${raster.awake} / ${raster.total}` : `${lit} / ${rows * cols}`}
        </span>

        <select
          className="fr-sample"
          aria-label="Образец"
          value={sample}
          disabled={!samples.length}
          onChange={(event) => setChosen({ ...chosen, [field.id]: event.target.value })}
        >
          {samples.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="fr-act"
          disabled={!live || !sample}
          onClick={() => onShow(field.id, { sample })}
        >
          Показать
        </button>

        {/* Своя картинка -- кнопкой, а не полем ввода во всю строку: поле
            файла занимает полполосы и показывает имя, которое здесь ни на что
            не влияет. */}
        <button
          type="button"
          className="fr-act"
          disabled={!live}
          onClick={() => file.current?.click()}
          title="Показать свою картинку: браузер сам ужмёт её до сетки поля"
        >
          файл…
        </button>
        <input
          ref={file}
          className="fr-file"
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => void pick(field, event.target.files?.[0])}
        />

        <button
          type="button"
          className="fr-act"
          disabled={!live}
          // Гасится поле тем же движением, что и показывается: кадром из
          // нулей. Отдельного «снять» в языке нет и не нужно -- темнота это
          // такая же картинка.
          onClick={() => onShow(field.id, { frame: new Array(field.size).fill(0) })}
        >
          Снять
        </button>

        <button
          type="button"
          className={`fr-open${open ? ' is-on' : ''}`}
          title={open ? 'Свернуть' : 'Показать кадр и отклик крупно'}
          onClick={() => setOpen(!open)}
        >
          {open ? '⌄' : '›'}
        </button>

        {trouble ? <span className="fr-trouble">{trouble}</span> : null}
      </div>

      {open ? (
        <div className="fr-wide">
          <figure>
            <Grid
              rows={rows}
              cols={cols}
              light={shown}
              side={LARGE}
              tone={SHOWN}
              title={`Кадр на поле ${field.id}`}
            />
            <figcaption>
              подано: {lit} из {rows * cols}
            </figcaption>
          </figure>
          {layer ? (
            <figure>
              <Grid
                rows={layer.grid[0]}
                cols={layer.grid[1]}
                light={raster.light}
                side={LARGE}
                tone={ANSWER}
                title={`Отклик слоя ${layer.id}`}
              />
              <figcaption>
                ответило: {raster.awake} из {raster.total}
              </figcaption>
            </figure>
          ) : (
            <p className="fr-note">
              Поле льёт не в слой, а в отдельные клетки — отклик смотрите на схеме.
            </p>
          )}
          <p className="fr-note">
            Отклик — клетки слоя, разрядившиеся за последние 50 мс модельного
            времени: мгновенный срез мигает, растровое окно читается.
          </p>
        </div>
      ) : null}
    </section>
  )
}
