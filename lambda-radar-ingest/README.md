# lambda-radar-ingest

Containerized AWS Lambda that archives NEA's 240km rain radar frames to S3 every 5 minutes.

It is triggered on an EventBridge `rate(5 minutes)` schedule.
On each invocation it computes the most recently completed 5-minute boundary in Singapore time, fetches that frame from data.gov.sg's weather-radar-images API, downloads the image from the presigned URL in the response, and uploads it to S3 under a key partitioned by date, derived from the radar's own timestamp (e.g. `2026-08-26/radar_240km_2026-08-26T15-00-00.png`).

This is an independent service, like `backend/` and `frontend/`.
It does not import from `backend/`; `src/radar_ingest/nea_client.py` is a self-contained copy of the same NEA request/retry pattern used in `backend/src/dryroute_api/radar`.

The S3 bucket is **not** managed by this stack - it must already exist before you deploy, and `sam delete` will never touch it or its contents.

## Local development

```bash
cd lambda-radar-ingest
uv sync --frozen
uv run pytest
uv run ruff check .
```

Copy `.env.example` to `.env` and fill in `NEA_API_KEY` / `RADAR_BUCKET_NAME` for any manual local invocation against real AWS resources.

## Prerequisites

- Docker (running)
- AWS SAM CLI: `brew install aws-sam-cli`
- AWS credentials for an account with permission to create IAM roles, Lambda functions, EventBridge rules, and ECR repositories (`aws sso login` / `aws configure`, then confirm with `aws sts get-caller-identity`)
- A NEA API key from https://data.gov.sg/signin -> Create API Key (stored in your local `.env` as `NEA_API_KEY`; the app works without one at a lower rate limit)
- An existing S3 bucket to write frames into, in the same region you deploy to:
  ```bash
  aws s3 mb s3://dryroute-rain-radar --region ap-southeast-1
  ```

## First-time deploy

```bash
cd lambda-radar-ingest
sam build
NEA_KEY=$(grep NEA_API_KEY .env | cut -d= -f2-)
sam deploy \
  --stack-name dryroute-radar-ingest \
  --region ap-southeast-1 \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --resolve-image-repos \
  --parameter-overrides NeaApiKey="$NEA_KEY" RadarBucketName=dryroute-rain-radar
```

This provisions:

- an IAM role for the function, scoped to `s3:PutObject` / `s3:GetObject` on `<bucket>/*` and `s3:ListBucket` on the bucket itself (nothing else)
- an EventBridge schedule rule invoking the function every 5 minutes
- the container-image Lambda function (`Architectures: arm64`; SAM auto-creates and manages the backing ECR repository)

`sam deploy --guided` can be used instead for an interactive first run - it writes your answers into `samconfig.toml` so subsequent deploys are just `sam deploy`.

## Subsequent deploys

```bash
sam build
sam deploy --stack-name dryroute-radar-ingest --region ap-southeast-1 \
  --parameter-overrides NeaApiKey="$NEA_KEY" RadarBucketName=dryroute-rain-radar
```

## Verifying a deployment

```bash
# find the deployed function name
aws cloudformation describe-stacks --stack-name dryroute-radar-ingest --region ap-southeast-1 \
  --query "Stacks[0].Outputs"

FUNCTION_NAME=<RadarIngestFunctionArn's function name from the output above>

# invoke once manually rather than waiting for the schedule
aws lambda invoke --function-name "$FUNCTION_NAME" --region ap-southeast-1 /tmp/response.json
cat /tmp/response.json

# confirm the object landed
aws s3 ls s3://dryroute-rain-radar/ --recursive --region ap-southeast-1

# tail structured logs for the invocation
aws logs tail "/aws/lambda/$FUNCTION_NAME" --region ap-southeast-1 --since 5m
```

Re-invoking within the same 5-minute window should log `already exists, skipping upload` and return `"uploaded": false` - this is the idempotency check working, not a bug.

Once left running, new `<date>/radar_240km_<timestamp>.png` objects should appear in the bucket roughly every 5 minutes with strictly increasing timestamps, driven by the EventBridge rule instead of manual invokes.

## Local container testing (no real deploy)

Useful for testing image builds without touching AWS. Run the built image with the Lambda Runtime Interface Emulator against a local moto S3 mock:

```bash
sam build
docker network create radar-ingest-test
docker run -d --name radar-moto --network radar-ingest-test -p 5001:5000 motoserver/moto:latest
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=ap-southeast-1 \
  aws --endpoint-url http://localhost:5001 s3 mb s3://test-bucket

docker run -d --name radar-lambda --network radar-ingest-test -p 9000:8080 \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=ap-southeast-1 \
  -e AWS_ENDPOINT_URL=http://radar-moto:5000 \
  -e RADAR_BUCKET_NAME=test-bucket -e NEA_API_KEY= -e RADAR_RANGE=240km \
  radaringestfunction:latest   # image tag from `sam build` output

curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" -d '{}'

docker rm -f radar-lambda radar-moto && docker network rm radar-ingest-test
```

This still calls the real NEA API (no key needed for a quick check), but writes to the local moto mock instead of real S3.

## Tearing down

```bash
sam delete --stack-name dryroute-radar-ingest --region ap-southeast-1 --no-prompts
```

This removes the Lambda function, IAM role, EventBridge rule, and the SAM-managed ECR repository. It does **not** touch the S3 bucket or any objects in it - the bucket is an external resource referenced by the `RadarBucketName` parameter, not created by this stack.

## Notes / future hardening

- No dead-letter queue is configured; a failed invocation relies on Lambda's default async-invoke retry (2 automatic retries). Add an `OnFailure` destination if this needs to be more durable.
- The API key is passed as a plaintext (`NoEcho`) CloudFormation parameter -> Lambda environment variable. For stronger secret hygiene, move it to AWS Secrets Manager and fetch it at cold start instead.
- S3's `HeadObject`/`GetObject` API returns 403 (not 404) for a missing key unless the caller also has `s3:ListBucket` on the bucket - this is why the IAM policy grants both; dropping `ListBucket` will break the idempotency check with a false error instead of a clean "not found".
