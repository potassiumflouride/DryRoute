# CLAUDE.md

This file provides repository guidance for coding agents working on DryRoute.

## Architecture

DryRoute is organized as independent top-level services:

- `frontend/` — TypeScript, Vite, MapLibre GL SPA
- `backend/` — Python FastAPI package `dryroute_api`, managed with `uv`
- `tiles/` — PMTiles serving and Singapore extract scripts
- `valhalla/` — independent routing-service boundary
- `infra/` — cross-service orchestration only

There is no root pnpm workspace or Turbo configuration. Run tools from the relevant service directory.

## Backend

```bash
cd backend
uv sync --frozen
uv run uvicorn dryroute_api.main:app --reload --port 8000
uv run ruff check .
uv run pytest
```

Configuration is env-driven through `pydantic-settings`, uses the `DRYROUTE_` prefix, and loads `.env`. The API serves geocoding, route, radar-frame, and health endpoints. Routing delegates to the URL in `DRYROUTE_VALHALLA_URL`.

## Frontend

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm build
pnpm test
```

The frontend uses relative `/api` and `/tiles` URLs. Its Vite development server proxies those paths to ports 8000 and 8081. Production hosting must provide equivalent routing or proxy behavior.

Shared frontend types live in `frontend/src/types.ts`. Keep matching Python API types synchronized manually.

Design tokens live in `frontend/src/style.css`. Preserve safe-area handling and regenerate PWA PNG icons from `frontend/public/icon-source.svg` if the mark changes.

## Tiles

```bash
tiles/scripts/extract-singapore.sh
tiles/scripts/serve-pmtiles.sh
```

Both scripts require the `pmtiles` CLI. The generated archive lives at `tiles/data/singapore.pmtiles` and is ignored by Git. The tile endpoint remains `/singapore/{z}/{x}/{y}.mvt` on port 8081.

## Boundaries

- Services communicate through network APIs, not source imports or shared filesystems.
- Service-specific build and startup assets belong with that service.
- `infra/` may reference services; services must not depend on files under `infra/`.
- Secrets and generated datasets are never committed.
