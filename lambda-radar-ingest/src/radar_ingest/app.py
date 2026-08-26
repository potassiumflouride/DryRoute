import logging
import os
from datetime import datetime
from typing import Any

from . import nea_client, s3_writer, timing

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

NEA_API_KEY = os.environ.get("NEA_API_KEY", "")
RADAR_BUCKET_NAME = os.environ["RADAR_BUCKET_NAME"]
RADAR_RANGE = os.environ.get("RADAR_RANGE", "240km")


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    now = datetime.now(tz=timing.SGT)
    target = timing.compute_target_timestamp(now)

    record = nea_client.fetch_radar_record(
        date=timing.format_date_param(target),
        api_key=NEA_API_KEY,
        radar_range=RADAR_RANGE,
    )
    if record.timestamp != target:
        logger.warning(
            "NEA record timestamp %s differs from computed target %s; using NEA's timestamp",
            record.timestamp,
            target,
        )

    image_bytes = nea_client.download_image_bytes(record.image_url)
    key = timing.format_s3_key(record.timestamp, RADAR_RANGE)
    uploaded = s3_writer.upload_if_absent(RADAR_BUCKET_NAME, key, image_bytes)

    logger.info(
        "radar frame %s: %s (%d bytes)",
        key,
        "uploaded" if uploaded else "skipped (already exists)",
        len(image_bytes),
    )

    return {"statusCode": 200, "key": key, "uploaded": uploaded}
