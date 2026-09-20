/**
 * Проектная часть песочницы: какой проект открыт, как он зовётся и что с ним
 * можно сделать (#569).
 *
 * Одним местом и слева сверху -- там, где его и искали. Разошлось это само:
 * выбор проекта стоял в верхней полосе, а переименование, добавленное в #563,
 * легло в правую панель свойств -- туда, где правят выбранную клетку. Проект
 * правили в одном месте, выбирали в другом, и владелец сказал об этом прямо:
 * «название проекта должно редактироваться сверху слева, проектная часть
 * вообще как бы где-то обособлена должна быть».
 *
 * Здесь и собрано всё, что относится к проекту как к файлу: имя (правится
 * прямо в полосе), переключение на другой, новый и закрытие. Правая панель
 * после этого остаётся про выбранный объект -- и только про него.
 *
 * Полосой в той же шапке, а не отдельной строкой сверху. Развилка названа в
 * карточке, и решена она так: после переезда управления временем и чисел
 * прогона вниз (#569, дополнение владельца) в шапке освободилось больше
 * половины ширины, и на 1280 она перестала переноситься на две строки без
 * всякой второй полосы. А вторая полоса стоила бы холсту ещё одной строки
 * высоты в окне, которое и так делят четыре панели (#504), -- то есть лечила
 * бы тесноту теснотой.
 *
 * Список проектов -- меню, а не `select`. Причин две. Первая: рядом стоит поле
 * имени, и `select` показывал бы то же самое имя вторым, уже не правящимся,
 * экземпляром -- одно место в двух видах. Вторая: «+» и «×» рядом с ним
 * читались двояко -- «×» возле «+» выглядит как «удалить», хотя закрывает, --
 * и владелец на это указал. В меню и то и другое названо словами: «Новый
 * проект» и «Закрыть проект», а удаления проекта в песочнице нет вовсе, и
 * теперь по виду полосы этого не спутать.
 */

import { useEffect, useRef, useState } from 'react'

export interface ProjectBarProps {
  /** Открытый проект: его имя правится прямо здесь. */
  id: string
  name: string
  /** Проекты из хранилища. Открытый в списке зовётся своим именем -- см. `rows`. */
  list: Array<{ id: string; name: string }>
  onRename: (name: string) => void
  onOpen: (id: string) => void
  onCreate: () => void
  onClose: () => void
}

export function ProjectBar({
  id,
  name,
  list,
  onRename,
  onOpen,
  onCreate,
  onClose,
}: ProjectBarProps) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  /**
   * Esc закрывает меню и возвращает фокус на кнопку.
   *
   * Тот же выход, что у выдвижной панели библиотеки (#550): щелчком мимо
   * закрыть можно, но с клавиатуры мимо не щёлкнешь, и меню осталось бы
   * ловушкой для фокуса.
   */
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector('button')?.focus()
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      opener.current?.focus()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])

  const shut = (act?: () => void): void => {
    setOpen(false)
    act?.()
  }

  return (
    <div className="sb-project-bar">
      <span className="sb-project-label">Проект</span>
      {/* Имя -- поле, а не подпись: его правят прямо здесь, и это главное, о
          чём просил владелец. Ключ по значению -- как во всех полях панели
          свойств: ответ сервера может отличаться от набранного, и поле обязано
          показывать то, что в проекте. */}
      <input
        className="sb-project-input"
        type="text"
        key={`${id}:${name}`}
        defaultValue={name}
        aria-label="Название проекта"
        title="Название проекта. Правится здесь же"
        onBlur={(event) => {
          if (event.target.value !== name) onRename(event.target.value)
        }}
        onKeyDown={(event) => {
          // Enter -- «готово»: правка уходит по уходу из поля, и заставлять
          // человека щёлкать мимо ради этого не за что. Esc -- «передумал»:
          // поле возвращается к тому, что в проекте, и ничего не отправляет.
          if (event.key === 'Enter') event.currentTarget.blur()
          else if (event.key === 'Escape') {
            event.currentTarget.value = name
            event.currentTarget.blur()
          }
        }}
      />
      <button
        ref={opener}
        type="button"
        className="sb-icon sb-project-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Проекты"
        title="Открыть другой проект, завести новый или закрыть этот"
        onClick={() => setOpen(!open)}
      >
        ▾
      </button>

      {open ? (
        <>
          {/* Подложка: щелчок мимо закрывает меню и не доходит до холста.
              Та же пара «подложка + Esc», что у ящика библиотеки. */}
          <button
            type="button"
            className="sb-menu-veil"
            aria-label="Закрыть меню проектов"
            onClick={() => shut(() => opener.current?.focus())}
          />
          <div className="sb-menu" role="menu" ref={menu}>
            <div className="sb-menu-title">Открыть проект</div>
            {list.map((row) => (
              <button
                key={row.id}
                type="button"
                role="menuitem"
                className={`sb-menu-item${row.id === id ? ' is-on' : ''}`}
                aria-current={row.id === id ? 'true' : undefined}
                onClick={() => shut(row.id === id ? undefined : () => onOpen(row.id))}
              >
                {row.name}
              </button>
            ))}
            <div className="sb-menu-line" />
            <button
              type="button"
              role="menuitem"
              className="sb-menu-item"
              onClick={() => shut(onCreate)}
            >
              Новый проект
            </button>
            {/* Словами, а не «×»: значок рядом с «+» читался как «удалить»
                проект, чего песочница не умеет вовсе. Подпись говорит, что
                именно происходит, -- проект остаётся на диске. */}
            <button
              type="button"
              role="menuitem"
              className="sb-menu-item"
              title="Проект останется в хранилище — закроется только этот экран"
              onClick={() => shut(onClose)}
            >
              Закрыть проект
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
