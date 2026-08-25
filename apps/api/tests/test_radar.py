from io import BytesIO

import pytest
import respx
from fastapi.testclient import TestClient
from httpx import Request, Response
from PIL import Image

from dryroute_api import radar
from dryroute_api.main import app

IMAGE_URL = "https://example-bucket.s3.amazonaws.com/frame.png"


@pytest.fixture(autouse=True)
def _no_backfill_spacing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(radar, "BACKFILL_REQUEST_SPACING_SECONDS", 0)


def _make_png_bytes(coverage_fraction: float) -> bytes:
    image = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    pixels = image.load()
    opaque_pixel_count = int(100 * coverage_fraction)
    for i in range(opaque_pixel_count):
        pixels[i % 10, i // 10] = (76, 110, 253, 255)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _nea_response(request: Request) -> Response:
    date_param = request.url.params.get("date")
    timestamp = f"{date_param}+08:00" if date_param else "2026-08-25T15:20:00+08:00"
    return Response(
        200,
        json={
            "code": 0,
            "errorMsg": "",
            "data": {
                "boundaryBox": {
                    "upperLeft": {"longitude": 101.810507, "latitude": 3.506012},
                    "lowerRight": {"longitude": 106.130495, "latitude": -0.809711},
                },
                "records": [
                    {
                        "timestamp": timestamp,
                        "updatedTimestamp": timestamp,
                        "image": {
                            "url": IMAGE_URL,
                            "urlExpiresAt": timestamp,
                            "label": "240km",
                            "range": "240km",
                            "format": "png",
                        },
                    }
                ],
                "paginationToken": None,
            },
        },
    )


def _mock_nea(coverage_fraction: float = 0.5) -> None:
    respx.get(url__regex=r"https://api-open\.data\.gov\.sg/.*weather-radar-images.*").mock(
        side_effect=_nea_response
    )
    respx.get(IMAGE_URL).mock(
        return_value=Response(200, content=_make_png_bytes(coverage_fraction))
    )


@respx.mock
def test_radar_frames_backfill_and_list() -> None:
    _mock_nea()

    with TestClient(app) as client:
        response = client.get("/radar/frames")
        assert response.status_code == 200
        frames = response.json()

        assert 1 <= len(frames) <= 12
        timestamps = [frame["timestamp"] for frame in frames]
        assert timestamps == sorted(timestamps)
        for frame in frames:
            assert "boundaryBox" in frame
            assert "upperLeft" in frame["boundaryBox"]
            assert "lowerRight" in frame["boundaryBox"]
            assert 0.0 <= frame["coverage"] <= 1.0
            assert "imageBytes" not in frame


@respx.mock
def test_radar_frame_image_returns_png() -> None:
    _mock_nea()

    with TestClient(app) as client:
        frames = client.get("/radar/frames").json()
        timestamp = frames[-1]["timestamp"]

        response = client.get(f"/radar/frames/{timestamp}.png")
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert Image.open(BytesIO(response.content)).format == "PNG"


@respx.mock
def test_radar_frame_image_unknown_timestamp_returns_404() -> None:
    _mock_nea()

    with TestClient(app) as client:
        response = client.get("/radar/frames/1999-01-01T00:00:00+08:00.png")
        assert response.status_code == 404


@respx.mock
def test_radar_frame_image_invalid_timestamp_returns_404() -> None:
    _mock_nea()

    with TestClient(app) as client:
        response = client.get("/radar/frames/not-a-timestamp.png")
        assert response.status_code == 404
