# DryRoute load tests

This directory is a self-contained asynchronous load-test suite for the DryRoute route API,
geocoding API or gateway, and PMTiles service. It does not import source or configuration from
the sibling services.

## Safety first

Only test systems you own or are explicitly authorized to test. No service URL has a working
default. The runner also refuses the repository's known shared public OneMap and Valhalla hosts
unless `--allow-third-party` is deliberately supplied.

Copy the example configuration and provide the deployment endpoints:

```bash
cp test_load/.env.example test_load/.env
```

For DryRoute's current backend, set `LOAD_ROUTE_URL` to the full `/route` URL and
`LOAD_GEOCODE_URL` to the full `/geocode` URL. To test the geo-encoding gateway instead, set the
full `/onemap/api/common/elastic/search` URL and use `LOAD_GEOCODE_STYLE=onemap-gateway`.
PMTiles defaults to `/{archive}/{z}/{x}/{y}.mvt` with archive name `dryroute`.

Headers are optional JSON objects. For example:

```dotenv
LOAD_ROUTE_HEADERS_JSON={"Authorization":"Bearer replace-me"}
```

The report contains header names but never their values. Do not commit `test_load/.env`.

## Run

The launcher uses `uv` and keeps its environment and dependencies inside this directory.

Start with a preflight, which sends one workflow and writes JSON and HTML reports:

```bash
test_load/run.sh --profile mixed --preflight
```

Then run the five-minute mixed test:

```bash
test_load/run.sh --profile mixed
```

Focused profiles put all virtual users on one service:

```bash
test_load/run.sh --profile route
test_load/run.sh --profile geocode
test_load/run.sh --profile tiles
```

CLI flags can override the profile, duration, peak users, and target URLs. Run
`test_load/run.sh --help` for the complete list. A short smoke run is:

```bash
test_load/run.sh --profile route --duration 15 --max-users 2
```

## Default load shape

The five-minute schedule ramps from 1 to 10 users for 30 seconds, ramps to 50 over the next
30 seconds, holds 50 for three minutes, synchronizes all 50 users for a 15-second no-think-time
burst, and ramps down for 45 seconds. Normal user think time is randomized between one and three
seconds.

The mixed workflow performs two searches, one route generation, and a browser-like batch of eight
tiles. The route dataset covers several Singapore trips and includes some waypoint routes. Tile
requests cover zoom levels 12 through 15, matching the current PMTiles archive, around multiple parts of Singapore.

## Pass criteria and reports

The initial defaults fail the process when the global or per-service error rate is 1% or higher,
or when p95 latency exceeds 3 seconds for routes, 2 seconds for geocoding, or 500 milliseconds for
tiles. All limits can be overridden with the environment variables in `.env.example`.

Timestamped JSON and standalone HTML reports are written to `test_load/results/`. They include
request totals, throughput, bytes, status codes, top errors, and p50/p90/p95/p99 latency. Exit code
0 means all thresholds passed, 1 means the test ran but a threshold failed, and 2 means the
configuration was invalid.

Client-side timing cannot explain server saturation by itself. During a real run, correlate the
report window with backend, geo-encoding, PMTiles, Valhalla, and host CPU/memory/network metrics.

## Development checks

```bash
uv sync --project test_load --dev
uv run --project test_load pytest test_load/tests
uv run --project test_load ruff check test_load
```
