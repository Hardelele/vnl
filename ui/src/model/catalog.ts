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

/**
 * Один запрос к серверу: разбор ответа на все группы обращений.
 *
 * Общий он затем, что 401 обязан быть услышан одинаково откуда угодно. Своя
 * копия разбора в песочнице и в симуляции однажды разошлась бы с этой -- и
 * отказ «нужен вход» в одном месте выглядел бы как поломка, а в другом как
 * вход.
 */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (reason) {
    throw new OfflineError(reason)
  }
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : {}
  if (!response.ok) {
    if (response.status === 401) {
      // Закрытый маршрут без сессии -- и он же ответ «сессия кончилась, пока
      // вкладка была открыта». Состоянию входа это говорится сразу, чтобы в
      // панели появился вход; экран при этом не подменяется: библиотека
      // открыта всем, а объясняет отказ то место, где его получили.
      onUnauthorized?.((payload as { login?: string }).login)
    }
    const message =
      (payload as { error?: string }).error ??
      `${response.status} ${response.statusText}`
    throw new ApiError(message, response.status)
  }
  return payload as T
}

function ask<T>(path: string, init?: RequestInit, base = '/api'): Promise<T> {
  return request<T>(base + path, init)
}

/** Отказ закрытого маршрута: нужен вход, а не сервер сломался. */
export function isDenied(reason: unknown): boolean {
  return reason instanceof ApiError && reason.status === 401
}

/**
 * Что делать, когда сервер ответил 401.
 *
 * Обратным вызовом, а не прямым импортом состояния входа: слой запросов не
 * должен знать про сторы интерфейса, иначе его нельзя будет позвать из теста
 * без поднятого React. Подписку ставит оболочка при запуске.
 *
 * Адрес входа берётся из тела отказа: сервер кладёт его туда именно затем,
 * чтобы интерфейсу не приходилось знать чужие маршруты наизусть.
 */
let onUnauthorized: ((login?: string) => void) | undefined

export function whenUnauthorized(notify: ((login?: string) => void) | undefined): void {
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

/**
 * «Добавить»: пустой черновик, который сразу лежит в библиотеке.
 *
 * Ступень по умолчанию -- первая ступень схем (`L0`), а не та, что выше:
 * черновик ещё ничего не умеет, и записывать его в «вычислительные примитивы»
 * (`L2`) значило бы обещать за автора. То же решение и на сервере
 * (`patterns.DRAFT_LEVEL`).
 */
export async function createDraft(
  name: string,
  level: Catalog['levels'][number]['id'] = 'L0',
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
