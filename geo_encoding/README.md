# DryRoute Geo Encoding Gateway

Authenticating, rate-limited proxy in front of OneMap Singapore's API.
Other DryRoute services call `/onemap/{path}` on this gateway instead of hitting
`onemap.gov.sg` directly, so this gateway alone owns the OneMap access token
lifecycle (tokens expire every ~72 hours) and the 250-calls/minute rate budget.

```bash
cd geo_encoding
uv sync --frozen
cp sample.env .env  # fill in GEO_ENCODING_ONEMAP_EMAIL / GEO_ENCODING_ONEMAP_PASSWORD
uv run uvicorn geo_encoding_gateway.main:app --reload --port 8090
uv run ruff check .
uv run pytest
```

Configuration is env-driven through `pydantic-settings`, uses the
`GEO_ENCODING_` prefix, and loads `.env`. See `sample.env` for the full list
of settings and their defaults.

## Usage

`GET|POST|PUT|PATCH|DELETE /onemap/{path}` forwards the request (method, query
string, body) to `https://www.onemap.gov.sg/{path}`, injecting a valid OneMap
bearer token and enforcing the rate limit. Example:

```
GET /onemap/api/common/elastic/search?searchVal=orchard&returnGeom=Y&getAddrDetails=Y&pageNum=1
```

`GET /healthz` returns `{"status": "ok"}`.

If OneMap responds `429`, the gateway retries with backoff (`onemap_retry_max_attempts`, `onemap_retry_backoff_seconds`) before giving up. If the gateway's own rate limit is exceeded, a request waits briefly (`rate_limit_max_wait_seconds`) for budget to free up rather than failing immediately.

Possible error responses: `429` if the gateway's rate limit is exceeded even after waiting, `502` if OneMap is unreachable, `503` if the OneMap token could not be refreshed.

## Not yet wired up

`backend/`'s `/geocode` route still calls `onemap.gov.sg` directly and
unauthenticated (`backend/src/dryroute_api/geocoding/__init__.py`) rather than
through this gateway. Routing it through `/onemap/api/common/elastic/search`
here is a follow-up.

Only a single in-process instance is supported today: the rate limiter and
token cache are in-memory. If this service is ever horizontally scaled, both
would need to become shared state (e.g. redis-backed), since separate
instances would each track their own 250/min budget and could jointly exceed
OneMap's real limit.
