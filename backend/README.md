# DryRoute Backend

FastAPI service for geocoding, rain radar ingestion and serving, rain-aware route scoring, and Valhalla route orchestration.

```bash
uv sync --frozen
uv run uvicorn dryroute_api.main:app --reload --port 8000
uv run ruff check .
uv run pytest
```

Configuration uses `DRYROUTE_`-prefixed environment variables loaded from `.env`. Valhalla is configured through `DRYROUTE_VALHALLA_URL`.
