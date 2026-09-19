/**
 * Форма «Сохранить как паттерн»: чем схема из песочницы становится в библиотеке.
 *
 * Спрашивается ровно то, чего сервер не может решить сам.
 *
 * Имя и ступень -- потому что это подпись схемы в каталоге, а не служебное
 * поле. Умолчание имени -- имя проекта: другого имени у схемы пока не было.
 *
 * Порты -- потому что порт увидит каждый, кто вставит блок. Предложение
 * считает сервер (`portHints`: клетка без входящих связей похожа на вход, без
 * исходящих -- на выход), но подставить его молча нельзя: «out_ffi2_E» в
 * чужой схеме не объясняет ничего, а исправить имя потом будет негде.
 *
 * Чего здесь нет. Нет выбора, что попадёт в тело: попадёт вся собранная сеть,
 * и выделять часть -- другая работа (`patterns.extract_pattern`). Нет и выбора
 * стимулов: драйв и записи проекта уезжают в витрину карточки целиком, иначе
 * паттерн ляжет в библиотеку молчащим.
 */

import { useState } from 'react'

import type { PatternDraft } from '../../model/sandbox'
import type { CatalogLevel, PatternPort } from '../../model/types'

/** Ступень нового паттерна. То же умолчание, что у `patterns.DRAFT_LEVEL`. */
const DRAFT_LEVEL: CatalogLevel = 'L0'

/** Предложенный порт вместе с тем, берут ли его. */
interface Row {
  port: PatternPort
  on: boolean
  name: string
}

export interface SavePatternProps {
  /** Имя проекта: умолчание для имени паттерна. */
  projectName: string
  /** Что предложил сервер. Пусто -- предлагать нечего, и это видно. */
  hints: PatternPort[]
  /** Ступени каталога с их названиями: список держит сервер (`LEVEL_NAMES`). */
  levels: Array<{ id: string; name: string }>
  busy: boolean
  onSave: (draft: PatternDraft) => void
  onCancel: () => void
}

export function SavePattern({
  projectName,
  hints,
  levels,
  busy,
  onSave,
  onCancel,
}: SavePatternProps) {
  const [name, setName] = useState(projectName)
  // Ступень -- строкой: список приходит с сервера, и сужать его тип здесь
  // значило бы утверждать, что интерфейс знает ступени лучше каталога.
  // Проверяет её всё равно сервер (`LEVEL_NAMES`).
  const [level, setLevel] = useState<string>(DRAFT_LEVEL)
  // Предложенные порты берутся все: они и есть догадка о том, чем схему
  // подключают. Снять галочку дешевле, чем искать нужную клетку заново.
  const [rows, setRows] = useState<Row[]>(
    hints.map((port) => ({ port, on: true, name: port.name })),
  )

  const chosen = rows.filter((row) => row.on)

  return (
    <form
      className="panel sb-save"
      aria-label="Сохранить как паттерн"
      onSubmit={(event) => {
        event.preventDefault()
        onSave({
          name,
          level: level as CatalogLevel,
          // Порт уходит тем же видом, каким пришёл: правится только имя.
          ports: chosen.map((row) => ({ ...row.port, name: row.name.trim() })),
        })
      }}
    >
      <div className="sb-section">Сохранить как паттерн</div>

      <label className="sb-field">
        Имя
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="sb-field">
        Ступень
        <select
          value={level}
          onChange={(event) => setLevel(event.target.value)}
        >
          {/* Список ступеней приходит с сервером: своей нумерации у интерфейса
              нет, иначе две разошлись бы на первой правке каталога. */}
          {(levels.length ? levels : [{ id: DRAFT_LEVEL, name: 'Черновик' }]).map(
            (step) => (
              <option key={step.id} value={step.id}>
                {step.id} · {step.name}
              </option>
            ),
          )}
        </select>
      </label>

      <div className="sb-section">Порты</div>
      <p className="sb-note">
        Порт — точка, которой схему подключают снаружи. Имя увидит каждый, кто
        вставит блок, поэтому его стоит поправить на своё.
      </p>

      {rows.map((row, index) => (
        <label className="sb-field sb-port" key={row.port.site.instance + row.port.direction}>
          <input
            type="checkbox"
            className="sb-port-on"
            checked={row.on}
            aria-label={`Взять порт ${row.port.name}`}
            onChange={(event) => change(index, { on: event.target.checked })}
          />
          <input
            type="text"
            value={row.name}
            aria-label={`Имя порта на ${row.port.site.instance}`}
            disabled={!row.on}
            onChange={(event) => change(index, { name: event.target.value })}
          />
          <span className="mono sb-port-site">
            {row.port.direction === 'in' ? '→' : '←'} {row.port.site.instance}.
            {row.port.site.section}
          </span>
        </label>
      ))}

      {rows.length === 0 ? (
        <p className="sb-note">
          Предложить нечего: в схеме нет клетки без связей с одной из сторон.
          Соедините или разъедините что-нибудь — или сохраните после правки.
        </p>
      ) : null}
      {rows.length > 0 && chosen.length === 0 ? (
        <p className="sb-warn">
          Ни один порт не выбран — такой блок не получится подключить.
        </p>
      ) : null}

      <div className="sb-save-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          Сохранить
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  )

  function change(index: number, patch: Partial<Row>): void {
    setRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)))
  }
}
