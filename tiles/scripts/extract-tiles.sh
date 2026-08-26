#!/usr/bin/env bash
# Extracts a PMTiles archive covering Singapore, the Riau Islands, and
# Peninsular Malaysia from
# Protomaps' daily global OSM basemap build, using HTTP range requests (no
# full-planet download).
#
# Requires the go-pmtiles CLI (https://github.com/protomaps/go-pmtiles).
# Prebuilt binaries: https://github.com/protomaps/go-pmtiles/releases
# (no Go toolchain needed — download the release archive for your platform
# and put `pmtiles` on your PATH, or set PMTILES_BIN below).
set -euo pipefail

PMTILES_BIN="${PMTILES_BIN:-pmtiles}"
# Default to yesterday's UTC build, since today's daily build often isn't
# published yet. GNU date syntax first, falling back to BSD date (macOS).
YESTERDAY="$(date -u -d 'yesterday' +%Y%m%d 2>/dev/null || date -u -v-1d +%Y%m%d)"
BUILD_DATE="${1:-${YESTERDAY}}"
SOURCE_URL="https://build.protomaps.com/${BUILD_DATE}.pmtiles"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$(cd "${SCRIPT_DIR}/../data" && pwd)"
OUT_FILE="${OUT_DIR}/dryroute.pmtiles"

echo "Extracting Singapore + Riau Islands + Peninsular Malaysia bbox from ${SOURCE_URL} -> ${OUT_FILE}"
"${PMTILES_BIN}" extract "${SOURCE_URL}" "${OUT_FILE}" \
  --bbox=99.5,0.8,104.6,6.8

echo "Done. Verify with: ${PMTILES_BIN} show ${OUT_FILE}"
