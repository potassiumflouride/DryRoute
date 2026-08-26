# lambda-radar-ingest

Containerized AWS Lambda that archives NEA's 240km rain radar frames to S3 every 5 minutes.

It is triggered on an EventBridge `rate(5 minutes)` schedule.
On each invocation it computes the most recently completed 5-minute boundary in Singapore time, fetches that frame from data.gov.sg's weather-radar-images API, downloads the image from the presigned URL in the response, and uploads it to S3 under a key partitioned by date, derived from the radar's own timestamp (e.g. `2026-08-26/radar_240km_2026-08-26T15-00-00.png`).

This is an independent service, like `backend/` and `frontend/`.
It does not import from `backend/`; `src/radar_ingest/nea_client.py` is a self-contained copy of the same NEA request/retry pattern used in `backend/src/dryroute_api/radar`.

## Local development

```bash
cd lambda-radar-ingest
uv sync --frozen
uv run pytest
uv run ruff check .
```

Copy `.env.example` to `.env` and fill in `NEA_API_KEY` / `RADAR_BUCKET_NAME` for any manual local invocation against real AWS resources.

## Deploying

Requires the AWS SAM CLI and Docker.

```bash
sam build
sam deploy --guided   # first time only; captures answers into samconfig.toml
sam deploy            # subsequent deploys
```

`sam deploy --guided` prompts for the `NeaApiKey` parameter (stored with `NoEcho`, never committed).
It provisions:

- an S3 bucket (`dryroute-rain-radar-<account-id>`) that the frames are written to
- an EventBridge schedule rule invoking the function every 5 minutes
- an IAM role scoped to `s3:PutObject` / `s3:HeadObject` on that bucket only
- the container-image Lambda function itself (SAM manages the backing ECR repository)

## Local container testing

```bash
sam build
sam local invoke RadarIngestFunction --event events/scheduled-event.json \
  --parameter-overrides NeaApiKey=<key>
```

## Verifying a deployment

```bash
aws s3 ls s3://<bucket-name>/ --recursive
aws logs tail /aws/lambda/<function-name> --follow
```

New `<date>/radar_240km_<timestamp>.png` objects should appear roughly every 5 minutes with strictly increasing timestamps.

## Notes / future hardening

- No dead-letter queue is configured; a failed invocation relies on Lambda's default async-invoke retry (2 automatic retries). Add an `OnFailure` destination if this needs to be more durable.
- The API key is passed as a plaintext (`NoEcho`) CloudFormation parameter -> Lambda environment variable. For stronger secret hygiene, move it to AWS Secrets Manager and fetch it at cold start instead.
