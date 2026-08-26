import logging

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

_s3_client = None


def _client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3")
    return _s3_client


def _object_exists(bucket: str, key: str) -> bool:
    try:
        _client().head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as error:
        code = error.response["Error"]["Code"]
        if code in ("404", "NoSuchKey"):
            return False
        logger.error("head_object failed for s3://%s/%s: %s", bucket, key, error)
        raise


def upload_if_absent(bucket: str, key: str, body: bytes) -> bool:
    if _object_exists(bucket, key):
        logger.info("s3://%s/%s already exists, skipping upload", bucket, key)
        return False

    try:
        _client().put_object(Bucket=bucket, Key=key, Body=body, ContentType="image/png")
    except ClientError as error:
        logger.error("put_object failed for s3://%s/%s: %s", bucket, key, error)
        raise

    logger.info("uploaded s3://%s/%s (%d bytes)", bucket, key, len(body))
    return True
