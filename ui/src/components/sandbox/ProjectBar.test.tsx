/**
 * Проектная часть слева сверху (#569).
 *
 * Проверяется то, на что жаловался владелец: имя открытого проекта правится
 * здесь, а не в панели свойств; переключение и заведение нового -- там же; и
 * закрытие названо словом, а не значком, который рядом с «+» читался как
 * «удалить».
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProjectBar, type ProjectBarProps } from './ProjectBar'

let root: Root | null = null
let host: HTMLElement

const LIST = [
  { id: 's1', name: 'Проба' },
  { id: 's2', name: 'Вторая схема' },
]

async function mount(extra: Partial<ProjectBarProps> = {}): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <ProjectBar
        id="s1"
        name="Проба"
        list={LIST}
        onRename={() => {}}
        onOpen={() => {}}
        onCreate={() => {}}
        onClose={() => {}}
        {...extra}
      />,
    )
  })
}

function field(): HTMLInputElement {
  return host.querySelector('.sb-project-input') as HTMLInputElement
}

async function openMenu(): Promise<void> {
  const more = host.querySelector('.sb-project-more') as HTMLButtonElement
  await act(async () => {
    more.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function items(): HTMLButtonElement[] {
  return [...host.querySelectorAll('.sb-menu-item')] as HTMLButtonElement[]
}

/** Пункт меню по номеру: в тесте он всегда есть, и проверять это незачем. */
function item(index: number): HTMLButtonElement {
  return items()[index] as HTMLButtonElement
}

afterEach(() => {
  act(() => root?.unmount())
  host.remove()
  root = null
})

describe('проектная часть', () => {
  it('имя открытого проекта видно и правится здесь же', async () => {
    const renamed = vi.fn()
    await mount({ onRename: renamed })

    expect(field().value).toBe('Проба')

    await act(async () => {
      field().value = 'Сеть внимания'
      field().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(renamed).toHaveBeenCalledWith('Сеть внимания')
  })

  it('то же имя обратно на сервер не уезжает', async () => {
    // Щелчок мимо поля -- не правка: лишний шаг истории отменял бы ничто.
    const renamed = vi.fn()
    await mount({ onRename: renamed })

    await act(async () => {
      field().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(renamed).not.toHaveBeenCalled()
  })

  it('Esc в поле возвращает прежнее имя и ничего не отправляет', async () => {
    const renamed = vi.fn()
    await mount({ onRename: renamed })

    await act(async () => {
      field().value = 'набрал и передумал'
      field().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(field().value).toBe('Проба')
    expect(renamed).not.toHaveBeenCalled()
  })

  it('переключение, новый и закрытие живут в одном меню', async () => {
    const opened = vi.fn()
    const created = vi.fn()
    const closed = vi.fn()
    await mount({ onOpen: opened, onCreate: created, onClose: closed })

    await openMenu()
    const labels = items().map((item) => item.textContent)
    expect(labels).toEqual(['Проба', 'Вторая схема', 'Новый проект', 'Закрыть проект'])

    // Закрытие названо словом: значок «×» рядом с «+» читался как «удалить»,
    // хотя удаления проекта в песочнице нет вовсе.
    expect(host.textContent).not.toContain('×')

    await act(async () => {
      item(1).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(opened).toHaveBeenCalledWith('s2')
    // Выбрали -- меню ушло: результат лежит ровно под ним.
    expect(host.querySelector('.sb-menu')).toBeNull()

    await openMenu()
    await act(async () => {
      item(2).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(created).toHaveBeenCalled()

    await openMenu()
    await act(async () => {
      item(3).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(closed).toHaveBeenCalled()
  })

  it('открытый проект в меню отмечен и заново не открывается', async () => {
    const opened = vi.fn()
    await mount({ onOpen: opened })

    await openMenu()
    expect(item(0).className).toContain('is-on')
    await act(async () => {
      item(0).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // Открывать уже открытое значило бы перечитать проект с диска и потерять
    // несохранённые правки.
    expect(opened).not.toHaveBeenCalled()
    expect(host.querySelector('.sb-menu')).toBeNull()
  })

  it('Esc закрывает меню: с клавиатуры мимо не щёлкнешь', async () => {
    await mount()
    await openMenu()
    expect(host.querySelector('.sb-menu')).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(host.querySelector('.sb-menu')).toBeNull()
  })
})
