/**
 * Оболочка: панель сверху и один экран под ней.
 *
 * Отдельного экрана прогона нет намеренно. Симуляция -- не расчёт с отчётом в
 * конце, а среда с управляемым временем: схема, её состояние и таймлайн живут
 * вместе, на карточке паттерна и в песочнице.
 *
 * Роутера нет: экранов три, адресная строка локального инструмента никому не
 * нужна, а библиотека роутинга привела бы за собой собственное состояние рядом
 * с уже имеющимся.
 */

import { useEffect, useMemo, useState } from 'react'

import { LibraryScreen } from './components/catalog/LibraryScreen'
import { PatternScreen } from './components/pattern/PatternScreen'
import { SandboxScreen } from './components/sandbox/SandboxScreen'
import { AppBar, type Screen, type Tab } from './components/shell/AppBar'
import { LoginScreen } from './components/shell/LoginScreen'
import { PATTERNS, counted } from './lib/plural'
import { whenUnauthorized } from './model/catalog'
import { useCatalog } from './state/catalog'
import { needsLogin, session, useSession } from './state/session'

const TABS: Tab[] = [
  { id: 'library', label: 'Библиотека' },
  { id: 'sandbox', label: 'Песочница' },
]

export function App() {
  const [screen, setScreen] = useState<Screen>('library')
  /** Открытый паттерн. Он же решает, что показывать поверх библиотеки. */
  const [pattern, setPattern] = useState<string | null>(null)

  // Из стора берутся только простые величины. Селектор, собирающий объект,
  // возвращал бы каждый раз новый -- а `useSyncExternalStore` считает это
  // изменением состояния и уходит в бесконечную перерисовку.
  const offline = useCatalog((state) => state.offline)
  const loading = useCatalog((state) => state.loading)
  const total = useCatalog((state) => state.catalog?.total ?? null)

  // Про вход спрашиваем один раз при запуске. На своей машине ответ будет
  // «не требуется», и дальше оболочка ведёт себя как раньше.
  const login = useSession((state) => state.info?.login ?? null)
  const closed = useSession(needsLogin)
  const sessionOffline = useSession((state) => state.offline)
  const who = useSession((state) => {
    const info = state.info
    if (!info?.user || !info.logout) return null
    return {
      label: info.user.email ?? info.user.name ?? info.user.sub,
      logout: info.logout,
    }
  })

  useEffect(() => {
    whenUnauthorized(() => session.expired())
    void session.refresh()
    return () => whenUnauthorized(undefined)
  }, [])

  const status = useMemo(() => {
    if (offline) return { tone: 'off' as const, text: 'сервер библиотеки не отвечает' }
    if (total !== null) {
      return { tone: 'ok' as const, text: `библиотека · ${counted(total, PATTERNS)}` }
    }
    return { tone: 'idle' as const, text: loading ? 'читаем библиотеку…' : 'библиотека' }
  }, [offline, loading, total])

  // Пока вход не пройден, экранов приложения нет вовсе -- ни одного, даже
  // пустого. Библиотека всё равно ответила бы 401, а показывать её каркас
  // значило бы обещать то, чего не дадим.
  if (closed) {
    return <LoginScreen login={login ?? '/auth/login'} offline={sessionOffline} />
  }

  return (
    <div className="shell">
      <AppBar
        tabs={TABS}
        current={screen}
        who={who}
        onPick={(chosen) => {
          setPattern(null)
          setScreen(chosen)
        }}
        status={status}
      />
      <main className="shell-screen">
        {screen === 'sandbox' ? (
          <SandboxScreen />
        ) : pattern ? (
          <PatternScreen id={pattern} onBack={() => setPattern(null)} />
        ) : (
          <LibraryScreen onOpen={setPattern} />
        )}
      </main>
    </div>
  )
}
