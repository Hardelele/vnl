/**
 * Экран библиотеки: поиск, фильтр по готовности и карточки по уровням.
 *
 * Отбор делает сервер, здесь только группировка пришедшего. Считать
 * количество в группе по своему фильтру значило бы завести вторую истину о
 * том, что подходит, -- и однажды показать «L2 (7)» над четырьмя карточками.
 *
 * «Добавить» сразу заводит черновик с рабочим именем: пустая форма имени
 * посреди каталога спрашивает то, чего человек ещё не решил, а переименование
 * -- дело карточки паттерна (#478).
 */

import { useEffect } from 'react'

import { PATTERNS, counted } from '../../lib/plural'
import type { Catalog, Pattern, PatternStatus } from '../../model/types'
import { catalogController, useCatalog } from '../../state/catalog'
import { PatternCard } from './PatternCard'
import './library.css'

const NEW_DRAFT_NAME = 'Новый паттерн'

const STATUS_TABS: Array<{ id: PatternStatus | null; label: string }> = [
  { id: null, label: 'Все' },
  { id: 'ready', label: 'Готов' },
  { id: 'draft', label: 'Черновик' },
]

export interface LibraryScreenProps {
  onOpen: (id: string) => void
}

export function LibraryScreen({ onOpen }: LibraryScreenProps) {
  const state = useCatalog((current) => current)
  const control = catalogController

  useEffect(() => {
    void control.refresh()
    return () => control.dispose()
  }, [control])

  const catalog = state.catalog
  const chosen: PatternStatus | null = state.statuses[0] ?? null

  return (
    <div className="lib">
      <header className="lib-head">
        <h1 className="lib-title">Библиотека</h1>
        <span className="lib-count mono">{summary(catalog, state.loading)}</span>

        <div className="lib-tools">
          <input
            className="lib-search"
            type="search"
            value={state.text}
            placeholder="Поиск"
            aria-label="Поиск по библиотеке"
            onChange={(event) => control.search(event.target.value)}
          />
          <div className="lib-tabs" role="group" aria-label="Готовность">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.label}
                type="button"
                className={`lib-tab${chosen === tab.id ? ' is-on' : ''}`}
                aria-pressed={chosen === tab.id}
                onClick={() => control.pickStatus(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void control.addDraft(NEW_DRAFT_NAME)}
          >
            Добавить
          </button>
        </div>
      </header>

      {state.error ? (
        <p className={`lib-alert${state.offline ? ' is-offline' : ''}`} role="alert">
          {state.error}
        </p>
      ) : null}

      {catalog ? <Groups catalog={catalog} onOpen={onOpen} /> : null}
    </div>
  )
}

function summary(catalog: Catalog | null, loading: boolean): string {
  if (!catalog) return loading ? 'читаем библиотеку…' : ''
  if (catalog.matched === catalog.total) return counted(catalog.total, PATTERNS)
  // При отборе честнее показать обе величины: иначе кажется, что часть
  // библиотеки пропала. После «из» форма всегда родительная: «1 из 4 паттернов».
  return `${catalog.matched} из ${catalog.total} ${PATTERNS.many}`
}

function Groups({
  catalog,
  onOpen,
}: {
  catalog: Catalog
  onOpen: (id: string) => void
}) {
  const groups = catalog.levels
    .map((level) => ({
      level,
      items: catalog.patterns.filter((pattern) => pattern.level === level.id),
    }))
    .filter((group) => group.items.length > 0)

  if (!groups.length) {
    return (
      <p className="lib-empty">
        {catalog.total
          ? 'Ничего не нашлось. Попробуйте другое слово или снимите фильтр.'
          : 'Библиотека пуста. «Добавить» заведёт первый черновик.'}
      </p>
    )
  }

  return (
    <>
      {groups.map(({ level, items }) => (
        <section className="lib-group" key={level.id}>
          <h2 className="lib-group-head">
            <span className="lib-level mono">{level.id}</span>
            <span className="lib-group-name">{level.name}</span>
            <span className="lib-group-count mono">{items.length}</span>
          </h2>
          <div className="lib-grid">
            {items.map((pattern: Pattern) => (
              <PatternCard
                key={pattern.id}
                pattern={pattern}
                onOpen={(chosen) => onOpen(chosen.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
