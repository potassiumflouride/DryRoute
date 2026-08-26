import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

NEA_RADAR_BASE_URL = "https://api-open.data.gov.sg/v2/real-time/api"

# NEA's API rate-limits bursts of requests (observed 429s), so requests are
# retried with backoff rather than failing the invocation outright.
MAX_RETRIES = 5
RETRY_BACKOFF_SECONDS = 2.0


@dataclass
class RadarRecord:
    timestamp: datetime
    image_url: str


def _get_with_retry(client: httpx.Client, url: str, **kwargs: Any) -> httpx.Response:
    response = None
    for attempt in range(MAX_RETRIES):
        response = client.get(url, **kwargs)
        if response.status_code != httpx.codes.TOO_MANY_REQUESTS:
            response.raise_for_status()
            return response
        time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
    assert response is not None
    response.raise_for_status()
    return response


def fetch_radar_record(date: str, api_key: str, radar_range: str) -> RadarRecord:
    with httpx.Client() as client:
        response = _get_with_retry(
            client,
            f"{NEA_RADAR_BASE_URL}/weather-radar-images/{radar_range}",
            headers={"x-api-key": api_key} if api_key else {},
            params={"date": date},
            timeout=10.0,
        )
        payload = response.json()["data"]

    record = payload["records"][0]
    return RadarRecord(
        timestamp=datetime.fromisoformat(record["timestamp"]),
        image_url=record["image"]["url"],
    )


def download_image_bytes(url: str) -> bytes:
    with httpx.Client() as client:
        response = _get_with_retry(client, url, timeout=10.0)
        return response.content
