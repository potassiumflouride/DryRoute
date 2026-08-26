import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

NEA_RADAR_BASE_URL = "https://api-open.data.gov.sg/v2/real-time/api"

# NEA's API rate-limits bursts of requests (observed 429s), so requests are
# retried with backoff rather than failing the invocation outright.
MAX_RETRIES = 5
RETRY_BACKOFF_SECONDS = 2.0


@dataclass
class RadarRecord:
    timestamp: datetime
    image_url: str
    raw_response: bytes


def _get_with_retry(client: httpx.Client, url: str, **kwargs: Any) -> httpx.Response:
    response = None
    for attempt in range(MAX_RETRIES):
        response = client.get(url, **kwargs)
        if response.status_code != httpx.codes.TOO_MANY_REQUESTS:
            if response.is_error:
                logger.error(
                    "request to %s failed: %s %s", url, response.status_code, response.text[:500]
                )
            response.raise_for_status()
            return response
        wait_seconds = RETRY_BACKOFF_SECONDS * (attempt + 1)
        logger.warning(
            "429 from %s (attempt %d/%d), retrying in %.1fs",
            url,
            attempt + 1,
            MAX_RETRIES,
            wait_seconds,
        )
        time.sleep(wait_seconds)
    assert response is not None
    logger.error("exhausted %d retries against %s, still 429", MAX_RETRIES, url)
    response.raise_for_status()
    return response


def fetch_radar_record(date: str, api_key: str, radar_range: str) -> RadarRecord:
    url = f"{NEA_RADAR_BASE_URL}/weather-radar-images/{radar_range}"
    logger.info("fetching radar record for date=%s from %s", date, url)
    with httpx.Client() as client:
        response = _get_with_retry(
            client,
            url,
            headers={"x-api-key": api_key} if api_key else {},
            params={"date": date},
            timeout=10.0,
        )
        raw_response = response.content
        payload = response.json()["data"]

    records = payload.get("records") or []
    if not records:
        logger.error("NEA returned no records for date=%s", date)
        raise ValueError(f"NEA returned no records for date={date}")

    record = records[0]
    parsed = RadarRecord(
        timestamp=datetime.fromisoformat(record["timestamp"]),
        image_url=record["image"]["url"],
        raw_response=raw_response,
    )
    logger.info("NEA record timestamp=%s image_url=%s", parsed.timestamp, parsed.image_url)
    return parsed


def download_image_bytes(url: str) -> bytes:
    logger.info("downloading radar image from presigned URL")
    with httpx.Client() as client:
        response = _get_with_retry(client, url, timeout=10.0)
        body = response.content
        logger.info("downloaded radar image (%d bytes)", len(body))
        return body
