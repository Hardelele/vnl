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

/**
 * Чем кнопка оказалась для сети: пальцем, лампочкой или петлёй (#574).
 *
 * Считается по привязкам, а не хранится: два поля и слово про них -- это два
 * места, где написано одно и то же, и разойтись они успели бы на первой же
 * правке привязки.
 */
export type BoardRole = 'sensor' | 'motor' | 'loop' | 'none'

/**
 * Кнопка панели: у неё две привязки, и любая может быть пустой (#574).
 *
 * `sensor` -- кому кнопка отдаёт свой бит, `motor` -- кто её зажигает. Только
 * сенсор -- палец, как было; только мотор -- лампочка, как было; обе -- петля:
 * сеть шевельнула мотор, кнопка нажалась сама, сенсор получил единицу, и сеть
 * почувствовала последствие собственного действия.
 *
 * Двумя полями, а не «родом и привязкой», как было в #562: род при одной
 * привязке был честен, а при двух пришлось бы завести третье слово («петля»)
 * и держать его в согласии с тем, куда кнопка на самом деле привязана. Род
 * теперь считается -- `roleOf` ниже.
 *
 * `key` -- `code` клавиши (`KeyA`), а не её символ: за место клавиши держится
 * и разбор в `lib/keys`, и подпись на кнопке -- см. там же, почему.
 */
export interface BoardButton {
  id: string
  name: string
  /** Сенсор, которому кнопка подаёт единицу. Пусто -- она ничего не подаёт. */
  sensor: string | null
  /** Мотор, который её зажигает. Пусто -- её зажигает только палец. */
  motor: string | null
  key: string | null
}

/** Чем кнопка стала при таких привязках. */
export function roleOf(button: BoardButton): BoardRole {
  if (button.sensor && button.motor) return 'loop'
  if (button.sensor) return 'sensor'
  if (button.motor) return 'motor'
  return 'none'
}

const PREFIX = 'vnl.buttons.'

/**
 * Разбор одной записи из чужого хранилища -- и заодно переезд со старой формы.
 *
 * До #574 у кнопки были `role` и одна `bind`. Такие записи лежат в браузерах
 * тех, кто уже завёл себе кнопки, и выкинуть их было бы хуже, чем кажется:
 * человек увидел бы пустую полосу и решил, что панель сломалась, -- а сломался
 * бы ровно переезд. Поэтому старая запись читается и превращается в новую:
 * `role: 'sensor'` -- это кнопка, у которой привязан только сенсор.
 *
 * Обратного превращения нет: страница со старым кодом прочтёт новую запись и
 * отбросит её, то есть потеряет кнопки, которые заводятся в два щелчка. Это
 * дешевле, чем писать в хранилище обе формы разом и гадать, какая из них
 * правда.
 */
function revive(item: unknown): BoardButton | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null
  if (row.key !== null && typeof row.key !== 'string' && row.key !== undefined) return null
  const key = typeof row.key === 'string' ? row.key : null

  // Старая форма: род и одна привязка.
  if (typeof row.bind === 'string' && (row.role === 'sensor' || row.role === 'motor')) {
    return {
      id: row.id,
      name: row.name,
      sensor: row.role === 'sensor' ? row.bind : null,
      motor: row.role === 'motor' ? row.bind : null,
      key,
    }
  }

  const sensor = row.sensor === null || row.sensor === undefined ? null : row.sensor
  const motor = row.motor === null || row.motor === undefined ? null : row.motor
  if (sensor !== null && typeof sensor !== 'string') return null
  if (motor !== null && typeof motor !== 'string') return null
  // Кнопка без единой привязки не нажимается и не горит: показывать её -- то
  // же самое, что показывать мусор из чужого хранилища.
  if (sensor === null && motor === null) return null
  return { id: row.id, name: row.name, sensor, motor, key }
}

export function readButtons(project: string): BoardButton[] {
  try {
    const kept = localStorage.getItem(PREFIX + project)
    if (!kept) return []
    const parsed: unknown = JSON.parse(kept)
    if (!Array.isArray(parsed)) return []
    const alive: BoardButton[] = []
    for (const item of parsed) {
      const button = revive(item)
      if (button) alive.push(button)
    }
    return alive
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
