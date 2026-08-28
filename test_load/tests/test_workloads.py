from __future__ import annotations

import random

import httpx
import pytest

from loadtest.config import LoadConfig
from loadtest.metrics import Metrics
from loadtest.workloads import Workloads


def response_for(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/route":
        return httpx.Response(200, json={"legs": [{}], "distanceMeters": 1000, "durationSeconds": 100})
    if request.url.path == "/geocode":
        return httpx.Response(200, json=[{"name": "Place", "address": "Address", "lat": 1.3, "lon": 103.8}])
    if request.url.path.endswith(".mvt"):
        return httpx.Response(200, content=b"tile", headers={"content-type": "application/vnd.mapbox-vector-tile"})
    return httpx.Response(404)


@pytest.mark.asyncio
async def test_mixed_workload_records_every_service() -> None:
    config = LoadConfig(
        route_url="http://test/route",
        geocode_url="http://test/geocode",
        tiles_base_url="http://test",
        tiles_per_view=3,
    )
    config.validate()
    metrics = Metrics()
    async with Workloads(config, metrics, transport=httpx.MockTransport(response_for)) as workloads:
        await workloads.iteration(random.Random(1))
    summary = metrics.summary(1.0)
    assert summary["route"]["requests"] == 1
    assert summary["geocode"]["requests"] == 2
    assert summary["tiles"]["requests"] == 3
    assert all(group["failures"] == 0 for group in summary.values())


@pytest.mark.asyncio
async def test_invalid_route_response_is_recorded_as_failure() -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json={"legs": []}))
    config = LoadConfig(profile="route", route_url="http://test/route")
    metrics = Metrics()
    async with Workloads(config, metrics, transport=transport) as workloads:
        await workloads.route(random.Random(1))
    assert metrics.samples[0].error == "route response had no legs"


@pytest.mark.asyncio
async def test_tile_workload_never_exceeds_archive_max_zoom() -> None:
    requested_paths: list[str] = []

    def record_tile(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        return httpx.Response(200, content=b"tile", headers={"content-type": "application/x-protobuf"})

    config = LoadConfig(profile="tiles", tiles_base_url="http://test", tiles_per_view=1)
    metrics = Metrics()
    async with Workloads(config, metrics, transport=httpx.MockTransport(record_tile)) as workloads:
        for seed in range(100):
            await workloads.tiles(random.Random(seed))

    zooms = {int(path.split("/")[2]) for path in requested_paths}
    assert zooms == {12, 13, 14, 15}
