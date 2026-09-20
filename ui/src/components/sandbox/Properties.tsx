/**
 * Правая панель песочницы: свойства выбранного объекта.
 *
 * Панель не показывает, а правит. Смотреть на собранную схему можно и на
 * холсте; сюда приходят затем, чтобы поменять порог, вес или частоту драйва и
 * увидеть, что из этого вышло, -- поэтому каждое число здесь поле, а не
 * подпись. Исключений два: имя паттерна (за него держится снимок блока) и
 * адрес связи (другой адрес -- это другая связь, а не правка этой).
 *
 * Отдельным файлом, потому что экран песочницы и без неё большой, а свойств
 * ровно столько, сколько параметров у модели: они будут только прибывать.
 */

import { NO_GLOSSARY } from '../../model/glossary'
import type { CellState } from '../../model/sim'
import type {
  DriveKind,
  Endpoint,
  SandboxBlock,
  SandboxCell,
  SandboxContact,
  SandboxDrive,
  SandboxNeuron,
  SandboxRecording,
  SandboxState,
} from '../../model/sandbox'
import type {
  CellKind,
  Glossary,
  PatternPort,
  PointModel,
  RecordedVar,
  RunSpec,
} from '../../model/types'
import { sandboxController, type Selection } from '../../state/sandbox'
import { Vitals } from '../live/Vitals'

/**
 * Подсказка к рецептору: объяснение плюс его же числа.
 *
 * Числа берутся из полей ответа, а не пересказываются словами: реверсал и спад
 * -- те самые, по которым синапс и считается, и повтори их в тексте, правка
 * `tau_decay` оставила бы в подсказке старое число.
 */
function receptorHint(receptor: {
  note: string
  reversal: number
  tauDecay: number
}): string {
  return `${receptor.note} Реверсал ${receptor.reversal} мВ, спад ${receptor.tauDecay} мс.`
}

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
    note: receptorHint(item),
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

/** Что можно записывать: реестр живёт в `ir.RECORDED`. */
const RECORDED: Array<{ id: RecordedVar; name: string }> = [
  { id: 'v', name: 'потенциал' },
  { id: 'g', name: 'проводимость' },
  { id: 'g_exc', name: 'возбуждение' },
  { id: 'g_inh', name: 'торможение' },
  { id: 'w', name: 'вес' },
  { id: 'spikes', name: 'спайки' },
]

/** Правятся только числа: род модели (`kind`) -- это другой солвер, не поле. */
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
 * Адрес конца связи одной строкой.
 *
 * У блока это `ffi.out` -- порт; у клетки порта нет, и печатать `E.null`
 * нельзя: такого адреса не существует. Пишется само имя клетки -- ровно то,
 * чем она зовётся и в собранной сети.
 */
export function where(endpoint: Pick<Endpoint, 'instance' | 'port'>): string {
  return endpoint.port ? `${endpoint.instance}.${endpoint.port}` : endpoint.instance
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
    return block ? (
      <BlockProps block={block} cells={cells} glossary={glossary} palette={palette} />
    ) : null
  }

  if (selection.kind === 'neuron') {
    const neuron = project.neurons.find((item) => item.id === selection.id)
    return neuron ? (
      <NeuronProps
        neuron={neuron}
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

  const record = project.recordings.find((item) => item.id === selection.id)
  return record ? <RecordProps record={record} /> : null
}

function BlockProps({
  block,
  cells,
  glossary,
  palette,
}: {
  block: SandboxBlock
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
          <button
            type="button"
            className="row sb-pick"
            key={neuron.id}
            onClick={() => void control.touchEndpoint(flat, null)}
          >
            <span className={`sb-dot${neuron.inhibitory ? ' is-inh' : ''}`} />
            <span className="mono row-id">{flat}</span>
            <span className="mono row-dim row-end">
              {state ? `${state.v.toFixed(1)} мВ` : 'соединить'}
            </span>
          </button>
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

      <div className="sb-actions">
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
        {/* Разобрать -- не то же, что убрать: блок не уносится, а заменяется
            своим же содержимым в другом виде (#532). Нужно там, где от
            паттерна нужна половина или его надо переделать на месте; «Fork»
            на этот вопрос не отвечает -- он про библиотеку, а не про этот
            проект. Отменяется одним шагом, поэтому спрашивать подтверждения
            незачем. */}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void control.ungroup(block.id)}
        >
          Разобрать на клетки
        </button>
        <button
          type="button"
          className="btn-secondary"
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
  cells,
  spikes,
  elapsed,
  glossary,
  palette,
}: {
  neuron: SandboxNeuron
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
          {CELL_FIELDS.map((field) => (
            <NumberField
              key={field.key}
              label={field.label}
              hint={glossary.cell[field.key]}
              step={field.step}
              value={neuron.pointModel![field.key]}
              onChange={(value) =>
                void control.setCell(neuron.id, neuron.cellType, { [field.key]: value })
              }
            />
          ))}
        </>
      ) : (
        // Потерянный тип чинят, а не скрывают: клетка остаётся на холсте и
        // говорит, чего ей не хватает.
        <p className="sb-note">
          Тип клетки «{neuron.cellType}» в проекте не найден — параметры мембраны
          править не по чему.
        </p>
      )}

      <div className="sb-actions">
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
        <button
          type="button"
          className="btn-secondary"
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
        <span className="mono sb-kind">{cell.pointModel.vThreshold} мВ</span>
      </summary>
      <p className="sb-note mono" title={about}>
        {cell.type}
      </p>
      {CELL_FIELDS.map((field) => (
        <NumberField
          key={field.key}
          label={field.label}
          hint={glossary.cell[field.key]}
          step={field.step}
          value={cell.pointModel[field.key]}
          onChange={(value) =>
            void control.setCell(block, cell.type, { [field.key]: value })
          }
        />
      ))}
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

function DriveProps({
  drive,
  glossary,
}: {
  drive: SandboxDrive
  glossary: Glossary
}) {
  const control = sandboxController
  // Пуассоновский шум задаётся частотой, ток -- амплитудой, список спайков --
  // временами. Показывать все три сразу значило бы предлагать править то, что
  // при этом роде стимула никуда не идёт.
  return (
    <>
      <Head title="Стимул" note={drive.id} />
      <div className="row">
        <span className="mono row-path">→ {where(drive.target)}</span>
      </div>
      <SelectField<DriveKind>
        label="Род"
        value={drive.kind}
        options={[
          { id: 'poisson', name: 'пуассоновский' },
          { id: 'current', name: 'ток' },
          { id: 'spikes', name: 'список спайков' },
        ]}
        onChange={(kind) => void control.setDrive(drive.id, { kind })}
      />
      {drive.kind === 'poisson' ? (
        <NumberField
          label="Частота, Гц"
          step={10}
          value={drive.rate}
          onChange={(rate) => void control.setDrive(drive.id, { rate })}
        />
      ) : null}
      {drive.kind === 'spikes' ? (
        <TextField
          label="Моменты, мс"
          value={drive.times.join(', ')}
          onChange={(text) => void control.setDrive(drive.id, { times: moments(text) })}
        />
      ) : null}
      <NumberField
        label={drive.kind === 'current' ? 'Ток, нА' : 'Вес, нСм'}
        value={drive.amplitude}
        onChange={(amplitude) => void control.setDrive(drive.id, { amplitude })}
      />
      {drive.kind === 'current' ? null : (
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
      <Remove what="стимул" id={drive.id} />
    </>
  )
}

function RecordProps({ record }: { record: SandboxRecording }) {
  const control = sandboxController
  return (
    <>
      <Head title="Запись" note={record.id} />
      <div className="row">
        <span className="mono row-path">{where(record.target)}</span>
      </div>
      <SelectField<RecordedVar>
        label="Величина"
        value={record.var}
        options={RECORDED}
        onChange={(value) => void control.setRecord(record.id, value)}
      />
      <Remove what="запись" id={record.id} />
    </>
  )
}

/**
 * Параметры прогона.
 *
 * Стоят отдельно от выделения и видны всегда: длительность и зерно меняют
 * чаще всего, а ради них снимать выделение с блока -- лишний шаг там, где его
 * не за что оправдать.
 */
export function RunFields({ run }: { run: RunSpec }) {
  const control = sandboxController
  return (
    <>
      <Section title="Прогон" />
      <NumberField
        label="Длительность, мс"
        step={50}
        value={run.duration}
        onChange={(duration) => void control.setRun({ duration })}
      />
      <NumberField
        label="Шаг, мс"
        step={0.05}
        value={run.dt}
        onChange={(dt) => void control.setRun({ dt })}
      />
      <NumberField
        label="Зерно"
        step={1}
        value={run.seed}
        onChange={(seed) => void control.setRun({ seed })}
      />
      <p className="sb-note">
        Новые числа берёт следующий запуск: уже идущее время досчитывается по
        прежним.
      </p>
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
