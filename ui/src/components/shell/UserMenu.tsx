/**
 * Кто вошёл: значок, имя и меню действий над учётной записью.
 *
 * Имя, а не идентификатор. Провайдер при коде авторизации кладёт в токен
 * только `sub`, и панель показывала человеку строку вида
 * `8161ee5a-7705-48c6-bd27-9ab3f2f51e9b` -- то есть не показывала ничего.
 * Почту и имя сервер теперь спрашивает отдельно (`vnl/auth.py`, userinfo), а
 * здесь остаётся последний рубеж: если известен только идентификатор, он
 * сокращается до первых знаков, а целиком живёт в подсказке.
 *
 * Меню, а не одна кнопка «Выйти»: действий над учётной записью будет больше
 * одного, и место для них должно существовать заранее -- иначе первое же
 * второе действие поедет в случайный угол панели. Пока в меню один выход, и
 * это нормально.
 *
 * Выход -- ссылка, а не кнопка с `fetch`: он уводит к провайдеру закрывать
 * сессию, то есть это переход браузера, а не запрос из скрипта.
 */

import { useEffect, useRef, useState } from 'react'

import './shell.css'

export interface UserMenuProps {
  /** Как звать вошедшего: почта, имя или идентификатор -- что известно. */
  label: string
  /** Адрес выхода на сервере. */
  logout: string
}

/** Первая буква имени для значка. Пустое имя сюда не доходит. */
export function initialOf(label: string): string {
  const letter = label.trim()[0] ?? '?'
  return letter.toUpperCase()
}

/**
 * Идентификатор вместо имени -- крайний случай, но показывать его целиком
 * незачем: тридцать шесть знаков занимают полпанели и ничего не сообщают.
 */
export function shortLabel(label: string): string {
  const looksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(label)
  return looksLikeId ? `${label.slice(0, 8)}…` : label
}

export function UserMenu({ label, logout }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Меню закрывается щелчком мимо и клавишей Esc: открытое меню, которое не
  // закрыть, -- ловушка на экране, где всё остальное работает щелчком.
  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent): void => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div className="who" ref={box}>
      <button
        type="button"
        className="who-face"
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="who-badge" aria-hidden="true">
          {initialOf(label)}
        </span>
        <span className="who-name">{shortLabel(label)}</span>
      </button>

      {open ? (
        <div className="who-menu" role="menu">
          <span className="who-full">{label}</span>
          <a className="who-item" role="menuitem" href={logout}>
            Выйти
          </a>
        </div>
      ) : null}
    </div>
  )
}
