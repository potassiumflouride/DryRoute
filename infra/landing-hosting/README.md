# DryRoute landing page hosting: S3 + CloudFront

Serves `landing/index.html` from a private S3 bucket behind its own
CloudFront distribution, at the apex domain `dryroute.com`. This mirrors
`infra/frontend-hosting/` but scaled down: no build step (the landing page is
a single static HTML file) and no `/api`/`/tiles` routing (it's a standalone
marketing page, not the app).

## Prerequisites

- AWS CLI configured against the same account as `infra/frontend-hosting/`
  (`aws sts get-caller-identity` to confirm)
- The Route 53 hosted zone and ACM certificate from
  `infra/environments/production/README.md` - do that first. This README
  assumes you have the ACM certificate ARN in hand.

## One-time setup

### 1. Create the S3 bucket

```bash
aws s3 mb s3://dryroute-landing --region ap-southeast-1
aws s3api put-public-access-block --bucket dryroute-landing \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Stays fully private, same as `dryroute-frontend` - CloudFront is the only
reader, via Origin Access Control (OAC).

### 2. Create the CloudFront Origin Access Control

```bash
aws cloudfront create-origin-access-control --origin-access-control-config \
  Name=dryroute-landing-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3
```

Note the returned `Id`. Paste it into `cloudfront-distribution.json`,
replacing `OAC_ID`.

### 3. Fill in the ACM certificate ARN

In `cloudfront-distribution.json`, replace `CERTIFICATE_ARN` with the ARN
from `infra/environments/production/README.md` step 3.

### 4. Create the distribution

```bash
aws cloudfront create-distribution --distribution-config file://cloudfront-distribution.json
```

Note the returned `Id`, `ARN`, and `DomainName`.

### 5. Lock the S3 bucket down to this distribution

In `s3-bucket-policy.json`, replace `ACCOUNT_ID` and `DISTRIBUTION_ID` with
the values from step 4, then:

```bash
aws s3api put-bucket-policy --bucket dryroute-landing --policy file://s3-bucket-policy.json
```

### 6. Point dryroute.com at this distribution

Follow `infra/environments/production/README.md` step 5 using this
distribution's domain name.

### 7. First deploy

```bash
cp sample.env .env
# edit .env: set CLOUDFRONT_DISTRIBUTION_ID to the Id from step 4

./deploy.sh
```

## Deploying (this and every subsequent deploy)

```bash
./deploy.sh
```

Reads `CLOUDFRONT_DISTRIBUTION_ID` (and optionally `LANDING_BUCKET`/
`AWS_REGION`) from `.env`, syncs `landing/index.html` to S3 with a
`no-cache` `Cache-Control` (it's the only file served, so it should always
revalidate), and invalidates it.

`.env` is gitignored, so it stays local; `sample.env` is the checked-in
template.

## Verifying a deployment

- `https://<distribution-domain>.cloudfront.net/` loads the landing page
- Once DNS is wired up (`infra/environments/production/README.md`),
  `https://dryroute.com/` loads the same page over HTTPS with a valid cert
- DevTools Network tab: `index.html` shows `Cache-Control: no-cache`
