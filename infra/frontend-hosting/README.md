# DryRoute frontend hosting: S3 + CloudFront

Serves `frontend/dist/` from a private S3 bucket behind a single CloudFront distribution.
The same distribution also routes `/api/*` to the backend and `/tiles/*` to the tiles service, so the browser only ever talks to one domain and `frontend/src`'s existing relative fetches (`/api/geocode`, `/tiles/dryroute/{z}/{x}/{y}.mvt`, ...) work unmodified in production, exactly as they do today against Vite's dev proxy (`frontend/vite.config.ts`).

Both `backend/` (`backend/src/dryroute_api/routers/__init__.py`) and the tiles server (`tiles/scripts/serve-pmtiles.sh`) expose their routes unprefixed, so a CloudFront Function strips the `/api` and `/tiles` prefixes before forwarding - see `cloudfront-function-strip-prefix.js`.

`geo_encoding/` and `valhalla/` are out of scope here: `geo_encoding/` is intentionally not deployed, and `valhalla/` stays pointed at the existing public third-party instance via `DRYROUTE_VALHALLA_URL`.

## Prerequisites

- AWS CLI configured against an account with permission to manage S3, CloudFront, and IAM (`aws sts get-caller-identity` to confirm)
- `frontend/`'s normal build prerequisites (`pnpm`)
- **A live HTTPS endpoint for the backend and one for the tiles service.** Neither is deployed anywhere yet - this hosting setup only covers the frontend and the CloudFront routing in front of it. Pick a host for `backend/` and `tiles/` first; this README treats their domains as the placeholders `BACKEND_ORIGIN_DOMAIN` and `TILES_ORIGIN_DOMAIN` below.

## One-time setup

Run these in order - each step's output feeds the next.

### 1. Create the S3 bucket

```bash
aws s3 mb s3://dryroute-frontend --region ap-southeast-1
aws s3api put-public-access-block --bucket dryroute-frontend \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Unlike `dryroute-rain-radar`, this bucket stays fully private - CloudFront is the only reader, via Origin Access Control (OAC), set up next.

### 2. Create the CloudFront Origin Access Control

```bash
aws cloudfront create-origin-access-control --origin-access-control-config \
  Name=dryroute-frontend-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3
```

Note the returned `Id`. Paste it into `cloudfront-distribution.json`, replacing `OAC_ID`.

### 3. Create and publish the CloudFront Function

```bash
aws cloudfront create-function \
  --name dryroute-strip-prefix \
  --function-config Comment="Strip /api and /tiles prefixes before forwarding",Runtime=cloudfront-js-2.0 \
  --function-code fileb://cloudfront-function-strip-prefix.js

aws cloudfront publish-function \
  --name dryroute-strip-prefix \
  --if-match "$(aws cloudfront describe-function --name dryroute-strip-prefix --stage DEVELOPMENT --query ETag --output text)"

aws cloudfront describe-function --name dryroute-strip-prefix --stage LIVE --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text
```

Paste the printed ARN into `cloudfront-distribution.json`, replacing both `STRIP_PREFIX_FUNCTION_ARN` occurrences.

### 4. Create the tiles cache policy

The `/tiles/*` behavior uses a custom TTL rather than a managed policy, since tile freshness needs differ from the S3 static assets. Start with a 5-minute default/max-1-day ceiling and tune once the tiles service's actual update cadence is confirmed:

```bash
aws cloudfront create-cache-policy --cache-policy-config '{
  "Name": "dryroute-tiles",
  "DefaultTTL": 300,
  "MinTTL": 0,
  "MaxTTL": 86400,
  "ParametersInCacheKeyAndForwardedToOrigin": {
    "EnableAcceptEncodingGzip": true,
    "EnableAcceptEncodingBrotli": true,
    "HeadersConfig": { "HeaderBehavior": "none" },
    "CookiesConfig": { "CookieBehavior": "none" },
    "QueryStringsConfig": { "QueryStringBehavior": "none" }
  }
}' --query 'CachePolicy.Id' --output text
```

Paste the printed ID into `cloudfront-distribution.json`, replacing `TILES_CACHE_POLICY_ID`.

### 5. Fill in the origin domains

In `cloudfront-distribution.json`, replace `BACKEND_ORIGIN_DOMAIN` and `TILES_ORIGIN_DOMAIN` with the actual hostnames (no scheme, e.g. `api.example.com`) of wherever `backend/` and `tiles/` end up hosted.

### 6. Create the distribution

```bash
aws cloudfront create-distribution --distribution-config file://cloudfront-distribution.json
```

Note the returned `Id`, `ARN`, and `DomainName` (the `*.cloudfront.net` domain the app will be served from).

### 7. Lock the S3 bucket down to this distribution

In `s3-bucket-policy.json`, replace `ACCOUNT_ID` and `DISTRIBUTION_ID` with the values from step 6, then:

```bash
aws s3api put-bucket-policy --bucket dryroute-frontend --policy file://s3-bucket-policy.json
```

### 8. First deploy

```bash
cp sample.env .env
# edit .env: set CLOUDFRONT_DISTRIBUTION_ID to the Id from step 6

./deploy.sh
```

## Deploying (this and every subsequent deploy)

```bash
./deploy.sh
```

Reads `CLOUDFRONT_DISTRIBUTION_ID` (and optionally `FRONTEND_BUCKET`/`AWS_REGION`) from `.env`, builds `frontend/`, syncs `frontend/dist/` to S3 with tiered `Cache-Control` (immutable for hashed `/assets/*`, `no-cache` for `index.html`/`sw.js`/`manifest.webmanifest`), and invalidates the three no-cache entry files. Hashed assets never need invalidation - their filenames change with their content.

`.env` is gitignored, so it stays local; `sample.env` is the checked-in template. `deploy.sh` also accepts the variables directly from the environment (e.g. `CLOUDFRONT_DISTRIBUTION_ID=... ./deploy.sh`) if you'd rather not keep a `.env` file.

## Custom domain

Served at `app.dryroute.com`. `cloudfront-distribution.json`'s `Aliases` and `ViewerCertificate` are already filled in for this - see `infra/environments/production/README.md` for the Route 53 hosted zone and ACM certificate (issued in `us-east-1`, regardless of this distribution's region) that `CERTIFICATE_ARN` there needs to be replaced with, and for the DNS record pointing `app.dryroute.com` at this distribution.

If you're applying the alias/cert change to an already-created distribution rather than creating it fresh, that's an update, not a create:

```bash
aws cloudfront get-distribution-config --id <DISTRIBUTION_ID>
# take the returned ETag, then:
aws cloudfront update-distribution --id <DISTRIBUTION_ID> \
  --distribution-config file://cloudfront-distribution.json \
  --if-match <ETag>
```

## Verifying a deployment

- `https://<distribution-domain>.cloudfront.net/` loads `index.html` and the map boots
- `https://<distribution-domain>.cloudfront.net/api/geocode?q=...` reaches the backend (once its origin is live)
- `https://<distribution-domain>.cloudfront.net/tiles/dryroute/{z}/{x}/{y}.mvt` returns a tile (once its origin is live)
- DevTools Network tab: `sw.js`, `index.html`, `manifest.webmanifest` show `Cache-Control: no-cache`; hashed files under `/assets/` show `immutable`
- After a redeploy, confirm the PWA's `autoUpdate` picks up the new service worker without a hard refresh - the real test that the cache-control tiering above is doing its job
