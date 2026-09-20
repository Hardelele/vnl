/**
 * Кнопки песочницы: что браузер помнит про привязку к сенсорам и моторам.
 *
 * Кнопка -- не часть схемы. Отпечаток сети от нажатия не меняется (#561), и от
 * заведения кнопки не должен меняться тем более: положи её в проект, и щелчок
 * по «+» сделал бы проект несохранённым, состарил бы прогон и потребовал бы
 * «Отменить» -- всё это про правку сети, а кнопка сеть не правит. Она стоит с
 * той же стороны границы, что палец: снаружи.
 *
 * Отсюда и место -- браузер, рядом с высотой нижней панели (`state/desk`) и
 * темой (`state/theme`). Но ключ свой на проект, а не один на приложение:
 * кнопка привязана к сенсору по имени, а имена у каждого проекта свои, и общий
 * список означал бы кнопку «Газ», которая в соседнем проекте не привязана ни к
 * чему.
 *
 * Хранилища может не быть вовсе, а лежать в нём может что угодно -- правил его
 * не мы. Поэтому чтение никогда не падает и не отдаёт мусор: любое сомнение --
 * пустой список. Потерять кнопки не страшно, они заводятся в два щелчка;
 * показать кнопку, привязанную неизвестно к чему, -- страшно.
 */

/** К чему привязана кнопка: к двери внутрь или к двери наружу. */
export type BoardRole = 'sensor' | 'motor'

/**
 * Кнопка панели.
 *
 * `role` хранится, а не вычисляется по тому, в каком из двух списков проекта
 * нашлось `bind`: сенсор и мотор -- разные вещи, и одноимённые (а имена
 * задаёт человек) превратили бы кнопку подачи в лампочку молча, на ближайшем
 * ответе сервера.
 *
 * `key` -- `code` клавиши (`KeyA`), а не её символ: за место клавиши держится
 * и разбор в `lib/keys`, и подпись на кнопке -- см. там же, почему.
 */
export interface BoardButton {
  id: string
  name: string
  role: BoardRole
  /** Имя сенсора или мотора в проекте. Может и потеряться -- дверь убрали. */
  bind: string
  key: string | null
}

const PREFIX = 'vnl.buttons.'

/** Похоже ли это на кнопку: ответ из чужого хранилища проверяется целиком. */
function sound(item: unknown): item is BoardButton {
  if (!item || typeof item !== 'object') return false
  const row = item as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    (row.role === 'sensor' || row.role === 'motor') &&
    typeof row.bind === 'string' &&
    (row.key === null || typeof row.key === 'string')
  )
}

export function readButtons(project: string): BoardButton[] {
  try {
    const kept = localStorage.getItem(PREFIX + project)
    if (!kept) return []
    const parsed: unknown = JSON.parse(kept)
    return Array.isArray(parsed) ? parsed.filter(sound) : []
  } catch {
    return []
  }
}

export function rememberButtons(project: string, buttons: BoardButton[]): void {
  try {
    localStorage.setItem(PREFIX + project, JSON.stringify(buttons))
  } catch {
    /* Без хранилища кнопки просто не переживут перезагрузку -- см. `desk.ts`. */
  }
}

/**
 * Имя следующей кнопке в списке -- уникальное внутри проекта.
 *
 * Считается от занятых, а не от длины списка: кнопки убирают, и счётчик по
 * длине выдал бы второй `btn2` тому, кто завёл три и убрал среднюю. Ключ
 * реакта -- это он же, и повтор стоил бы перепутанных кнопок на перерисовке.
 */
export function freeButtonId(buttons: BoardButton[]): string {
  const taken = new Set(buttons.map((item) => item.id))
  let number = buttons.length + 1
  while (taken.has(`btn${number}`)) number += 1
  return `btn${number}`
}
