# DryRoute Backend

FastAPI service for geocoding, rain radar ingestion and serving, rain-aware route scoring, and Valhalla route orchestration.

## Local

```bash
uv sync --frozen
uv run uvicorn dryroute_api.main:app --reload --port 8000
uv run ruff check .
uv run pytest
```

Copy `sample.env` to `.env` and fill in real values.

## Docker

```bash
docker build -t dryroute-backend .
docker run --rm -p 8000:8000 --env-file .env dryroute-backend
```

The image installs dependencies with `uv sync --frozen` and runs a single `uvicorn` process (the radar store is process-local `app.state`, so scale by running more containers, not more workers per container). No secrets are baked in; `.env` is excluded from the build context via `.dockerignore` and must be supplied at runtime.

Runtime env vars:

- `PORT` — serving port (default `8000`). Many PaaS platforms inject this automatically.

## Configuration

Configuration uses `DRYROUTE_`-prefixed environment variables loaded from `.env` (see `sample.env` for the full list and defaults):

- `DRYROUTE_NEA_API_KEY`
- `DRYROUTE_ONEMAP_API_KEY`
- `DRYROUTE_MAPTILER_API_KEY`
- `DRYROUTE_VALHALLA_URL` — Valhalla routing service base URL.
- `DRYROUTE_RAIN_AVOIDANCE_ENABLED`
- `DRYROUTE_RAIN_ALPHA_THRESHOLD`
