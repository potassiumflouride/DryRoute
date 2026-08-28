from __future__ import annotations

import asyncio

import pytest

from loadtest.config import LoadConfig
from loadtest.scheduler import LoadScheduler, phase_at


def test_default_five_minute_phase_boundaries() -> None:
    assert phase_at(0, 300, 50).name == "warm-up"
    assert phase_at(29.9, 300, 50).users == 10
    assert phase_at(30, 300, 50).name == "ramp"
    assert phase_at(60, 300, 50).name == "hold"
    assert phase_at(240, 300, 50).name == "burst"
    assert phase_at(255, 300, 50).name == "cool-down"
    assert phase_at(300, 300, 50).users == 0


class RecordingWorkloads:
    def __init__(self) -> None:
        self.active = 0
        self.peak_active = 0
        self.calls = 0

    async def iteration(self, _rng: object) -> None:
        self.active += 1
        self.peak_active = max(self.peak_active, self.active)
        self.calls += 1
        await asyncio.sleep(0.002)
        self.active -= 1


@pytest.mark.asyncio
async def test_scheduler_reaches_configured_peak_and_finishes() -> None:
    workloads = RecordingWorkloads()
    config = LoadConfig(
        profile="route",
        route_url="http://test/route",
        duration_seconds=0.5,
        max_users=5,
        think_time_min_seconds=0,
        think_time_max_seconds=0,
        request_timeout_seconds=0.5,
    )
    scheduler = LoadScheduler(config, workloads)  # type: ignore[arg-type]
    elapsed = await scheduler.run()
    assert elapsed >= 0.5
    assert workloads.peak_active == 5
    assert workloads.calls >= 5
    assert scheduler.phase_history == ["warm-up", "ramp", "hold", "burst", "cool-down"]
