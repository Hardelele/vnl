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
 *
 * Переход с карточки паттерна в песочницу живёт здесь же (#526): переключить
 * экран умеет только оболочка, а серверу об этом знать нечего -- вставку он
 * принимает тем же маршрутом, что и кнопка «+» в панели «Библиотека».
 * Оболочка при этом несёт ровно имя паттерна, а не вставляет его сама: в какой
 * проект он ляжет, решает песочница -- она одна знает, открыт ли проект и что
 * лежит в списке.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { LibraryScreen } from './components/catalog/LibraryScreen'
import { PatternScreen } from './components/pattern/PatternScreen'
import { SandboxScreen } from './components/sandbox/SandboxScreen'
import { AppBar, type Screen, type Tab } from './components/shell/AppBar'
import { PATTERNS, counted } from './lib/plural'
import { whenUnauthorized } from './model/catalog'
import { useCatalog } from './state/catalog'
import {
  SANDBOX_LOCKED,
  canChange,
  goToLogin,
  logoutAt,
  needsLogin,
  session,
  useSession,
  whoLabel,
} from './state/session'

export function App() {
  const [screen, setScreen] = useState<Screen>('library')
  /** Открытый паттерн. Он же решает, что показывать поверх библиотеки. */
  const [pattern, setPattern] = useState<string | null>(null)
  /**
   * Паттерн, который несут с карточки в песочницу (#526).
   *
   * Отдельное состояние, а не `pattern`: карточку с экрана мы уводим, но
   * просьба «положи его в проект» переживает этот уход и гаснет только тогда,
   * когда песочница её исполнила. Иначе переход пришлось бы делать из
   * карточки, а она не знает ни про открытый проект, ни про список.
   */
  const [carry, setCarry] = useState<string | null>(null)
  const forget = useCallback(() => setCarry(null), [])

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
          // Уход по вкладке -- это отказ от того, что несли: человек выбрал
          // другое место, и класть паттерн, о котором он уже передумал, в
          // первый попавшийся проект было бы самодеятельностью.
          setCarry(null)
          setPattern(null)
          setScreen(chosen)
        }}
        status={status}
      />
      {/* Оконный каркас -- только у песочницы. Библиотеку и карточку паттерна
          читают сверху вниз, и прокрутка страницы им родная; песочница же --
          рабочее место с прибитой снизу панелью, и прокрутка страницы здесь
          уносила бы за край как раз то, ради чего в неё и заходят (#504). */}
      <main className={`shell-screen${screen === 'sandbox' ? ' is-window' : ''}`}>
        {screen === 'sandbox' ? (
          <SandboxScreen bring={carry} onBrought={forget} />
        ) : pattern ? (
          <PatternScreen
            id={pattern}
            onBack={() => setPattern(null)}
            onToSandbox={() => {
              setCarry(pattern)
              setScreen('sandbox')
            }}
          />
        ) : (
          <LibraryScreen onOpen={setPattern} />
        )}
      </main>
    </div>
  )
}
