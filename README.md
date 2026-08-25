# DryRoute

DryRoute is a Singapore route planner that scores routes against live rain radar data.

## Services

- `frontend/` — Vite, TypeScript, MapLibre SPA
- `backend/` — FastAPI service for geocoding, radar frames, rain scoring, and route orchestration
- `tiles/` — self-hosted Singapore PMTiles server and data preparation scripts
- `valhalla/` — boundary for the independently deployed Valhalla routing service
- `infra/` — local and environment-specific cross-service orchestration

Each service owns its dependencies and runtime contract. There is no repository-level package workspace or task runner.

## Development

Run each service from its own directory. See the service README files for commands and requirements.
