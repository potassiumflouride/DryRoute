from datetime import datetime
from zoneinfo import ZoneInfo

SGT = ZoneInfo("Asia/Singapore")
INTERVAL_MINUTES = 5


def floor_to_interval(moment: datetime) -> datetime:
    floored_minute = moment.minute - (moment.minute % INTERVAL_MINUTES)
    return moment.replace(minute=floored_minute, second=0, microsecond=0)


def compute_target_timestamp(now: datetime) -> datetime:
    return floor_to_interval(now.astimezone(SGT))


def _filename_stem(timestamp: datetime, radar_range: str) -> str:
    sgt_timestamp = timestamp.astimezone(SGT)
    return f"radar_{radar_range}_{sgt_timestamp.strftime('%Y-%m-%dT%H-%M-%S')}"


def format_image_key(timestamp: datetime, radar_range: str) -> str:
    date_prefix = timestamp.astimezone(SGT).strftime("%Y-%m-%d")
    return f"{date_prefix}/img/{_filename_stem(timestamp, radar_range)}.png"


def format_json_key(timestamp: datetime, radar_range: str) -> str:
    date_prefix = timestamp.astimezone(SGT).strftime("%Y-%m-%d")
    return f"{date_prefix}/json/{_filename_stem(timestamp, radar_range)}.json"


def format_date_param(timestamp: datetime) -> str:
    return timestamp.strftime("%Y-%m-%dT%H:%M:%S")


__all__ = [
    "SGT",
    "compute_target_timestamp",
    "floor_to_interval",
    "format_date_param",
    "format_image_key",
    "format_json_key",
]
