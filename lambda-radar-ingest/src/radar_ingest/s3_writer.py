import boto3
from botocore.exceptions import ClientError

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
        if error.response["Error"]["Code"] in ("404", "NoSuchKey"):
            return False
        raise


def upload_if_absent(bucket: str, key: str, body: bytes) -> bool:
    if _object_exists(bucket, key):
        return False
    _client().put_object(Bucket=bucket, Key=key, Body=body, ContentType="image/png")
    return True
