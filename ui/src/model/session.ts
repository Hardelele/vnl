/**
 * Кто вошёл: один запрос к `/api/session`.
 *
 * Этот эндпоинт отвечает и без входа -- в этом весь смысл. Иначе интерфейсу
 * пришлось бы узнавать о том, что войти надо, из ошибки первого же запроса за
 * данными, и первый экран был бы пустым «не отвечает» вместо кнопки «Войти».
 *
 * Самого входа здесь нет и быть не может: обмен на токены -- редиректы
 * браузера между стендом и Reckue auth, а не запросы из скрипта. Интерфейс
 * только показывает состояние и уводит на `login`.
 */

/** Ответ `/api/session`. `required: false` -- вход не настроен (своя машина). */
export interface SessionInfo {
  user: { sub: string; email: string | null; name: string | null } | null
  /** Адрес, куда уводить за входом. `null` -- входа нет, кнопка не нужна. */
  login: string | null
  logout?: string | null
  required: boolean
}

export async function loadSession(base = '/api'): Promise<SessionInfo> {
  // Без `no-store` браузер может отдать состояние входа из кэша -- ровно то,
  // что нельзя кэшировать: оно меняется в другой вкладке и по истечении срока.
  const response = await fetch(`${base}/session`, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`сервер ответил ${response.status} на запрос о входе`)
  }
  return (await response.json()) as SessionInfo
}
