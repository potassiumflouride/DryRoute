import logging
import os
from datetime import datetime
from typing import Any

from . import nea_client, s3_writer, timing

# The Lambda runtime pre-attaches a root handler wired to CloudWatch Logs, so
# basicConfig() is a no-op there; setLevel explicitly so INFO logs surface both
# in Lambda and when running locally (where no handler exists yet).
logging.basicConfig(level=logging.INFO)
logging.getLogger().setLevel(logging.INFO)
logger = logging.getLogger(__name__)

NEA_API_KEY = os.environ.get("NEA_API_KEY", "")
RADAR_BUCKET_NAME = os.environ["RADAR_BUCKET_NAME"]
RADAR_RANGE = os.environ.get("RADAR_RANGE", "240km")


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    request_id = getattr(context, "aws_request_id", "local")
    now = datetime.now(tz=timing.SGT)
    target = timing.compute_target_timestamp(now)

    logger.info(
        "invocation start request_id=%s now=%s target=%s bucket=%s range=%s",
        request_id,
        now.isoformat(),
        target.isoformat(),
        RADAR_BUCKET_NAME,
        RADAR_RANGE,
    )

    try:
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
        image_key = timing.format_image_key(record.timestamp, RADAR_RANGE)
        json_key = timing.format_json_key(record.timestamp, RADAR_RANGE)
        image_uploaded = s3_writer.upload_if_absent(RADAR_BUCKET_NAME, image_key, image_bytes)
        json_uploaded = s3_writer.upload_if_absent(
            RADAR_BUCKET_NAME, json_key, record.raw_response, content_type="application/json"
        )
    except Exception:
        logger.exception("invocation failed request_id=%s target=%s", request_id, target.isoformat())
        raise

    logger.info(
        "invocation done request_id=%s image_key=%s image_result=%s json_key=%s json_result=%s bytes=%d",
        request_id,
        image_key,
        "uploaded" if image_uploaded else "skipped (already exists)",
        json_key,
        "uploaded" if json_uploaded else "skipped (already exists)",
        len(image_bytes),
    )

    return {
        "statusCode": 200,
        "imageKey": image_key,
        "imageUploaded": image_uploaded,
        "jsonKey": json_key,
        "jsonUploaded": json_uploaded,
    }
