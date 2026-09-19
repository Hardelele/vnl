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

import type { CellState } from '../../model/sim'
import type {
  DriveKind,
  Endpoint,
  SandboxBlock,
  SandboxCell,
  SandboxDrive,
  SandboxNeuron,
  SandboxRecording,
  SandboxState,
} from '../../model/sandbox'
import type { PointModel, RecordedVar, RunSpec } from '../../model/types'
import { sandboxController, type Selection } from '../../state/sandbox'

/** Рецепторы: тот же список, что в `ir.RECEPTORS`. */
const RECEPTORS = ['ampa', 'nmda', 'gaba_a', 'gaba_b', 'nicotinic']

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

export function Properties({
  selection,
  project,
  cells,
}: {
  selection: Selection | null
  project: SandboxState
  cells: Record<string, CellState>
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
    return block ? <BlockProps block={block} cells={cells} /> : null
  }

  if (selection.kind === 'neuron') {
    const neuron = project.neurons.find((item) => item.id === selection.id)
    return neuron ? <NeuronProps neuron={neuron} cells={cells} /> : null
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
          value={link.receptor}
          options={RECEPTORS.map((name) => ({ id: name, name }))}
          onChange={(receptor) => void control.setParams(link.id, { receptor })}
        />
        <NumberField
          label="Вес, нСм"
          value={link.weight}
          onChange={(weight) => void control.setParams(link.id, { weight })}
        />
        <NumberField
          label="Задержка, мс"
          value={link.delay}
          onChange={(delay) => void control.setParams(link.id, { delay })}
        />
        <Remove what="связь" id={link.id} />
      </>
    )
  }

  if (selection.kind === 'stimulus') {
    const drive = project.stimuli.find((item) => item.id === selection.id)
    return drive ? <DriveProps drive={drive} /> : null
  }

  const record = project.recordings.find((item) => item.id === selection.id)
  return record ? <RecordProps record={record} /> : null
}

function BlockProps({
  block,
  cells,
}: {
  block: SandboxBlock
  cells: Record<string, CellState>
}) {
  const control = sandboxController
  return (
    <>
      <Head title="Блок" note={block.patternId} />
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
      </div>

      <Section title="Порты" />
      {block.ports.map((port) => {
        const state = cells[`${block.id}/${port.site.instance}`]
        return (
          <div className="row" key={port.name}>
            <span className="row-id">{port.name}</span>
            <span className="mono row-dim">{port.direction}</span>
            <span className="mono row-dim row-end">
              {state ? `${state.v.toFixed(1)} мВ` : port.site.instance}
            </span>
          </div>
        )
      })}

      <Section title="Клетки" />
      {block.cells.map((cell) => (
        <CellGroup key={cell.type} block={block.id} cell={cell} />
      ))}

      <div className="sb-actions">
        {block.ports
          .filter((port) => port.direction === 'in')
          .map((port) => (
            <button
              key={port.name}
              type="button"
              className="btn-secondary"
              onClick={() => void control.stimulate(block.id, port.name)}
            >
              Драйв на {port.name}
            </button>
          ))}
        {block.ports
          .filter((port) => port.direction === 'out')
          .map((port) => (
            <button
              key={port.name}
              type="button"
              className="btn-secondary"
              onClick={() => void control.record(block.id, port.name)}
            >
              Записывать {port.name}
            </button>
          ))}
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
}: {
  neuron: SandboxNeuron
  cells: Record<string, CellState>
}) {
  const control = sandboxController
  // Приставки у отдельной клетки нет: в собранной сети она зовётся так же.
  const state = cells[neuron.id]
  return (
    <>
      <Head title="Клетка" note={neuron.id} />
      <div className="row">
        <span className={`sb-dot${neuron.inhibitory ? ' is-inh' : ''}`} />
        <span className="mono row-dim">{neuron.cellType}</span>
        <span className="mono row-dim row-end">
          {state ? `${state.v.toFixed(1)} мВ` : neuron.inhibitory ? 'тормозная' : 'возбуждающая'}
        </span>
      </div>

      {neuron.pointModel ? (
        <>
          <Section title="Мембрана" />
          {CELL_FIELDS.map((field) => (
            <NumberField
              key={field.key}
              label={field.label}
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
function CellGroup({ block, cell }: { block: string; cell: SandboxCell }) {
  const control = sandboxController
  return (
    <details className="sb-group">
      <summary>
        <span className={`sb-dot${cell.inhibitory ? ' is-inh' : ''}`} />
        <span className="sb-row-name">{cell.neurons.join(', ')}</span>
        <span className="mono sb-kind">{cell.pointModel.vThreshold} мВ</span>
      </summary>
      <p className="sb-note mono">{cell.type}</p>
      {CELL_FIELDS.map((field) => (
        <NumberField
          key={field.key}
          label={field.label}
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

function DriveProps({ drive }: { drive: SandboxDrive }) {
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
          value={drive.receptor}
          options={RECEPTORS.map((name) => ({ id: name, name }))}
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

export function NumberField({
  label,
  value,
  step = 0.1,
  onChange,
}: {
  label: string
  value: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="sb-field">
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

function SelectField<T extends string = string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ id: T; name: string }>
  onChange: (value: T) => void
}) {
  return (
    <label className="sb-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  )
}
