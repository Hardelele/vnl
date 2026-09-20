/**
 * Расшифровка подписей: договор с сервером (#541).
 *
 * Проверяется ровно одно: интерфейс спрашивает объяснения, а не хранит их.
 * Собственного списка рецепторов здесь больше нет -- он приходит из
 * `ir.RECEPTORS` вместе с числами, по которым рецепторы считают, и второй
 * список в браузере разошёлся бы с первым молча: подсказка ни на один прогон
 * не влияет.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { NO_GLOSSARY, loadGlossary } from './glossary'

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('расшифровка подписей', () => {
  it('спрашивается у сервера, а не собирается здесь', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      reply({
        schema: 1,
        receptors: [
          {
            id: 'gaba_a',
            note: 'Быстрое торможение',
            reversal: -70,
            tauDecay: 6,
            inhibitory: true,
          },
        ],
        cell: { tauM: 'За сколько мембрана забывает заряд' },
        contact: { weight: 'Сила контакта' },
        port: { mod: 'Модуляция' },
      }),
    )
    vi.stubGlobal('fetch', fetcher)

    const glossary = await loadGlossary()

    const [url] = fetcher.mock.calls[0] as [string]
    expect(url).toBe('/api/glossary')
    // Числа приходят полями, а не словами внутри текста: пересказанный спад
    // разошёлся бы с тем, по которому синапс считается.
    expect(glossary.receptors[0]?.tauDecay).toBe(6)
    expect(glossary.cell.tauM).toBeTruthy()
  })

  it('пустая расшифровка -- не поломка экрана', () => {
    // Подсказка объясняет, а не управляет: без неё песочница работает так же,
    // как работала до #541.
    expect(NO_GLOSSARY.receptors).toEqual([])
    expect(NO_GLOSSARY.cell).toEqual({})
  })
})
