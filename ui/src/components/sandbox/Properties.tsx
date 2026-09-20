/**
 * Правая панель песочницы: свойства выбранного объекта.
 *
 * Панель не показывает, а правит. Смотреть на собранную схему можно и на
 * холсте; сюда приходят затем, чтобы поменять порог, вес или частоту драйва и
 * увидеть, что из этого вышло, -- поэтому каждое число здесь поле, а не
 * подпись. Исключений два: имя паттерна (за него держится снимок блока) и
 * адрес связи (другой адрес -- это другая связь, а не правка этой).
 *
 * **Правило панели: здесь живёт только выбранный объект.** Оно написано тут
 * прямо, потому что именно его отсутствие превратило панель в свалку (#569):
 * сюда легло всё новое подряд -- имя проекта (#563), числа прогона, -- и
 * получилось, что проект правят там же, где клетку, а выбирают в другом месте.
 * Проверка простая: если поле не исчезает вместе со снятым выделением, ему
 * здесь не место. Имя проекта уехало в полосу слева сверху (`ProjectBar`),
 * числа прогона -- к управлению временем (`RunSettings`).
 *
 * Отдельным файлом, потому что экран песочницы и без неё большой, а свойств
 * ровно столько, сколько параметров у модели: они будут только прибывать.
 */

import type { ReactNode } from 'react'

import { CELLS, LINKS, counted } from '../../lib/plural'
import { momentWords } from '../../lib/times'
import {
  NO_GLOSSARY,
  driveHint,
  driveKind,
  driveKinds,
  driveParamLabel,
  receptorNote,
  recordedName,
} from '../../model/glossary'
import type { CellState } from '../../model/sim'
import { where } from '../../model/sandbox'
import type {
  DriveKind,
  Endpoint,
  SandboxBlock,
  SandboxCell,
  SandboxContact,
  SandboxDrive,
  SandboxLink,
  SandboxMotor,
  SandboxNeuron,
  SandboxRecording,
  SandboxSensor,
  SandboxState,
} from '../../model/sandbox'
import type {
  CellKind,
  DriveParam,
  Glossary,
  PatternPort,
  PointModel,
  RecordedVar,
} from '../../model/types'
import { sandboxController, type Selection } from '../../state/sandbox'
import { Vitals } from '../live/Vitals'
// Разбор приставки (`ffi/I` принадлежит блоку `ffi`) -- один на весь
// интерфейс: второе место, считающее владельца по-своему, разошлось бы с
// первым на первом же блоке с вложенным именем.
import { ownerOf } from './Canvas'

/**
 * Список рецепторов для поля выбора.
 *
 * Своего списка в браузере нет: он приходит из `ir.RECEPTORS` вместе с
 * объяснениями. Пока ответа нет, в списке стоит одно текущее значение -- поле
 * обязано показывать то, что в проекте, даже без справки; предлагать выбор из
 * выдуманного здесь списка было бы хуже, чем не предлагать его вовсе.
 */
function receptorOptions(
  glossary: Glossary,
  value: string,
): Array<{ id: string; name: string; note?: string }> {
  if (!glossary.receptors.length) return [{ id: value, name: value }]
  return glossary.receptors.map((item) => ({
    id: item.id,
    name: item.id,
    note: receptorNote(item),
  }))
}

/**
 * Клетка палитры по имени типа -- ради её `note`.
 *
 * Тексты клеток уже написаны в `vnl/cells.py` и приходят каталогом; в
 * песочнице они просто нигде не показывались (#541). Потерянный тип -- не
 * ошибка: у клетки из чужого `.vnl` объяснения может не быть вовсе.
 */
function cellHint(palette: CellKind[], type: string): string | undefined {
  const kind = palette.find((item) => item.id === type)
  if (!kind) return undefined
  return kind.note ? `${kind.name}. ${kind.note}` : kind.name
}

/**
 * Что можно записывать. Список приходит из реестра сервера (`ir.RECORDED`) тем
 * же ответом, что и рецепторы: своя копия имён здесь значила бы, что новая
 * величина появляется в симуляторе и не появляется в поле выбора.
 *
 * Пока словаря нет, в списке стоит одно текущее значение -- по тому же
 * правилу, что и у рецепторов: поле обязано показывать то, что в проекте.
 */
function recordedOptions(
  glossary: Glossary,
  value: RecordedVar,
): Array<{ id: RecordedVar; name: string }> {
  if (!glossary.recorded.length) return [{ id: value, name: value }]
  return glossary.recorded.map((item) => ({ id: item.id, name: item.name }))
}

/**
 * Список видов точечной модели для поля выбора.
 *
 * Тем же устройством, что у рецепторов, и по той же причине: какие мембраны
 * симулятор действительно считает, знает `ir.POINT_MODELS`, а браузер об этом
 * знать не должен. Пока ответа сервера нет, в списке стоит один текущий вид --
 * поле обязано показывать то, что в проекте, и выбор из выдуманного здесь
 * списка был бы хуже, чем отсутствие выбора (#527).
 */
function modelOptions(
  glossary: Glossary,
  value: string,
): Array<{ id: string; name: string; note?: string }> {
  const models = glossary.models ?? []
  if (!models.length) return [{ id: value, name: value }]
  return models.map((item) => ({ id: item.id, name: item.id, note: item.note }))
}

/** Числа мембраны. Вид модели (`kind`) правится отдельно: это не число. */
type CellField = Exclude<keyof PointModel, 'kind'>

/**
 * Параметры мембраны в порядке чтения: сначала то, что решает, когда клетка
 * разрядится, потом то, что решает, как она устаёт.
 */
const CELL_FIELDS: Array<{ key: CellField; label: string; step?: number }> = [
  { key: 'vThreshold', label: 'Порог, мВ' },
  { key: 'vRest', label: 'Покой, мВ' },
  { key: 'vReset', label: 'Сброс, мВ' },
  { key: 'tauM', label: 'τ мембраны, мс' },
  { key: 'refractory', label: 'Рефрактерность, мс' },
  { key: 'adaptation', label: 'Адаптация, мВ' },
  { key: 'tauAdaptation', label: 'τ адаптации, мс' },
  { key: 'rIn', label: 'Rвх, МОм', step: 10 },
]

/**
 * Поля, которые читает только `adex`, -- в порядке того же разговора: сперва
 * разгон у порога, потом ток адаптации.
 *
 * Отдельным списком, а не флагом в `CELL_FIELDS`, потому что и показываются
 * они отдельно: у `lif` этих чисел нет вовсе -- не «есть, но не действуют», а
 * нет, -- и предлагать править то, что никуда не идёт, значит врать про
 * модель. Приходят они при этом всегда (`POINT_FIELDS`), и прятать их здесь
 * можно безопасно: переключение вида ничего не теряет.
 *
 * В подписях -- имена из текста схемы (`Δ_t`, `v_peak`, `τ_w`, `a`, `b`). Тот
 * же довод, что у имени вида модели: этими словами параметр пишется в файле, и
 * «связь тока с потенциалом, нСм» пришлось бы потом переводить обратно.
 */
const ADEX_FIELDS: Array<{ key: CellField; label: string; step?: number }> = [
  { key: 'deltaT', label: 'Δ_t разгона, мВ', step: 0.5 },
  { key: 'vPeak', label: 'v_peak разряда, мВ' },
  { key: 'tauW', label: 'τ_w тока адаптации, мс', step: 10 },
  { key: 'wCoupling', label: 'a — ток за потенциалом, нСм', step: 0.5 },
  { key: 'wIncrement', label: 'b — ток на разряд, нА', step: 0.01 },
]

/** Что сейчас за мембрана. Нет `pointModel` -- нет и разговора про вид. */
const ADEX = 'adex'

/**
 * Мембрана: вид модели и его числа (#527).
 *
 * Один набор полей на оба места, где мембрану правят, -- отдельную клетку и
 * тип внутри блока. Вещь одна, и вторая копия разошлась бы с первой на первом
 * же новом параметре: у клетки поле появилось бы, у блока нет. Тем же
 * правилом, что `DriveFields` и `RecordFields` (#565).
 *
 * Вид стоит первым, потому что он решает, о чём дальше разговор: половина
 * полей ниже при `lif` не существует. До #527 его здесь не было вовсе --
 * схему с `adex` можно было написать файлом, но не собрать на холсте, то есть
 * половина движка человеку была недоступна.
 *
 * Отказ показывать не нужно: он приходит общим путём песочницы (`act` ->
 * `error`), тем же, каким приходит отказ по весу связи или по частоте драйва.
 * Своё сообщение об ошибке здесь было бы вторым местом, где написано, что не
 * так с мембраной, -- а текст отказа приходит от языка.
 */
function MembraneFields({
  point,
  glossary,
  onChange,
}: {
  point: PointModel
  glossary: Glossary
  /** Куда уходит правка: у клетки и у блока адрес разный, поле одно. */
  onChange: (params: Partial<PointModel>) => void
}) {
  const adex = point.kind === ADEX
  return (
    <>
      <SelectField
        label="Вид модели"
        hint={glossary.cell.kind}
        value={point.kind}
        options={modelOptions(glossary, point.kind)}
        onChange={(kind) => onChange({ kind })}
      />
      {CELL_FIELDS.map((field) => (
        <NumberField
          key={field.key}
          label={field.label}
          hint={glossary.cell[field.key]}
          step={field.step}
          value={point[field.key]}
          onChange={(value) => onChange({ [field.key]: value })}
        />
      ))}
      {/* Адаптация порогом (`adaptation`, `tau_adaptation`) у `adex` не
          читается: там она выражена током w. Поля всё равно остаются выше,
          среди общих, -- они есть у типа клетки при любом виде модели, и
          спрятать их значило бы молча потерять набранные числа при
          переключении туда и обратно. Что при `adex` они не действуют,
          сказано в их подсказке (`ir.POINT_NOTES`), там же, где сказано, что
          пять полей ниже читает только `adex`. */}
      {adex ? (
        <>
          {/* Заголовок, а не просто ещё пять полей подряд: эти числа
              принадлежат второму виду модели, и без границы они читались бы
              как продолжение общих -- то есть как что-то, что было и у lif. */}
          <Section title="Разгон и ток адаптации" />
          {ADEX_FIELDS.map((field) => (
            <NumberField
              key={field.key}
              label={field.label}
              hint={glossary.cell[field.key]}
              step={field.step}
              value={point[field.key]}
              onChange={(value) => onChange({ [field.key]: value })}
            />
          ))}
        </>
      ) : null}
    </>
  )
}

/**
 * На какой порт можно подать драйв и какой можно записывать (#533).
 *
 * Модуляторный порт попадает в оба списка, и это не послабление: `gate` у
 * `disinhibition` смотрит на VIP, а `dopamine` -- на VTA, то есть это обычные
 * клетки, которые точно так же принимают стимул и точно так же спайкают. Ради
 * них паттерн и вставляют: без драйва на `gate` растормаживания не увидеть, а
 * без записи с `dopamine` не увидеть, когда пришло подкрепление.
 *
 * Разделения «mod -- только вход» или «mod -- только выход» здесь нет
 * намеренно: модулятор и стимулируют, и смотрят, и любой из двух половин не
 * хватило бы. Сервер и так не ограничивает ни то, ни другое -- `add_stimulus`
 * принимает любой конец связи, а `resolve_endpoint` разбирает порт любого
 * направления, -- так что вторая, более строгая правда о портах жила бы только
 * в этой панели и расходилась бы с тем, что на самом деле можно.
 */
function canDrive(port: PatternPort): boolean {
  return port.direction === 'in' || port.direction === 'mod'
}

function canRecord(port: PatternPort): boolean {
  return port.direction === 'out' || port.direction === 'mod'
}

/**
 * Имя порта в кнопке драйва и записи.
 *
 * У `disinhibition` четыре входа -- `in`, `tonic`, `gate`, `dopamine`, -- и по
 * столбцу одинаковых «Драйв на …» не понять, куда бьёшь: два последних порта
 * модуляторные, и драйв на них делает не то же самое, что драйв на `in`.
 * Поэтому модуляторный вход назван словом.
 *
 * Слово, а не значок или `mod` из ответа сервера: значок пришлось бы
 * объяснять, а направление подряд машинным именем уже стоит выше в списке
 * портов -- там оно к месту, потому что рядом видно и точку, на которую порт
 * смотрит.
 */
function portTitle(port: PatternPort): string {
  return port.direction === 'mod' ? `модулятор ${port.name}` : port.name
}

export function Properties({
  selection,
  project,
  cells,
  spikes,
  elapsed,
  glossary = NO_GLOSSARY,
  palette = [],
}: {
  selection: Selection | null
  project: SandboxState
  cells: Record<string, CellState>
  /** Моменты разрядов по клеткам собранной сети: `ffi/E`, `X`. */
  spikes: Record<string, number[]>
  /** Пройденное время симуляции, мс: по нему считается частота. */
  elapsed: number
  /**
   * Расшифровка подписей с сервера (#541). Пустая -- панель работает как
   * работала: подсказка объясняет, а не управляет, и ждать её незачем.
   */
  glossary?: Glossary
  /** Каталог клеток -- ради `note`: объяснения уже написаны в `cells.py`. */
  palette?: CellKind[]
}) {
  if (!selection) {
    return (
      <>
        <Head title="Свойства" />
        <p className="sb-hint">
          Выберите клетку, блок или связь. Соединение — щелчок по точке
          подключения, потом по второй.
        </p>
      </>
    )
  }

  if (selection.kind === 'block') {
    const block = project.blocks.find((item) => item.id === selection.id)
    // Блоку принадлежат и стимулы на его портах, и стимулы на внутренних
    // узлах (`ffi/I`, #530): владельца считает `ownerOf` -- тот же разбор
    // приставки, которым холст решает, чью фигуру держит конец связи.
    const mine = (target: Endpoint): boolean =>
      block !== undefined && ownerOf(target.instance, project.blocks) === block.id
    return block ? (
      <BlockProps
        block={block}
        drives={project.stimuli.filter((item) => mine(item.target))}
        records={project.recordings.filter((item) => mine(item.target))}
        cells={cells}
        glossary={glossary}
        palette={palette}
      />
    ) : null
  }

  if (selection.kind === 'neuron') {
    const neuron = project.neurons.find((item) => item.id === selection.id)
    // У клетки приставки нет: её имя в собранной сети -- она сама, и сравнение
    // точное. `ownerOf` здесь дал бы то же самое, но обещал бы, что у клетки
    // бывают внутренние узлы.
    const at = (target: Endpoint): boolean => target.instance === selection.id
    return neuron ? (
      <NeuronProps
        neuron={neuron}
        drives={project.stimuli.filter((item) => at(item.target))}
        records={project.recordings.filter((item) => at(item.target))}
        cells={cells}
        spikes={spikes}
        elapsed={elapsed}
        glossary={glossary}
        palette={palette}
      />
    ) : null
  }

  if (selection.kind === 'link') {
    const link = project.links.find((item) => item.id === selection.id)
    if (!link) return null
    const control = sandboxController
    return (
      <>
        <Head title="Связь" note={link.id} />
        <div className="row">
          <span className="mono row-path">
            {where(link.source)} → {where(link.target)}
          </span>
        </div>
        <SelectField
          label="Рецептор"
          hint={glossary.contact.receptor}
          value={link.receptor}
          options={receptorOptions(glossary, link.receptor)}
          onChange={(receptor) => void control.setParams(link.id, { receptor })}
        />
        <NumberField
          label="Вес, нСм"
          hint={glossary.contact.weight}
          value={link.weight}
          onChange={(weight) => void control.setParams(link.id, { weight })}
        />
        <NumberField
          label="Задержка, мс"
          hint={glossary.contact.delay}
          value={link.delay}
          onChange={(delay) => void control.setParams(link.id, { delay })}
        />
        <Remove what="связь" id={link.id} />
      </>
    )
  }

  if (selection.kind === 'stimulus') {
    const drive = project.stimuli.find((item) => item.id === selection.id)
    return drive ? <DriveProps drive={drive} glossary={glossary} /> : null
  }

  if (selection.kind === 'sensor') {
    const sensor = project.sensors.find((item) => item.id === selection.id)
    return sensor ? (
      <SensorProps
        sensor={sensor}
        // Куда смотрит сенсор -- это его связи: подключён он обычной стрелкой,
        // у которой источник он сам. Второго списка целей у него нет, и
        // заводить его значило бы объявить, что связь от сенсора -- не связь.
        links={project.links.filter((link) => link.source.instance === sensor.id)}
        glossary={glossary}
      />
    ) : null
  }

  if (selection.kind === 'motor') {
    const motor = project.motors.find((item) => item.id === selection.id)
    return motor ? <MotorProps motor={motor} glossary={glossary} /> : null
  }

  const record = project.recordings.find((item) => item.id === selection.id)
  return record ? <RecordProps record={record} glossary={glossary} /> : null
}

/**
 * Список родов сенсора или мотора для поля выбора (#571).
 *
 * Тем же устройством, что `driveOptions`, и по той же причине: реестр родов
 * живёт на сервере (`protocols.SENSOR_KINDS`, `MOTOR_KINDS`), и своя копия
 * здесь значила бы, что новый род появляется в симуляторе и не появляется в
 * поле выбора. Текущий род обязан быть в списке, даже если реестр о нём не
 * знает: `select` с чужим значением показал бы вместо него первый пункт, то
 * есть панель соврала бы про род.
 */
function kindOptions(
  kinds: Array<{ id: string; name: string; note: string }>,
  value: string,
): Array<{ id: string; name: string; note?: string }> {
  const known = kinds.map((item) => ({ id: item.id, name: item.name, note: item.note }))
  if (known.some((item) => item.id === value)) return known
  return [{ id: value, name: value }, ...known]
}

/**
 * Поле числа рода -- одно на сенсор и на мотор.
 *
 * Общее нарочно: числа у них устроены одинаково (реестр называет поле, его
 * подпись, единицу и шаг), и различаются только тем, как их отправить. Две
 * копии разошлись бы на первом же новом роде: у сенсора поле появилось бы, у
 * мотора нет.
 */
function KindParamField({
  owner,
  param,
  onChange,
}: {
  owner: Record<string, unknown>
  param: DriveParam
  onChange: (value: number) => void
}) {
  const value = Number((owner[param.name] as number | undefined) ?? param.default)
  return (
    <NumberField
      label={driveParamLabel(param)}
      hint={param.note}
      step={param.form === 'int' ? 1 : param.step}
      value={value}
      onChange={(next) => onChange(param.form === 'int' ? Math.round(next) : next)}
    />
  )
}

/**
 * Сенсор: род, числа рода и то, куда он бьёт (#571).
 *
 * Панель ровно такая же, как у стимула, и это не подражание, а признание
 * родства: сенсор -- тот же внешний вход, только величину ему подают снаружи
 * прогона, а не задают наперёд протоколом. Поэтому и поле рода объясняется той
 * же парой подсказок -- на подписи «что это за поле», на списке «что значит
 * выбранное».
 *
 * Цели показаны строками, а не полями: цель сенсора -- это связь, а связь
 * правят, выбрав её саму. Другой адрес -- это другая связь, а не правка этой,
 * ровно как у всякого конца связи в этой панели.
 */
function SensorProps({
  sensor,
  links,
  glossary,
}: {
  sensor: SandboxSensor
  links: SandboxLink[]
  glossary: Glossary
}) {
  const control = sandboxController
  const kind = (glossary.sensors ?? []).find((item) => item.id === sensor.kind)
  return (
    <>
      <Head title="Сенсор" note={sensor.id} />
      <p className="sb-note">{sensor.story}</p>
      <SelectField
        label="Род"
        hint={glossary.sensor || undefined}
        value={sensor.kind}
        options={kindOptions(glossary.sensors ?? [], sensor.kind)}
        onChange={(next) => void control.setSensor(sensor.id, { kind: next })}
      />
      {(kind?.params ?? []).map((param) => (
        <KindParamField
          key={param.name}
          owner={sensor as unknown as Record<string, unknown>}
          param={param}
          onChange={(value) => void control.setSensor(sensor.id, { [param.name]: value })}
        />
      ))}
      <Section title="Куда смотрит" />
      {links.length ? (
        links.map((link) => (
          <p className="sb-note mono" key={link.id}>
            → {where(link.target)}
          </p>
        ))
      ) : (
        // Одинокий сенсор -- законный объект, но величина до сети не доходит,
        // и сказать об этом надо здесь, а не после пустого прогона.
        <p className="sb-note">
          Ни к чему не подключён: щёлкните по кружку справа от его фигуры, потом
          по клетке. Пока связи нет, поданная величина никуда не идёт.
        </p>
      )}
      <Remove what="сенсор" id={sensor.id} />
    </>
  )
}

/** Мотор: род, числа рода и клетка, на которую он смотрит (#571). */
function MotorProps({ motor, glossary }: { motor: SandboxMotor; glossary: Glossary }) {
  const control = sandboxController
  const kind = (glossary.motors ?? []).find((item) => item.id === motor.kind)
  return (
    <>
      <Head title="Мотор" note={motor.id} />
      <div className="row">
        {/* Цель стоит первой строкой, как у записи: мотор и есть «смотрю на
            эту точку», и без неё он не значит ничего. */}
        <span className="mono row-path">{where(motor.source)} →</span>
      </div>
      <p className="sb-note">
        {motor.story}
        {motor.unit ? `, отдаёт ${motor.unit}` : ''}
      </p>
      <SelectField
        label="Род"
        hint={glossary.motor || undefined}
        value={motor.kind}
        options={kindOptions(glossary.motors ?? [], motor.kind)}
        onChange={(next) => void control.setMotor(motor.id, { kind: next })}
      />
      {(kind?.params ?? []).map((param) => (
        <KindParamField
          key={param.name}
          owner={motor as unknown as Record<string, unknown>}
          param={param}
          onChange={(value) => void control.setMotor(motor.id, { [param.name]: value })}
        />
      ))}
      <Remove what="мотор" id={motor.id} />
    </>
  )
}

function BlockProps({
  block,
  drives,
  records,
  cells,
  glossary,
  palette,
}: {
  block: SandboxBlock
  /**
   * Стимулы и записи блока -- и на портах, и на внутренних узлах (#565, #530).
   *
   * Вместе, а не двумя списками: `ffi.in` и `ffi/IN` -- это одна и та же
   * точка, названная с двух сторон, и разводить их значило бы объявить, что
   * драйв на порт и драйв на узел разные вещи.
   */
  drives: SandboxDrive[]
  records: SandboxRecording[]
  cells: Record<string, CellState>
  glossary: Glossary
  palette: CellKind[]
}) {
  const control = sandboxController
  return (
    <>
      {/* В шапке -- идентификатор экземпляра, а не паттерна: это адрес, им
          блок и его нейроны зовутся в связях (`ffi`, `ffi/I`). Откуда блок
          взялся, сказано ниже отдельной строкой. */}
      <Head title="Блок" note={block.id} />
      {/* Подпись на холсте -- у экземпляра: одного «FFI» из библиотеки на
          схеме бывает три, и различать их надо здесь, а не в библиотеке. */}
      <TextField
        label="Название"
        value={block.label}
        onChange={(label) => void control.rename(block.id, label)}
      />
      <div className="row">
        <span className="mono row-dim">
          {block.counts.neurons} кл. · {block.counts.contacts} св.
        </span>
        <span className="mono row-dim row-end">{block.patternId}</span>
      </div>

      <Section title="Порты" />
      {block.ports.map((port) => {
        const state = cells[`${block.id}/${port.site.instance}`]
        return (
          <div className="row" key={port.name}>
            <span className="row-id" title={port.note || undefined}>
              {port.name}
            </span>
            {/* `in`, `out` и `mod` -- машинные имена из текста схемы, и
                оставить их без расшифровки значит предложить угадать, чем
                модуляторный порт отличается от входа (#541). */}
            <span className="mono row-dim" title={glossary.port[port.direction]}>
              {port.direction}
            </span>
            <span className="mono row-dim row-end">
              {state ? `${state.v.toFixed(1)} мВ` : port.site.instance}
            </span>
          </div>
        )
      })}

      <Section title="Внутри" />
      {/* Начинка блока -- не справка, а точки подключения. Блок считается
          насквозь (`compose` разворачивает его нейроны в общую сеть), поэтому
          связь можно вести прямо в узел, минуя порт: порт -- названный автором
          ярлык частой двери, а не единственная дверь. Щелчок ведёт тот же
          автомат соединения, что порт на холсте и сома клетки: второго способа
          начать связь заводить нельзя. */}
      {block.scheme.neurons.map((neuron) => {
        const flat = `${block.id}/${neuron.id}`
        const state = cells[flat]
        return (
          <div className="row sb-inner" key={neuron.id}>
            <button
              type="button"
              className="sb-inner-pick"
              onClick={() => void control.touchEndpoint(flat, null)}
            >
              <span className={`sb-dot${neuron.inhibitory ? ' is-inh' : ''}`} />
              <span className="mono row-id">{flat}</span>
              <span className="mono row-dim row-end">
                {state ? `${state.v.toFixed(1)} мВ` : 'соединить'}
              </span>
            </button>
            {/* Драйв прямо на внутренний узел (#565). До сих пор его вешали
                только на порт, хотя сервер принимает любой конец связи, --
                и на тормозный нейрон блока, ради которого паттерн часто и
                вставляют, подать было нечего, кроме как через панель
                стимула. Кнопка отдельная, а не второй смысл у строки: щелчок
                по строке уже занят соединением, и два действия в одном
                щелчке различить нельзя. */}
            <button
              type="button"
              className="sb-plus"
              title={`Драйв на ${flat}`}
              onClick={() => void control.stimulate(flat, null)}
            >
              ↯
            </button>
          </div>
        )
      })}

      <Section title="Связи внутри" />
      {/* Механизм паттерна живёт в контактах не меньше, чем в мембране: в
          «задержке проведения» весь смысл в двух контактах одного источника,
          `delay = 1 мс` и `delay = 10 мс`. Пока их нельзя было тронуть,
          потрогать механизм там, где он живёт, не получалось -- оставалось
          переписывать `.vnl` и перекладывать схему заново (#531). */}
      {block.contacts.map((contact) => (
        <ContactGroup
          key={contact.id}
          block={block.id}
          contact={contact}
          glossary={glossary}
        />
      ))}
      {block.contacts.length ? (
        <p className="sb-note">
          Правка задевает только этот блок: снимок у экземпляра свой — ни такой
          же блок рядом, ни паттерн в библиотеке не меняются.
        </p>
      ) : (
        <p className="sb-note">Внутри блока связей нет.</p>
      )}

      <Section title="Клетки" />
      {block.cells.map((cell) => (
        <CellGroup
          key={cell.type}
          block={block.id}
          cell={cell}
          glossary={glossary}
          palette={palette}
        />
      ))}

      {/* Стимулы и записи блока -- там же, где их правят у клетки (#565).
          Заводятся они по-прежнему на конкретную точку: у блока их столько,
          сколько портов, и общий «драйв на блок» был бы адресом, которого не
          существует -- потенциал есть у клетки, а коробка это несколько
          клеток с разными порогами. */}
      <DrivesOf drives={drives} records={records} glossary={glossary}>
        {block.ports.filter(canDrive).map((port) => (
          <button
            key={port.name}
            type="button"
            className="btn-secondary"
            onClick={() => void control.stimulate(block.id, port.name)}
          >
            Драйв на {portTitle(port)}
          </button>
        ))}
        {block.ports.filter(canRecord).map((port) => (
          <button
            key={port.name}
            type="button"
            className="btn-secondary"
            onClick={() => void control.record(block.id, port.name)}
          >
            Записывать {portTitle(port)}
          </button>
        ))}
      </DrivesOf>

      <div className="sb-actions">
        {/* Разобрать -- не то же, что убрать: блок не уносится, а заменяется
            своим же содержимым в другом виде (#532). Нужно там, где от
            паттерна нужна половина или его надо переделать на месте; «Fork»
            на этот вопрос не отвечает -- он про библиотеку, а не про этот
            проект. Отменяется одним шагом, поэтому спрашивать подтверждения
            незачем. */}
        <button
          type="button"
          className="btn-secondary"
          // Последствие названо здесь той же фразой, что и у плашки на холсте
          // (#549): дорог к разбору две, а сказано о нём должно быть одно и то
          // же -- иначе одна из дорог окажется «той, что без предупреждения».
          title={`${block.label} перестанет быть блоком: на холсте останутся ${counted(
            block.counts.neurons,
            CELLS,
          )} и ${counted(
            block.counts.contacts,
            LINKS,
          )} как обычные объекты проекта. Отменяется одним шагом.`}
          onClick={() => void control.ungroup(block.id)}
        >
          Разобрать на клетки
        </button>
        {/* Копия блока -- со своим снимком: правленые пороги и задержки
            уезжают в неё, а дальше два экземпляра расходятся свободно. За это
            снимок и хранится (#563). */}
        <button
          type="button"
          className="btn-secondary"
          title="Ещё один такой же блок рядом — со своим снимком, без связей (Ctrl+D)"
          onClick={() => void control.duplicate(block.id)}
        >
          Дублировать блок
        </button>
        <button
          type="button"
          className="btn-secondary"
          title="Убрать вместе со связями, стимулами и записями (Delete)"
          onClick={() => void control.remove(block.id)}
        >
          Убрать блок
        </button>
      </div>
    </>
  )
}

/**
 * Свойства отдельной клетки: параметры мембраны, драйв, запись и удаление.
 *
 * Ни портов, ни «Fork», ни «Открыть карточку» здесь нет, и это не упущение.
 * Портов у клетки не бывает -- соединяется она точкой на себе; разворачивать и
 * форкать нечего -- внутренностей нет; карточки нет тоже -- показывать в ней
 * схему из одного узла значит показывать пустое место. Общего с панелью блока
 * у этой панели ровно ничего, поэтому она и отдельная.
 *
 * Параметры мембраны правятся так же, как у блока: в IR они висят на типе
 * клетки, а не на нейроне, -- но словарь типов у отдельных клеток общий на
 * песочницу, и правка задевает всех её клеток этого типа. Каталог при этом не
 * трогается: песочница держит копию типа.
 */
function NeuronProps({
  neuron,
  drives,
  records,
  cells,
  spikes,
  elapsed,
  glossary,
  palette,
}: {
  neuron: SandboxNeuron
  /** Стимулы, которые бьют в эту клетку, и записи, которые её пишут (#565). */
  drives: SandboxDrive[]
  records: SandboxRecording[]
  cells: Record<string, CellState>
  spikes: Record<string, number[]>
  elapsed: number
  glossary: Glossary
  palette: CellKind[]
}) {
  const control = sandboxController
  // Приставки у отдельной клетки нет: в собранной сети она зовётся так же.
  const state = cells[neuron.id]
  // Объяснение клетки уже написано в `cells.py` и приходит каталогом: в
  // песочнице оно просто нигде не показывалось (#541).
  const about = cellHint(palette, neuron.cellType)
  return (
    <>
      <Head title="Клетка" note={neuron.id} />
      {/* Имя клетки правится здесь же, где и всё остальное, и это то же самое
          поле, что «Название» у блока, -- но правит оно другое. У блока это
          подпись на коробке, у клетки -- её имя в собранной сети: им подписан
          столбец растра и за него держатся связи, стимулы и записи. Ссылки
          чинит сервер одной операцией, поэтому и «Отменить» на неё одно
          (#563). */}
      <TextField
        label="Имя"
        value={neuron.id}
        onChange={(name) => void control.renameNeuron(neuron.id, name)}
      />
      <div className="row" title={about}>
        <span className={`sb-dot${neuron.inhibitory ? ' is-inh' : ''}`} />
        <span className="mono row-dim">{neuron.cellType}</span>
        <span className="mono row-dim row-end">
          {neuron.inhibitory ? 'тормозная' : 'возбуждающая'}
        </span>
      </div>

      {/* Живые числа -- тем же `Vitals`, что и в инспекторе карточки паттерна:
          заряд, потенциал и разряды за прогон. Прежде здесь стоял один
          потенциал в милливольтах, и доли до порога из него не вычислить --
          порог у клетки свой, адаптация поднимает его выше номинального. */}
      <Vitals state={state} spikes={spikes[neuron.id] ?? []} elapsed={elapsed} />

      {neuron.pointModel ? (
        <>
          <Section title="Мембрана" />
          {/* Правка задевает всех клеток этого типа в песочнице -- тип в IR
              один на всех своих, -- и смена вида модели тем более: она меняет
              не число, а солвер. Сказано это подписью здесь, а не только в
              комментарии, ровно по той причине, по которой список нейронов
              стоит в заголовке типа у блока: знать это надо до правки, а не
              после прогона (#527). */}
          <p className="sb-note">
            Мембрана висит на типе «{neuron.cellType}»: правка задевает все
            клетки этого типа в проекте. Вид модели — другой солвер, а не
            число.
          </p>
          <MembraneFields
            point={neuron.pointModel}
            glossary={glossary}
            onChange={(params) =>
              void control.setCell(neuron.id, neuron.cellType, params)
            }
          />
        </>
      ) : (
        // Потерянный тип чинят, а не скрывают: клетка остаётся на холсте и
        // говорит, чего ей не хватает.
        <p className="sb-note">
          Тип клетки «{neuron.cellType}» в проекте не найден — параметры мембраны
          править не по чему.
        </p>
      )}

      {/* Стимулы и записи этой клетки -- здесь, а не только отдельной строкой
          в дереве объектов (#565). У стимула ровно одна цель, и смотрят на
          него оттуда, куда он бьёт: чтобы понять, почему клетка спайкает
          пачками, человек выбирает клетку, а не идёт искать `drive2`. */}
      <DrivesOf drives={drives} records={records} glossary={glossary}>
        {/* Драйв и запись идут на саму клетку: порта, на который их вешают у
            блока, здесь нет. */}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void control.stimulate(neuron.id, null)}
        >
          Драйв на {neuron.id}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void control.record(neuron.id, null)}
        >
          Записывать {neuron.id}
        </button>
        {/* Граница с миром стоит рядом с драйвом и записью, потому что вопрос
            один: чем эту клетку гонят и что с неё снимают. Разница только в
            том, откуда приходит и куда уходит величина -- у драйва обе
            стороны внутри прогона, у сенсора с мотором одна снаружи (#560).

            «Сенсор на клетку» заводит дверь и сразу тянет от неё стрелку:
            одинокий сенсор до клетки ничего не доносит, а провести стрелку
            иначе пока негде -- фигуры на холсте у него нет. «Отменить» на это
            два: связь и сам сенсор -- разные объекты, и история о них
            честна. */}
        <button
          type="button"
          className="btn-secondary"
          title={glossary.sensor}
          onClick={() => void control.addSensor(neuron.id, null)}
        >
          Сенсор на {neuron.id}
        </button>
        <button
          type="button"
          className="btn-secondary"
          title={glossary.motor}
          onClick={() => void control.addMotor(neuron.id, null)}
        >
          Мотор с {neuron.id}
        </button>
      </DrivesOf>

      <div className="sb-actions">
        {/* Копия ложится рядом, со своим именем и тем же типом -- значит с
            теми же параметрами мембраны, и правка порога задевает обеих
            (тип в IR один на всех своих клеток). Связей и драйва копия не
            получает: связь без второго конца бессмысленна, а второй драйв
            удвоил бы вход в схему, которую ещё собирают (#563). */}
        <button
          type="button"
          className="btn-secondary"
          title="Ещё одна такая же клетка рядом — без связей и драйва (Ctrl+D)"
          onClick={() => void control.duplicate(neuron.id)}
        >
          Дублировать клетку
        </button>
        <button
          type="button"
          className="btn-secondary"
          title="Убрать вместе со связями, стимулами и записями (Delete)"
          onClick={() => void control.remove(neuron.id)}
        >
          Убрать клетку
        </button>
      </div>
    </>
  )
}

/**
 * Параметры одного типа клеток блока.
 *
 * Свёрнуто, потому что у микросхемы типов бывает три, а полей у каждого
 * восемь: развёрнутые они превращают панель в простыню, по которой не найти
 * ни порт, ни вес. В сводке стоит порог -- по нему тип и узнают.
 *
 * Список нейронов в подписи не украшение: параметры мембраны в IR висят на
 * типе, поэтому правка задевает всех, кто этого типа, и знать это надо до
 * правки, а не после прогона.
 */
function CellGroup({
  block,
  cell,
  glossary,
  palette,
}: {
  block: string
  cell: SandboxCell
  glossary: Glossary
  palette: CellKind[]
}) {
  const control = sandboxController
  const about = cellHint(palette, cell.type)
  return (
    <details className="sb-group">
      <summary title={about}>
        <span className={`sb-dot${cell.inhibitory ? ' is-inh' : ''}`} />
        <span className="sb-row-name">{cell.neurons.join(', ')}</span>
        {/* В сводке вид модели и порог: до #527 стоял один порог, а «-50 мВ»
            у lif и у adex значат разное -- у второго это не порог, а точка, с
            которой начинается разгон. Вид назван своим словом из текста
            схемы, а не «обычная»/«с разгоном»: сравнивать свёрнутые строки
            придётся с тем, что написано в файле. */}
        <span className="mono sb-kind">
          {cell.pointModel.kind} · {cell.pointModel.vThreshold} мВ
        </span>
      </summary>
      <p className="sb-note mono" title={about}>
        {cell.type}
      </p>
      <MembraneFields
        point={cell.pointModel}
        glossary={glossary}
        onChange={(params) => void control.setCell(block, cell.type, params)}
      />
    </details>
  )
}

/**
 * Параметры одного контакта внутри блока (#531).
 *
 * Поля те же три, что у связи песочницы, -- и это не повторение, а признание
 * того, что вещь одна: связь и контакт различаются только адресом. Завести
 * внутри блока свой «вес» значило бы, что одно и то же число зовётся
 * по-разному в зависимости от того, с какой стороны коробки оно нарисовано.
 *
 * Свёрнуто по той же причине, что и тип клетки: у «растормаживания» контактов
 * шесть, а полей у каждого три, и развёрнутыми они превращают панель в
 * простыню. В сводке стоит задержка: ради неё сюда и приходят.
 */
function ContactGroup({
  block,
  contact,
  glossary,
}: {
  block: string
  contact: SandboxContact
  glossary: Glossary
}) {
  const control = sandboxController
  return (
    <details className="sb-group">
      <summary>
        <span className={`sb-dot${contact.inhibitory ? ' is-inh' : ''}`} />
        {/* Адрес -- точки снимка (`IN → FAR`), без приставки экземпляра:
            правится снимок, а не собранная сеть, где тот же контакт зовётся
            `ffi/c1`. */}
        <span className="sb-row-name mono">
          {contact.pre.instance} → {contact.post.instance}
        </span>
        <span className="mono sb-kind">{contact.delay} мс</span>
      </summary>
      <p className="sb-note mono">{contact.id}</p>
      <SelectField
        label="Рецептор"
        hint={glossary.contact.receptor}
        value={contact.receptor}
        options={receptorOptions(glossary, contact.receptor)}
        onChange={(receptor) =>
          void control.setContact(block, contact.id, { receptor })
        }
      />
      <NumberField
        label="Вес, нСм"
        hint={glossary.contact.weight}
        value={contact.weight}
        onChange={(weight) => void control.setContact(block, contact.id, { weight })}
      />
      <NumberField
        label="Задержка, мс"
        hint={glossary.contact.delay}
        value={contact.delay}
        onChange={(delay) => void control.setContact(block, contact.id, { delay })}
      />
    </details>
  )
}

/**
 * Список родов драйва для поля выбора.
 *
 * Как и у рецепторов: своего списка здесь нет -- он приходит с сервера вместе
 * с объяснениями (`Glossary.drives`, #553). Пока ответа нет, в списке стоит
 * один текущий род: поле обязано показывать то, что в проекте, а выдуманный
 * здесь выбор был бы хуже, чем отсутствие выбора.
 */
function driveOptions(
  glossary: Glossary,
  value: string,
): Array<{ id: string; name: string; note?: string }> {
  const known = driveKinds(glossary).map((item) => ({
    id: item.id,
    name: item.name,
    note: item.note,
  }))
  // Текущий род обязан быть в списке, даже если реестр о нём не знает: `select`
  // с чужим значением показывает вместо него первый пункт, то есть панель
  // соврала бы про род, а следующая правка молча перевела бы драйв на него.
  if (known.some((item) => item.id === value)) return known
  return [{ id: value, name: value }, ...known]
}

/**
 * Поле числа протокола: подпись, единица и объяснение -- из реестра сервера.
 *
 * Считанное число `form` решает, счётное поле или дробное: у «импульсов» шаг
 * ровно единица, а у частоты -- десятые, и решает это тот, кто протокол
 * описал, а не панель.
 */
function DriveParamField({
  drive,
  param,
}: {
  drive: SandboxDrive
  param: DriveParam
}) {
  const control = sandboxController
  if (param.form === 'times') {
    return (
      <TextField
        label={driveParamLabel(param)}
        value={drive.times.join(', ')}
        onChange={(text) => void control.setDrive(drive.id, { times: moments(text) })}
      />
    )
  }
  const value = Number((drive as unknown as Record<string, number>)[param.name] ?? 0)
  return (
    <NumberField
      label={driveParamLabel(param)}
      hint={param.note}
      step={param.form === 'int' ? 1 : param.step}
      value={value}
      onChange={(next) =>
        void control.setDrive(drive.id, {
          [param.name]: param.form === 'int' ? Math.round(next) : next,
        })
      }
    />
  )
}

function DriveProps({
  drive,
  glossary,
}: {
  drive: SandboxDrive
  glossary: Glossary
}) {
  return (
    <>
      <Head title="Стимул" note={drive.id} />
      <div className="row">
        <span className="mono row-path">→ {where(drive.target)}</span>
      </div>
      <DriveFields drive={drive} glossary={glossary} />
      <Remove what="стимул" id={drive.id} />
    </>
  )
}

/**
 * Поля одного стимула: род, числа, окно, рецептор (#565).
 *
 * Отдельно от `DriveProps`, потому что мест, где стимул правят, стало два:
 * своя строка в дереве объектов и свойства той клетки, на которую он смотрит.
 * Правят при этом одно и то же -- значит и набор полей должен быть один.
 * Вторая их копия внутри панели клетки разошлась бы с этой на первом же новом
 * роде драйва: там поле появилось бы, здесь нет.
 *
 * То, что стимул -- отдельная сущность, это не отменяет: у него своя жизнь,
 * его правят и убирают, и строка в дереве объектов остаётся. Здесь он показан
 * оттуда, куда бьёт, потому что цель у него ровно одна.
 */
function DriveFields({
  drive,
  glossary,
}: {
  drive: SandboxDrive
  glossary: Glossary
}) {
  const control = sandboxController
  // Поля рисуются по реестру родов, а не перечислены здесь. Пуассоновский шум
  // задаётся частотой, ток -- амплитудой, поезд -- числом импульсов и
  // частотой, theta-burst -- ещё и пачками: показывать все сразу значило бы
  // предлагать править то, что при этом роде никуда не идёт, а перечислять
  // здесь -- держать в браузере вторую копию того, что знает сервер (#508).
  const kind = driveKind(glossary, drive.kind)
  const params = kind?.params ?? []
  return (
    <>
      {/* На подписи -- что это за поле вообще, на самом списке -- что значит
          выбранный род: это два разных вопроса, и один ответ на оба оставил
          бы без ответа тот, который задают чаще (#553). */}
      <SelectField<DriveKind>
        label="Род"
        hint={glossary.drive || undefined}
        value={drive.kind}
        options={driveOptions(glossary, drive.kind)}
        onChange={(next) => void control.setDrive(drive.id, { kind: next })}
      />
      {/* Род словами и моменты, в которые придут импульсы. Шаблон обязан
          уметь напечатать себя списком времён -- вот он и печатает, прямо
          здесь: без этого «поезд» остаётся таким же словом на веру, каким был
          «пуассоновский». У пуассоновского драйва моментов заранее нет вовсе,
          и строка с ними не показывается -- врать про «0 моментов» незачем.

          Строкой, а не полем, -- у тех родов, у которых поля моментов нет:
          у списка спайков они правятся, и показывать их второй раз значило бы
          спорить с самим собой. Какому роду поле положено, знает реестр, а не
          этот файл: имя рода здесь было бы последней его копией в браузере. */}
      {drive.protocol ? <p className="sb-note">{drive.protocol}</p> : null}
      {drive.times.length && !params.some((param) => param.form === 'times') ? (
        <p className="sb-note mono">{momentWords(drive.times)}</p>
      ) : null}
      {params.map((param) => (
        <DriveParamField key={param.name} drive={drive} param={param} />
      ))}
      {kind && !kind.receptor ? null : (
        <SelectField
          label="Рецептор"
          hint={glossary.contact.receptor}
          value={drive.receptor}
          options={receptorOptions(glossary, drive.receptor)}
          onChange={(receptor) => void control.setDrive(drive.id, { receptor })}
        />
      )}
      <NumberField
        label="Начало, мс"
        step={10}
        value={drive.start}
        onChange={(start) => void control.setDrive(drive.id, { start })}
      />
      <NumberField
        label="Конец, мс"
        step={10}
        value={drive.stop}
        onChange={(stop) => void control.setDrive(drive.id, { stop })}
      />
    </>
  )
}

function RecordProps({
  record,
  glossary,
}: {
  record: SandboxRecording
  glossary: Glossary
}) {
  return (
    <>
      <Head title="Запись" note={record.id} />
      <div className="row">
        <span className="mono row-path">{where(record.target)}</span>
      </div>
      <RecordFields record={record} glossary={glossary} />
      <Remove what="запись" id={record.id} />
    </>
  )
}

/** Что пишет эта запись. Один набор полей на оба места -- см. `DriveFields`. */
function RecordFields({
  record,
  glossary,
}: {
  record: SandboxRecording
  glossary: Glossary
}) {
  return (
    <SelectField<RecordedVar>
      label="Величина"
      value={record.var}
      options={recordedOptions(glossary, record.var)}
      onChange={(value) => void sandboxController.setRecord(record.id, value)}
    />
  )
}

/**
 * Стимулы и записи, смотрящие на выбранный объект (#565).
 *
 * Свёрнутой группой на каждый, а не сплошным списком полей, -- и это ответ на
 * названную в карточке развилку. У стимула полей до восьми (род, числа
 * протокола, рецептор, окно), и три стимула развёрнутыми дают простыню, в
 * которой не найти ни мембрану, ни кнопку; ровно поэтому свёрнуты типы клеток
 * и контакты блока. В сводке стоит то, ради чего сюда и смотрят: протокол
 * словами -- «поезд, 8 импульсов, 20 Гц», -- и он читается, не раскрывая
 * ничего.
 *
 * Единственный стимул раскрыт сразу. Человек, выбравший клетку с одним
 * драйвом, спрашивает именно про него, и щелчок здесь ничего не экономит --
 * экономить нечего. Как только их двое, оба сворачиваются: список из двух
 * свёрнутых строк читается, а две простыни подряд -- нет.
 *
 * Выделение не двоится: показаны здесь поля, а «выбранным» остаётся тот
 * объект, который выбрали. Строка стимула в дереве объектов никуда не делась
 * и открывает ровно то же самое -- у объекта есть имя, и прятать его оттуда
 * значило бы скрывать то, что существует.
 */
function DrivesOf({
  drives,
  records,
  glossary,
  children,
}: {
  drives: SandboxDrive[]
  records: SandboxRecording[]
  glossary: Glossary
  /**
   * Чем завести новый драйв или новую запись на этом объекте.
   *
   * Приходит снаружи, потому что у объектов оно разное: у клетки одна точка --
   * она сама, -- а у блока их столько, сколько портов и внутренних узлов.
   * Общая кнопка «драйв на блок» была бы адресом, которого не существует:
   * потенциал есть у клетки, а коробка -- это несколько клеток.
   */
  children: ReactNode
}) {
  return (
    <>
      <Section title="Драйв и записи" />
      {drives.map((drive) => (
        <details className="sb-group" key={drive.id} open={drives.length === 1}>
          <summary title={driveHint(glossary, drive.kind)}>
            <span className="sb-row-name">{drive.protocol || drive.kind}</span>
            <span className="mono sb-kind">{drive.id}</span>
          </summary>
          {/* Адрес показан и здесь: у блока драйв бывает и на порт, и на
              внутренний узел, и по одному `drive2` их не различить. */}
          <p className="sb-note mono">→ {where(drive.target)}</p>
          <DriveFields drive={drive} glossary={glossary} />
          <Remove what="стимул" id={drive.id} />
        </details>
      ))}
      {records.map((record) => (
        <details className="sb-group" key={record.id} open={records.length === 1}>
          {/* Величина словом, а не ключом трассы: `g_exc` -- шифр, и реестр
              уже назвал его человеческим именем (#546). Справа имя записи:
              две записи одной клетки различаются только им. */}
          <summary>
            <span className="sb-row-name">
              запись: {recordedName(glossary, record.var)}
            </span>
            <span className="mono sb-kind">{record.id}</span>
          </summary>
          <RecordFields record={record} glossary={glossary} />
          <Remove what="запись" id={record.id} />
        </details>
      ))}
      {!drives.length && !records.length ? (
        <p className="sb-note">
          Драйва и записей здесь нет: без драйва сеть молчит, без записи её
          нечем смотреть.
        </p>
      ) : null}
      <div className="sb-actions">{children}</div>
    </>
  )
}

/** Моменты спайков из строки. Мусор молча отбрасывается, а не ломает поле. */
export function moments(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .map((piece) => Number.parseFloat(piece))
    .filter((value) => Number.isFinite(value) && value >= 0)
}

function Head({ title, note }: { title: string; note?: string }) {
  return (
    <div className="panel-head">
      <span className="panel-title">{title}</span>
      {note ? <span className="mono panel-note">{note}</span> : null}
    </div>
  )
}

function Section({ title }: { title: string }) {
  return <div className="sb-section">{title}</div>
}

function Remove({ what, id }: { what: string; id: string }) {
  return (
    <div className="sb-actions">
      <button
        type="button"
        className="btn-secondary"
        onClick={() => void sandboxController.remove(id)}
      >
        Убрать {what}
      </button>
    </div>
  )
}

/**
 * Числовое поле. `hint` -- расшифровка подписи (#541).
 *
 * Подсказкой, а не строкой под полем: панель свойств и без того плотная, а
 * восемь объяснений мембраны, выписанных на экран, превратили бы её в статью.
 * Висит на всей подписи вместе с полем: человек наводит на «τ мембраны, мс»,
 * а не целится в вопросительный знак.
 */
export function NumberField({
  label,
  hint,
  value,
  step = 0.1,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="sb-field" title={hint}>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        // Ключ по значению: ответ сервера может отличаться от набранного
        // (округление, отказ), и поле обязано показать то, что в проекте.
        key={value}
        defaultValue={value}
        // Правка уходит по уходу из поля, а не на каждую цифру: иначе история
        // отмены наполнится промежуточными «1», «1.», «1.4».
        onBlur={(event) => {
          const next = Number.parseFloat(event.target.value)
          if (Number.isFinite(next) && next !== value) onChange(next)
        }}
      />
    </label>
  )
}

export function TextField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="sb-field">
      <span>{label}</span>
      <input
        type="text"
        key={value}
        defaultValue={value}
        onBlur={(event) => {
          if (event.target.value !== value) onChange(event.target.value)
        }}
      />
    </label>
  )
}

/**
 * Поле выбора. Объясняется и само поле, и каждый его пункт (#541).
 *
 * Объяснений два места нарочно. В закрытом списке видно одно значение, и
 * подсказка на самом поле расшифровывает выбранное -- иначе, чтобы понять, что
 * такое `gaba_a`, список пришлось бы открыть. Открытый список объясняет тот
 * пункт, который под курсором: выбирают там, а не в закрытом поле.
 *
 * `hint` отвечает на другой вопрос: что это за поле вообще. Поэтому он стоит
 * на подписи, а не на самом `select`, где уже висит объяснение значения.
 */
function SelectField<T extends string = string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint?: string
  value: T
  options: Array<{ id: T; name: string; note?: string }>
  onChange: (value: T) => void
}) {
  const chosen = options.find((option) => option.id === value)
  return (
    <label className="sb-field">
      <span title={hint}>{label}</span>
      <select
        value={value}
        title={chosen?.note}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id} title={option.note}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  )
}
