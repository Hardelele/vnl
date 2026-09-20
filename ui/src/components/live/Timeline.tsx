/**
 * Таймлайн симуляции: активность сети по дорожкам.
 *
 * Дорожка на клетку, и в ней сразу спайки и трасса -- так в макете
 * (`design/mockups/Spike Timeline.dc.html`), и так правильнее: разряд и то, что
 * к нему привело, надо видеть вместе, а не на двух графиках друг под другом.
 *
 * Шкала времени одна на все дорожки и на курсор: тик «100 мс» обязан стоять на
 * одной вертикали везде, иначе дорожки нельзя читать друг под другом.
 *
 * Два разных действия мышью. Наведение показывает значения под указателем и
 * ничего не меняет. Щелчок ставит время симуляции на выбранный момент -- это
 * уже не просмотр, а откат: сессия восстанавливает состояние и встаёт на паузу.
 * Оба названы словами (`TIMELINE_HINT`), потому что необратим из них ровно
 * один, а на вид они одинаковы (#504).
 *
 * Своей шапки у таймлайна нет: заголовок и объяснение жестов даёт панель,
 * внутри которой он стоит («Активность сети» в песочнице, `panel-head` на
 * карточке паттерна). Второй заголовок под первым съедал бы строку в панели,
 * высота которой и так спорная, а время под указателем показывается там, где
 * оно и нужно -- подписью на самой шкале, у волоска.
 *
 * Время масштабируется, а не всегда сжимается по ширине панели (#536). 400 мс
 * на 700 пикселях -- это 0.57 мс на пиксель, и пачка из восьми спайков с шагом
 * 5 мс ложится в девять пикселей одной чертой; разглядеть в ней, кто кого
 * опередил, нельзя, а смотрят в схеме именно это. Поэтому время приближают --
 * Ctrl с колесом, -- лишнее уезжает за край и прокручивается, а колонка имён
 * прибита слева: дорожка без имени бесполезна.
 *
 * Масштаб -- показ, а не состояние сессии: он живёт в этом компоненте, на
 * сервер не ездит, `fingerprint` не трогает и нового прогона не требует --
 * спайки и трассы уже накоплены в `state/sim`.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react'

import { ticks } from '../../lib/analysis'
import './timeline.css'

/** Внутренняя ширина дорожки: тянется по месту, важна только пропорция. */
const TRACK = 1000
const LANE = 100

/**
 * Предел приближения.
 *
 * Дальше 32× разглядывать нечего: при шаге симуляции 0.1 мс и панели в 700
 * пикселей это уже доли шага на пиксель, а сетка и подписи становятся частой
 * гребёнкой, в которой не читается ни то ни другое.
 */
const MAX_ZOOM = 32

/**
 * Сколько подписей держать в видимом окне.
 *
 * Тики считаются по всему прогону, а не по видимому куску: тогда они не
 * пересчитываются на каждый пиксель прокрутки и стоят на одних и тех же
 * круглых числах, сколько ни возишь. Частота же выбирается по масштабу --
 * `8 * zoom` тиков на прогон -- и в окно попадает те же восемь подписей при
 * любом приближении. Потолок в 128 -- про цену: тики рисуются линиями в каждой
 * дорожке, и на дюжине дорожек тысяча линий стоила бы дороже, чем стоят
 * подписи гуще одной на треть окна.
 */
const TICKS = 8
const TICKS_MAX = 128

/** Чувствительность колеса: щелчок мыши (~100) меняет масштаб примерно на 22%. */
const WHEEL = 0.002

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/**
 * Момент под указателем.
 *
 * Считается от геометрии самого поля дорожек, а не от доли ширины панели: при
 * масштабе поле шире окна и уезжает влево за край, его `left` тогда
 * отрицателен, а `width` -- полная ширина прогона. Доля от видимой ширины дала
 * бы в этом месте совсем другое время, и щелчок перематывал бы не туда, куда
 * показывают (#536).
 */
export function momentAt(
  clientX: number,
  box: { left: number; width: number },
  duration: number,
): number {
  const part = (clientX - box.left) / Math.max(box.width, 1)
  return clamp(part, 0, 1) * duration
}

/**
 * Что делает мышь на поле дорожек.
 *
 * Строка одна на все экраны: жесты у таймлайна общие, и разойтись их описания
 * не должны. Стоит она в шапке панели и в подсказке самого поля -- прочесть её
 * надо до щелчка, а не после.
 */
export const TIMELINE_HINT =
  'наведение показывает значения, щелчок перематывает время и ставит на паузу, ' +
  'колесо листает дорожки, Ctrl с колесом приближает время, Shift — прокручивает'

export interface TimelineProps {
  duration: number
  /** Где сейчас время симуляции, мс. */
  time: number
  dt: number
  /** Имена клеток в том порядке, в каком они стоят на схеме. */
  order: string[]
  spikes: Record<string, number[]>
  /** Трассы по ключам вида `E.soma:v`. */
  traces: Record<string, number[]>
  inhibitory: Record<string, boolean>
  onSeek: (time: number) => void
  /** Выбранная клетка подсвечена и здесь, и в инспекторе. */
  selected?: string | null
  onSelect?: (name: string) => void
  disabled?: boolean
}

interface Lane {
  name: string
  inhibitory: boolean
  spikes: number[]
  rate: number
  trace: number[] | null
  unit: string
  low: number
  high: number
}

export function Timeline({
  duration,
  time,
  dt,
  order,
  spikes,
  traces,
  inhibitory,
  onSeek,
  selected = null,
  onSelect,
  disabled = false,
}: TimelineProps) {
  /** Где стоит указатель, мс. Это просмотр: время симуляции он не трогает. */
  const [hover, setHover] = useState<number | null>(null)
  /** Во сколько раз время растянуто. 1 -- прогон целиком в ширину панели. */
  const [zoom, setZoom] = useState(1)
  /** Сам скроллер: по горизонтали -- время, по вертикали -- дорожки. */
  const view = useRef<HTMLDivElement | null>(null)
  /** Строка тиков: её геометрия и есть геометрия времени на экране. */
  const marks = useRef<HTMLSpanElement | null>(null)
  /** Куда поставить прокрутку после перерисовки на новом масштабе. */
  const pending = useRef<number | null>(null)

  const lanes = useMemo(
    () => order.map((name) => lane(name, spikes, traces, inhibitory, time)),
    [order, spikes, traces, inhibitory, time],
  )

  const at = useCallback(
    (event: PointerEvent<HTMLDivElement>): number =>
      momentAt(event.clientX, event.currentTarget.getBoundingClientRect(), duration),
    [duration],
  )

  // Прокрутка ставится после перерисовки, а не в обработчике колеса: до неё
  // поле ещё прежней ширины, и `scrollLeft` браузер обрезал бы по ней.
  useLayoutEffect(() => {
    const el = view.current
    if (!el || pending.current === null) return
    el.scrollLeft = pending.current
    pending.current = null
  }, [zoom])

  useEffect(() => {
    const el = view.current
    if (!el) return

    /**
     * Ctrl с колесом -- масштаб. Точка под курсором остаётся на месте:
     * приближают, чтобы разглядеть конкретную пачку, и уезжать из-под мыши она
     * не должна. Голое колесо листает дорожки -- этим занимается сам браузер,
     * и отбирать у него привычный жест не за что.
     *
     * Слушатель вешается руками, а не через `onWheel`: React вешает `wheel`
     * пассивным, и `preventDefault` в нём молча ничего не делает -- панель
     * продолжала бы скроллиться под приближением.
     */
    const onWheel = (event: WheelEvent): void => {
      const box = marks.current?.getBoundingClientRect()
      if (!box) return
      // Приближает Ctrl с колесом, а голое колесо листает дорожки. Раньше над
      // полем приближало голое колесо, и выходило, что один жест значит два
      // разных действия, а какое именно -- зависит от невидимого состояния:
      // на пределе масштаба обработчик выходил, и то же движение колеса
      // доставалось браузеру прокруткой. Со стороны это выглядело так, что
      // вниз таймлайн листается, а вверх -- приближается (#548).
      //
      // Ctrl выбран не произвольно: им приближают в браузере, в картах и в
      // редакторах, и щипок на трекпаде приходит тем же событием. Shift и
      // горизонтальное колесо по-прежнему прокручивают время -- это привычный
      // жест, и перехватывать его нечем.
      if (!event.ctrlKey && !event.metaKey) return
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

      // `preventDefault` до проверки предела: на пределе Ctrl с колесом всё
      // равно наш жест, и отдавать его браузеру (который увеличит страницу)
      // нельзя.
      event.preventDefault()
      const next = clamp(zoom * Math.exp(-event.deltaY * WHEEL), 1, MAX_ZOOM)
      if (next === zoom) return

      // Курсор стоит на месте: смещение точки от левого края поля растёт во
      // столько же раз, во сколько растянулось время.
      const inside = event.clientX - box.left
      pending.current = Math.max(0, el.scrollLeft + inside * (next / zoom - 1))
      setZoom(next)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom])

  const whole = (): void => {
    pending.current = 0
    setZoom(1)
  }

  const grid = ticks(duration, Math.min(Math.round(TICKS * zoom), TICKS_MAX))

  /**
   * Куда сдвинуть подпись относительно своей отметки.
   *
   * Обычная стоит по центру над чертой, крайние -- внутрь: подпись у края,
   * съехавшая на половину наружу, либо прячется под прибитой колонкой имён,
   * либо вылезает за правый край и заводит прокрутку там, где прокручивать
   * нечего.
   */
  const nudge = (moment: number): string => {
    const part = share(moment)
    if (part <= 0.5) return 'translateX(0)'
    if (part >= 99.5) return 'translateX(-100%)'
    return 'translateX(-50%)'
  }
  const share = (moment: number) => (moment / Math.max(duration, 1)) * 100
  const x = (moment: number) => (moment / Math.max(duration, 1)) * TRACK

  return (
    <div className="tl" ref={view}>
      <div
        className="tl-body"
        // Ширина поля растёт с масштабом, колонка имён -- нет: она прибита
        // слева и на любой прокрутке остаётся на месте.
        style={
          zoom > 1
            ? { width: `calc(var(--tl-name) + (100% - var(--tl-name)) * ${zoom})` }
            : undefined
        }
      >
        <div className="tl-scale">
          <span className="tl-corner">
            {/* Возврат к «целиком» -- кнопкой, а не двойным щелчком по полю:
                щелчок по полю перематывает время уже на первом нажатии, и
                двойной был бы двумя перемотками до возврата масштаба. */}
            <button
              type="button"
              className="mono tl-zoom"
              disabled={zoom === 1}
              title={
                zoom === 1
                  ? 'Прогон целиком; колесо над дорожками приближает время'
                  : 'Показать прогон целиком'
              }
              onClick={whole}
            >
              {zoom === 1 ? 'целиком' : `×${zoom < 10 ? zoom.toFixed(1) : zoom.toFixed(0)}`}
            </button>
          </span>
          <span className="tl-marks" ref={marks}>
            {grid.map((moment) => (
              <span
                key={moment}
                className="mono tl-mark"
                style={{ left: `${share(moment)}%`, transform: nudge(moment) }}
              >
                {moment}
              </span>
            ))}
            {/* Время под указателем стоит у самого волоска, а не в углу панели:
                читают его вместе со значениями на дорожках, и глазами ходить
                за ним через весь экран незачем. */}
            {hover === null ? null : (
              <span
                className="mono tl-now"
                style={{ left: `${share(hover)}%`, transform: nudge(hover) }}
              >
                {hover.toFixed(1)} мс
              </span>
            )}
          </span>
        </div>

        {lanes.map((item) => (
          <div className={`tl-lane${selected === item.name ? ' is-on' : ''}`} key={item.name}>
            <LaneName item={item} value={valueAt(item, hover, dt)} onSelect={onSelect} />

            <div
              className={`tl-field${disabled ? ' is-off' : ''}`}
              // Подсказка на самом поле, а не только в шапке: щелчок здесь
              // откатывает сессию, и узнать об этом надо до него.
              title={disabled ? undefined : TIMELINE_HINT}
              onPointerMove={(event) => setHover(at(event))}
              onPointerLeave={() => setHover(null)}
              onPointerDown={(event) => {
                if (!disabled) onSeek(at(event))
              }}
            >
              <svg className="tl-svg" viewBox={`0 0 ${TRACK} ${LANE}`} preserveAspectRatio="none">
                {grid.map((moment) => (
                  <line
                    key={moment}
                    className="tl-grid"
                    x1={x(moment)}
                    y1={0}
                    x2={x(moment)}
                    y2={LANE}
                  />
                ))}

                {item.trace ? (
                  <>
                    <path className="tl-fill" d={area(item, duration, dt)} />
                    <path className="tl-curve" d={curve(item, duration, dt)} />
                  </>
                ) : null}

                {item.spikes.map((moment, index) => (
                  <line
                    key={`${moment}-${index}`}
                    className={item.inhibitory ? 'tl-spike is-inh' : 'tl-spike'}
                    x1={x(moment)}
                    y1={item.trace ? LANE * 0.06 : LANE * 0.25}
                    x2={x(moment)}
                    y2={item.trace ? LANE * 0.4 : LANE * 0.75}
                  />
                ))}
              </svg>

              {hover === null ? null : (
                <div className="tl-hairline" style={{ left: `${share(hover)}%` }} />
              )}
              <div className="tl-cursor" style={{ left: `${share(time)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Подпись дорожки.
 *
 * Кнопкой она становится только там, где щелчку есть что открыть: в песочнице
 * инспектора клетки нет, `onSelect` не передают, и кнопка с подсветкой обещала
 * бы действие, которого на этом экране не существует (#504).
 *
 * Имя клетки и приставка блока -- в двух строках, а не в одну: в собранной
 * схеме приставка у дорожек общая (`ffi/E`, `ffi/I`), различаются они как раз
 * хвостом, и обрезать в одной строке пришлось бы его. Полное имя всегда в
 * подсказке, и передан `onSelect` или нет -- на это не влияет.
 */
function LaneName({
  item,
  value,
  onSelect,
}: {
  item: Lane
  value: string
  onSelect?: (name: string) => void
}) {
  const inside: ReactNode = (
    <>
      <span className="tl-title">
        <span className={`tl-dot${item.inhibitory ? ' is-inh' : ''}`} />
        <span className="tl-cell">{cellOf(item.name)}</span>
      </span>
      <span className="mono tl-value">{value}</span>
      {/* У положенной руками клетки приставки нет -- и пустой строки под
          именем тоже: место в панели не тратится на прочерк. */}
      {ownerOf(item.name) ? (
        <span className="mono tl-owner">{ownerOf(item.name)}</span>
      ) : null}
      <span className="mono tl-stat">
        {item.spikes.length} сп. · {item.rate.toFixed(0)} Гц
      </span>
    </>
  )

  if (!onSelect) {
    return (
      <span className="tl-name" title={item.name}>
        {inside}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="tl-name is-pick"
      onClick={() => onSelect(item.name)}
      title={`${item.name} — показать в инспекторе`}
    >
      {inside}
    </button>
  )
}

/** Имя нейрона в собранной сети -- `блок/клетка` (см. `compose.SEPARATOR`). */
function cellOf(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1)
}

function ownerOf(name: string): string {
  const cut = name.lastIndexOf('/')
  return cut < 0 ? '' : name.slice(0, cut)
}

/** Дорожка одной клетки: её спайки, её трасса и шкала под трассу. */
function lane(
  name: string,
  spikes: Record<string, number[]>,
  traces: Record<string, number[]>,
  inhibitory: Record<string, boolean>,
  elapsed: number,
): Lane {
  const fired = spikes[name] ?? []
  // Ключ трассы -- `E.soma:v`; секция здесь не важна, берём первую подходящую.
  const key = Object.keys(traces).find((candidate) => candidate.startsWith(`${name}.`))
  const values = key ? traces[key] ?? null : null
  const variable = key?.split(':')[1] ?? 'v'
  const span = extent(values)
  return {
    name,
    inhibitory: inhibitory[name] ?? false,
    spikes: fired,
    rate: elapsed > 0 ? (fired.length / elapsed) * 1000 : 0,
    trace: values && values.length ? values : null,
    unit: variable === 'v' ? 'мВ' : 'нСм',
    low: span.low,
    high: span.high,
  }
}

function extent(values: number[] | null): { low: number; high: number } {
  if (!values || !values.length) return { low: 0, high: 1 }
  let low = values[0] as number
  let high = low
  for (const value of values) {
    if (value < low) low = value
    if (value > high) high = value
  }
  if (high - low < 1e-6) {
    // Ровная линия: без запаса она легла бы точно на край дорожки.
    low -= 0.5
    high += 0.5
  }
  return { low, high }
}

/** Точки трассы в координатах дорожки; длинная трасса прореживается. */
function points(item: Lane, duration: number, dt: number): Array<[number, number]> {
  const values = item.trace ?? []
  const span = Math.max(item.high - item.low, 1e-6)
  const step = Math.max(1, Math.floor(values.length / TRACK))
  const out: Array<[number, number]> = []
  for (let index = 0; index < values.length; index += step) {
    const value = values[index] as number
    out.push([
      ((index * dt) / Math.max(duration, 1)) * TRACK,
      // Нижние две трети дорожки -- под трассу, верх -- под штрихи спайков.
      LANE - ((value - item.low) / span) * LANE * 0.52,
    ])
  }
  return out
}

function curve(item: Lane, duration: number, dt: number): string {
  return points(item, duration, dt)
    .map(([px, py], index) => `${index ? 'L' : 'M'} ${px.toFixed(1)} ${py.toFixed(1)}`)
    .join(' ')
}

function area(item: Lane, duration: number, dt: number): string {
  const line = points(item, duration, dt)
  if (line.length < 2) return ''
  const first = line[0] as [number, number]
  const last = line[line.length - 1] as [number, number]
  const body = line
    .map(([px, py]) => `L ${px.toFixed(1)} ${py.toFixed(1)}`)
    .join(' ')
  return `M ${first[0].toFixed(1)} ${LANE} ${body} L ${last[0].toFixed(1)} ${LANE} Z`
}

/** Значение трассы под указателем -- то, ради чего наведение и нужно. */
function valueAt(item: Lane, hover: number | null, dt: number): string {
  if (hover === null || !item.trace) return ''
  const index = Math.min(item.trace.length - 1, Math.max(0, Math.round(hover / dt)))
  const value = item.trace[index]
  return value === undefined ? '' : `${value.toFixed(1)} ${item.unit}`
}
