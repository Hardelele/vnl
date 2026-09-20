/**
 * Высота нижней панели помнится браузером.
 *
 * Проверяется не «записали и прочитали», а то, ради чего здесь try/catch:
 * хранилища может не быть вовсе (приватное окно), а лежать в нём может что
 * угодно -- правил его не обязательно интерфейс. Любое сомнение обязано дать
 * высоту по умолчанию, а не сломать экран и не вернуть мусор.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PANEL_HEIGHT,
  PANEL_MAX,
  PANEL_MIN,
  readPanelHeight,
  rememberPanelHeight,
} from './desk'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('высота панели активности', () => {
  it('пустое хранилище -- высота по умолчанию', () => {
    expect(readPanelHeight()).toBe(PANEL_HEIGHT)
  })

  it('переживает перезагрузку страницы', () => {
    rememberPanelHeight(320)
    expect(readPanelHeight()).toBe(320)
  })

  it('испорченное значение -- высота по умолчанию, а не ноль', () => {
    for (const junk of ['', '   ', 'высокая', '{"h":300}', 'NaN']) {
      localStorage.setItem('vnl.panel.activity', junk)
      expect(readPanelHeight()).toBe(PANEL_HEIGHT)
    }
  })

  it('число вне пределов зажимается, а не берётся как есть', () => {
    localStorage.setItem('vnl.panel.activity', '4')
    expect(readPanelHeight()).toBe(PANEL_MIN)
    localStorage.setItem('vnl.panel.activity', '99999')
    expect(readPanelHeight()).toBe(PANEL_MAX)
  })

  it('запрет на хранилище не роняет чтение и запись', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('доступ к хранилищу закрыт')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('доступ к хранилищу закрыт')
    })

    expect(() => rememberPanelHeight(300)).not.toThrow()
    expect(readPanelHeight()).toBe(PANEL_HEIGHT)
  })
})
