/**
 * Экран входа: одна кнопка, ведущая в Reckue auth.
 *
 * Поля логина и пароля здесь нет намеренно -- и это не упрощение вида. Пароль,
 * введённый на этой странице, пришлось бы куда-то отправлять, то есть стенд
 * снова знал бы чужие пароли. Весь смысл перехода на Reckue auth в том, что он
 * их не знает: отсюда уходит только ссылка.
 *
 * Ссылка -- обычный `<a>`, а не `fetch`: вход это цепочка редиректов браузера,
 * и запрос из скрипта её не пройдёт.
 */

import './shell.css'

export interface LoginScreenProps {
  /** Адрес шага входа на сервере. */
  login: string
  /** Сервер не ответил: входить некуда, и кнопка бы обманывала. */
  offline?: boolean
}

export function LoginScreen({ login, offline = false }: LoginScreenProps) {
  return (
    <main className="login">
      <div className="login-card">
        <span className="login-mark">
          vnl<span className="bar-dot">.</span>
        </span>
        <h1 className="login-title">Библиотека нейронных микросхем</h1>
        {offline ? (
          <p className="login-note">
            Сервер библиотеки не отвечает. Войти можно будет, когда он поднимется.
          </p>
        ) : (
          <>
            <p className="login-note">
              Стенд закрыт: схемы можно менять и удалять, поэтому нужно знать, кто
              это делает.
            </p>
            <a className="login-go" href={login}>
              Войти через Reckue
            </a>
          </>
        )}
      </div>
    </main>
  )
}
