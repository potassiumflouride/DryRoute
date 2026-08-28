#!/usr/bin/env bash
# Syncs landing/index.html to the landing S3 bucket and invalidates
# CloudFront's cache for it.
#
# Configured via environment variables - copy sample.env to .env and fill it
# in, or export the variables yourself. See README.md for one-time setup
# (bucket, OAC, distribution) before running this.
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

BUCKET="${LANDING_BUCKET:-dryroute-landing}"
export AWS_REGION="${AWS_REGION:-ap-southeast-1}"
LANDING_DIR="${SCRIPT_DIR}/../../landing"

aws s3 cp "${LANDING_DIR}/index.html" "s3://${BUCKET}/index.html" \
    --cache-control "no-cache, must-revalidate"

aws cloudfront create-invalidation \
    --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
    --paths "/index.html" "/"
