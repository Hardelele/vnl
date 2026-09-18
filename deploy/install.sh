#!/usr/bin/env bash
# Установка VNL без docker: пользователь, окружение Python, сборка интерфейса,
# служба systemd. Запускать от root из корня проекта:
#
#   sudo git clone <репозиторий> /opt/vnl
#   sudo bash /opt/vnl/deploy/install.sh
#
# Тот же скрипт годится для обновления: он переустанавливает пакет, пересобирает
# интерфейс и перезапускает службу, а хранилище не трогает вообще. Перед
# обновлением достаточно `git pull` в каталоге проекта.
#
# Нужны: python3 >= 3.11, node + npm (только на сборку интерфейса), systemd.
# nginx настраивается отдельно -- см. deploy/nginx.conf.example.
set -euo pipefail

APP_DIR=${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
DATA_DIR=${DATA_DIR:-/var/lib/vnl}
SERVICE=${SERVICE:-vnl}
USER_NAME=${USER_NAME:-vnl}
PORT=${PORT:-8765}

step() { printf '\n== %s\n' "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "нужен root: sudo $0" >&2; exit 1; }

step "проверка окружения"
command -v python3 >/dev/null || { echo "нет python3" >&2; exit 1; }
python3 - <<'PY' || exit 1
import sys
if sys.version_info < (3, 11):
    sys.exit(f"нужен Python >= 3.11, а здесь {sys.version.split()[0]}")
PY
command -v npm >/dev/null || { echo "нет npm: интерфейс нечем собрать" >&2; exit 1; }
echo "python3 $(python3 -c 'import sys;print(sys.version.split()[0])'), npm $(npm --version)"

step "пользователь $USER_NAME"
# Системный, без оболочки и без пароля: под ним ничего, кроме службы, не запускают.
id -u "$USER_NAME" >/dev/null 2>&1 ||
    useradd --system --user-group --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$USER_NAME"
chown -R "$USER_NAME:$USER_NAME" "$APP_DIR"

step "хранилище $DATA_DIR"
# Данные живут вне кода и переживают выкладку: каталог создаётся один раз, и
# содержимое его никто здесь не касается.
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0750 "$DATA_DIR"

step "окружение python"
# Зависимостей у ядра нет, поэтому venv маленький и ставится быстро.
# Установка editable (-e): после `git pull` код Python обновляется сам, и
# обновление сводится к перезапуску службы плюс пересборке интерфейса. В образе
# docker наоборот -- обычная установка: там код и так неизменяемый слой.
runuser -u "$USER_NAME" -- python3 -m venv "$APP_DIR/.venv"
runuser -u "$USER_NAME" -- "$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
runuser -u "$USER_NAME" -- "$APP_DIR/.venv/bin/pip" install --quiet --upgrade -e "$APP_DIR"

step "сборка интерфейса"
# npm ci -- строго по package-lock.json: на сервере не место «почти той же»
# версии. npm run build проверяет типы (tsc -b) и кладёт результат в ui/dist.
runuser -u "$USER_NAME" -- sh -c "cd '$APP_DIR/ui' && npm ci --no-audit --no-fund && npm run build"
[ -f "$APP_DIR/ui/dist/index.html" ] || { echo "интерфейс не собрался" >&2; exit 1; }

step "служба $SERVICE"
# Пути в юните подставляются: значения по умолчанию в файле -- /opt/vnl и
# /var/lib/vnl, но установить можно и в другое место.
sed -e "s#/opt/vnl#$APP_DIR#g" \
    -e "s#/var/lib/vnl#$DATA_DIR#g" \
    -e "s#--port 8765#--port $PORT#" \
    "$APP_DIR/deploy/vnl.service" > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

step "проверка"
# Приложению нужна доля секунды на открытие сокета; ждём до пяти.
for _ in $(seq 25); do
    if python3 - "$PORT" <<'PY' 2>/dev/null
import sys, urllib.request
urllib.request.urlopen(f"http://127.0.0.1:{sys.argv[1]}/api/health", timeout=2).read()
PY
    then
        echo "служба отвечает: http://127.0.0.1:$PORT/api/health"
        cat <<EOF

Дальше -- прокси: deploy/nginx.conf.example. Без авторизации публиковать нельзя:
у приложения её нет, а его API позволяет удалять паттерны.

Хранилище: $DATA_DIR    Журнал: journalctl -u $SERVICE -f
EOF
        exit 0
    fi
    sleep 0.2
done

echo "служба не ответила на /api/health; смотреть: journalctl -u $SERVICE -n 50" >&2
exit 1
