"""Вход через Reckue auth: отказ без сессии, полный проход и подделки.

Провайдер здесь настоящий, только свой: маленький HTTP-сервер на localhost,
который отдаёт discovery, jwks и токены. Подменять `Provider` вызовом Python
значило бы проверить всё, кроме разбора ответов провайдера и работы с куками --
а именно там живут ошибки такого слоя.

Токены подписываются тем же RSA, что и у настоящего провайдера (RS256). Ключ
зашит ниже: генерировать его на каждый прогон незачем, а проверка подписи от
происхождения ключа не зависит. Второй ключ нужен ровно для одного теста --
«подписано не тем».
"""

import base64
import hashlib
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from vnl import auth
from vnl.server import create_server
from vnl.store import Store

from test_server import ffi_pattern

# --- ключи для подписи токенов в тестах ---------------------------------------

#: Ключ «нашего» провайдера: им подписаны токены в большинстве тестов.
_N = int(
    "e277ba63a632047a3d83f2f870352fe0be942e098bd090b4a6fd2a22ecd8bec6"
    "aec6422c72124c217cfce7049c71ff4d902e81d985abbefdf26c024087b7352d"
    "7aad8366cb38772cc337c87e05f9e4599916bfadbf1991453fa54434a06f0535"
    "8255dafd4cc9763b875dce3d4efaeb84fb63304c8c7f85b00d5713ed901620c9"
    "69da1c539929ab1e79230816e27cf977397ba29cf2b6444f5553cd970d11f5c0"
    "7d04880faaef72b146a834bc35f43af098a60cab2fc2947f97f3f959256de498"
    "6455a53cedfee8a67c1dfc6da83f071beffa3e9c185f9a6e6c2b96429ede1ecc"
    "6540896c7fc0712630db50190bd0eb0813564c60313416dc7061fbb4db822893",
    16,
)

_D = int(
    "0b596806dc6a549d1cfe182c13d0d135c321ebee0b355d90756f3f3056e199d5"
    "f27ba464a926cf97e75ff3e28af08f947f2d9ad0f588f633b07571e61d51b4cc"
    "33020511740d155e873e016c876224411fe740488b1e289094304a6b14c0863d"
    "f895283a04ccc7d71336994255f5ef32fa8cd85123180a46c35f0cc99d5743e1"
    "f15610d99a348ebd6471b9016958f7ed569a7dfa1538d2393df445308b506cbc"
    "dea10c050044c427a90f1a636d06c1adf49200041c51dee4a8c12ab9c4e1fb22"
    "defca292d4a512ad03d6885c01ab358b619464c328f81c8b0496fac116dffbd0"
    "96143f3e0d53947e95f70164bdf2adb79f459317ef391f81d7eef0407b943a31",
    16,
)

_E = 65537

#: Второй ключ нужен ровно для проверки «подписано не тем».
_OTHER_N = int(
    "849eadaea7bc6a187d68cc5f079dd52b807405628475420cafbd15637d07eafb"
    "00aa518d7ceb3fa9805b0edf401312a9574e9dde1807936db6b107628d84187d"
    "15aaae79c30f91423cba43d49f84aea477635e367a6ad43047247a8298a65210"
    "9c2848ffe6d1d659d82dab0106e9a1a0aa7330c53514c6b34ffac265e20828fe"
    "82cb4afa7b351c1cda29173ea8fb7b9a6ee9e2f392efe0c0a00c3631139b774b"
    "68666c83f2237b6e30c722414ddb878124b70660aaeb4a9282b681775c6bd361"
    "e3564a93afc4066fe67d6dcbaad70d522dd03d61ac1de6b7b4ceeb40458fa947"
    "7ff0c808a27a3db992da0e5ac8b34a83db684d80ddd00e8eb78055c1d110565b",
    16,
)

_OTHER_D = int(
    "0b9bba172e1e7b68ee5d447a52f7d94768047fce2a4afb3f92086a7d5d5dda8f"
    "22f545932d6a881585a332cf8ed3bc8fef10f6179121e4a1375b128ae959352d"
    "89be796c360b404b3c768f66669a1e114e53f7d4abed7aea48e7e403576a4387"
    "a9ab8b0c3f3f81d4366c74e9ef9976a8d212a823b2ec412243ef6ea1ad61ca78"
    "b0671be0b26650803b69b86cfeb145844599b3c2e1738488fe8c6ef2a370ca05"
    "7580bfa162b25687a3e20aab98d8eaf303a955a2323dc3f02df68ca08f942d29"
    "08cdca029aae0c7ba5aa5bcc3e18839bc69a45fe231f87eefdbf862e80c0d800"
    "b2f1a4611bced2dc8383cf2bbd9ee202818fb227bc9137e56ac1a3f5aae9fa0d",
    16,
)


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _int_b64(value: int) -> str:
    return _b64(value.to_bytes((value.bit_length() + 7) // 8, "big"))


def sign_rs256(payload: dict, *, modulus: int, private: int, header: dict) -> str:
    """Собрать и подписать JWT так же, как это делает провайдер.

    Подпись -- RSASSA-PKCS1-v1_5 с SHA-256 на голом `pow`: тот же приём, что и
    в проверяющей стороне, только с закрытой экспонентой.
    """
    parts = [
        _b64(json.dumps(header, separators=(",", ":")).encode()),
        _b64(json.dumps(payload, separators=(",", ":")).encode()),
    ]
    signed = ".".join(parts).encode("ascii")
    size = (modulus.bit_length() + 7) // 8
    digest = hashlib.sha256(signed).digest()
    prefix = bytes.fromhex("3031300d060960864801650304020105000420")
    block = (
        b"\x00\x01"
        + b"\xff" * (size - 3 - len(prefix) - len(digest))
        + b"\x00"
        + prefix
        + digest
    )
    signature = pow(int.from_bytes(block, "big"), private, modulus)
    parts.append(_b64(signature.to_bytes(size, "big")))
    return ".".join(parts)


# --- свой провайдер на localhost ----------------------------------------------


class FakeProvider(BaseHTTPRequestHandler):
    """Discovery, jwks и обмен кода на токены -- ровно то, чем ходит клиент."""

    #: Подставляется в фикстуре: план ответов и запись того, что пришло.
    plan: dict

    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # тишина в выводе теста
        pass

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        issuer = self.plan["issuer"]
        if self.path == "/.well-known/openid-configuration":
            self._json(
                200,
                {
                    "issuer": self.plan.get("issuer_says", issuer),
                    "authorization_endpoint": f"{issuer}/auth",
                    "token_endpoint": f"{issuer}/token",
                    "jwks_uri": f"{issuer}/jwks",
                    "end_session_endpoint": f"{issuer}/session/end",
                },
            )
            return
        if self.path == "/jwks":
            self.plan["jwks_hits"] = self.plan.get("jwks_hits", 0) + 1
            self._json(
                200,
                {
                    "keys": [
                        {
                            "kty": "RSA",
                            "kid": "test",
                            "alg": "RS256",
                            "n": _int_b64(_N),
                            "e": _int_b64(_E),
                        }
                    ]
                },
            )
            return
        self._json(404, {"error": self.path})

    def do_POST(self) -> None:
        if self.path != "/token":
            self._json(404, {"error": self.path})
            return
        length = int(self.headers.get("Content-Length") or 0)
        form = urllib.parse.parse_qs(self.rfile.read(length).decode())
        self.plan["token_form"] = {k: v[0] for k, v in form.items()}
        self.plan["token_auth"] = self.headers.get("Authorization")
        if self.plan.get("token_error"):
            self._json(400, {"error": self.plan["token_error"]})
            return
        now = int(time.time())
        claims = {
            "iss": self.plan["issuer"],
            "aud": self.plan["client_id"],
            "sub": "user-1",
            "email": "user@reckue.com",
            "name": "Пользователь Reckue",
            "iat": now,
            "exp": now + 300,
        }
        claims.update(self.plan.get("claims", {}))
        header = {"alg": "RS256", "kid": "test", "typ": "JWT"}
        header.update(self.plan.get("header", {}))
        self._json(
            200,
            {
                "access_token": "at",
                "token_type": "Bearer",
                "id_token": sign_rs256(
                    claims,
                    modulus=self.plan.get("sign_n", _N),
                    private=self.plan.get("sign_d", _D),
                    header=header,
                ),
            },
        )


# --- запросы без автоматических редиректов ------------------------------------


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Редирект -- предмет проверки, а не деталь транспорта."""

    def redirect_request(self, *args):
        return None


def ask(base: str, path: str, cookies: dict[str, str] | None = None):
    """Запрос к стенду. Возвращает код, заголовки и тело."""
    request = urllib.request.Request(base + path)
    if cookies:
        request.add_header(
            "Cookie", "; ".join(f"{k}={v}" for k, v in cookies.items())
        )
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


def cookies_of(headers) -> dict[str, str]:
    """Куки из ответа: имя -> значение. Пустое значение -- «забудь эту куку»."""
    found = {}
    for raw in headers.get_all("Set-Cookie") or []:
        pair = raw.split(";", 1)[0]
        name, _, value = pair.partition("=")
        found[name.strip()] = value.strip()
    return found


def json_of(body: bytes) -> dict:
    return json.loads(body.decode("utf-8"))


# --- фикстуры -----------------------------------------------------------------


@pytest.fixture
def provider_plan():
    return {"client_id": "vnl-test"}


@pytest.fixture
def issuer(provider_plan):
    """Свой провайдер на свободном порту."""
    handler = type("BoundFake", (FakeProvider,), {"plan": provider_plan})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    url = f"http://127.0.0.1:{server.server_address[1]}"
    provider_plan["issuer"] = url
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield url
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.fixture
def settings(issuer, provider_plan):
    return auth.Settings(
        issuer=issuer,
        client_id=provider_plan["client_id"],
        client_secret="секрет-клиента",
        redirect_uri="http://127.0.0.1:8765/auth/callback",
        secret=b"x" * 32,
    )


@pytest.fixture
def stand(tmp_path, settings):
    """Стенд с включённым входом и одним паттерном в библиотеке."""
    Store(tmp_path).save_pattern(ffi_pattern())
    server = create_server(
        tmp_path, port=0, quiet=True, provider=auth.Provider(settings)
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def enter(base: str) -> dict[str, str]:
    """Пройти вход целиком и вернуть куки вошедшего."""
    status, headers, _ = ask(base, auth.LOGIN_PATH)
    assert status == 302
    flow = cookies_of(headers)[auth.FLOW_COOKIE]
    state = urllib.parse.parse_qs(
        urllib.parse.urlsplit(headers["Location"]).query
    )["state"][0]
    status, headers, _ = ask(
        base,
        f"{auth.CALLBACK_PATH}?code=code-1&state={state}",
        {auth.FLOW_COOKIE: flow},
    )
    assert status == 302, headers
    return {auth.SESSION_COOKIE: cookies_of(headers)[auth.SESSION_COOKIE]}


# --- без входа стенд закрыт ----------------------------------------------------


def test_api_without_session_answers_401_with_login_link(stand):
    """Интерфейсу нужен код и адрес входа, а не редирект с HTML."""
    status, _, body = ask(stand, "/api/catalog")
    assert status == 401
    assert json_of(body)["login"] == auth.LOGIN_PATH


def test_page_without_session_goes_to_login(stand):
    """Человеку в браузере -- редирект на вход."""
    status, headers, _ = ask(stand, "/")
    assert status == 302
    assert headers["Location"] == auth.LOGIN_PATH


def test_pattern_cannot_be_deleted_without_session(stand):
    """Запись закрыта тем же рубежом, что и чтение."""
    request = urllib.request.Request(stand + "/api/patterns/ffi", method="DELETE")
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request) as response:
            assert False, f"удалило без входа: {response.status}"
    except urllib.error.HTTPError as error:
        assert error.code == 401


def test_ready_answers_without_login(stand):
    """Выкат проверяет здоровье службы, а не чужой вход."""
    status, _, body = ask(stand, "/api/ready")
    assert status == 200
    assert json_of(body)["ok"] is True


def test_session_says_nobody_entered_yet(stand):
    status, _, body = ask(stand, "/api/session")
    assert status == 200
    assert json_of(body) == {
        "user": None,
        "login": auth.LOGIN_PATH,
        "logout": auth.LOGOUT_PATH,
        "required": True,
    }


# --- проход входа --------------------------------------------------------------


def test_login_sends_to_provider_with_pkce(stand, settings):
    """Редирект на провайдера несёт S256-челлендж, а не сам verifier."""
    status, headers, _ = ask(stand, auth.LOGIN_PATH)
    assert status == 302
    target = urllib.parse.urlsplit(headers["Location"])
    query = urllib.parse.parse_qs(target.query)
    assert query["client_id"] == [settings.client_id]
    assert query["redirect_uri"] == [settings.redirect_uri]
    assert query["response_type"] == ["code"]
    assert query["code_challenge_method"] == ["S256"]
    assert "openid" in query["scope"][0]

    flow = auth.unseal(cookies_of(headers)[auth.FLOW_COOKIE], settings.secret)
    assert flow is not None
    # В адресе -- хеш verifier'а; сам verifier остаётся у нас в куке.
    assert query["code_challenge"] == [auth.challenge_of(flow["verifier"])]
    assert flow["verifier"] not in headers["Location"]


def test_login_cookie_is_httponly_and_lax(stand):
    """Куку не достать скриптом, но с возврата от провайдера она придёт."""
    _, headers, _ = ask(stand, auth.LOGIN_PATH)
    raw = [c for c in headers.get_all("Set-Cookie") if c.startswith(auth.FLOW_COOKIE)][0]
    assert "HttpOnly" in raw
    assert "SameSite=Lax" in raw
    # redirect_uri у стенда http -- значит Secure ставить нельзя, иначе браузер
    # выбросит куку и вход на своей машине перестанет работать.
    assert "Secure" not in raw


def test_full_login_opens_the_stand(stand, provider_plan):
    """Полный проход: вход, возврат, и библиотека отвечает."""
    session = enter(stand)

    status, _, body = ask(stand, "/api/catalog", session)
    assert status == 200
    assert json_of(body)["total"] == 1

    status, _, body = ask(stand, "/api/session", session)
    assert json_of(body)["user"] == {
        "sub": "user-1",
        "email": "user@reckue.com",
        "name": "Пользователь Reckue",
    }


def test_exchange_sends_verifier_and_client_secret(stand, provider_plan, settings):
    """На token-эндпоинт уходит verifier, а клиент представляется basic'ом."""
    enter(stand)
    form = provider_plan["token_form"]
    assert form["grant_type"] == "authorization_code"
    assert form["code"] == "code-1"
    assert form["redirect_uri"] == settings.redirect_uri
    assert auth.challenge_of(form["code_verifier"])  # verifier пришёл целиком
    pair = f"{settings.client_id}:{settings.client_secret}".encode()
    assert provider_plan["token_auth"] == "Basic " + base64.b64encode(pair).decode()
    # Секрет клиента в теле запроса не дублируется.
    assert "client_secret" not in form


def test_logout_forgets_session_and_goes_to_provider(stand, issuer):
    """Выход снимает свою куку и ведёт закрывать сессию у провайдера."""
    session = enter(stand)
    status, headers, _ = ask(stand, auth.LOGOUT_PATH, session)
    assert status == 302
    assert headers["Location"].startswith(f"{issuer}/session/end")
    assert cookies_of(headers)[auth.SESSION_COOKIE] == ""

    # Кука, которую вернул выход, больше не пускает.
    status, _, _ = ask(stand, "/api/catalog", {auth.SESSION_COOKIE: ""})
    assert status == 401


# --- подделки ------------------------------------------------------------------


def test_callback_refuses_foreign_state(stand):
    """Чужой `code` с чужим `state` -- это CSRF на входе, а не вход."""
    status, headers, _ = ask(stand, auth.LOGIN_PATH)
    flow = cookies_of(headers)[auth.FLOW_COOKIE]
    status, _, body = ask(
        stand,
        f"{auth.CALLBACK_PATH}?code=code-1&state=forged",
        {auth.FLOW_COOKIE: flow},
    )
    assert status == 400
    assert "state" in body.decode("utf-8")


def test_callback_without_flow_cookie_refused(stand):
    """Без куки начатого входа сверять `state` не с чем."""
    status, _, _ = ask(stand, f"{auth.CALLBACK_PATH}?code=code-1&state=whatever")
    assert status == 400


def test_provider_error_is_shown_not_swallowed(stand):
    """Отказ провайдера виден человеку, а не превращается в пустой экран."""
    status, _, body = ask(stand, f"{auth.CALLBACK_PATH}?error=access_denied")
    assert status == 400
    assert "access_denied" in body.decode("utf-8")


def test_session_cookie_cannot_be_forged(stand):
    """Подпись куки -- единственное, что делает её сессией."""
    payload = {"sub": "самозванец", "exp": time.time() + 3600}
    forged = auth.seal(payload, b"y" * 32)  # не тот секрет
    status, _, _ = ask(stand, "/api/catalog", {auth.SESSION_COOKIE: forged})
    assert status == 401


def test_expired_session_cookie_refused(stand, settings):
    payload = {"sub": "user-1", "exp": time.time() - 1}
    stale = auth.seal(payload, settings.secret)
    status, _, _ = ask(stand, "/api/catalog", {auth.SESSION_COOKIE: stale})
    assert status == 401


def test_id_token_signed_by_another_key_refused(stand, provider_plan):
    """Токен, подписанный не ключом провайдера, входом не считается."""
    provider_plan["sign_n"] = _OTHER_N
    provider_plan["sign_d"] = _OTHER_D
    status, headers, _ = ask(stand, auth.LOGIN_PATH)
    flow = cookies_of(headers)[auth.FLOW_COOKIE]
    state = urllib.parse.parse_qs(
        urllib.parse.urlsplit(headers["Location"]).query
    )["state"][0]
    status, _, body = ask(
        stand,
        f"{auth.CALLBACK_PATH}?code=code-1&state={state}",
        {auth.FLOW_COOKIE: flow},
    )
    assert status == 400
    assert "подпись" in body.decode("utf-8")


def test_unsigned_id_token_refused(stand, provider_plan):
    """`alg: none` -- самый дешёвый способ войти кем угодно, если его принять."""
    provider_plan["header"] = {"alg": "none"}
    status, headers, _ = ask(stand, auth.LOGIN_PATH)
    flow = cookies_of(headers)[auth.FLOW_COOKIE]
    state = urllib.parse.parse_qs(
        urllib.parse.urlsplit(headers["Location"]).query
    )["state"][0]
    status, _, body = ask(
        stand,
        f"{auth.CALLBACK_PATH}?code=code-1&state={state}",
        {auth.FLOW_COOKIE: flow},
    )
    assert status == 400
    assert "RS256" in body.decode("utf-8")


def test_id_token_for_another_client_refused(stand, provider_plan):
    provider_plan["claims"] = {"aud": "другое-приложение"}
    status, headers, _ = ask(stand, auth.LOGIN_PATH)
    flow = cookies_of(headers)[auth.FLOW_COOKIE]
    state = urllib.parse.parse_qs(
        urllib.parse.urlsplit(headers["Location"]).query
    )["state"][0]
    status, _, body = ask(
        stand,
        f"{auth.CALLBACK_PATH}?code=code-1&state={state}",
        {auth.FLOW_COOKIE: flow},
    )
    assert status == 400
    assert "другому приложению" in body.decode("utf-8")


def test_expired_id_token_refused(stand, provider_plan):
    now = int(time.time())
    provider_plan["claims"] = {"iat": now - 7200, "exp": now - 3600}
    status, headers, _ = ask(stand, auth.LOGIN_PATH)
    flow = cookies_of(headers)[auth.FLOW_COOKIE]
    state = urllib.parse.parse_qs(
        urllib.parse.urlsplit(headers["Location"]).query
    )["state"][0]
    status, _, body = ask(
        stand,
        f"{auth.CALLBACK_PATH}?code=code-1&state={state}",
        {auth.FLOW_COOKIE: flow},
    )
    assert status == 400
    assert "срок" in body.decode("utf-8")


def test_discovery_with_other_issuer_refused(stand, provider_plan):
    """Если discovery называет себя не тем, дальше идти нельзя."""
    provider_plan["issuer_says"] = "https://кто-то-другой"
    status, _, body = ask(stand, auth.LOGIN_PATH)
    assert status == 400
    assert "issuer" in body.decode("utf-8")


# --- проверка подписи как таковая ---------------------------------------------


def test_rsa_verify_accepts_own_signature():
    signed = "сообщение".encode()
    size = (_N.bit_length() + 7) // 8
    digest = hashlib.sha256(signed).digest()
    prefix = bytes.fromhex("3031300d060960864801650304020105000420")
    block = (
        b"\x00\x01"
        + b"\xff" * (size - 3 - len(prefix) - len(digest))
        + b"\x00"
        + prefix
        + digest
    )
    signature = pow(int.from_bytes(block, "big"), _D, _N).to_bytes(size, "big")
    assert auth.rsa_verify(_N, _E, signature, signed)
    assert not auth.rsa_verify(_N, _E, signature, "другое сообщение".encode())


def test_rsa_verify_refuses_short_signature():
    """Подпись не того размера -- не подпись, а не «почти подходит»."""
    assert not auth.rsa_verify(_N, _E, b"\x01\x02", "сообщение".encode())


# --- настройки ----------------------------------------------------------------


def test_settings_absent_means_login_not_configured():
    """Пустое окружение -- обычный запуск на своей машине, а не поломка."""
    assert auth.Settings.from_env({}) is None


def test_settings_refuse_half_configuration():
    """Половина настроек хуже их отсутствия: «вход включён» было бы неправдой."""
    with pytest.raises(auth.AuthError) as failure:
        auth.Settings.from_env({"VNL_OIDC_ISSUER": "https://auth.reckue.com"})
    assert "VNL_OIDC_CLIENT_ID" in str(failure.value)


def test_settings_refuse_short_session_secret():
    with pytest.raises(auth.AuthError):
        auth.Settings.from_env(
            {
                "VNL_OIDC_ISSUER": "https://auth.reckue.com",
                "VNL_OIDC_CLIENT_ID": "id",
                "VNL_OIDC_CLIENT_SECRET": "secret",
                "VNL_OIDC_REDIRECT_URI": "https://vnl.reckue.com/auth/callback",
                "VNL_SESSION_SECRET": "коротко",
            }
        )


def test_https_redirect_uri_turns_on_secure_cookies():
    """На проде куки уходят только по https -- это следствие адреса возврата."""
    common = {
        "VNL_OIDC_ISSUER": "https://auth.reckue.com",
        "VNL_OIDC_CLIENT_ID": "id",
        "VNL_OIDC_CLIENT_SECRET": "secret",
        "VNL_SESSION_SECRET": "s" * 32,
    }
    prod = auth.Settings.from_env(
        {**common, "VNL_OIDC_REDIRECT_URI": "https://vnl.reckue.com/auth/callback"}
    )
    local = auth.Settings.from_env(
        {**common, "VNL_OIDC_REDIRECT_URI": "http://127.0.0.1:8765/auth/callback"}
    )
    assert prod is not None and local is not None
    assert prod.secure_cookies
    assert not local.secure_cookies


# --- без входа всё как было ----------------------------------------------------


def test_without_provider_stand_answers_as_before(tmp_path):
    """Ненастроенный вход не должен закрывать запуск на своей машине."""
    Store(tmp_path).save_pattern(ffi_pattern())
    server = create_server(tmp_path, port=0, quiet=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        status, _, body = ask(base, "/api/catalog")
        assert status == 200
        assert json_of(body)["total"] == 1
        # Интерфейс по этому ответу понимает, что кнопка входа не нужна.
        status, _, body = ask(base, "/api/session")
        assert json_of(body) == {"user": None, "login": None, "required": False}
        # Шагов входа при ненастроенном входе нет.
        status, _, _ = ask(base, auth.LOGIN_PATH)
        assert status == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
