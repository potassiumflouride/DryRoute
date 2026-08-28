#!/bin/sh
set -e
exec .venv/bin/uvicorn dryroute_api.main:app --host 0.0.0.0 --port "${PORT}"
