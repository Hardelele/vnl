/**
 * Клавиши экрана: чья клавиша и что она значит (#563, #537).
 *
 * Проверяется разбор, а не отрисованный экран: правила тут не механические --
 * раскладка, `Backspace` вместо `Delete`, что дублируется, а что нет, -- и
 * через кнопку в панели свойств они не видны вовсе.
 */

import { describe, expect, it } from 'vitest'

import { boardKey, keyLabel, objectCommand, typing } from './keys'

/** Нажатие как его увидит слушатель на окне. */
function press(
  key: string,
  extra: Partial<KeyboardEvent> & { target?: EventTarget | null } = {},
): KeyboardEvent {
  return {
    key,
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    repeat: false,
    target: null,
    ...extra,
  } as KeyboardEvent
}

describe('набор текста забирает клавишу себе', () => {
  it('поле, область текста и список -- чужие', () => {
    // В поле имени клетки `Delete` стирает букву, и отбирать его у поля
    // нельзя: иначе «стёр символ — исчезла клетка».
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(typing({ tagName } as unknown as EventTarget)).toBe(true)
    }
    expect(typing({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false)
    expect(typing(null)).toBe(false)
  })

  it('и разобранное нажатие над полем ничего не просит', () => {
    const event = press('Delete', {
      target: { tagName: 'INPUT' } as unknown as EventTarget,
    })

    expect(objectCommand(event, 'neuron')).toBeNull()
  })
})

describe('клавиши над выбранным объектом (#563)', () => {
  it('Delete и Backspace убирают выбранное -- любого рода', () => {
    for (const key of ['Delete', 'Backspace']) {
      for (const kind of ['block', 'neuron', 'link', 'stimulus', 'recording']) {
        expect(objectCommand(press(key), kind)).toBe('remove')
      }
    }
  })

  it('без выделения не просят ничего', () => {
    expect(objectCommand(press('Delete'), null)).toBeNull()
  })

  it('Ctrl+D дублирует объект холста и молчит над связью и стимулом', () => {
    // У связи копия не получила бы второго конца, а копия стимула била бы в
    // ту же клетку вторым входом -- это другая схема, а не второй объект.
    const combo = press('d', { code: 'KeyD', ctrlKey: true })

    expect(objectCommand(combo, 'neuron')).toBe('duplicate')
    expect(objectCommand(combo, 'block')).toBe('duplicate')
    expect(objectCommand(combo, 'link')).toBeNull()
    expect(objectCommand(combo, 'stimulus')).toBeNull()
  })

  it('работает на русской раскладке: смотрится клавиша, а не буква', () => {
    const combo = press('в', { code: 'KeyD', ctrlKey: true })

    expect(objectCommand(combo, 'neuron')).toBe('duplicate')
  })

  it('Ctrl с чужой клавишей не трогаем: это сочетания браузера', () => {
    expect(objectCommand(press('c', { code: 'KeyC', ctrlKey: true }), 'neuron')).toBeNull()
    expect(objectCommand(press('v', { code: 'KeyV', ctrlKey: true }), 'neuron')).toBeNull()
    expect(objectCommand(press('s', { code: 'KeyS', ctrlKey: true }), 'neuron')).toBeNull()
  })

  it('стрелки остаются временем прогона (#537), а Ctrl+Delete -- ничьим', () => {
    expect(objectCommand(press('ArrowLeft'), 'neuron')).toBeNull()
    expect(objectCommand(press('ArrowRight'), 'neuron')).toBeNull()
    expect(
      objectCommand(press('Delete', { code: 'Delete', ctrlKey: true }), 'neuron'),
    ).toBeNull()
  })

  it('разобранное кем-то раньше нажатие второй раз не разбирается', () => {
    expect(objectCommand(press('Delete', { defaultPrevented: true }), 'neuron')).toBeNull()
  })
})

describe('клавиша кнопки песочницы (#562)', () => {
  it('буквы и цифры -- наши, и отдаются местом клавиши, а не буквой', () => {
    // Держимся за `code` по той же причине, что и Ctrl+D: на русской
    // раскладке та же клавиша шлёт `ф`, и кнопка не работала бы ровно у того,
    // кто читает эту панель по-русски.
    expect(boardKey(press('ф', { code: 'KeyA' }))).toBe('KeyA')
    expect(boardKey(press('1', { code: 'Digit1' }))).toBe('Digit1')
  })

  it('занятое чужим не берётся: стрелки, Delete, Ctrl и Alt', () => {
    // Стрелки шагают по времени (#537), Delete и Ctrl+D правят объект на
    // холсте (#563), Ctrl с колесом приближает холст (#548).
    expect(boardKey(press('ArrowLeft', { code: 'ArrowLeft' }))).toBeNull()
    expect(boardKey(press('Delete', { code: 'Delete' }))).toBeNull()
    expect(boardKey(press(' ', { code: 'Space' }))).toBeNull()
    expect(boardKey(press('a', { code: 'KeyA', ctrlKey: true }))).toBeNull()
    expect(boardKey(press('a', { code: 'KeyA', metaKey: true }))).toBeNull()
    expect(boardKey(press('a', { code: 'KeyA', altKey: true }))).toBeNull()
  })

  it('автоповтор зажатой клавиши -- не второе нажатие', () => {
    // Иначе одно удержание легло бы в запись входа сотней записей.
    expect(boardKey(press('a', { code: 'KeyA', repeat: true }))).toBeNull()
  })

  it('пока набирают текст, клавиша принадлежит полю', () => {
    const event = press('a', {
      code: 'KeyA',
      target: { tagName: 'INPUT' } as unknown as EventTarget,
    })

    expect(boardKey(event)).toBeNull()
  })

  it('разобранное кем-то раньше нажатие панель не трогает', () => {
    // Этим же и разводится назначение клавиши с нажатием кнопки: форма
    // заведения гасит событие, и панель его уже не видит.
    expect(boardKey(press('a', { code: 'KeyA', defaultPrevented: true }))).toBeNull()
  })

  it('подпись клавиши -- латиница: это место клавиши, а не её буква', () => {
    expect(keyLabel('KeyA')).toBe('A')
    expect(keyLabel('Digit1')).toBe('1')
  })
})
