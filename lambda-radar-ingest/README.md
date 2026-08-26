# lambda-radar-ingest

Containerized AWS Lambda that archives NEA's 240km rain radar frames to S3.

It is triggered on an EventBridge schedule, currently `cron(0/2 * * * ? *)` (every 2 minutes). NEA itself only publishes a new frame every 5 minutes; polling more often than that doesn't create duplicate or malformed data - each invocation is idempotent (see below) and simply picks up a newly-published frame sooner than a 5-minute poll would, since NEA typically takes 1-2 minutes after a frame's nominal timestamp to actually publish it.
On each invocation it computes the most recently completed 5-minute boundary in Singapore time, fetches that frame from data.gov.sg's weather-radar-images API, downloads the image from the presigned URL in the response, and uploads both the image and NEA's raw JSON response to S3 under keys partitioned by date, derived from **NEA's own timestamp for the frame it actually returned** (not necessarily the boundary requested, if NEA hasn't published that one yet):

- `2026-08-26/img/radar_240km_2026-08-26T15-00-00.png` - the radar image
- `2026-08-26/json/radar_240km_2026-08-26T15-00-00.json` - NEA's raw API response for that frame (includes the boundary box consumers need to geo-position the image)

The bucket has a public-read policy and CORS configured directly on it (see Bucket permissions below) so both objects can be fetched directly by a browser without going through a backend. This is managed by hand, independently of the Lambda - the bucket's read access shouldn't depend on whether the ingest function happens to be deployed.

This is an independent service, like `backend/` and `frontend/`.
It does not import from `backend/`; `src/radar_ingest/nea_client.py` is a self-contained copy of the same NEA request/retry pattern used in `backend/src/dryroute_api/radar`.

The S3 bucket is **not** managed by this Lambda - it must already exist, and nothing here creates, deletes, or touches its contents beyond writing frame objects.

`frontend/src/radar.ts` polls the bucket on the same 2-minute cadence (`POLL_INTERVAL_MINUTES`) to pick up newly-ingested frames promptly. If you change this Lambda's schedule interval, consider whether the frontend's poll interval should move with it - they're independent settings that happen to currently match.

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
- AWS CLI configured against an account with permission to push to ECR (`aws sso login` / `aws configure`, then confirm with `aws sts get-caller-identity`)
- AWS Console access with permission to create IAM roles, Lambda functions, and EventBridge rules
- A NEA API key from https://data.gov.sg/signin -> Create API Key (stored in your local `.env` as `NEA_API_KEY`; the app works without one at a lower rate limit)
- An existing S3 bucket to write frames into, in the same region you deploy to:
  ```bash
  aws s3 mb s3://dryroute-rain-radar --region ap-southeast-1
  ```

## Bucket permissions (one-time, independent of the Lambda)

The frontend fetches radar frames straight from S3 in the browser, so the bucket needs public read + CORS regardless of whether the Lambda is deployed, updated, or torn down. Set this up once, by hand, in the S3 console - it is deliberately **not** part of the Lambda's deployment so the two lifecycles don't fight each other:

1. Bucket -> **Permissions** tab -> **Block public access (bucket settings)** -> Edit -> uncheck **Block all public access**, then uncheck just:
   - Block public access to buckets and objects granted through **new public bucket or access point policies**
   - Block public and cross-account access to buckets and objects through **any public bucket or access point policies**

   Leave the two ACL-related boxes checked. Save and confirm.

2. **Bucket Policy** -> Edit -> paste:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PublicReadRadarFrames",
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::dryroute-rain-radar/*"
       }
     ]
   }
   ```

3. **Cross-origin resource sharing (CORS)** -> Edit -> paste:
   ```json
   [
     {
       "AllowedMethods": ["GET"],
       "AllowedOrigins": ["*"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

Verify with `curl -o /dev/null -w "%{http_code}\n" https://dryroute-rain-radar.s3.ap-southeast-1.amazonaws.com/<some-existing-key>.png` - expect `200`.

## Deployment (manual, via ECR + AWS Console)

### First-time setup

1. **ECR repository** - ECR console -> Repositories -> Create repository -> private, name `dryroute/lambda-radar-ingest` -> Create.

2. **Build and push the image** (terminal - no console equivalent for building):
   ```bash
   cd lambda-radar-ingest
   aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com
   docker build --platform linux/arm64 --provenance=false --sbom=false -t radar-ingest .
   docker tag radar-ingest:latest <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/dryroute/lambda-radar-ingest:latest
   docker push <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/dryroute/lambda-radar-ingest:latest
   ```
   `--provenance=false --sbom=false` matters here: BuildKit attaches provenance/SBOM attestations by default, which pushes an OCI image index (manifest list) instead of a plain single-arch image. Lambda container image functions don't support pulling an image index as the deploy target, so without these flags the push looks fine in ECR but the function creation/update step below can fail or pick up the wrong manifest.

3. **IAM role** - IAM console -> Roles -> Create role -> Trusted entity: AWS service -> Use case: Lambda -> attach `AWSLambdaBasicExecutionRole` -> name it `radar-ingest-lambda-role` -> Create role. Then add an inline policy on that role, scoped to this bucket only:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": "arn:aws:s3:::dryroute-rain-radar/*" },
       { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::dryroute-rain-radar" }
     ]
   }
   ```
   **Create this role first, by hand, before creating the function.** In step 4, pick "Use an existing role" and select it. Do **not** let the function-creation wizard auto-generate a role for you - its "Create a new role from AWS policy templates" flow burned us once: it attached a basic-execution policy whose `logs:CreateLogStream`/`logs:PutLogEvents` resource ARN was scoped to whatever function name was in the box at that moment, which drifted from the function's actual final name, silently breaking all logging (the log group never got created, `StartQuery` in Logs Insights returned `ResourceNotFoundException`) - and it granted no S3 access at all, so every invocation failed on the first `HeadObject` call with a 403. Both were only caught by manually invoking the function and inspecting the raw error.

4. **Lambda function** - Lambda console -> Create function -> Container image:
   - Function name: `lambda-radar-ingest`
   - Container image URI: browse to the `dryroute/lambda-radar-ingest` repo, tag `latest`
   - Architecture: `arm64`
   - Execution role: use existing -> `radar-ingest-lambda-role`
   - Create function

5. **Environment variables** - Configuration -> Environment variables -> Edit -> add `RADAR_BUCKET_NAME=dryroute-rain-radar`, `NEA_API_KEY=<your key>`, `RADAR_RANGE=240km` -> Save.

6. **Timeout/memory** - Configuration -> General configuration -> Edit -> Timeout `30 sec`, Memory `256 MB` -> Save.

7. **Schedule trigger (EventBridge)** - function overview -> **+ Add trigger** -> select **EventBridge (CloudWatch Events)** -> **Create a new rule**:
   - Rule name: `radar-ingest-schedule`
   - Rule type: **Schedule expression**
   - Schedule expression: `cron(0/2 * * * ? *)` (every 2 minutes - see note at the top of this README on why polling faster than NEA's own 5-minute publish cadence is safe)
   -> **Add**

   This creates an EventBridge rule targeting the function and wires up the resource-based invoke permission automatically - no separate IAM step needed. Verify it landed:
   ```bash
   aws lambda get-policy --function-name lambda-radar-ingest --region ap-southeast-1
   aws events list-rules --region ap-southeast-1 --query "Rules[?contains(Name, 'radar')]"
   ```
   `get-policy` should show a statement with `"Principal": {"Service": "events.amazonaws.com"}`, and `list-rules` should return the rule with the expected `ScheduleExpression` and `"State": "ENABLED"`.

   Note: the currently-deployed rule is still literally named `radar-ingest-5min` (from when it was first created at a 5-minute cadence and later edited to 2 minutes in place) - a stale name, harmless, but use `radar-ingest-schedule` if creating fresh.

8. **Smoke test** - Test tab -> create a test event with an empty `{}` body -> Test -> check the response and CloudWatch Logs, then confirm a new object landed in the bucket.

### Subsequent image updates

```bash
cd lambda-radar-ingest
docker build --platform linux/arm64 --provenance=false --sbom=false -t radar-ingest .
docker tag radar-ingest:latest <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/dryroute/lambda-radar-ingest:latest
docker push <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/dryroute/lambda-radar-ingest:latest
```

Then in the Lambda console: function -> **Image** tab -> **Deploy new image** -> select the `latest` tag -> Save. The role, environment variables, and schedule trigger don't need to be touched again.

## Verifying a deployment

```bash
FUNCTION_NAME=lambda-radar-ingest

# invoke once manually rather than waiting for the schedule
aws lambda invoke --function-name "$FUNCTION_NAME" --region ap-southeast-1 /tmp/response.json
cat /tmp/response.json

# confirm the object landed
aws s3 ls s3://dryroute-rain-radar/ --recursive --region ap-southeast-1

# tail structured logs for the invocation
aws logs tail "/aws/lambda/$FUNCTION_NAME" --region ap-southeast-1 --since 5m
```

Re-invoking before NEA has published a new frame should log `already exists, skipping upload` and return `"uploaded": false` - this is the idempotency check working, not a bug. You may also see `WARNING: NEA record timestamp ... differs from computed target ...; using NEA's timestamp` when NEA hasn't published the current 5-minute boundary yet - also expected, not a bug; the invocation still uploads correctly under whichever timestamp NEA actually returned.

Once left running, new `<date>/img/radar_240km_<timestamp>.png` and `<date>/json/radar_240km_<timestamp>.json` objects should appear in the bucket with strictly increasing 5-minute-spaced timestamps, driven by the EventBridge rule instead of manual invokes.

## Local container testing (no real deploy)

Useful for testing image builds without touching AWS. Run the built image with the Lambda Runtime Interface Emulator against a local moto S3 mock:

```bash
docker build --platform linux/arm64 --provenance=false --sbom=false -t radar-ingest .
docker network create radar-ingest-test
docker run -d --name radar-moto --network radar-ingest-test -p 5001:5000 motoserver/moto:latest
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=ap-southeast-1 \
  aws --endpoint-url http://localhost:5001 s3 mb s3://test-bucket

docker run -d --name radar-lambda --network radar-ingest-test -p 9000:8080 \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_DEFAULT_REGION=ap-southeast-1 \
  -e AWS_ENDPOINT_URL=http://radar-moto:5000 \
  -e RADAR_BUCKET_NAME=test-bucket -e NEA_API_KEY= -e RADAR_RANGE=240km \
  radar-ingest:latest

curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" -d '{}'

docker rm -f radar-lambda radar-moto && docker network rm radar-ingest-test
```

This still calls the real NEA API (no key needed for a quick check), but writes to the local moto mock instead of real S3.

## Tearing down

In the AWS Console: delete the `lambda-radar-ingest` Lambda function, its `radar-ingest-5min` EventBridge schedule rule, the `radar-ingest-lambda-role` IAM role, and the `dryroute/lambda-radar-ingest` ECR repository, in that order. None of this touches the S3 bucket or any objects in it - the bucket is an external resource, not created or owned by anything here. The public-read policy and CORS configuration from the Bucket permissions section above are also independent and won't be affected.

## Notes / future hardening

- `template.yaml` / `samconfig.toml` describe an equivalent SAM-based deployment but are **not** the deployment path currently used - actual deploys are the manual ECR + Console steps above. Keep the two in sync if you touch the Lambda's IAM permissions, or remove the SAM files if they go stale.
- If invocations fail with a 403 on `HeadObject`/`PutObject`, or CloudWatch Logs Insights says a log group `does not exist` for a function you know is running: check the execution role's attached/inline policies match the function's actual name and bucket - see the warning under "IAM role" above for the specific failure mode this project hit.
- No dead-letter queue is configured; a failed invocation relies on Lambda's default async-invoke retry (2 automatic retries). Add an `OnFailure` destination if this needs to be more durable.
- The API key is stored as a plaintext Lambda environment variable. For stronger secret hygiene, move it to AWS Secrets Manager and fetch it at cold start instead.
- S3's `HeadObject`/`GetObject` API returns 403 (not 404) for a missing key unless the caller also has `s3:ListBucket` on the bucket - this is why the IAM policy grants both; dropping `ListBucket` will break the idempotency check with a false error instead of a clean "not found".
