#!/usr/bin/env bash
# Extracts a Singapore-only PMTiles archive from Protomaps' daily global
# OSM basemap build, using HTTP range requests (no full-planet download).
#
# Requires the go-pmtiles CLI (https://github.com/protomaps/go-pmtiles).
# Prebuilt binaries: https://github.com/protomaps/go-pmtiles/releases
# (no Go toolchain needed — download the release archive for your platform
# and put `pmtiles` on your PATH, or set PMTILES_BIN below).
set -euo pipefail

PMTILES_BIN="${PMTILES_BIN:-pmtiles}"
BUILD_DATE="${1:-$(date -u +%Y%m%d)}"
SOURCE_URL="https://build.protomaps.com/${BUILD_DATE}.pmtiles"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$(cd "${SCRIPT_DIR}/../../data/osm" && pwd)"
OUT_FILE="${OUT_DIR}/singapore.pmtiles"

echo "Extracting Singapore bbox from ${SOURCE_URL} -> ${OUT_FILE}"
"${PMTILES_BIN}" extract "${SOURCE_URL}" "${OUT_FILE}" \
  --bbox=103.55,1.15,104.15,1.50

echo "Done. Verify with: ${PMTILES_BIN} show ${OUT_FILE}"
