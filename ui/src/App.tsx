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

import { useMemo, useState } from 'react'

import { LibraryScreen } from './components/catalog/LibraryScreen'
import { PatternScreen } from './components/pattern/PatternScreen'
import { AppBar, type Screen, type Tab } from './components/shell/AppBar'
import { PATTERNS, counted } from './lib/plural'
import { useCatalog } from './state/catalog'

const TABS: Tab[] = [
  { id: 'library', label: 'Библиотека' },
  { id: 'sandbox', label: 'Песочница', pending: 'Появится вместе с холстом (#479)' },
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
        tabs={TABS}
        current={screen}
        onPick={(chosen) => {
          setPattern(null)
          setScreen(chosen)
        }}
        status={status}
      />
      <main className="shell-screen">
        {pattern ? (
          <PatternScreen id={pattern} onBack={() => setPattern(null)} />
        ) : (
          <LibraryScreen onOpen={setPattern} />
        )}
      </main>
    </div>
  )
}
