/**
 * Верхняя панель: имя, переход между экранами и состояние связи.
 *
 * В макете справа стоит «MCP · Claude подключён». MCP ещё нет, и писать о нём
 * подпись значило бы врать в единственном месте экрана, которое существует
 * ради правды о состоянии. Пока здесь настоящее: отвечает ли сервер
 * библиотеки. Claude займёт это место, когда появится (#483).
 */

import { applyTheme, useTheme } from '../../state/theme'
import { UserMenu } from './UserMenu'
import './shell.css'

export type Screen = 'library' | 'sandbox'

export interface Tab {
  id: Screen
  label: string
  /** Почему кнопка недоступна. Пустая строка -- доступна. */
  pending?: string
  /**
   * Экран есть, но до него нужен вход.
   *
   * Не `pending`: недоступной кнопкой это делать нельзя. Человек должен видеть,
   * что песочница существует, и узнать про вход до щелчка, а не вместо
   * результата. Сам экран объяснит то же подробнее.
   */
  locked?: string
}

export interface AppBarProps {
  tabs: Tab[]
  current: Screen
  onPick: (screen: Screen) => void
  status: { tone: 'ok' | 'off' | 'idle'; text: string }
  /** Кто вошёл и куда уводит выход. Без входа (своя машина) -- ничего. */
  who?: { label: string; logout: string } | null
  /** Куда уводить за входом, пока никто не вошёл. `null` -- вход не настроен. */
  signIn?: string | null
}

export function AppBar({
  tabs,
  current,
  onPick,
  status,
  who = null,
  signIn = null,
}: AppBarProps) {
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
            className={`bar-tab${current === tab.id ? ' is-on' : ''}${
              tab.locked ? ' is-locked' : ''
            }`}
            aria-current={current === tab.id ? 'page' : undefined}
            disabled={Boolean(tab.pending)}
            title={tab.pending ?? tab.locked}
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
      {who ? <UserMenu label={who.label} logout={who.logout} /> : null}
      {/* Вход стоит здесь же, где потом встанет имя вошедшего: это одно и то же
          место панели в двух состояниях, а не два разных экрана. */}
      {signIn ? (
        <a className="bar-in" href={signIn}>
          Войти
        </a>
      ) : null}
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
