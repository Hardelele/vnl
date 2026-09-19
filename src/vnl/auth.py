"""Вход через Reckue auth: OIDC authorization code + PKCE.

Зачем это здесь. У приложения не было авторизации вообще, и единственным
рубежом был basic auth на nginx -- один пароль на всех, который передают
ссылкой вместе со стендом. API при этом пишет в библиотеку, удаляет паттерны и
запускает расчёты, так что «кто вошёл» -- не украшение, а часть доступа. Своей
таблицы пользователей у инструмента нет и не будет: учётные записи живут в
Reckue auth (`https://auth.reckue.com`), а здесь -- только проверка.

Почему без зависимостей. У ядра их нет ни одной, и это свойство дороже
удобства: `pip install -e .` не тянет колёса под нужную версию Python. Поэтому
здесь свои двадцать строк проверки RS256 поверх `pow` вместо `cryptography` и
`urllib` вместо `requests`. Проверка подписи -- операция с открытым ключом,
секретной математики в ней нет.

Что происходит при входе:

1. Запрос без сессии. Страница уходит редиректом на `/auth/login`, запрос к
   `/api/...` получает 401 -- интерфейсу нужен код, а не HTML.
2. `/auth/login` создаёт `state` и PKCE-пару, кладёт их в подписанную куку на
   десять минут и отправляет браузер на `authorization_endpoint`.
3. Reckue auth спрашивает пользователя и возвращает его на `/auth/callback` с
   `code` и `state`.
4. `state` сверяется с кукой, `code` меняется на токены, подпись `id_token`
   проверяется по `jwks_uri`, а `iss`/`aud`/`exp` -- по настройкам.
5. Из токена берутся `sub`, `email`, `name` и кладутся в свою подписанную
   сессионную куку. Дальше приложение живёт на ней и к Reckue auth не ходит.

Кого пускаем. Любого, у кого есть учётная запись Reckue -- это решение
владельца (OpenProject VNL/494). Своего списка разрешённых здесь нет
намеренно: он немедленно стал бы второй базой пользователей рядом с той,
которую мы только что перестали держать.

Чего здесь нет. `refresh_token` не используется: сессия живёт своим сроком, а
по его истечении браузер снова проходит через Reckue auth -- молча, если там
сессия ещё жива. Хранить и продлевать чужие токены ради этого не стоит, поэтому
и скоуп `offline_access` не запрашивается.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

LOGIN_PATH = "/auth/login"
CALLBACK_PATH = "/auth/callback"
LOGOUT_PATH = "/auth/logout"

#: Кука сессии и кука незавершённого входа. Вторая живёт минуты и нужна только
#: между редиректом к провайдеру и возвратом обратно.
SESSION_COOKIE = "vnl_session"
FLOW_COOKIE = "vnl_login"

SESSION_TTL = 12 * 60 * 60
FLOW_TTL = 10 * 60

#: Сколько расхождения часов прощаем `exp`/`iat`. Часы на стенде и у провайдера
#: синхронизируются ntp, но ровно нулевого расхождения не бывает.
LEEWAY = 60

_TIMEOUT = 10


class AuthError(Exception):
    """Вход не удался. Текст виден пользователю, поэтому он по-русски."""


# --- куда вернуть после входа -------------------------------------------------


def safe_next(value: str | None) -> str | None:
    """Свой адрес возврата или `None`, если предложенному верить нельзя.

    Куда идти после входа, говорит запрос -- человек нажал на песочницу, а не
    на «войти», и вернуть его на главную значило бы потерять то, ради чего он
    входил. Но значение приходит из адресной строки, то есть от кого угодно, и
    без разбора оно превращается в открытый перенаправитель: ссылка на наш
    домен, уводящая на чужой сайт после входа.

    Поэтому пропускаем только путь внутри этого приложения: одна ведущая
    косая черта и никакой схемы, хоста, обратной косой (её часть браузеров
    читает как прямую) и переводов строки. Всё остальное -- не адрес возврата,
    и разговаривать о нём не о чем: `None`, дальше будет корень.
    """
    if not value or not value.startswith("/") or value.startswith("//"):
        return None
    if len(value) > 512:
        return None
    if any(ord(ch) < 0x20 or ch == "\\" for ch in value):
        return None
    return value


# --- подписанные куки ---------------------------------------------------------
#
# Кука подписывается HMAC-SHA256 на секрете службы, а не шифруется: её
# содержимое (кто вошёл и до какого времени) не тайна, подделка -- вот что
# недопустимо. Шифрование добавило бы работы и ничего бы не закрыло.


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def seal(payload: dict[str, Any], secret: bytes) -> str:
    """Значение куки: полезная часть и подпись через точку."""
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    mac = hmac.new(secret, body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64(mac)}"


def unseal(
    value: str, secret: bytes, now: float | None = None
) -> dict[str, Any] | None:
    """Разбор куки. `None` -- подделка, мусор или истёкший срок.

    Отличать «подделали» от «просрочено» снаружи незачем: ответ в обоих случаях
    один -- пройти вход заново.
    """
    body, _, signature = value.partition(".")
    if not body or not signature:
        return None
    expected = hmac.new(secret, body.encode("ascii"), hashlib.sha256).digest()
    try:
        if not hmac.compare_digest(expected, _unb64(signature)):
            return None
        payload = json.loads(_unb64(body).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    expires = payload.get("exp")
    if not isinstance(expires, (int, float)):
        return None
    if (time.time() if now is None else now) > expires:
        return None
    return payload


# --- проверка подписи RS256 ---------------------------------------------------

#: DigestInfo для SHA-256 из RFC 8017 (приложение B.1): им начинается
#: содержимое блока PKCS#1 v1.5 после набивки.
_SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


def rsa_verify(modulus: int, exponent: int, signature: bytes, message: bytes) -> bool:
    """Проверка RSASSA-PKCS1-v1_5 с SHA-256 на голом `pow`.

    Восстановленный блок сверяется целиком, а не «ищем в хвосте хеш»: набивка
    тоже часть подписи, и пропускать её -- известный способ принять чужое.
    """
    size = (modulus.bit_length() + 7) // 8
    if len(signature) != size:
        return False
    block = pow(int.from_bytes(signature, "big"), exponent, modulus).to_bytes(
        size, "big"
    )
    digest = hashlib.sha256(message).digest()
    padding = size - 3 - len(_SHA256_PREFIX) - len(digest)
    if padding < 8:  # RFC 8017 требует не меньше восьми байт 0xff
        return False
    expected = b"\x00\x01" + b"\xff" * padding + b"\x00" + _SHA256_PREFIX + digest
    return hmac.compare_digest(block, expected)


def verify_id_token(
    token: str,
    keys: list[dict[str, Any]],
    issuer: str,
    audience: str,
    now: float | None = None,
) -> dict[str, Any]:
    """Разбор и проверка `id_token`: claims или `AuthError`.

    Проверяется всё, на что этот токен даёт право: подпись, кто выдал, кому
    выдал и не истёк ли. `alg` из заголовка служит только выбором ветки --
    ничего, кроме RS256, не принимается, иначе подделка сводилась бы к
    `{"alg": "none"}`.
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise AuthError("id_token не из трёх частей")
    try:
        header = json.loads(_unb64(parts[0]).decode("utf-8"))
        claims = json.loads(_unb64(parts[1]).decode("utf-8"))
        signature = _unb64(parts[2])
    except (ValueError, UnicodeDecodeError) as exc:
        raise AuthError(f"id_token не разобран: {exc}") from exc
    if not isinstance(header, dict) or not isinstance(claims, dict):
        raise AuthError("id_token без объектов заголовка и claims")
    if header.get("alg") != "RS256":
        raise AuthError(f"подпись {header.get('alg')!r} не принимается, нужен RS256")

    signed = f"{parts[0]}.{parts[1]}".encode("ascii")
    kid = header.get("kid")
    # kid сужает выбор, но его отсутствие -- не отказ: ключ может быть один.
    usable = [
        key for key in keys if kid is None or key.get("kid") in (None, kid)
    ] or keys
    for key in usable:
        if key.get("kty") != "RSA" or not key.get("n") or not key.get("e"):
            continue
        modulus = int.from_bytes(_unb64(key["n"]), "big")
        exponent = int.from_bytes(_unb64(key["e"]), "big")
        if rsa_verify(modulus, exponent, signature, signed):
            break
    else:
        raise AuthError("подпись id_token не сошлась ни с одним ключом провайдера")

    if claims.get("iss") != issuer:
        raise AuthError(f"id_token выдан не тем, кем ожидали: {claims.get('iss')!r}")
    got = claims.get("aud")
    audiences = got if isinstance(got, list) else [got]
    if audience not in audiences:
        raise AuthError("id_token выдан другому приложению")
    moment = time.time() if now is None else now
    expires = claims.get("exp")
    if not isinstance(expires, (int, float)) or moment > expires + LEEWAY:
        raise AuthError("срок id_token истёк")
    issued = claims.get("iat")
    if isinstance(issued, (int, float)) and issued > moment + LEEWAY:
        raise AuthError("id_token выдан в будущем")
    return claims


# --- настройки ----------------------------------------------------------------


@dataclass(frozen=True)
class Settings:
    """Что нужно знать о провайдере и о себе.

    `redirect_uri` задаётся значением, а не собирается из заголовка `Host`, и
    это не перестраховка: nginx ходит сюда с `Host: localhost` (иначе
    приложение отвечает 403), так что собранный из запроса адрес указывал бы на
    localhost -- и вход ломался бы ровно в проде.
    """

    issuer: str
    client_id: str
    client_secret: str
    redirect_uri: str
    secret: bytes
    session_ttl: int = SESSION_TTL

    @property
    def secure_cookies(self) -> bool:
        """`Secure` ставится по схеме адреса возврата: на http его нельзя."""
        return self.redirect_uri.startswith("https://")

    @classmethod
    def from_env(cls, env: dict[str, str]) -> Settings | None:
        """Настройки из окружения. `None` -- вход не настроен.

        Отсутствие настроек -- обычный режим запуска на своей машине, где
        сервер слушает 127.0.0.1 и закрыт тем, что до него никто не дотянется.
        Поэтому `None`, а не отказ: требовать OIDC для `vnl serve` на ноутбуке
        значило бы сделать инструмент бесполезным без интернета. А вот
        половинчатой настройки не бывает -- либо все пять значений, либо ни
        одного, иначе «вход включён» оказалось бы неправдой.
        """
        names = (
            "VNL_OIDC_ISSUER",
            "VNL_OIDC_CLIENT_ID",
            "VNL_OIDC_CLIENT_SECRET",
            "VNL_OIDC_REDIRECT_URI",
            "VNL_SESSION_SECRET",
        )
        given = [(env.get(name) or "").strip() for name in names]
        if not any(given):
            return None
        missing = [name for name, value in zip(names, given) if not value]
        if missing:
            raise AuthError("вход настроен не полностью, нет: " + ", ".join(missing))
        issuer, client_id, client_secret, redirect_uri, secret = given
        if len(secret) < 32:
            raise AuthError("VNL_SESSION_SECRET короче 32 символов")
        return cls(
            issuer=issuer.rstrip("/"),
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            secret=secret.encode("utf-8"),
        )


# --- провайдер ----------------------------------------------------------------


@dataclass(frozen=True)
class Endpoints:
    authorization: str
    token: str
    jwks: str
    end_session: str | None


class Provider:
    """Провайдер OIDC: адреса из discovery и ключи из jwks.

    И то и другое читается по первому требованию и запоминается: адреса между
    запросами не меняются, а поход за ними на каждый вход добавил бы лишнюю
    задержку и лишнюю причину отказа. Ключи перечитываются, если попался
    незнакомый `kid` -- так их ротация у провайдера переживается без
    перезапуска службы.
    """

    def __init__(self, settings: Settings, opener: Any = None) -> None:
        self.settings = settings
        # Подменяется в тестах, где провайдер -- свой сервер на localhost.
        self._open = opener or self._fetch
        self._lock = threading.Lock()
        self._endpoints: Endpoints | None = None
        self._keys: list[dict[str, Any]] | None = None

    # --- сеть -----------------------------------------------------------

    @staticmethod
    def _fetch(
        url: str, data: bytes | None = None, headers: dict[str, str] | None = None
    ) -> dict[str, Any]:
        request = urllib.request.Request(url, data=data, headers=headers or {})
        try:
            with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:200]
            raise AuthError(f"провайдер ответил {exc.code}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise AuthError(f"провайдер недоступен: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise AuthError(f"провайдер ответил не JSON: {exc}") from exc

    def endpoints(self) -> Endpoints:
        with self._lock:
            if self._endpoints is None:
                url = f"{self.settings.issuer}/.well-known/openid-configuration"
                found = self._open(url)
                if found.get("issuer") != self.settings.issuer:
                    raise AuthError(
                        f"discovery отдал issuer {found.get('issuer')!r}, "
                        f"а настроен {self.settings.issuer!r}"
                    )
                for field in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
                    if not found.get(field):
                        raise AuthError(f"discovery без {field}")
                self._endpoints = Endpoints(
                    authorization=found["authorization_endpoint"],
                    token=found["token_endpoint"],
                    jwks=found["jwks_uri"],
                    end_session=found.get("end_session_endpoint"),
                )
            return self._endpoints

    def keys(self, refresh: bool = False) -> list[dict[str, Any]]:
        jwks = self.endpoints().jwks
        with self._lock:
            if self._keys is None or refresh:
                found = self._open(jwks)
                keys = found.get("keys")
                if not isinstance(keys, list) or not keys:
                    raise AuthError("jwks без ключей")
                self._keys = keys
            return self._keys

    # --- шаги входа -----------------------------------------------------

    def authorize_url(self, state: str, verifier: str) -> str:
        """Адрес, на который уходит браузер.

        PKCE здесь обязателен: провайдер объявляет только `S256`, и это
        правильно -- без него перехваченный `code` меняется на токены любым,
        кто его перехватил.
        """
        query = urllib.parse.urlencode(
            {
                "client_id": self.settings.client_id,
                "redirect_uri": self.settings.redirect_uri,
                "response_type": "code",
                "scope": "openid profile email",
                "state": state,
                "code_challenge": challenge_of(verifier),
                "code_challenge_method": "S256",
            }
        )
        return f"{self.endpoints().authorization}?{query}"

    def exchange(self, code: str, verifier: str) -> dict[str, Any]:
        """Обмен `code` на токены.

        Клиент представляется basic-заголовком: он есть в списке
        поддерживаемых и не оставляет секрет в теле запроса.
        """
        body = urllib.parse.urlencode(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.settings.redirect_uri,
                "code_verifier": verifier,
            }
        ).encode("ascii")
        pair = f"{self.settings.client_id}:{self.settings.client_secret}"
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": "Basic "
            + base64.b64encode(pair.encode("utf-8")).decode("ascii"),
            "Accept": "application/json",
        }
        tokens = self._open(self.endpoints().token, body, headers)
        if not tokens.get("id_token"):
            raise AuthError("провайдер не отдал id_token")
        return tokens

    def claims(self, id_token: str, now: float | None = None) -> dict[str, Any]:
        """Проверенные claims: сперва на кэше ключей, при неудаче -- на свежих."""
        try:
            return verify_id_token(
                id_token,
                self.keys(),
                self.settings.issuer,
                self.settings.client_id,
                now,
            )
        except AuthError:
            return verify_id_token(
                id_token,
                self.keys(refresh=True),
                self.settings.issuer,
                self.settings.client_id,
                now,
            )

    def logout_url(self, id_token: str | None) -> str | None:
        """Адрес выхода у провайдера, если он его объявляет.

        Без этого шага «выйти» означало бы только забыть свою куку: сессия в
        Reckue auth осталась бы, и следующий вход прошёл бы молча -- на общем
        компьютере это выглядит как «выход не работает».
        """
        end = self.endpoints().end_session
        if not end:
            return None
        query = {"client_id": self.settings.client_id}
        if id_token:
            query["id_token_hint"] = id_token
        return f"{end}?{urllib.parse.urlencode(query)}"


# --- PKCE ---------------------------------------------------------------------


def new_verifier() -> str:
    """`code_verifier` из RFC 7636: 43-128 символов безопасного алфавита."""
    return _b64(secrets.token_bytes(32))


def challenge_of(verifier: str) -> str:
    return _b64(hashlib.sha256(verifier.encode("ascii")).digest())


def new_state() -> str:
    return _b64(secrets.token_bytes(16))


# --- сессия -------------------------------------------------------------------


@dataclass(frozen=True)
class Session:
    """Кто вошёл. Ровно то, что нужно показать в панели и записать в лог."""

    sub: str
    email: str | None = None
    name: str | None = None

    def as_payload(self) -> dict[str, Any]:
        return {"sub": self.sub, "email": self.email, "name": self.name}

    @classmethod
    def of(cls, claims: dict[str, Any]) -> Session:
        sub = claims.get("sub")
        if not sub:
            raise AuthError("id_token без sub -- непонятно, кто вошёл")
        return cls(
            sub=str(sub),
            email=claims.get("email"),
            name=claims.get("name"),
        )
