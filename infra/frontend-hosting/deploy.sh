#!/usr/bin/env bash
# Builds frontend/ and syncs frontend/dist/ to the frontend S3 bucket with a
# cache-control tier that keeps the PWA service worker updatable, then
# invalidates the entry files CloudFront caches.
#
# Configured via environment variables - copy sample.env to .env and fill it
# in, or export the variables yourself. See README.md for one-time setup
# (bucket, OAC, function, distribution) before running this.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
    set -a
    source "${SCRIPT_DIR}/.env"
    set +a
fi

if [[ -z "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]]; then
    echo "CLOUDFRONT_DISTRIBUTION_ID is not set" >&2
    exit 1
fi

BUCKET="${FRONTEND_BUCKET:-dryroute-frontend}"
export AWS_REGION="${AWS_REGION:-ap-southeast-1}"
FRONTEND_DIR="${SCRIPT_DIR}/../../frontend"
DIST_DIR="${FRONTEND_DIR}/dist"

(cd "${FRONTEND_DIR}" && pnpm install --frozen-lockfile && pnpm build)

# Hashed, content-addressed assets: cache forever, browsers only re-fetch
# when the filename itself changes.
aws s3 sync "${DIST_DIR}" "s3://${BUCKET}" \
    --exclude "*" --include "assets/*" \
    --cache-control "public, max-age=31536000, immutable" \
    --delete

# Everything else except the three PWA entry files below.
aws s3 sync "${DIST_DIR}" "s3://${BUCKET}" \
    --exclude "assets/*" --exclude "index.html" --exclude "sw.js" --exclude "manifest.webmanifest" \
    --delete

# PWA entry files: must always be revalidated so vite-plugin-pwa's
# autoUpdate can detect a new service worker.
for f in index.html sw.js manifest.webmanifest; do
    if [[ -f "${DIST_DIR}/${f}" ]]; then
        aws s3 cp "${DIST_DIR}/${f}" "s3://${BUCKET}/${f}" \
            --cache-control "no-cache, must-revalidate"
    fi
done

aws cloudfront create-invalidation \
    --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
    --paths "/index.html" "/sw.js" "/manifest.webmanifest"
