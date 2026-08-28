import pytest
import respx
from httpx import Response

from radar_ingest import nea_client

IMAGE_URL = "https://example-bucket.s3.amazonaws.com/frame.png"


def _nea_response() -> Response:
    return Response(
        200,
        json={
            "code": 0,
            "errorMsg": "",
            "data": {
                "records": [
                    {
                        "timestamp": "2026-08-26T15:00:00+08:00",
                        "updatedTimestamp": "2026-08-26T15:00:00+08:00",
                        "image": {
                            "url": IMAGE_URL,
                            "urlExpiresAt": "2026-08-26T15:10:00+08:00",
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


@respx.mock
def test_fetch_radar_record_parses_response() -> None:
    route = respx.get(url__regex=r"https://api-open\.data\.gov\.sg/.*weather-radar-images.*").mock(
        return_value=_nea_response()
    )

    record = nea_client.fetch_radar_record(
        date="2026-08-26T15:00:00", api_key="test-key", radar_range="240km"
    )

    assert record.image_url == IMAGE_URL
    assert record.timestamp.isoformat() == "2026-08-26T15:00:00+08:00"
    assert record.raw_response == _nea_response().content
    assert route.calls.last.request.headers["x-api-key"] == "test-key"
    assert route.calls.last.request.url.params["date"] == "2026-08-26T15:00:00"


@respx.mock
def test_fetch_radar_record_retries_on_429(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nea_client, "RETRY_BACKOFF_SECONDS", 0)
    route = respx.get(url__regex=r"https://api-open\.data\.gov\.sg/.*weather-radar-images.*")
    route.side_effect = [Response(429), _nea_response()]

    record = nea_client.fetch_radar_record(date="2026-08-26T15:00:00", api_key="", radar_range="240km")

    assert record.image_url == IMAGE_URL
    assert route.call_count == 2


@respx.mock
def test_download_image_bytes() -> None:
    respx.get(IMAGE_URL).mock(return_value=Response(200, content=b"png-bytes"))

    assert nea_client.download_image_bytes(IMAGE_URL) == b"png-bytes"
