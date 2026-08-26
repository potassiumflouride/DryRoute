from datetime import datetime

from radar_ingest import timing


def _sgt(*, hour: int, minute: int, second: int = 0) -> datetime:
    return datetime(2026, 8, 26, hour, minute, second, tzinfo=timing.SGT)


def test_floor_to_interval_rounds_down_to_five_minutes() -> None:
    assert timing.floor_to_interval(_sgt(hour=15, minute=1)) == _sgt(hour=15, minute=0)
    assert timing.floor_to_interval(_sgt(hour=15, minute=4, second=59)) == _sgt(hour=15, minute=0)
    assert timing.floor_to_interval(_sgt(hour=15, minute=5, second=3)) == _sgt(hour=15, minute=5)


def test_floor_to_interval_is_idempotent_on_boundary() -> None:
    assert timing.floor_to_interval(_sgt(hour=15, minute=0)) == _sgt(hour=15, minute=0)


def test_compute_target_timestamp_uses_sgt() -> None:
    now = _sgt(hour=15, minute=1)
    assert timing.compute_target_timestamp(now) == _sgt(hour=15, minute=0)


def test_format_s3_key() -> None:
    key = timing.format_s3_key(_sgt(hour=15, minute=0), "240km")
    assert key == "2026-08-26/radar_240km_2026-08-26T15-00-00.png"


def test_format_date_param() -> None:
    assert timing.format_date_param(_sgt(hour=15, minute=0)) == "2026-08-26T15:00:00"
