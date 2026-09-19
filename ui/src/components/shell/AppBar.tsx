/**
 * Верхняя панель: имя, переход между экранами и состояние связи.
 *
 * В макете справа стоит «MCP · Claude подключён». MCP ещё нет, и писать о нём
 * подпись значило бы врать в единственном месте экрана, которое существует
 * ради правды о состоянии. Пока здесь настоящее: отвечает ли сервер
 * библиотеки. Claude займёт это место, когда появится (#483).
 */

import { applyTheme, useTheme } from '../../state/theme'
import './shell.css'

export type Screen = 'library' | 'sandbox'

export interface Tab {
  id: Screen
  label: string
  /** Почему кнопка недоступна. Пустая строка -- доступна. */
  pending?: string
}

export interface AppBarProps {
  tabs: Tab[]
  current: Screen
  onPick: (screen: Screen) => void
  status: { tone: 'ok' | 'off' | 'idle'; text: string }
}

export function AppBar({ tabs, current, onPick, status }: AppBarProps) {
  const theme = useTheme()

  return (
    <header className="bar">
      <span className="bar-mark">
        vnl<span className="bar-dot">.</span>
      </span>
      <nav className="bar-nav" aria-label="Экраны">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`bar-tab${current === tab.id ? ' is-on' : ''}`}
            aria-current={current === tab.id ? 'page' : undefined}
            disabled={Boolean(tab.pending)}
            title={tab.pending}
            onClick={() => onPick(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <span className="bar-status">
        <span className={`bar-led is-${status.tone}`} />
        {status.text}
      </span>
      <button
        type="button"
        className="bar-theme"
        title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </header>
  )
}
