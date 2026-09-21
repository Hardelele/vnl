/**
 * Панель кнопок песочницы: чем сеть трогают снаружи и чем она отвечает (#562).
 *
 * Кнопка -- это палец на сенсоре. Нажали -- в сессию ушла единица, отпустили
 * -- ноль, и пока держат, держится единица: никаких ползунков и никаких долей,
 * вход прототипа -- бит.
 *
 * У кнопки две привязки, и любая может быть пустой (#574): `sensor` -- кому
 * она отдаёт свой бит, `motor` -- кто её зажигает. Только сенсор -- палец, как
 * было; только мотор -- лампочка, которая не нажимается; обе -- петля: сеть
 * шевельнула мотор, кнопка нажалась сама, сенсор получил единицу, и сеть
 * почувствовала последствие собственного действия. Ради этой петли сенсоры,
 * моторы и кнопки и делались: без неё граница односторонняя -- человек жмёт,
 * сеть отвечает, и на этом всё.
 *
 * ## Где замыкается петля
 *
 * Здесь, в браузере, тем же маршрутом, которым кнопку нажимает палец (`POST
 * /api/sim/<id>/sensors`, #561). Не на сервере внутри сессии -- и это решение,
 * а не то, до чего не дошли руки.
 *
 * Причина первая, названная владельцем: петля должна идти **через кнопку**.
 * Замкни её в симуляторе -- и кнопка перестанет быть тем, через что петля
 * проходит, и станет показом того, что происходит без неё. Тогда «привязать
 * один сенсор и один мотор к одной кнопке» нечего и значило бы.
 *
 * Причина вторая, техническая: всё, что приходит снаружи, ложится в поток
 * входа сессии (`Session._input`), а он часть состояния прогона -- перемотка
 * переигрывает его по записи, «Сброс» его не стирает. Значит петля,
 * замкнутая снаружи, **воспроизводима** тем же механизмом, что и палец: та же
 * запись даёт тот же прогон спайк в спайк. Петля, замкнутая внутри симулятора,
 * потребовала бы второго механизма воспроизведения -- и разошлась бы с первым.
 *
 * Цена -- задержка. Величина мотора приходит опросом (`POLL_MS`, 150 мс
 * реального времени), а сессия идёт со скоростью `DEFAULT_PACE` -- 50 модельных
 * миллисекунд за секунду реального. Значит между разрядом клетки и единицей на
 * сенсоре проходит **порядка 5-15 модельных миллисекунд** (шаг фонового потока
 * -- 5 мс модельных, опрос -- ещё до 7.5), в среднем около десяти. Это порядок
 * синаптической задержки, и для петли «сеть себя триггернула» он уместен; но
 * задан он опросом интерфейса, а не сетью, и при другом темпе сессии
 * изменится пропорционально. Петли, которым нужна задержка в доли
 * миллисекунды, так не собираются -- их место внутри схемы, обычной связью.
 *
 * Обратная сторона той же цены оказалась защитой: петля не может звенеть чаще,
 * чем идёт опрос. Мотор с коротким окном мигает на каждом шаге, но в поток
 * входа попадает не больше семи событий в секунду реального времени -- то
 * есть петля без задержки здесь не генератор, а ограниченный опросом храповик.
 * Разбор устойчивости -- в README, раздел «Кнопки в песочнице».
 *
 * ## Два источника одного бита
 *
 * Бит сенсора -- это **или**: он держится, пока его держит хоть кто-то, палец
 * или петля. Никто не «побеждает»: кнопка -- это контакт, и два пальца на
 * одном контакте не спорят, кто из них нажал. Практическое следствие важнее
 * правила: отпустив кнопку, которую держит петля, человек её не гасит -- и это
 * верно, потому что гасил бы он не свой бит, а чужой.
 *
 * Видно это на самой кнопке: пока её держит петля, у неё горит значок петли,
 * а подсказка говорит, что отпускание пальцем ничего не изменит.
 *
 * Разница считается по ответу сессии, а не по памяти браузера: петля подаёт
 * только то, чего на сенсоре ещё нет (`values[sensor]`). Поэтому на перемотке
 * назад она молчит -- там величину держит запись, -- и переигранное прошлое не
 * перезаписывается новыми событиями.
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
 * нечего, и пустая полоса отбирала бы у холста высоту.
 */

import { useEffect, useRef, useState } from 'react'

import { boardKey, keyLabel } from '../../lib/keys'
import type { SandboxMotor, SandboxSensor } from '../../model/sandbox'
import { boardController, roleOf, useButtons, type BoardButton } from '../../state/board'

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
  /**
   * Есть ли на холсте хоть что-нибудь (#573).
   *
   * От этого зависит, показывать ли полосу схеме без дверей. Пустому проекту
   * она не нужна: человек, который ещё ничего не положил, кнопок не ищет -- он
   * смотрит в палитру, а не под холст, и строка про сенсоры была бы ответом на
   * незаданный вопрос. А вот в собранной схеме вопрос «где кнопки» уже возник,
   * и там строка стоит своих тридцати пикселей.
   */
  scheme: boolean
  onSense: (values: Record<string, number>) => void
}

export function ButtonBoard({
  project,
  sensors,
  motors,
  values,
  output,
  live,
  scheme,
  onSense,
}: ButtonBoardProps) {
  // Список общий на весь экран (#576): те же кнопки видны в свойствах двери,
  // и второй список разошёлся бы с этим на первом же заведении.
  const buttons = useButtons(project)
  const [adding, setAdding] = useState(false)
  /**
   * Что сейчас держат пальцем -- ровно затем, чтобы отпустить.
   *
   * Не «нажато» (его спрашивают у сессии), а «мы уже послали единицу»: без
   * этого автоповтор клавиши слал бы её снова и снова, а уход окна из фокуса
   * оставлял бы сенсор нажатым навсегда -- отпускать было бы некому.
   */
  const held = useRef(new Set<string>())

  const press = (button: BoardButton): void => {
    if (!button.sensor || !live) return
    if (held.current.has(button.id)) return
    held.current.add(button.id)
    // Петля могла уже держать этот бит: тогда подавать нечего -- он подан.
    // Иначе палец, легший на горящую кнопку, послал бы вторую единицу в тот
    // же сенсор и записал бы в поток входа событие, ничего не меняющее.
    if (!values[button.sensor]) onSense({ [button.sensor]: 1 })
  }

  const release = (button: BoardButton): void => {
    if (!held.current.delete(button.id)) return
    if (!button.sensor) return
    // Палец убран -- но бит держится, пока его держит мотор: это одно и то же
    // «или», просто со стороны отпускания. Гасить чужой бит нельзя.
    if (button.motor && output[button.motor]) return
    onSense({ [button.sensor]: 0 })
  }

  /**
   * Петля: мотор зажёг кнопку -- сенсор получил единицу, мотор замолчал --
   * ноль (#574).
   *
   * Подаётся **разница** между тем, чего петля хочет, и тем, что сессия уже
   * держит на сенсоре. Не «мотор ненулевой -- шлём единицу»: ответ приходит
   * опросом по шесть-семь раз в секунду, и ровное повторение своего же
   * значения забило бы поток входа сотней одинаковых событий, каждое из
   * которых стирает записанное после себя будущее (`Simulator.sense_at`). А
   * заодно это и есть честное поведение на перемотке: там величину держит
   * запись, разницы нет -- и петля молчит, не перезаписывая переигранное.
   *
   * Эффект зависит от ответов сессии (`values`, `output` -- новые объекты на
   * каждом ответе), а не от каждой перерисовки: открытая форма заведения не
   * повод спрашивать петлю заново.
   *
   * Пока палец держит ту же кнопку, петля не гасит её: бит -- «или», и
   * замолчавший мотор не отменяет нажатого пальца.
   */
  // Кнопки проекта читаются при его открытии, а не при каждом кадре: список
  // живёт в браузере, и перечитывать его незачем -- правят его отсюда же.
  useEffect(() => {
    boardController.open(project)
  }, [project])

  useEffect(() => {
    if (!live) return
    for (const button of buttons) {
      if (!button.sensor || !button.motor) continue
      const lit = Boolean(output[button.motor])
      const on = Boolean(values[button.sensor])
      if (lit === on) continue
      if (!lit && held.current.has(button.id)) continue
      onSense({ [button.sensor]: lit ? 1 : 0 })
    }
    // `onSense` и `buttons` сюда не нужны как повод спрашивать заново: петлю
    // спрашивает новый ответ сессии, а не новая ссылка на обработчик.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, output, live, buttons])

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

  /**
   * Схема без дверей: полоса не пустая, а с одной строкой -- где взять дверь
   * (#573).
   *
   * В #562 полосы здесь не было вовсе, и решение было верным по своей причине:
   * привязывать нечего, а высоту пустая полоса отбирала бы у холста. Цена
   * оказалась в том, что человек, искавший кнопки, их не находил и не узнавал,
   * что сперва нужна дверь, -- та же болезнь, что была с раскрытием блока
   * (#549) и с поиском самих сенсоров (#571): возможность есть, дороги к ней
   * нет.
   *
   * Поэтому строка, а не пустая полоса, и поэтому же только в непустой схеме:
   * тридцать пикселей платятся там, где вопрос уже задан, и не платятся в
   * пустом проекте, где их и вправду не за что отдавать.
   */
  if (!sensors.length && !motors.length) {
    if (!scheme) return null
    return (
      <section className="bb" aria-label="Кнопки">
        <span className="bb-title">Кнопки</span>
        <span className="bb-note">
          Появятся, когда в схеме будет сенсор или мотор — их кладут слева, из
          вкладки «Внешнее».
        </span>
      </section>
    )
  }

  return (
    <section className="bb" aria-label="Кнопки">
      <span className="bb-title">Кнопки</span>

      {buttons.map((button) => (
        <Key
          key={button.id}
          button={button}
          // Потерянная привязка -- не повод прятать кнопку: дверь убрали из
          // схемы, и сказать об этом надо там, где на неё жмут. Сторон две, и
          // потеряться может любая: кнопка петли, у которой убрали мотор,
          // остаётся рабочим пальцем -- врать про неё «её больше нет» нельзя.
          lostSensor={Boolean(button.sensor) && !sensors.some((one) => one.id === button.sensor)}
          lostMotor={Boolean(button.motor) && !motors.some((one) => one.id === button.motor)}
          live={live}
          value={button.sensor ? values[button.sensor] : undefined}
          out={button.motor ? output[button.motor] : undefined}
          unit={button.motor ? unitOf(motors, button.motor) : ''}
          onPress={() => press(button)}
          onRelease={() => release(button)}
          onDrop={() => boardController.drop(project, button.id)}
        />
      ))}

      {adding ? (
        <NewButton
          sensors={sensors}
          motors={motors}
          onCancel={() => setAdding(false)}
          onAdd={(button) => {
            boardController.add(project, button)
            setAdding(false)
          }}
        />
      ) : (
        <button
          type="button"
          className="sb-icon bb-add"
          title="Завести кнопку: она подаёт на сенсор, зажигается мотором или делает и то и другое — тогда это петля"
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
 * Нажимается та, у которой привязан сенсор: только ей есть что подавать.
 * Кнопка одного мотора не нажимается совсем -- она показывает; поэтому у неё
 * нет ни `pointerdown`, ни клавиши, а есть число, то самое, что отдаёт сеть,
 * вместе с единицей от сервера.
 *
 * Кнопка петли -- и то и другое сразу, и по виду это должно читаться (#574):
 * у неё знак петли перед именем, а числом под именем стоит то, что отдаёт её
 * мотор. Пока петля держит бит, знак горит: значит кнопку держит не палец, и
 * отпускание пальцем её не погасит.
 *
 * Указатель захватывается на нажатии: без этого палец, съехавший с кнопки,
 * уносит с собой `pointerup`, и сенсор остаётся нажатым. Захват возвращает
 * событие отпускания той кнопке, на которой нажали, -- ровно как у настоящей.
 */
function Key({
  button,
  lostSensor,
  lostMotor,
  live,
  value,
  out,
  unit,
  onPress,
  onRelease,
  onDrop,
}: {
  button: BoardButton
  lostSensor: boolean
  lostMotor: boolean
  live: boolean
  /** Что держится на её сенсоре. У кнопки без сенсора -- `undefined`. */
  value: number | undefined
  /** Что отдаёт её мотор. У кнопки без мотора -- `undefined`. */
  out: number | undefined
  unit: string
  onPress: () => void
  onRelease: () => void
  onDrop: () => void
}) {
  const role = roleOf(button)
  const loop = role === 'loop'
  const lamp = role === 'motor'
  const lost = lostSensor || lostMotor
  // Горит то, что уходит в сеть: у кнопки с сенсором -- её бит, у лампочки --
  // число мотора. Один цвет на оба случая -- одно утверждение о границе.
  const on = Boolean(button.sensor ? value : out)
  /** Держит петля: мотор отдаёт, и бит на сенсоре уже стоит. */
  const auto = loop && Boolean(out) && Boolean(value)
  /**
   * Ждёт прогона: нажимать есть чем, а подавать некуда (#576).
   *
   * Отдельно от `lost` и от «нечего нажимать», потому что это единственная из
   * трёх причин, которая проходит сама: запустите прогон -- и кнопка оживёт.
   * Серым цветом все три выглядели одинаково, и человек читал серое как
   * «привязка сломалась» -- ровно так владелец и прочёл.
   */
  const waiting = Boolean(button.sensor) && !live && !lost
  const dead = lost || (!button.sensor && !lamp) || (Boolean(button.sensor) && !live)
  return (
    <span
      className={`bb-key${on ? ' is-on' : ''}${lost ? ' is-lost' : ''}${loop ? ' is-loop' : ''}${waiting ? ' is-waiting' : ''}`}
    >
      <button
        type="button"
        className="bb-press"
        disabled={dead}
        title={title(button, lostSensor, lostMotor, auto, waiting)}
        onPointerDown={(event) => {
          if (!button.sensor) return
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
          if (!button.sensor || (event.key !== ' ' && event.key !== 'Enter')) return
          event.preventDefault()
          onPress()
        }}
        onKeyUp={(event) => {
          if (!button.sensor || (event.key !== ' ' && event.key !== 'Enter')) return
          onRelease()
        }}
      >
        <span className="bb-name">
          {/* Знак петли -- на самой кнопке, а не в подсказке: подсказку
              читают после наведения, а «эта кнопка и жмётся, и горит» надо
              видеть, ни на что не наводя. */}
          {loop ? (
            <span className={`bb-loop${auto ? ' is-held' : ''}`} aria-hidden="true">
              ⟳
            </span>
          ) : null}
          {button.name}
        </span>
        {/* Подпись под именем -- место, где кнопка объясняет себя сама
            (#576). Число мотора у неё есть не всегда, а сказать, почему она
            не нажимается, надо именно на ней: строка рядом с панелью
            относится ко всем кнопкам сразу, а гаснет их по одной. */}
        <span className="mono bb-sub">{sub(button, out, unit, lostSensor, lostMotor, waiting)}</span>
      </button>
      <button type="button" className="bb-drop" title="Убрать кнопку" onClick={onDrop}>
        ×
      </button>
    </span>
  )
}

/**
 * Подпись под именем.
 *
 * Сперва причина, по которой кнопка не работает, потом число мотора, потом
 * клавиша: кнопка, которая сейчас ничего не делает, обязана сказать об этом
 * первой -- иначе «— Гц» на сером прямоугольнике читается как поломка.
 */
function sub(
  button: BoardButton,
  out: number | undefined,
  unit: string,
  lostSensor: boolean,
  lostMotor: boolean,
  waiting: boolean,
): string {
  if (lostSensor || lostMotor) return 'двери нет'
  if (waiting) return 'нужен прогон'
  if (button.motor) return `${format(out)}${unit ? ` ${unit}` : ''}`
  return button.key ? keyLabel(button.key) : (button.sensor ?? '')
}

/** Что сказать о кнопке наведением: потерянное, петля, палец, лампочка. */
function title(
  button: BoardButton,
  lostSensor: boolean,
  lostMotor: boolean,
  auto: boolean,
  waiting: boolean,
): string {
  if (lostSensor && lostMotor) return `${button.sensor} и ${button.motor} в схеме больше нет`
  if (lostSensor) return `сенсора ${button.sensor} в схеме больше нет`
  if (lostMotor) return `мотора ${button.motor} в схеме больше нет`
  // Привязка цела, и сказать об этом важнее, чем повторить «не нажимается»:
  // человек, увидевший серую кнопку, идёт заводить вторую.
  if (waiting)
    return `Привязка цела: ${button.sensor} получит 1, как только пойдёт прогон. Нажатие подаётся в прогон — запустите его`
  if (button.sensor && button.motor) {
    const loop = `Петля: мотор ${button.motor} зажигает её, сенсор ${button.sensor} получает 1. Держать можно и рукой — это тот же бит`
    return auto ? `${loop}. Сейчас её держит петля: отпускание рукой её не погасит` : loop
  }
  if (button.motor) return `Горит, пока мотор ${button.motor} отдаёт ненулевое`
  return `Держать — ${button.sensor} получает 1, отпустить — 0`
}

/** Число мотора коротко: длинная дробь на кнопке шириной в слово не читается. */
function format(value: number | undefined): string {
  if (value === undefined) return '—'
  return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1)
}

/**
 * Форма заведения: имя, две привязки и клавиша.
 *
 * Привязки спрашиваются отдельными полями, а не одним списком дверей, как было
 * в #562: у кнопки их две, и «сенсор или мотор» одним выбором петлю завести не
 * даёт. Каждое поле необязательно -- первым пунктом стоит «нет», -- но обе
 * пустыми быть не могут: такая кнопка ничего не делает, и завести её значило
 * бы поставить на панель украшение.
 *
 * Род отдельным вопросом по-прежнему не спрашивается: чем кнопка стала, видно
 * по тому, что в ней привязано, а лишний вопрос «это кнопка, лампочка или
 * петля» позволял бы ответить неправильно.
 *
 * Имя подставляется по первой названной двери -- в схеме из одного сенсора его
 * и менять незачем, а в схеме из шести кнопка «Газ» отличается от кнопки
 * «Тормоз» именно им.
 */
function NewButton({
  sensors,
  motors,
  onCancel,
  onAdd,
}: {
  sensors: SandboxSensor[]
  motors: SandboxMotor[]
  onCancel: () => void
  onAdd: (button: Omit<BoardButton, 'id'>) => void
}) {
  // Первая дверь предлагается сама: схема чаще всего об одном сенсоре, и
  // заводить кнопку в ней -- это два щелчка, а не выбор из списка в один пункт.
  const [sensor, setSensor] = useState<string>(sensors[0]?.id ?? '')
  const [motor, setMotor] = useState<string>(sensors.length ? '' : (motors[0]?.id ?? ''))
  const [name, setName] = useState(sensors[0]?.id ?? motors[0]?.id ?? '')
  const [key, setKey] = useState<string | null>(null)
  const nothing = !sensor && !motor

  return (
    <form
      className="bb-new"
      onSubmit={(event) => {
        event.preventDefault()
        if (nothing) return
        onAdd({
          name: name.trim() || sensor || motor,
          sensor: sensor || null,
          motor: motor || null,
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
        aria-label="Подаёт на сенсор"
        value={sensor}
        onChange={(event) => {
          setSensor(event.target.value)
          if (event.target.value) setName(event.target.value)
        }}
      >
        <option value="">без сенсора</option>
        {sensors.map((one) => (
          <option key={one.id} value={one.id} title={one.story}>
            сенсор {one.id} · {one.story}
          </option>
        ))}
      </select>
      <select
        className="bb-field"
        aria-label="Зажигается мотором"
        value={motor}
        onChange={(event) => {
          setMotor(event.target.value)
          if (event.target.value && !sensor) setName(event.target.value)
        }}
      >
        <option value="">без мотора</option>
        {motors.map((one) => (
          <option key={one.id} value={one.id} title={one.story}>
            мотор {one.id} · {one.story}, {one.unit}
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
      <button
        type="submit"
        className="btn-secondary"
        disabled={nothing}
        title={
          nothing
            ? 'Кнопка без привязок ничего не делает: выберите сенсор, мотор или оба сразу'
            : sensor && motor
              ? 'Кнопка с двумя привязками: мотор её зажигает, сенсор получает от неё 1 — это петля'
              : 'Завести кнопку'
        }
      >
        Завести
      </button>
      <button type="button" className="btn-secondary" onClick={onCancel}>
        Отмена
      </button>
      {/* Что получится, сказано до нажатия «Завести», а не после: петля
          собирается ровно здесь, и узнать о ней по виду заведённой кнопки --
          это узнать после того, как выбор уже сделан. */}
      <span className="bb-note">
        {sensor && motor
          ? 'Петля: мотор зажигает кнопку, сенсор получает от неё 1 — сеть чувствует собственное действие'
          : sensor
            ? 'Палец: нажали — сенсор получил 1, отпустили — 0'
            : motor
              ? 'Лампочка: горит, пока мотор отдаёт ненулевое'
              : 'Выберите сенсор, мотор или оба сразу'}
      </span>
    </form>
  )
}
