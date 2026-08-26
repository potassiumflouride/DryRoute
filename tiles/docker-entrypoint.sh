#!/bin/sh
set -eu
PORT="${PORT:-8081}"
PUBLIC_URL="${PUBLIC_URL:-http://localhost:${PORT}/}"
exec pmtiles serve /data --port "${PORT}" --cors="*" --public-url="${PUBLIC_URL}"
