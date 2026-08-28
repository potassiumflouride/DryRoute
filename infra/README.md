# DryRoute Infrastructure

Cross-service deployment and orchestration belongs here. Application source and service-specific startup scripts remain inside their service directories.

- `local/` is reserved for local multi-service orchestration, networking, proxying, and volumes.
- `environments/production/` holds the Route 53 hosted zone and ACM certificate setup for `dryroute.com`, shared by `frontend-hosting/` and `landing-hosting/`.
- `frontend-hosting/` deploys `frontend/` as a static site on S3 + CloudFront at `app.dryroute.com` (`deploy.sh` builds and syncs the site and invalidates the distribution; see its own README for setup).
- `landing-hosting/` deploys `landing/` as a static site on S3 + CloudFront at the apex domain `dryroute.com` (see its own README for setup).

No deployment configuration is included yet for `local/`.
