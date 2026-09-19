/**
 * Библиотека паттернов: запросы к локальному серверу (`vnl serve`).
 *
 * Отбор здесь не делается. Поиск и фильтры считает Python -- теми же словами
 * библиотеку спрашивает Claude через MCP, и вторая реализация «подходит»
 * разошлась бы с первой не сразу и незаметно. Интерфейс только собирает строку
 * запроса и показывает, что пришло.
 *
 * Ошибка сервера доносится как есть: «схема не готова» и «нет такого паттерна»
 * -- это сообщения для человека, и переписывать их здесь значило бы заводить
 * второй словарь причин.
 */

import { SCHEMA_VERSION, type Catalog, type PatternDetail } from './types'

/** Что спрашиваем у библиотеки. Пустые поля в строку запроса не попадают. */
export interface CatalogQuery {
  text?: string
  levels?: string[]
  statuses?: string[]
}

export interface Health {
  schema: number
  version: string
  root: string
  patterns: number
  sandboxes: number
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Сервер не запущен -- частый и поправимый случай, поэтому отдельный тип. */
export class OfflineError extends Error {
  constructor(cause: unknown) {
    super('сервер библиотеки не отвечает — запустите vnl serve')
    this.name = 'OfflineError'
    this.cause = cause
  }
}

export function catalogQueryString(query: CatalogQuery): string {
  const params = new URLSearchParams()
  const text = query.text?.trim()
  if (text) params.set('q', text)
  // Список уходит одним параметром через запятую: сервер принимает и такую
  // запись, и повторы, а короткая строка читается в адресной строке глазами.
  if (query.levels?.length) params.set('level', query.levels.join(','))
  if (query.statuses?.length) params.set('status', query.statuses.join(','))
  const rendered = params.toString()
  return rendered ? `?${rendered}` : ''
}

async function ask<T>(path: string, init?: RequestInit, base = '/api'): Promise<T> {
  let response: Response
  try {
    response = await fetch(base + path, init)
  } catch (reason) {
    throw new OfflineError(reason)
  }
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : {}
  if (!response.ok) {
    if (response.status === 401) {
      // Сессия кончилась, пока вкладка была открыта. Сообщаем об этом состоянию
      // входа, а не показываем «нет доступа» рядом со схемой: вернуть сюда может
      // только вход, и экран должен стать экраном входа.
      onUnauthorized?.()
    }
    const message =
      (payload as { error?: string }).error ??
      `${response.status} ${response.statusText}`
    throw new ApiError(message, response.status)
  }
  return payload as T
}

/**
 * Что делать, когда сервер ответил 401.
 *
 * Обратным вызовом, а не прямым импортом состояния входа: слой запросов не
 * должен знать про сторы интерфейса, иначе его нельзя будет позвать из теста
 * без поднятого React. Подписку ставит оболочка при запуске.
 */
let onUnauthorized: (() => void) | undefined

export function whenUnauthorized(notify: (() => void) | undefined): void {
  onUnauthorized = notify
}

function checkSchema(schema: number): void {
  if (schema !== SCHEMA_VERSION) {
    throw new ApiError(
      `сервер отдаёт формат версии ${schema}, интерфейс понимает ${SCHEMA_VERSION}` +
        ' — обновите vnl или пересоберите интерфейс',
      0,
    )
  }
}

export async function loadCatalog(
  query: CatalogQuery = {},
  base?: string,
): Promise<Catalog> {
  const catalog = await ask<Catalog>(
    `/catalog${catalogQueryString(query)}`,
    undefined,
    base,
  )
  checkSchema(catalog.schema)
  return catalog
}

export async function loadPattern(id: string, base?: string): Promise<PatternDetail> {
  return ask<PatternDetail>(`/patterns/${encodeURIComponent(id)}`, undefined, base)
}

/** «Добавить»: пустой черновик, который сразу лежит в библиотеке. */
export async function createDraft(
  name: string,
  level: Catalog['levels'][number]['id'] = 'L2',
  base?: string,
): Promise<PatternDetail> {
  return ask<PatternDetail>(
    '/patterns',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, level }),
    },
    base,
  )
}

export async function deletePattern(id: string, base?: string): Promise<void> {
  await ask(`/patterns/${encodeURIComponent(id)}`, { method: 'DELETE' }, base)
}

export async function loadHealth(base?: string): Promise<Health> {
  return ask<Health>('/health', undefined, base)
}
