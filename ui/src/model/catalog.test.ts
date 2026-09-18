import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  OfflineError,
  catalogQueryString,
  createDraft,
  loadCatalog,
} from './catalog'

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const empty = {
  schema: 1,
  query: { text: '', levels: [], statuses: [] },
  total: 0,
  matched: 0,
  levels: [],
  statuses: [],
  patterns: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('строка запроса', () => {
  it('пустой запрос не добавляет к адресу ничего', () => {
    expect(catalogQueryString({})).toBe('')
    expect(catalogQueryString({ text: '   ' })).toBe('')
  })

  it('текст обрезается по краям', () => {
    expect(catalogQueryString({ text: '  ffi ' })).toBe('?q=ffi')
  })

  it('список уходит одним параметром через запятую', () => {
    expect(catalogQueryString({ levels: ['L1', 'L2'] })).toBe('?level=L1%2CL2')
  })

  it('фильтры складываются', () => {
    const rendered = catalogQueryString({
      text: 'pv',
      levels: ['L2'],
      statuses: ['ready'],
    })
    expect(rendered).toBe('?q=pv&level=L2&status=ready')
  })
})

describe('каталог', () => {
  it('спрашивает сервер с готовой строкой запроса', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(empty))
    vi.stubGlobal('fetch', fetcher)

    await loadCatalog({ text: 'ffi', levels: ['L2'] })

    expect(fetcher).toHaveBeenCalledWith('/api/catalog?q=ffi&level=L2', undefined)
  })

  it('чужой формат данных называется, а не разбирается', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ ...empty, schema: 7 })))
    await expect(loadCatalog()).rejects.toThrow(/версии 7/)
  })

  it('ошибка сервера доносится его же словами', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reply({ error: "уровень 'L9' не из каталога" }, 400)),
    )
    const failure = await createDraft('x', 'L9' as 'L2').catch((error) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure.status).toBe(400)
    expect(failure.message).toContain('L9')
  })

  it('незапущенный сервер -- отдельный случай с подсказкой', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')))
    const failure = await loadCatalog().catch((error) => error)
    expect(failure).toBeInstanceOf(OfflineError)
    expect(failure.message).toContain('vnl serve')
  })

  it('черновик создаётся запросом POST с именем', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ id: 'proba', name: 'Проба' }, 201))
    vi.stubGlobal('fetch', fetcher)

    const created = await createDraft('Проба')

    expect(created.id).toBe('proba')
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/patterns')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Проба', level: 'L2' })
  })
})
