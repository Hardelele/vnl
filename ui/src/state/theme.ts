/**
 * Тема интерфейса: светлая по умолчанию, тёмная — по выбору.
 *
 * Дизайн-система Reckue светлая, макеты светлые, и подстраиваться под
 * настройку системы значило бы показывать половине людей то, чего в системе
 * нет: тёмная палитра дописана поверх неё, и три функциональных цвета в ней
 * подобраны вручную. Поэтому выбор явный, а не угаданный.
 *
 * Выбор помнится в браузере: тема — свойство рабочего места, а не проекта, и
 * серверу о ней знать незачем.
 */

import { useSyncExternalStore } from 'react'

import { createStore } from './store'

export type Theme = 'light' | 'dark'

const KEY = 'vnl.theme'

function remembered(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    // Приватное окно или запрет на хранилище -- не повод падать.
    return 'light'
  }
}

const store = createStore<{ theme: Theme }>({ theme: remembered() })

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* см. выше: без хранилища тема просто не переживёт перезагрузку */
  }
  store.setState({ theme })
}

/** Ставится один раз при запуске, до первой отрисовки. */
export function startTheme(): void {
  document.documentElement.dataset.theme = store.getState().theme
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getState().theme,
    () => store.getState().theme,
  )
}
