/**
 * Кнопки в браузере: чтение чужого хранилища и переезд со старой формы (#574).
 *
 * Проверяется прямо, а не через панель: правила тут не про разметку, а про то,
 * во что превращается уже записанное. Человек, заведший кнопки до двух
 * привязок, не должен увидеть пустую полосу и решить, что панель сломалась.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { freeButtonId, readButtons, rememberButtons, roleOf } from './board'

function put(project: string, value: unknown): void {
  localStorage.setItem('vnl.buttons.' + project, JSON.stringify(value))
}

beforeEach(() => {
  localStorage.clear()
})

describe('чем кнопка стала при таких привязках', () => {
  it('сенсор -- палец, мотор -- лампочка, оба -- петля', () => {
    expect(roleOf({ id: 'b1', name: 'Газ', sensor: 'key', motor: null, key: null })).toBe('sensor')
    expect(roleOf({ id: 'b2', name: 'Ход', sensor: null, motor: 'out', key: null })).toBe('motor')
    expect(roleOf({ id: 'b3', name: 'Петля', sensor: 'key', motor: 'out', key: null })).toBe('loop')
  })
})

describe('переезд со старой формы (#562 -> #574)', () => {
  it('кнопка сенсора, записанная родом и привязкой, читается как кнопка с сенсором', () => {
    put('p1', [{ id: 'btn1', name: 'Газ', role: 'sensor', bind: 'key', key: 'KeyG' }])

    expect(readButtons('p1')).toEqual([
      { id: 'btn1', name: 'Газ', sensor: 'key', motor: null, key: 'KeyG' },
    ])
  })

  it('кнопка мотора становится кнопкой с мотором, а не теряется', () => {
    put('p1', [{ id: 'btn2', name: 'Ход', role: 'motor', bind: 'out', key: null }])

    expect(readButtons('p1')).toEqual([
      { id: 'btn2', name: 'Ход', sensor: null, motor: 'out', key: null },
    ])
  })
})

describe('чужому хранилищу не верят на слово', () => {
  it('не список -- пустой список', () => {
    put('p1', { id: 'btn1' })

    expect(readButtons('p1')).toEqual([])
  })

  it('испорченная запись выбрасывается, соседние остаются', () => {
    put('p1', [
      { id: 'btn1', name: 'Газ', sensor: 'key', motor: null, key: null },
      { id: 7, name: 'Что-то', sensor: 'key', motor: null, key: null },
      { id: 'btn3', name: 'Ход', sensor: null, motor: 5, key: null },
    ])

    expect(readButtons('p1').map((one) => one.id)).toEqual(['btn1'])
  })

  it('кнопка без единой привязки не показывается: делать ей нечего', () => {
    put('p1', [{ id: 'btn1', name: 'Пустая', sensor: null, motor: null, key: null }])

    expect(readButtons('p1')).toEqual([])
  })

  it('хранилища нет вовсе -- пустой список, а не отказ', () => {
    expect(readButtons('никогда-не-открывали')).toEqual([])
  })
})

describe('запись и имена', () => {
  it('записанное читается обратно тем же', () => {
    const buttons = [
      { id: 'btn1', name: 'Петля', sensor: 'key', motor: 'out', key: 'KeyL' },
    ]
    rememberButtons('p1', buttons)

    expect(readButtons('p1')).toEqual(buttons)
  })

  it('кнопки одного проекта не видны в другом', () => {
    rememberButtons('p1', [{ id: 'btn1', name: 'Газ', sensor: 'key', motor: null, key: null }])

    expect(readButtons('p2')).toEqual([])
  })

  it('имя свободно от занятых, а не от длины списка', () => {
    const taken = [
      { id: 'btn1', name: 'a', sensor: 'key', motor: null, key: null },
      { id: 'btn2', name: 'b', sensor: 'key', motor: null, key: null },
    ]

    expect(freeButtonId(taken)).toBe('btn3')
    expect(freeButtonId([taken[1]!])).toBe('btn3')
  })
})
