# syntax=docker/dockerfile:1

########################
# Stage 1: build the venv
########################
FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /usr/local/bin/uv

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Install dependencies first, separately from project source, for layer caching.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src/ ./src/
COPY README.md ./README.md
RUN uv sync --frozen --no-dev

########################
# Stage 2: minimal runtime
########################
FROM python:3.12-slim AS runtime

RUN useradd --create-home --shell /usr/sbin/nologin dryroute

WORKDIR /app
COPY --from=builder --chown=dryroute:dryroute /app/.venv /app/.venv
COPY --from=builder --chown=dryroute:dryroute /app/src /app/src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER dryroute

ENV PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD .venv/bin/python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/healthz')" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
