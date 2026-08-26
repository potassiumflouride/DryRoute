import os
from datetime import datetime
from unittest.mock import patch

import pytest

os.environ.setdefault("RADAR_BUCKET_NAME", "test-bucket")

from radar_ingest import app, nea_client, timing


@pytest.fixture(autouse=True)
def _mock_bucket_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app, "RADAR_BUCKET_NAME", "test-bucket")


def _fake_record() -> nea_client.RadarRecord:
    return nea_client.RadarRecord(
        timestamp=datetime(2026, 8, 26, 15, 0, 0, tzinfo=timing.SGT),
        image_url="https://example-bucket.s3.amazonaws.com/frame.png",
    )


def test_handler_uploads_new_frame() -> None:
    with (
        patch.object(nea_client, "fetch_radar_record", return_value=_fake_record()),
        patch.object(nea_client, "download_image_bytes", return_value=b"png-bytes"),
        patch("radar_ingest.app.s3_writer.upload_if_absent", return_value=True) as upload,
    ):
        result = app.handler({}, None)

    assert result == {"statusCode": 200, "key": "2026-08-26/radar_240km_2026-08-26T15-00-00.png", "uploaded": True}
    upload.assert_called_once_with("test-bucket", "2026-08-26/radar_240km_2026-08-26T15-00-00.png", b"png-bytes")


def test_handler_skips_existing_frame() -> None:
    with (
        patch.object(nea_client, "fetch_radar_record", return_value=_fake_record()),
        patch.object(nea_client, "download_image_bytes", return_value=b"png-bytes"),
        patch("radar_ingest.app.s3_writer.upload_if_absent", return_value=False),
    ):
        result = app.handler({}, None)

    assert result["uploaded"] is False
