import asyncio
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from io import BytesIO
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import numpy as np
from PIL import Image
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

NEA_RADAR_BASE_URL = "https://api-open.data.gov.sg/v2/real-time/api"
RADAR_RANGE = "240km"
FRAME_COUNT = 12
INTERVAL_MINUTES = 5
SGT = ZoneInfo("Asia/Singapore")

# NEA's API rate-limits bursts of requests (observed 429s when firing the 12
# backfill calls back-to-back), so requests are spaced out and retried with backoff.
BACKFILL_REQUEST_SPACING_SECONDS = 1.0
MAX_RETRIES = 5
RETRY_BACKOFF_SECONDS = 2.0


async def _get_with_retry(client: httpx.AsyncClient, url: str, **kwargs: Any) -> httpx.Response:
    for attempt in range(MAX_RETRIES):
        response = await client.get(url, **kwargs)
        if response.status_code != httpx.codes.TOO_MANY_REQUESTS:
            response.raise_for_status()
            return response
        await asyncio.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
    response.raise_for_status()
    return response


class BoundaryPoint(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    longitude: float
    latitude: float


class BoundaryBox(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    upper_left: BoundaryPoint
    lower_right: BoundaryPoint


class RadarFrame(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    timestamp: datetime
    boundary_box: BoundaryBox
    coverage: float


@dataclass
class RadarRecord:
    timestamp: datetime
    boundary_box: BoundaryBox
    image_url: str


async def fetch_radar_record(date: str | None = None) -> RadarRecord:
    async with httpx.AsyncClient() as client:
        response = await _get_with_retry(
            client,
            f"{NEA_RADAR_BASE_URL}/weather-radar-images/{RADAR_RANGE}",
            params={"date": date} if date else {},
            timeout=10.0,
        )
        payload = response.json()["data"]

    record = payload["records"][0]
    boundary = payload["boundaryBox"]
    return RadarRecord(
        timestamp=datetime.fromisoformat(record["timestamp"]),
        boundary_box=BoundaryBox(
            upper_left=BoundaryPoint(**boundary["upperLeft"]),
            lower_right=BoundaryPoint(**boundary["lowerRight"]),
        ),
        image_url=record["image"]["url"],
    )


async def download_image_bytes(url: str) -> bytes:
    async with httpx.AsyncClient() as client:
        response = await _get_with_retry(client, url, timeout=10.0)
        return response.content


def _compute_coverage(image_bytes: bytes) -> float:
    image = Image.open(BytesIO(image_bytes)).convert("RGBA")
    alpha = np.asarray(image)[:, :, 3]
    return float(np.count_nonzero(alpha)) / alpha.size


def build_frame(record: RadarRecord, image_bytes: bytes) -> RadarFrame:
    return RadarFrame(
        timestamp=record.timestamp,
        boundary_box=record.boundary_box,
        coverage=_compute_coverage(image_bytes),
    )


def _floor_to_interval(moment: datetime) -> datetime:
    floored_minute = moment.minute - (moment.minute % INTERVAL_MINUTES)
    return moment.replace(minute=floored_minute, second=0, microsecond=0)


@dataclass
class _StoredFrame:
    frame: RadarFrame
    image_bytes: bytes


class RadarStore:
    def __init__(self, maxlen: int = FRAME_COUNT) -> None:
        self._frames: deque[_StoredFrame] = deque(maxlen=maxlen)
        self._lock = asyncio.Lock()

    async def add(self, frame: RadarFrame, image_bytes: bytes) -> None:
        async with self._lock:
            if any(stored.frame.timestamp == frame.timestamp for stored in self._frames):
                return
            self._frames.append(_StoredFrame(frame=frame, image_bytes=image_bytes))

    async def list_frames(self) -> list[RadarFrame]:
        async with self._lock:
            return [stored.frame for stored in sorted(self._frames, key=lambda s: s.frame.timestamp)]

    async def get_image(self, timestamp: datetime) -> bytes | None:
        async with self._lock:
            for stored in self._frames:
                if stored.frame.timestamp == timestamp:
                    return stored.image_bytes
        return None

    async def latest(self) -> tuple[RadarFrame, bytes] | None:
        async with self._lock:
            if not self._frames:
                return None
            stored = max(self._frames, key=lambda s: s.frame.timestamp)
            return stored.frame, stored.image_bytes


async def backfill(store: RadarStore) -> None:
    floor = _floor_to_interval(datetime.now(tz=SGT))
    targets = [floor - timedelta(minutes=INTERVAL_MINUTES * i) for i in reversed(range(FRAME_COUNT))]

    for i, target in enumerate(targets):
        if i > 0:
            await asyncio.sleep(BACKFILL_REQUEST_SPACING_SECONDS)
        record = await fetch_radar_record(date=target.strftime("%Y-%m-%dT%H:%M:%S"))
        image_bytes = await download_image_bytes(record.image_url)
        await store.add(build_frame(record, image_bytes), image_bytes)


async def refresh_loop(store: RadarStore) -> None:
    while True:
        now = datetime.now(tz=SGT)
        next_boundary = _floor_to_interval(now) + timedelta(minutes=INTERVAL_MINUTES)
        wait_seconds = (next_boundary - now).total_seconds() + 5
        await asyncio.sleep(max(wait_seconds, 1))

        record = await fetch_radar_record()
        image_bytes = await download_image_bytes(record.image_url)
        await store.add(build_frame(record, image_bytes), image_bytes)
