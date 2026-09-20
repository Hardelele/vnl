/**
 * Каталог типов клеток: палитра песочницы.
 *
 * Отдельно от библиотеки паттернов, потому что это разные вещи. Библиотека
 * ищется и фильтруется по ступени разбора и статусу готовности; у клетки нет
 * ни того, ни другого, и в тех же фильтрах она была бы ровно тем смешением,
 * из-за которого одиночные клетки когда-то убрали из библиотеки.
 *
 * Своего списка клеток здесь нет и быть не должно: встроенный набор живёт в
 * `vnl/cells.py`, свои лежат в хранилище, а интерфейс показывает то, что
 * пришло.
 */

import { request } from './catalog'
import type { CellKind } from './types'

export async function loadCells(): Promise<CellKind[]> {
  const payload = await request<{ cells: CellKind[] }>('/api/cells')
  return payload.cells
}

/** Что спрашивают у человека, прежде чем тип проекта уедет в каталог (#567). */
export interface CellDraft {
  /** Имя типа в проекте -- он же идентификатор будущей каталожной записи. */
  type: string
  name: string
  note: string
  /** Подтверждённое перекрытие клетки, которая уже лежит под этим именем. */
  replace?: boolean
}

/**
 * Положить тип клетки проекта в каталог (#567).
 *
 * Тот же адрес, что у чтения каталога: список клеток и место, куда клетку
 * кладут, -- одна вещь. Мембрана отсюда не уезжает: сервер берёт её из
 * названного проекта, и другого способа описать клетку у этого маршрута нет.
 *
 * Ответ -- весь каталог целиком, и он же заменяет палитру: новая запись
 * обязана встать среди встроенных там, где её потом ищут глазами, а порядок
 * списка держит сервер (`cells.catalog`).
 */
export async function adoptCell(
  sandbox: string,
  draft: CellDraft,
): Promise<CellKind[]> {
  const payload = await request<{ cells: CellKind[] }>('/api/cells', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sandbox,
      type: draft.type,
      name: draft.name,
      note: draft.note,
      replace: Boolean(draft.replace),
    }),
  })
  return payload.cells
}
