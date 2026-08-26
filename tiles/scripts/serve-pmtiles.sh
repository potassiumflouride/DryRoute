#!/usr/bin/env bash
# Serves tiles/data/*.pmtiles over HTTP (with Range + CORS support) for
# local development. The web app's Vite dev server proxies /tiles to this.
#
# Requires the go-pmtiles CLI — see extract-tiles.sh for install notes.
set -euo pipefail

PMTILES_BIN="${PMTILES_BIN:-pmtiles}"
PORT="${PORT:-8081}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$(cd "${SCRIPT_DIR}/../data" && pwd)"

echo "Serving PMTiles archives from ${DATA_DIR} on :${PORT}"
# --public-url makes the /<name>.json TileJSON endpoint work; the app itself
# talks to the /<name>/{z}/{x}/{y}.mvt tile endpoints directly (via the Vite
# dev proxy), so this only matters for tools that expect TileJSON.
"${PMTILES_BIN}" serve "${DATA_DIR}" --port "${PORT}" --cors="*" \
  --public-url="http://localhost:${PORT}/"
