/**
 * Экран прогона: загрузка `run.json`, выбор нейрона, инспектор.
 *
 * Это первый экран интерфейса, и он остаётся на своём месте, пока не появится
 * песочница (#479): инспектор и курсор времени переедут в неё, а до тех пор
 * прятать работающую вещь незачем.
 */

import { useEffect, useState } from 'react'

import { loadRun, type RunView } from '../../model/run'
import { NeuronInspector } from '../inspector/NeuronInspector'
import { selectNeuron, useUi } from '../../state/store'
import './run.css'

export function RunScreen() {
  const [view, setView] = useState<RunView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = useUi((state) => state.selected)

  useEffect(() => {
    let alive = true
    loadRun()
      .then((loaded) => {
        if (!alive) return
        setView(loaded)
        // Открываем на клетке, за которой в модели следят подробнее всего:
        // у неё больше всего записей, значит её и разглядывают.
        selectNeuron(mostRecorded(loaded))
      })
      .catch((reason: Error) => alive && setError(reason.message))
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <main className="app">
        <h1 className="app-title">VNL</h1>
        <p className="app-error">{error}</p>
        <p className="app-hint mono">
          vnl data examples/ffi.vnl -o ui/public/run.json
        </p>
      </main>
    )
  }

  if (!view) {
    return (
      <main className="app">
        <p className="app-hint">Загрузка прогона…</p>
      </main>
    )
  }

  const { model } = view

  return (
    <main className="app">
      <header className="app-head">
        <div>
          <h1 className="app-title">{model.name}</h1>
          <p className="app-sub mono">
            {model.source ?? 'модель VNL'} · уровень {model.run.level} ·{' '}
            {model.run.duration} мс · шаг {model.run.dt} мс · seed{' '}
            {model.run.seed}
          </p>
        </div>
      </header>

      <nav className="app-picker" aria-label="Нейроны">
        {view.neuronIds().map((id) => {
          const neuron = view.neuron(id)
          return (
            <button
              key={id}
              type="button"
              className={`app-chip${selected === id ? ' app-chip-on' : ''}`}
              onClick={() => selectNeuron(id)}
            >
              <span
                className={`app-chip-dot ${
                  neuron?.inhibitory ? 'app-chip-inh' : 'app-chip-exc'
                }`}
              />
              {id}
              <span className="app-chip-count mono">
                {view.spikesOf(id).length}
              </span>
            </button>
          )
        })}
      </nav>

      <section className="app-panel">
        {selected ? (
          <NeuronInspector view={view} id={selected} />
        ) : (
          <p className="app-hint">Выберите нейрон.</p>
        )}
      </section>
    </main>
  )
}

/** Клетка, за которой следят внимательнее всего: у неё больше всего записей. */
function mostRecorded(view: RunView): string | null {
  const counts = new Map<string, number>()
  for (const recording of view.model.recordings) {
    const id = recording.target.instance
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = -1
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id
      bestCount = count
    }
  }
  return best ?? view.neuronIds()[0] ?? null
}
