# DryRoute Tile Service

Serves a Protomaps archive covering Singapore and Peninsular Malaysia from `data/dryroute.pmtiles` on port 8081.

The PMTiles archive is generated runtime data and is not committed to Git.

## Local

```bash
scripts/extract-tiles.sh
scripts/serve-pmtiles.sh
```

Both scripts require the `pmtiles` CLI. Set `PMTILES_BIN` to override its executable and `PORT` to override the serving port.

## Docker

```bash
docker build -t dryroute-tiles .
docker run --rm -p 8081:8081 dryroute-tiles
```

The image bakes the `dryroute.pmtiles` archive in at build time (no network access needed at container start). Build args:

- `PMTILES_VERSION` — pinned go-pmtiles release version (default set in the Dockerfile).
- `PROTOMAPS_BUILD_DATE` — Protomaps daily build date to extract from, `YYYYMMDD` (defaults to yesterday's UTC date, since today's build often isn't published yet). Pass this explicitly for a reproducible build, since Protomaps' daily builds are not retained forever.

Runtime env vars:

- `PORT` — serving port (default `8081`). Many PaaS platforms inject this automatically.
- `PUBLIC_URL` — public base URL used for the TileJSON endpoint (default `http://localhost:$PORT/`). Override with your real domain in production, e.g. `https://tiles.example.com/`.
