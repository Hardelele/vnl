/**
 * Оболочка: панель сверху и один экран под ней.
 *
 * Отдельного экрана прогона нет намеренно. Симуляция -- не расчёт с отчётом в
 * конце, а среда с управляемым временем: схема, её состояние и таймлайн живут
 * вместе, на карточке паттерна и в песочнице.
 *
 * Экрана входа тоже нет. Библиотека -- витрина: её смотрят и трогают без
 * учётной записи, поэтому «не вошёл» не состояние приложения, а свойство
 * отдельных действий. Вход живёт в панели рядом с именем вошедшего, а закрытое
 * действие уводит ко входу сразу -- не окном поверх экрана и не вторым
 * нажатием (#518).
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
import { PATTERNS, counted } from './lib/plural'
import { whenUnauthorized } from './model/catalog'
import { useCatalog } from './state/catalog'
import {
  canChange,
  goToLogin,
  logoutAt,
  needsLogin,
  session,
  useSession,
  whoLabel,
} from './state/session'

/** Почему песочница закрыта. Тем же словом, что и панель на самом экране. */
const SANDBOX_LOCKED = 'Песочница открыта после входа: это чужая работа, а не витрина'

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
  // «не требуется», и в панели не появится ни кнопки, ни имени.
  //
  // Каждый селектор отдаёт величину, а не собранный объект: объект был бы каждый
  // раз новым, а `useSyncExternalStore` считает новую ссылку изменением
  // состояния и уходит в бесконечную перерисовку.
  const login = useSession((state) => state.info?.login ?? null)
  const offerLogin = useSession(needsLogin)
  const allowed = useSession(canChange)
  const label = useSession(whoLabel)
  const logout = useSession(logoutAt)
  const who = useMemo(
    () => (label && logout ? { label, logout } : null),
    [label, logout],
  )

  const tabs = useMemo<Tab[]>(
    () => [
      { id: 'library', label: 'Библиотека' },
      // Вкладка остаётся на виду и нажимаемой: спрятать или погасить её значило
      // бы скрыть, что песочница есть. Подсказка говорит про вход до щелчка,
      // а экран под вкладкой объясняет то же подробнее.
      { id: 'sandbox', label: 'Песочница', locked: allowed ? undefined : SANDBOX_LOCKED },
    ],
    [allowed],
  )

  useEffect(() => {
    whenUnauthorized((at) => session.expired(at))
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

  return (
    <div className="shell">
      <AppBar
        tabs={tabs}
        current={screen}
        who={who}
        signIn={offerLogin ? login ?? '/auth/login' : null}
        onPick={(chosen) => {
          // Закрытый экран -- это переход ко входу, а не окно с вопросом:
          // ответ на «войти?» тут и так один, и лишний шаг ничего не решает.
          if (chosen === 'sandbox' && !allowed) {
            goToLogin()
            return
          }
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
