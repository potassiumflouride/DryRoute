# DryRoute Infrastructure

Cross-service deployment and orchestration belongs here. Application source and service-specific startup scripts remain inside their service directories.

- `local/` is reserved for local multi-service orchestration, networking, proxying, and volumes.
- `environments/` is reserved for staging and production infrastructure definitions.
- `frontend-hosting/` deploys `frontend/` as a static site on S3 + CloudFront (`deploy.sh` builds and syncs the site and invalidates the distribution; see its own README for setup).

No deployment configuration is included yet for `local/` or `environments/`.
