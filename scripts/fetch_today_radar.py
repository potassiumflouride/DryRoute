#!/usr/bin/env python3
"""Adhoc script: fetch every NEA rain radar frame for a day and upload to S3.

Reuses lambda-radar-ingest's own fetch/upload logic so it writes into the
same bucket and key layout as the production Lambda. NEA's API returns
radar frames in pages of 25 (5-minute intervals, newest first) when queried
with a date-only `date=YYYY-MM-DD` param; this script pages backward with
`paginationToken` until it runs out of records for the target date.

Run from the repo root with lambda-radar-ingest's uv environment:

    uv run --project lambda-radar-ingest python scripts/fetch_today_radar.py [YYYY-MM-DD]

Defaults to today (SGT) if no date is given.

If AWS credentials are configured via `login_session` in ~/.aws/config (the
newer browser-login flow), boto3 also needs botocore[crt]:

    uv run --project lambda-radar-ingest --with 'botocore[crt]' python scripts/fetch_today_radar.py
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
LAMBDA_SRC = REPO_ROOT / "lambda-radar-ingest" / "src"
sys.path.insert(0, str(LAMBDA_SRC))

from radar_ingest import nea_client, s3_writer, timing  # noqa: E402

NEA_API_KEY = os.environ.get("NEA_API_KEY", "")
RADAR_BUCKET_NAME = os.environ.get("RADAR_BUCKET_NAME", "dryroute-rain-radar")
RADAR_RANGE = os.environ.get("RADAR_RANGE", "240km")


def fetch_day_records(date_str: str, api_key: str, radar_range: str) -> list[nea_client.RadarRecord]:
    """Page through NEA's weather-radar-images API and collect every frame for `date_str` (SGT)."""
    url = f"{nea_client.NEA_RADAR_BASE_URL}/weather-radar-images/{radar_range}"
    headers = {"x-api-key": api_key} if api_key else {}
    records: dict[str, nea_client.RadarRecord] = {}
    pagination_token: str | None = None

    with httpx.Client() as client:
        while True:
            params = {"date": date_str}
            if pagination_token:
                params["paginationToken"] = pagination_token

            response = nea_client._get_with_retry(client, url, headers=headers, params=params, timeout=10.0)
            payload = response.json()["data"]
            page_records = payload.get("records") or []
            if not page_records:
                break

            ran_off_target_date = False
            for record in page_records:
                timestamp = datetime.fromisoformat(record["timestamp"])
                if timestamp.astimezone(timing.SGT).strftime("%Y-%m-%d") != date_str:
                    ran_off_target_date = True
                    continue

                # Mirror the single-record page shape the production Lambda
                # stores, so per-frame JSON keeps the boundary box consumers need.
                raw_response = json.dumps(
                    {
                        "code": 0,
                        "data": {
                            "projection": payload["projection"],
                            "boundaryBox": payload["boundaryBox"],
                            "records": [record],
                        },
                        "errorMsg": "",
                    }
                ).encode()
                records[record["timestamp"]] = nea_client.RadarRecord(
                    timestamp=timestamp,
                    image_url=record["image"]["url"],
                    raw_response=raw_response,
                )

            pagination_token = payload.get("paginationToken")
            if ran_off_target_date or not pagination_token:
                break

    return sorted(records.values(), key=lambda r: r.timestamp)


def main() -> None:
    date_str = sys.argv[1] if len(sys.argv) > 1 else datetime.now(tz=timing.SGT).strftime("%Y-%m-%d")

    print(f"fetching NEA radar frames for date={date_str} range={RADAR_RANGE}")
    records = fetch_day_records(date_str, NEA_API_KEY, RADAR_RANGE)
    print(f"found {len(records)} frames")

    uploaded_count = 0
    skipped_count = 0
    for record in records:
        image_bytes = nea_client.download_image_bytes(record.image_url)
        image_key = timing.format_image_key(record.timestamp, RADAR_RANGE)
        json_key = timing.format_json_key(record.timestamp, RADAR_RANGE)

        image_uploaded = s3_writer.upload_if_absent(RADAR_BUCKET_NAME, image_key, image_bytes)
        s3_writer.upload_if_absent(
            RADAR_BUCKET_NAME, json_key, record.raw_response, content_type="application/json"
        )

        if image_uploaded:
            uploaded_count += 1
        else:
            skipped_count += 1
        print(f"{record.timestamp.isoformat()}: s3://{RADAR_BUCKET_NAME}/{image_key} "
              f"({'uploaded' if image_uploaded else 'already exists'})")

    print(f"done: {uploaded_count} uploaded, {skipped_count} already existed")


if __name__ == "__main__":
    main()
