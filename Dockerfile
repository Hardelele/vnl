# Образ VNL: сборка интерфейса на node, запуск на python.
#
# Две ступени, потому что node нужен только на сборку. В готовом образе его нет
# -- там лежат Python, код ядра и готовый `ui/dist`, который сервер отдаёт сам.
#
# Хранилище (`patterns/`, `sandboxes/`) в образ не попадает никогда: это данные,
# они живут в томе на /var/lib/vnl и переживают выкладку нового образа.

# --- ступень 1: интерфейс -------------------------------------------------
FROM node:22-alpine AS ui

WORKDIR /build

# Сначала только манифесты: слой с npm ci переживает правку исходников
# интерфейса и не пересобирается на каждый коммит.
COPY ui/package.json ui/package-lock.json ./ui/
RUN cd ui && npm ci

# Токены дизайн-системы лежат вне ui/: vite разрешает их через алиас @design
# (см. ui/vite.config.ts), поэтому в контекст сборки каталог нужен целиком.
COPY design/ ./design/
COPY ui/ ./ui/

# `npm run build` -- это `tsc -b && vite build`: типы проверяются на сборке, и
# сломанный интерфейс не доедет до образа молча.
RUN cd ui && npm run build

# --- ступень 2: приложение ------------------------------------------------
FROM python:3.12-slim AS app

# PYTHONUNBUFFERED -- чтобы логи приложения появлялись в `docker logs` сразу,
# а не после того, как заполнится буфер.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Непривилегированный пользователь с фиксированным uid: том, созданный docker'ом
# по этому образу, унаследует владельца каталога /var/lib/vnl, и приложению не
# придётся получать право на запись через root.
RUN useradd --system --uid 10001 --user-group --no-create-home vnl

WORKDIR /app

# У ядра нет зависимостей, поэтому отдельного слоя под requirements нет: весь
# `pip install` -- это сам пакет.
COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir .

COPY --from=ui /build/ui/dist ./ui/dist

# Каталог тома готовится в образе, чтобы владелец у свежего тома был правильный.
RUN install -d -o vnl -g vnl -m 0750 /var/lib/vnl

ENV VNL_ROOT=/var/lib/vnl \
    VNL_UI=/app/ui/dist \
    VNL_PORT=8765 \
    VNL_BIND=0.0.0.0

VOLUME ["/var/lib/vnl"]
EXPOSE 8765

USER vnl

# Проверка изнутри контейнера: снаружи порт может быть закрыт намеренно.
# curl в slim-образе нет, а Python есть -- он же и проверяет.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8765/api/health',timeout=4).read()"]

# `--bind 0.0.0.0` нужен ровно здесь: внутри контейнера 127.0.0.1 -- его
# собственный loopback, до которого опубликованный порт не доходит. «Только со
# своей машины» держат публикация порта на loopback хоста и проверка заголовка
# Host -- она работает при любом адресе.
CMD ["vnl", "serve", \
     "--bind", "0.0.0.0", \
     "--port", "8765", \
     "--root", "/var/lib/vnl", \
     "--ui", "/app/ui/dist", \
     "--quiet"]
