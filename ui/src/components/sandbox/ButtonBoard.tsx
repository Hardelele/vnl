/**
 * Панель кнопок песочницы: чем сеть трогают снаружи и чем она отвечает (#562).
 *
 * Кнопка -- это палец на сенсоре. Нажали -- в сессию ушла единица, отпустили
 * -- ноль, и пока держат, держится единица: никаких ползунков и никаких долей,
 * вход прототипа -- бит. Кнопка, привязанная к мотору, не нажимается вовсе:
 * она лампочка, и горит, пока мотор отдаёт ненулевое.
 *
 * Двух списков дверей здесь нет: сенсоры и моторы приходят с сервера вместе с
 * состоянием проекта (`SandboxState.sensors`, `.motors`), а панель только
 * выбирает из них. Свой список в браузере разошёлся бы с тем, что считает
 * сервер, на первом же переименовании -- и кнопка молча перестала бы что-либо
 * нажимать.
 *
 * Нажата ли кнопка, панель у себя не хранит. Это спрашивают у сессии
 * (`SimView.sensors`), потому что правда про вход -- там: после перемотки на
 * 50 мс кнопка, нажатая на 100-й, обязана погаснуть, хотя палец с неё никто не
 * убирал. Своё «нажато» показывало бы палец, а не прогон, -- то есть врало бы
 * ровно в том месте, ради которого запись входа и переигрывается.
 *
 * Самих кнопок в проекте нет: они живут в браузере (`state/board`) -- разбор
 * там же. Схема без сенсоров и моторов панели не получает вовсе: привязывать
 * нечего, и пустая полоса отбирала бы у холста высоту ни за чем.
 */

import { useEffect, useRef, useState } from 'react'

import { boardKey, keyLabel } from '../../lib/keys'
import type { SandboxMotor, SandboxSensor } from '../../model/sandbox'
import {
  freeButtonId,
  readButtons,
  rememberButtons,
  type BoardButton,
  type BoardRole,
} from '../../state/board'

export interface ButtonBoardProps {
  /** Проект: кнопки помнятся по нему, имена дверей у каждого свои. */
  project: string
  sensors: SandboxSensor[]
  motors: SandboxMotor[]
  /** Что сеть видит сейчас. Из ответа сессии, а не из состояния панели. */
  values: Record<string, number>
  /** Что сеть отдаёт сейчас: по этому горит лампочка мотора. */
  output: Record<string, number>
  /** Открыта ли сессия: без неё нажатие некуда подавать. */
  live: boolean
  onSense: (values: Record<string, number>) => void
}

/** Дверь для поля выбора: сенсор и мотор описываются одинаково. */
interface Door {
  role: BoardRole
  id: string
  story: string
}

export function ButtonBoard({
  project,
  sensors,
  motors,
  values,
  output,
  live,
  onSense,
}: ButtonBoardProps) {
  // Читается один раз на проект: панель пересоздаётся при его смене (`key` у
  // вызова), и следить за чужими кнопками ей не приходится.
  const [buttons, setButtons] = useState<BoardButton[]>(() => readButtons(project))
  const [adding, setAdding] = useState(false)
  /**
   * Что сейчас держат -- ровно затем, чтобы отпустить.
   *
   * Не «нажато» (его спрашивают у сессии), а «мы уже послали единицу»: без
   * этого автоповтор клавиши слал бы её снова и снова, а уход окна из фокуса
   * оставлял бы сенсор нажатым навсегда -- отпускать было бы некому.
   */
  const held = useRef(new Set<string>())

  const doors: Door[] = [
    ...sensors.map((item) => ({ role: 'sensor' as const, id: item.id, story: item.story })),
    ...motors.map((item) => ({
      role: 'motor' as const,
      id: item.id,
      story: `${item.story}, ${item.unit}`,
    })),
  ]

  const keep = (next: BoardButton[]): void => {
    setButtons(next)
    rememberButtons(project, next)
  }

  const press = (button: BoardButton): void => {
    if (button.role !== 'sensor' || !live) return
    if (held.current.has(button.id)) return
    held.current.add(button.id)
    onSense({ [button.bind]: 1 })
  }

  const release = (button: BoardButton): void => {
    if (!held.current.delete(button.id)) return
    onSense({ [button.bind]: 0 })
  }

  /**
   * Клавиша -- второй способ нажать ту же кнопку, а не второе понятие.
   *
   * Слушатель на окне, а не на самой кнопке: у кнопки клавиша работала бы
   * только под фокусом, то есть после щелчка по ней, -- а щелчком её уже и
   * нажали. Что из нажатого наше, решает `lib/keys`: там же разведение со
   * стрелками (#537), Delete и Ctrl+D (#563).
   *
   * Уход окна из фокуса отпускает всё зажатое: `keyup` до окна уже не
   * дойдёт, и сенсор остался бы нажатым до следующего щелчка по кнопке.
   */
  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      const code = boardKey(event)
      if (!code) return
      for (const button of buttons) if (button.key === code) press(button)
    }
    const up = (event: KeyboardEvent): void => {
      const code = boardKey(event)
      if (!code) return
      for (const button of buttons) if (button.key === code) release(button)
    }
    const away = (): void => {
      for (const button of buttons) release(button)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', away)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', away)
    }
  })

  if (!doors.length) return null

  return (
    <section className="bb" aria-label="Кнопки">
      <span className="bb-title">Кнопки</span>

      {buttons.map((button) => (
        <Key
          key={button.id}
          button={button}
          // Потерянная привязка -- не повод прятать кнопку: дверь убрали из
          // схемы, и сказать об этом надо там, где на неё жмут.
          lost={!doors.some((door) => door.role === button.role && door.id === button.bind)}
          live={live}
          value={button.role === 'sensor' ? values[button.bind] : output[button.bind]}
          unit={button.role === 'motor' ? unitOf(motors, button.bind) : ''}
          onPress={() => press(button)}
          onRelease={() => release(button)}
          onDrop={() => keep(buttons.filter((item) => item.id !== button.id))}
        />
      ))}

      {adding ? (
        <NewButton
          doors={doors}
          first={doors[0]!}
          taken={buttons}
          onCancel={() => setAdding(false)}
          onAdd={(button) => {
            keep([...buttons, button])
            setAdding(false)
          }}
        />
      ) : (
        <button
          type="button"
          className="sb-icon bb-add"
          title="Завести кнопку и привязать её к сенсору или мотору"
          onClick={() => setAdding(true)}
        >
          +
        </button>
      )}

      {/* Без сессии нажимать некуда: подача идёт в прогон, а не в схему.
          Строка вместо молчаливо мёртвых кнопок -- человек иначе решает, что
          сломана привязка, и заводит вторую кнопку. */}
      {live ? null : (
        <span className="bb-note">Нажатие подаётся в прогон — запустите его.</span>
      )}
    </section>
  )
}

function unitOf(motors: SandboxMotor[], id: string): string {
  return motors.find((item) => item.id === id)?.unit ?? ''
}

/**
 * Одна кнопка.
 *
 * Сенсорная нажимается и отпускается, моторная не нажимается совсем: у неё
 * нечего подавать, она показывает. Поэтому у моторной нет ни `pointerdown`, ни
 * клавиши, а есть число -- то самое, что отдаёт сеть, вместе с единицей от
 * сервера.
 *
 * Указатель захватывается на нажатии: без этого палец, съехавший с кнопки,
 * уносит с собой `pointerup`, и сенсор остаётся нажатым. Захват возвращает
 * событие отпускания той кнопке, на которой нажали, -- ровно как у настоящей.
 */
function Key({
  button,
  lost,
  live,
  value,
  unit,
  onPress,
  onRelease,
  onDrop,
}: {
  button: BoardButton
  lost: boolean
  live: boolean
  value: number | undefined
  unit: string
  onPress: () => void
  onRelease: () => void
  onDrop: () => void
}) {
  const motor = button.role === 'motor'
  const on = Boolean(value)
  const dead = lost || (!motor && !live)
  return (
    <span className={`bb-key${on ? ' is-on' : ''}${lost ? ' is-lost' : ''}`}>
      <button
        type="button"
        className="bb-press"
        disabled={dead}
        title={
          lost
            ? `${button.bind} в схеме больше нет`
            : motor
              ? `Горит, пока мотор ${button.bind} отдаёт ненулевое`
              : `Держать — ${button.bind} получает 1, отпустить — 0`
        }
        onPointerDown={(event) => {
          if (motor) return
          onPress()
          // Захват -- удобство, а не условие нажатия, поэтому он идёт после
          // подачи и в try: браузер отказывает в нём, когда указателя с таким
          // номером уже нет (быстрое нажатие, событие, посланное из скрипта),
          // и отказ не должен отменять нажатие, которое человек уже сделал.
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            /* Без захвата отпускание ловит `pointerup` на самой кнопке. */
          }
        }}
        onPointerUp={() => onRelease()}
        onLostPointerCapture={() => onRelease()}
        // С клавиатуры кнопка нажимается пробелом и вводом -- как всякая
        // другая. Своя клавиша (`button.key`) это не отменяет: та работает без
        // фокуса, а эта -- у того, кто дошёл до кнопки табуляцией.
        onKeyDown={(event) => {
          if (motor || (event.key !== ' ' && event.key !== 'Enter')) return
          event.preventDefault()
          onPress()
        }}
        onKeyUp={(event) => {
          if (motor || (event.key !== ' ' && event.key !== 'Enter')) return
          onRelease()
        }}
      >
        <span className="bb-name">{button.name}</span>
        <span className="mono bb-sub">
          {motor
            ? `${format(value)}${unit ? ` ${unit}` : ''}`
            : button.key
              ? keyLabel(button.key)
              : button.bind}
        </span>
      </button>
      <button type="button" className="bb-drop" title="Убрать кнопку" onClick={onDrop}>
        ×
      </button>
    </span>
  )
}

/** Число мотора коротко: длинная дробь на кнопке шириной в слово не читается. */
function format(value: number | undefined): string {
  if (value === undefined) return '—'
  return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
}

/**
 * Форма заведения: имя, дверь и клавиша.
 *
 * Дверь выбирается из того, что пришло с сервера, и поэтому же форма не
 * спрашивает род отдельно: сенсор от мотора отличает сам список, а лишний
 * вопрос «это кнопка или лампочка» позволял бы ответить неправильно.
 *
 * Имя подставляется по имени двери -- в схеме из одного сенсора его и менять
 * незачем, а в схеме из шести кнопка «Газ» отличается от кнопки «Тормоз»
 * именно им.
 */
function NewButton({
  doors,
  first,
  taken,
  onCancel,
  onAdd,
}: {
  doors: Door[]
  /** Дверь по умолчанию. Отдельным полем: список непуст, но тип этого не знает. */
  first: Door
  taken: BoardButton[]
  onCancel: () => void
  onAdd: (button: BoardButton) => void
}) {
  const [at, setAt] = useState(doorId(first))
  const [name, setName] = useState(first.id)
  const [key, setKey] = useState<string | null>(null)
  // Дверь ищется по значению поля, а не разбирается из него обратно: строка
  // `sensor:key` -- ключ списка, а не второе место, где написано, что такое
  // род и имя двери.
  const chosen = doors.find((door) => doorId(door) === at) ?? first

  return (
    <form
      className="bb-new"
      onSubmit={(event) => {
        event.preventDefault()
        onAdd({
          id: freeButtonId(taken),
          name: name.trim() || chosen.id,
          role: chosen.role,
          bind: chosen.id,
          key,
        })
      }}
    >
      <input
        className="bb-field"
        aria-label="Имя кнопки"
        placeholder="Имя"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        className="bb-field"
        aria-label="К чему привязать"
        value={at}
        onChange={(event) => {
          const door = doors.find((item) => doorId(item) === event.target.value) ?? first
          setAt(doorId(door))
          setName(door.id)
        }}
      >
        {doors.map((door) => (
          <option key={doorId(door)} value={doorId(door)} title={door.story}>
            {door.role === 'sensor' ? 'сенсор' : 'мотор'} {door.id} · {door.story}
          </option>
        ))}
      </select>
      {/* Клавиша назначается нажатием самой клавиши, а не выбором из списка:
          список пришлось бы составить из всех букв и цифр, и выбирать в нём
          «ту, что под пальцем» -- дольше, чем нажать её. Разбирает нажатое тот
          же `lib/keys`, что и панель, -- второго понимания «какие клавиши
          наши» здесь нет. `preventDefault` затем, чтобы назначаемая клавиша не
          нажала заодно и кнопку: панель слушает то же событие на окне и
          пропускает уже разобранное (`handled`). */}
      <button
        type="button"
        className="bb-field bb-hotkey"
        title="Щёлкните и нажмите букву или цифру — она станет второй кнопкой"
        onClick={() => setKey(null)}
        onKeyDown={(event) => {
          const code = boardKey(event.nativeEvent)
          if (!code) return
          event.preventDefault()
          setKey(code)
        }}
      >
        {key ? keyLabel(key) : 'клавиша'}
      </button>
      <button type="submit" className="btn-secondary">
        Завести
      </button>
      <button type="button" className="btn-secondary" onClick={onCancel}>
        Отмена
      </button>
    </form>
  )
}

/** Дверь строкой -- значение поля выбора и ключ строки списка. */
function doorId(door: Door): string {
  return `${door.role}:${door.id}`
}
