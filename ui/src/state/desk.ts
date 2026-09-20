/**
 * Что браузер помнит про раскладку окна.
 *
 * Высота нижней панели -- свойство рабочего места, а не схемы. В проекте ей
 * не место: правка высоты делала бы проект несохранённым (`dirty` считается
 * сравнением с записанным), отпечаток пришлось бы отдельно защищать от
 * устаревания, а один и тот же проект на ноутбуке и на большом мониторе
 * требует разной высоты -- общее значение было бы неверным на обоих.
 *
 * Значение одно на приложение, а не на проект: панель -- часть окна.
 *
 * Хранилища может не быть вовсе (приватное окно, запрет на site data), а
 * лежать в нём может что угодно -- правил его не мы. Поэтому чтение никогда
 * не падает и не возвращает мусор: любое сомнение -- высота по умолчанию.
 */

const KEY = 'vnl.panel.activity'

/** По умолчанию: три-четыре дорожки видно сразу, холст ещё не задавлен. */
export const PANEL_HEIGHT = 240
export const PANEL_MIN = 120
export const PANEL_MAX = 720

export function clampPanel(height: number): number {
  if (!Number.isFinite(height)) return PANEL_HEIGHT
  return Math.min(Math.max(Math.round(height), PANEL_MIN), PANEL_MAX)
}

export function readPanelHeight(): number {
  try {
    const kept = localStorage.getItem(KEY)
    if (kept === null) return PANEL_HEIGHT
    const value = Number(kept)
    // Пустая строка -- это `Number('') === 0`, а не «нет значения»: проверка
    // по `Number.isFinite` её пропустила бы в клампинг и вернула минимум.
    if (!kept.trim() || !Number.isFinite(value)) return PANEL_HEIGHT
    return clampPanel(value)
  } catch {
    return PANEL_HEIGHT
  }
}

export function rememberPanelHeight(height: number): void {
  try {
    localStorage.setItem(KEY, String(clampPanel(height)))
  } catch {
    /* Без хранилища высота просто не переживёт перезагрузку -- см. `theme.ts`. */
  }
}
