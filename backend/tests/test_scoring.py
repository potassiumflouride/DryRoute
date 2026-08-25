import asyncio
from datetime import UTC, datetime
from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from dryroute_api import scoring
from dryroute_api.radar import BoundaryBox, BoundaryPoint, RadarFrame, RadarStore

WIDTH = 100
HEIGHT = 100

BOUNDARY_BOX = BoundaryBox(
    upperLeft=BoundaryPoint(longitude=103.0, latitude=1.5),
    lowerRight=BoundaryPoint(longitude=104.0, latitude=1.0),
)


def _square_png_bytes(top: int, left: int, bottom: int, right: int) -> bytes:
    pixels = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    pixels[top:bottom, left:right, 3] = 255
    image = Image.fromarray(pixels, mode="RGBA")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


# A compact rain cell (~22km x 5.5km over this BOUNDARY_BOX's scale) that stays
# comfortably under the total-perimeter budget scoring enforces for Valhalla's
# exclude_polygons circumference limit.
SMALL_SQUARE = {"top": 45, "left": 40, "bottom": 55, "right": 60}


def test_extract_polygons_maps_square_to_expected_lonlat_bounds() -> None:
    image_bytes = _square_png_bytes(**SMALL_SQUARE)

    polygons = scoring._extract_polygons(image_bytes, BOUNDARY_BOX)

    assert len(polygons) == 1
    lons = [lon for lon, _ in polygons[0]]
    lats = [lat for _, lat in polygons[0]]

    expected_min_lon = BOUNDARY_BOX.upper_left.longitude + (SMALL_SQUARE["left"] / (WIDTH - 1)) * (
        BOUNDARY_BOX.lower_right.longitude - BOUNDARY_BOX.upper_left.longitude
    )
    expected_max_lon = BOUNDARY_BOX.upper_left.longitude + (SMALL_SQUARE["right"] / (WIDTH - 1)) * (
        BOUNDARY_BOX.lower_right.longitude - BOUNDARY_BOX.upper_left.longitude
    )
    assert min(lons) == pytest.approx(expected_min_lon, abs=0.02)
    assert max(lons) == pytest.approx(expected_max_lon, abs=0.02)

    expected_max_lat = BOUNDARY_BOX.upper_left.latitude + (SMALL_SQUARE["top"] / (HEIGHT - 1)) * (
        BOUNDARY_BOX.lower_right.latitude - BOUNDARY_BOX.upper_left.latitude
    )
    expected_min_lat = BOUNDARY_BOX.upper_left.latitude + (SMALL_SQUARE["bottom"] / (HEIGHT - 1)) * (
        BOUNDARY_BOX.lower_right.latitude - BOUNDARY_BOX.upper_left.latitude
    )
    assert min(lats) == pytest.approx(expected_min_lat, abs=0.02)
    assert max(lats) == pytest.approx(expected_max_lat, abs=0.02)


def test_extract_polygons_returns_empty_for_blank_frame() -> None:
    image_bytes = _square_png_bytes(top=0, left=0, bottom=0, right=0)
    assert scoring._extract_polygons(image_bytes, BOUNDARY_BOX) == []


def test_extract_polygons_drops_polygon_exceeding_perimeter_budget() -> None:
    # A rain band spanning most of the frame - far larger than Valhalla's
    # exclude_polygons circumference limit could ever accommodate - should be
    # dropped rather than sent to the routing engine and rejected wholesale.
    image_bytes = _square_png_bytes(top=20, left=10, bottom=80, right=60)
    assert scoring._extract_polygons(image_bytes, BOUNDARY_BOX) == []


def test_current_rain_polygons_returns_empty_without_frames() -> None:
    store = RadarStore()
    assert asyncio.run(scoring.current_rain_polygons(store)) == []


def test_current_rain_polygons_returns_empty_when_store_is_none() -> None:
    assert asyncio.run(scoring.current_rain_polygons(None)) == []


def test_current_rain_polygons_disabled_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    from dryroute_api.config import settings

    monkeypatch.setattr(settings, "rain_avoidance_enabled", False)

    async def _seed_and_check() -> list[list[tuple[float, float]]]:
        store = RadarStore()
        image_bytes = _square_png_bytes(**SMALL_SQUARE)
        frame = RadarFrame(timestamp=datetime.now(tz=UTC), boundaryBox=BOUNDARY_BOX, coverage=0.5)
        await store.add(frame, image_bytes)
        return await scoring.current_rain_polygons(store)

    assert asyncio.run(_seed_and_check()) == []
