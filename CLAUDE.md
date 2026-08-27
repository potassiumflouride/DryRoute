# CLAUDE.md

This file provides repository guidance for coding agents working on DryRoute.

## Architecture

DryRoute is organized as independent top-level services:

- `frontend/` — TypeScript, Vite, MapLibre GL SPA
- `backend/` — Python FastAPI package `dryroute_api`, managed with `uv`
- `geo_encoding/` — Python FastAPI gateway (`geo_encoding_gateway`) in front of OneMap: owns OneMap token auth/refresh and rate limiting
- `tiles/` — PMTiles serving and Singapore/West Malaysia extract scripts
- `valhalla/` — independent routing-service boundary
- `lambda-radar-ingest/` — containerized AWS Lambda that archives NEA rain radar frames to S3
- `infra/` — cross-service orchestration only

Services communicate only through network APIs and never import each other's source. `lambda-radar-ingest/src/radar_ingest/nea_client.py` is a deliberate self-contained copy of the NEA request/retry pattern in `backend/src/dryroute_api/radar`, not a shared dependency. There is no root pnpm workspace or Turbo configuration; run tools from the relevant service directory.

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

## Radar Ingest

```bash
cd lambda-radar-ingest
uv sync --frozen
uv run pytest
uv run ruff check .
```

Polls NEA's `data.gov.sg` weather-radar-images API every 2 minutes on an EventBridge schedule (NEA publishes new frames every 5 minutes) and uploads each frame's image and raw JSON to a public-read S3 bucket, partitioned by NEA's own frame timestamp. Idempotent per frame. Deployment is manual (ECR + Lambda console), not the `template.yaml`/SAM files present in the directory; see `lambda-radar-ingest/README.md` before changing IAM, schedule, or deploy steps. `frontend/src/radar.ts` polls the same bucket on a matching cadence; if the Lambda's schedule interval changes, check whether the frontend's poll interval should move with it.

`scripts/fetch_today_radar.py` is an ad-hoc backfill script that reuses `lambda-radar-ingest`'s fetch/upload logic to bulk-load a day's frames; run it with `uv run --project lambda-radar-ingest python scripts/fetch_today_radar.py [YYYY-MM-DD]`.

## Boundaries

- Services communicate through network APIs, not source imports or shared filesystems.
- Service-specific build and startup assets belong with that service.
- `infra/` may reference services; services must not depend on files under `infra/`.
- Secrets and generated datasets are never committed.
