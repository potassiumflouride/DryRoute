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

On startup, the app builds a process-local `RadarStore` (`app.state`), backfills it with recent radar frames, and keeps it updated with a background `refresh_loop` task, so the first request after boot may briefly see thinner radar data.

## API

- `GET /geocode` — address/place search.
- `GET /route` — routes between waypoints for a given travel `mode`, with rain-crossing segments (`rainSegments`) flagged per leg.
- `GET /radar/frames` — available radar frame metadata.
- `GET /radar/frames/{timestamp}.png` — a single radar frame image.
- `GET /healthz` — health check.

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

- `DRYROUTE_NEA_API_KEY` — declared but not currently read anywhere in `src/`; reserved for future NEA API use.
- `DRYROUTE_ONEMAP_API_KEY` — declared but not currently read anywhere in `src/`. `geocoding/__init__.py` calls OneMap's public search endpoint directly and unauthenticated instead, so this key is not wired up yet (see `geo_encoding/README.md` for the intended fix: routing `/geocode` through the `geo_encoding` gateway instead).
- `DRYROUTE_MAPTILER_API_KEY` — declared but not currently read anywhere in `src/`; reserved for future use.
- `DRYROUTE_VALHALLA_URL` — Valhalla routing service base URL. Defaults to the public, shared `https://valhalla1.openstreetmap.de` instance, not a self-hosted one; see `valhalla/README.md`.
- `DRYROUTE_RAIN_AVOIDANCE_ENABLED`
- `DRYROUTE_RAIN_ALPHA_THRESHOLD`
