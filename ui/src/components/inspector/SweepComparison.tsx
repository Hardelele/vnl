/**
 * Сравнение вариантов развёртки для выбранной клетки.
 *
 * Отвечает на вопрос «а что будет, если подвинуть параметр»: кривые всех
 * вариантов лежат одна на другой, разница видна сразу. Рядом сводка числами,
 * потому что глазами четыре набора кривых точно не сопоставить.
 */

import type { RunView } from '../../model/run'
import { downsample, extentOf, niceStep } from '../../lib/analysis'
import { Plot } from '../chart/Plot'
import './sweep.css'

const COLUMNS = 280

interface Props {
  view: RunView
  id: string
}

function minus(text: string): string {
  return text.replace('-', '−')
}

export function SweepComparison({ view, id }: Props) {
  const sweep = view.sweep
  if (!sweep) return null

  const traces = sweep.variants.map((variant, index) => ({
    variant,
    values: view.variantTrace(index, id, 'v'),
  }))
  const present = traces.filter(
    (item): item is { variant: (typeof traces)[0]['variant']; values: number[] } =>
      Array.isArray(item.values),
  )

  const rates = sweep.variants.map((variant) => variant.rates[id] ?? 0)
  const best = Math.max(...rates)
  const worst = Math.min(...rates)

  return (
    <section className="insp-block">
      <h3 className="insp-label">Развёртка: {sweep.path}</h3>
      <p className="insp-note">
        Каждый вариант — отдельный прогон: другой параметр означает другую
        симуляцию, а не другой взгляд на ту же.
      </p>

      <table className="insp-table sweep-table">
        <thead>
          <tr>
            <th>{sweep.path}</th>
            <th className="num">спайков {id}</th>
            <th className="num">Гц</th>
            <th>доля от максимума</th>
          </tr>
        </thead>
        <tbody>
          {sweep.variants.map((variant, index) => {
            const rate = variant.rates[id] ?? 0
            const share = best > 0 ? rate / best : 0
            return (
              <tr key={variant.label}>
                <td className="mono">{variant.label}</td>
                <td className="num">{variant.spikes[id] ?? 0}</td>
                <td className="num">{rate.toFixed(1)}</td>
                <td>
                  <span className="sweep-bar" aria-hidden>
                    <span
                      className="sweep-bar-fill"
                      style={{
                        width: `${share * 100}%`,
                        opacity: shadeFor(index, sweep.variants.length),
                      }}
                    />
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {best !== worst ? (
        <p className="insp-note">
          Разброс по {id}: от {worst.toFixed(1)} до {best.toFixed(1)} Гц.
        </p>
      ) : (
        <p className="insp-note">На {id} этот параметр не влияет.</p>
      )}

      {present.length > 0 ? (
        (() => {
          const all = present.flatMap((item) => item.values)
          const extent = extentOf(all, 0.08)
          const step = niceStep(extent.high - extent.low, 4)
          const low = Math.floor(extent.low / step) * step
          const high = Math.ceil(extent.high / step) * step
          const levels: number[] = []
          for (let level = low; level <= high + 1e-9; level += step) {
            levels.push(Number(level.toFixed(6)))
          }
          return (
            <>
            {/* Насыщенность растёт с величиной параметра, но догадаться об
                этом по самим кривым нельзя -- нужна легенда. */}
            <div className="sweep-legend">
              {present.map((item, index) => (
                <span key={item.variant.label} className="sweep-legend-item">
                  <span
                    className="sweep-swatch"
                    style={{ opacity: shadeFor(index, present.length) }}
                  />
                  <span className="mono">{item.variant.label}</span>
                </span>
              ))}
              <span className="sweep-legend-unit">{sweep.path}</span>
            </div>
            <Plot
              name={`${id}.soma`}
              kind={`потенциал во всех вариантах, мВ`}
              to={view.duration}
              low={low}
              high={high}
              levels={levels}
              height={170}
              showAxis
              series={present.map((item, index) => ({
                points: downsample(item.values, view.dt, COLUMNS),
                color: 'var(--trace)',
                opacity: shadeFor(index, present.length),
                width: index === present.length - 1 ? 1.6 : 1.2,
              }))}
              markers={
                view.thresholdOf(id) !== undefined
                  ? [
                      {
                        value: view.thresholdOf(id) as number,
                        label: `порог ${minus((view.thresholdOf(id) as number).toFixed(1))} мВ`,
                      },
                    ]
                  : []
              }
            />
            </>
          )
        })()
      ) : (
        <p className="insp-empty">
          Потенциал {id} в вариантах не записан — сравнивать нечего.
        </p>
      )}
    </section>
  )
}

/** Насыщенность растёт с номером варианта: так порядок значений виден
 *  на самом графике, а не только в легенде. */
function shadeFor(index: number, count: number): number {
  if (count <= 1) return 1
  return 0.32 + (index / (count - 1)) * 0.68
}
