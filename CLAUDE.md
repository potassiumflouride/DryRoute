# CLAUDE.md

This file provides repository guidance for coding agents working on DryRoute.

## Architecture

DryRoute is organized as independent top-level services:

- `frontend/` — TypeScript, Vite, MapLibre GL SPA
- `backend/` — Python FastAPI package `dryroute_api`, managed with `uv`
- `geo_encoding/` — Python FastAPI gateway (`geo_encoding_gateway`) in front of OneMap: owns OneMap token auth/refresh and rate limiting
- `tiles/` — PMTiles serving and Singapore/West Malaysia extract scripts
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

## Geo Encoding

```bash
cd geo_encoding
uv sync --frozen
uv run uvicorn geo_encoding_gateway.main:app --reload --port 8090
uv run ruff check .
uv run pytest
```

Configuration is env-driven through `pydantic-settings`, uses the `GEO_ENCODING_` prefix, and loads `.env`. The gateway authenticates with OneMap (token refreshed proactively before its ~72-hour expiry), enforces OneMap's 250-calls/minute limit, and exposes a generic passthrough proxy at `/onemap/{path}`. `backend/`'s existing direct, unauthenticated OneMap call is not yet rewired through this gateway.

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
tiles/scripts/extract-tiles.sh
tiles/scripts/serve-pmtiles.sh
```

Both scripts require the `pmtiles` CLI. The generated archive covers Singapore and Peninsular Malaysia and lives at `tiles/data/dryroute.pmtiles`, ignored by Git. The tile endpoint remains `/dryroute/{z}/{x}/{y}.mvt` on port 8081. `tiles/Dockerfile` builds a deployment-agnostic image that bakes this archive in at build time.

## Boundaries

- Services communicate through network APIs, not source imports or shared filesystems.
- Service-specific build and startup assets belong with that service.
- `infra/` may reference services; services must not depend on files under `infra/`.
- Secrets and generated datasets are never committed.
