# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DryRoute is a route-planning app for Singapore that avoids rain: it geocodes an origin/destination (OneMap), computes candidate routes for foot/bicycle/motorcycle (OSRM), scores them against live rain radar/NEA weather data, and serves the result via a FastAPI backend to a self-hosted-basemap MapLibre web frontend. Routing (`osrm`) and rain-scoring (`radar`, `scoring`) are still empty stub packages; geocoding is implemented, and the frontend map/search shell is functional.

## Monorepo layout

`pnpm` workspaces + `turbo` orchestrate three apps and shared packages (`pnpm-workspace.yaml`: `apps/*`, `packages/*`):

- `apps/api` — Python FastAPI backend (package `dryroute_api`), managed with `uv`.
- `apps/web` — TypeScript + Vite + MapLibre GL frontend (no framework — plain DOM, `main.ts` + `search.ts`).
- `apps/tiles` — not a real Node app; its `dev` script just execs `infra/osm/scripts/serve-pmtiles.sh` so the self-hosted tile server starts alongside `web`/`api` under one `pnpm dev`/turbo run. Has no `build`/`lint`/`test` scripts, so turbo skips it for those tasks.
- `packages/shared-types` — TS types shared across the workspace (`TravelMode`, `GeocodeResult`).
- `packages/eslint-config`, `packages/tsconfig` — shared lint/TS config consumed via `workspace:*`.

Root `package.json` scripts (`dev`, `build`, `lint`, `test`) fan out to `turbo run <task>` (`turbo.json`): `build` depends on upstream builds; `test` depends on `build`; a package only participates in a task if it defines that script (e.g. `apps/tiles` has no `build`, so it's silently skipped, not an error).

## Commands

Run from repo root unless noted. `pnpm --filter <name> <script>` targets one workspace package.

```bash
pnpm install   # installs Node workspaces only — does not install Python deps or the pmtiles CLI
pnpm dev       # turbo run dev — starts web (:5173), api (:8000), and tiles (:8081) together
pnpm build     # turbo run build
pnpm lint      # turbo run lint
pnpm test      # turbo run test (build runs first)
```

### API (`apps/api`) — uv-managed Python, package `dryroute_api`

```bash
cd apps/api
uv sync --frozen                                      # install deps (turbo's "build" task)
uv run uvicorn dryroute_api.main:app --reload --port 8000
uv run pytest                                          # all tests
uv run pytest tests/test_healthz.py -k test_healthz    # single test
uv run ruff check .                                    # lint
```

Config is env-driven via `pydantic-settings` (`dryroute_api/config.py`), prefix `DRYROUTE_`, loaded from `.env` (e.g. `DRYROUTE_NEA_API_KEY`, `DRYROUTE_OSRM_FOOT_URL`). Note: OneMap's basic search endpoint (used by `geocoding`) works unauthenticated — `onemap_api_key` is currently unused.

### Web (`apps/web`) — Vite + TypeScript, no test runner configured yet

```bash
cd apps/web
pnpm dev        # vite, port 5173
pnpm build      # tsc --noEmit && vite build
pnpm lint       # eslint .
pnpm preview    # serve the production build (needed to see PWA manifest/service worker — vite dev doesn't inject them)
```

### Tile server (`apps/tiles` / `infra/osm/`)

The basemap is fully self-hosted: OSM vector tiles come from a Protomaps PMTiles archive, not a third-party hosted style.

```bash
infra/osm/scripts/extract-singapore.sh   # one-time/refresh: extracts infra/data/osm/singapore.pmtiles
                                          # from Protomaps' daily global build via HTTP range requests
infra/osm/scripts/serve-pmtiles.sh       # serves it on :8081 (also what `pnpm --filter @dryroute/tiles dev` runs)
```

Both scripts require the `go-pmtiles` CLI (`pmtiles` on PATH — prebuilt binaries at github.com/protomaps/go-pmtiles/releases, no Go toolchain needed). `infra/data/` is gitignored — the `.pmtiles` file is regenerable, not tracked. `pmtiles serve` exposes plain `{z}/{x}/{y}.mvt` tile endpoints (not raw-file byte-range serving) at `/<archive-name>/{z}/{x}/{y}.mvt`.

## Architecture notes

- **Tile/API proxying in dev**: `apps/web/vite.config.ts` proxies `/tiles` → `http://localhost:8081` (tile server) and `/api` → `http://localhost:8000` (FastAPI). The frontend always calls relative `/tiles/...` and `/api/...` paths — never the raw ports — so the same code works through the dev proxy and through an external tunnel (e.g. ngrok) pointed at :5173 alone.
- **Map style**: `apps/web/src/main.ts` builds the MapLibre style by hand (not a style URL) using `@protomaps/basemaps`'s `layers(source, namedFlavor("dark"), opts)` against the self-hosted vector source. Note the package is `@protomaps/basemaps` — `protomaps-themes-base` is the deprecated predecessor; don't reintroduce it.
- **Search**: `apps/web/src/search.ts` debounces input, hits `/api/geocode?q=...`, renders a results dropdown, and on selection calls `map.flyTo()` + drops a `maplibregl.Marker`. Backend side, `dryroute_api/geocoding/__init__.py` proxies to OneMap's `elastic/search` API and normalizes results into `GeocodeResult` (mirrored in `packages/shared-types` for the frontend, even though the two aren't type-shared across the language boundary — keep both in sync by hand).
- **OSRM**: `apps/api` config assumes three *separate* OSRM instances (foot/bicycle/motorcycle at distinct ports, `config.py`), not one multi-profile instance — routing code needs to pick the right base URL per `TravelMode`.
- **Design tokens**: `apps/web/src/style.css` defines the app's dark color/type system as CSS custom properties (`--ink`, `--slate`, `--mist`, `--rain`, `--dry`; fonts Space Grotesk/Inter/IBM Plex Mono loaded via Google Fonts in `index.html`). Reuse these tokens for any new UI rather than introducing new colors/fonts.
- **PWA**: configured via `vite-plugin-pwa` in `vite.config.ts` (manifest + generated service worker). Icons in `apps/web/public/` (`pwa-192x192.png`, `pwa-512x512.png`, `apple-touch-icon.png`, `favicon.png`) were generated from `public/icon-source.svg` — regenerate from that SVG (e.g. via `sharp`) rather than hand-editing the PNGs if the mark changes.
- **Mobile/safe-area**: header and MapLibre controls use `env(safe-area-inset-*)` padding (`viewport-fit=cover` in `index.html`) — preserve this when adding new fixed-position chrome.
