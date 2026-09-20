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

import {
  NO_GLOSSARY,
  driveBrief,
  driveHint,
  driveKinds,
  driveWindow,
  loadGlossary,
} from './glossary'
import type { SandboxDrive } from './sandbox'
import type { Glossary } from './types'

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
    expect(NO_GLOSSARY.drives).toEqual([])
  })
})

describe('роды драйва из словаря (#553)', () => {
  const GLOSSARY = {
    ...NO_GLOSSARY,
    drives: [
      {
        id: 'poisson',
        name: 'пуассоновский',
        note: 'Случайные моменты со средней частотой.',
        receptor: true,
        template: false,
        params: [],
      },
    ],
  }

  it('подсказка называет род и объясняет его', () => {
    // Имя приписано нарочно: в дереве и на карточке текст висит на словах
    // протокола, а не на самом слове «пуассоновский».
    expect(driveHint(GLOSSARY, 'poisson')).toBe(
      'пуассоновский. Случайные моменты со средней частотой.',
    )
  })

  it('незнакомый род -- не подсказка наугад', () => {
    expect(driveHint(GLOSSARY, 'tbs')).toBeUndefined()
  })

  it('ответ старого сервера без родов не роняет экран', () => {
    // Вкладку держат открытой неделями, и сервер бывает старее страницы.
    // Обращение к полю, которого в ответе нет, уронило бы не подсказку, а
    // весь экран, ради которого страницу и открыли.
    const old = { ...NO_GLOSSARY, drives: undefined } as unknown as typeof NO_GLOSSARY
    expect(driveKinds(old)).toEqual([])
    expect(driveHint(old, 'poisson')).toBeUndefined()
  })
})

describe('драйв главными числами -- для знака на холсте (#502)', () => {
  const KINDS = [
    {
      id: 'poisson',
      name: 'пуассоновский',
      note: '',
      receptor: true,
      template: false,
      params: [
        { name: 'rate', label: 'Средняя частота', unit: 'Гц', default: 250, step: 10, form: 'number', note: '' },
        { name: 'amplitude', label: 'Вес', unit: 'нСм', default: 1.5, step: 0.1, form: 'number', note: '' },
      ],
    },
    {
      id: 'current',
      name: 'ток',
      note: '',
      receptor: false,
      template: false,
      params: [
        { name: 'amplitude', label: 'Ток', unit: 'нА', default: 0.2, step: 0.05, form: 'number', note: '' },
      ],
    },
    {
      id: 'spikes',
      name: 'список спайков',
      note: '',
      receptor: true,
      template: false,
      params: [
        { name: 'times', label: 'Моменты', unit: 'мс', default: 0, step: 1, form: 'times', note: '' },
        { name: 'amplitude', label: 'Вес', unit: 'нСм', default: 1.5, step: 0.1, form: 'number', note: '' },
      ],
    },
    {
      id: 'train',
      name: 'поезд',
      note: '',
      receptor: true,
      template: true,
      params: [
        { name: 'n', label: 'Импульсов', unit: '', default: 8, step: 1, form: 'int', note: '' },
        { name: 'freq', label: 'Частота', unit: 'Гц', default: 20, step: 1, form: 'number', note: '' },
        { name: 'recovery', label: 'Тест восстановления', unit: 'мс', default: 0, step: 10, form: 'number', note: '' },
        { name: 'amplitude', label: 'Вес', unit: 'нСм', default: 1.5, step: 0.1, form: 'number', note: '' },
      ],
    },
  ]
  const GLOSSARY = { ...NO_GLOSSARY, drives: KINDS } as unknown as Glossary

  function drive(patch: Record<string, unknown>): SandboxDrive {
    return {
      id: 'd',
      target: { instance: 'E', port: null, section: 'soma', fraction: 0.5 },
      kind: 'poisson',
      receptor: 'ampa',
      rate: 0,
      amplitude: 0,
      times: [],
      protocol: '',
      start: 0,
      stop: 400,
      n: 0,
      freq: 0,
      isi: 0,
      duration: 0,
      bursts: 0,
      burst_period: 0,
      repeats: 1,
      period: 0,
      recovery: 0,
      ...patch,
    } as unknown as SandboxDrive
  }

  it('у каждого рода свои числа -- те, что назвал реестр', () => {
    expect(driveBrief(GLOSSARY, drive({ rate: 250, amplitude: 1.5 }))).toBe(
      '250 Гц · 1.5 нСм',
    )
    expect(
      driveBrief(GLOSSARY, drive({ kind: 'current', amplitude: 1.5 })),
    ).toBe('1.5 нА')
    expect(
      driveBrief(
        GLOSSARY,
        drive({ kind: 'spikes', times: [10, 20, 30, 40, 50, 60, 70, 80], amplitude: 3 }),
      ),
    ).toBe('8 сп. · 3 нСм')
  })

  it('нули не пишутся: в протоколе ноль значит «этого в нём нет»', () => {
    // Иначе поезд читался бы «20 Гц · 0 мс · 1.5 нСм» -- лишним числом про
    // то, чего не происходит.
    expect(
      driveBrief(GLOSSARY, drive({ kind: 'train', n: 8, freq: 20, amplitude: 1.5 })),
    ).toBe('20 Гц · 1.5 нСм')
  })

  it('рода нет в словаре -- показывается то, что есть в проекте', () => {
    // Словарь приходит от сервера, а сервер бывает старее страницы. Выдумать
    // числа за неизвестный род нельзя, но и молчать не надо: имя у него есть.
    expect(driveBrief(NO_GLOSSARY, drive({ kind: 'tbs' }))).toBe('tbs')
  })

  it('окно пишется только там, где оно короче прогона', () => {
    expect(driveWindow(drive({ start: 0, stop: 400 }), 400)).toBeNull()
    expect(driveWindow(drive({ start: 100, stop: 260 }), 400)).toBe('100–260 мс')
  })
})
