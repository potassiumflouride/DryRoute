from __future__ import annotations

import asyncio
import json
import random
import time
from collections.abc import Callable
from typing import Self
from urllib.parse import urljoin

import httpx

from loadtest.config import LoadConfig
from loadtest.data import GEOCODE_QUERIES, ROUTE_CASES, TILE_CENTRES, TILE_MAX_ZOOM, TILE_MIN_ZOOM, lon_lat_to_tile
from loadtest.metrics import Metrics, RequestSample


class Workloads:
    def __init__(
        self,
        config: LoadConfig,
        metrics: Metrics,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.config = config
        self.metrics = metrics
        limits = httpx.Limits(max_connections=max(100, config.max_users * config.tiles_per_view + 20))
        timeout = httpx.Timeout(config.request_timeout_seconds)
        self.client = httpx.AsyncClient(timeout=timeout, limits=limits, transport=transport, follow_redirects=True)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.client.aclose()

    async def iteration(self, rng: random.Random, profile: str | None = None) -> None:
        selected = profile or self.config.profile
        if selected == "mixed":
            await self.geocode(rng)
            await self.geocode(rng)
            await self.route(rng)
            await self.tiles(rng)
        elif selected == "route":
            await self.route(rng)
        elif selected == "geocode":
            await self.geocode(rng)
        elif selected == "tiles":
            await self.tiles(rng)
        else:
            raise ValueError(f"unsupported profile: {selected}")

    async def route(self, rng: random.Random) -> None:
        case = rng.choice(ROUTE_CASES)
        params: dict[str, str | float] = {
            "origin_lat": case.origin.lat,
            "origin_lon": case.origin.lon,
            "dest_lat": case.destination.lat,
            "dest_lon": case.destination.lon,
        }
        if case.waypoints:
            params["waypoints"] = ";".join(f"{point.lat},{point.lon}" for point in case.waypoints)

        def validate(response: httpx.Response) -> str | None:
            try:
                payload = response.json()
            except json.JSONDecodeError:
                return "route response was not JSON"
            if not isinstance(payload, dict) or not payload.get("legs"):
                return "route response had no legs"
            if not isinstance(payload.get("distanceMeters"), (int, float)):
                return "route response had no distanceMeters"
            if not isinstance(payload.get("durationSeconds"), (int, float)):
                return "route response had no durationSeconds"
            return None

        await self._request("route", self.config.route_url, self.config.route_headers, params, validate)

    async def geocode(self, rng: random.Random) -> None:
        query = rng.choice(GEOCODE_QUERIES)

        def validate(response: httpx.Response) -> str | None:
            try:
                payload = response.json()
            except json.JSONDecodeError:
                return "geocode response was not JSON"
            if self.config.geocode_style == "backend":
                if not isinstance(payload, list):
                    return "backend geocode response was not a list"
            elif not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
                return "OneMap gateway response had no results list"
            return None

        params = (
            {"q": query}
            if self.config.geocode_style == "backend"
            else {"searchVal": query, "returnGeom": "Y", "getAddrDetails": "Y", "pageNum": "1"}
        )
        await self._request("geocode", self.config.geocode_url, self.config.geocode_headers, params, validate)

    async def tiles(self, rng: random.Random) -> None:
        centre = rng.choice(TILE_CENTRES)
        zoom = rng.randint(TILE_MIN_ZOOM, TILE_MAX_ZOOM)
        centre_x, centre_y = lon_lat_to_tile(centre, zoom)
        offsets = [(0, 0), (1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (-1, 1), (1, -1), (-1, -1)]
        rng.shuffle(offsets)
        requests = []
        for dx, dy in offsets[: self.config.tiles_per_view]:
            path = self.config.tiles_path_template.format(
                archive=self.config.tiles_archive,
                z=zoom,
                x=centre_x + dx,
                y=centre_y + dy,
            )
            url = urljoin(f"{self.config.tiles_base_url.rstrip('/')}/", path.lstrip("/"))
            requests.append(self._request("tiles", url, self.config.tiles_headers, None, self._validate_tile))
        await asyncio.gather(*requests)

    @staticmethod
    def _validate_tile(response: httpx.Response) -> str | None:
        if not response.content:
            return "tile response was empty"
        content_type = response.headers.get("content-type", "").lower()
        accepted = ("protobuf", "mapbox-vector-tile", "octet-stream")
        if content_type and not any(value in content_type for value in accepted):
            return f"unexpected tile content type: {content_type[:80]}"
        return None

    async def _request(
        self,
        service: str,
        url: str | None,
        headers: dict[str, str],
        params: dict[str, str | float] | None,
        validator: Callable[[httpx.Response], str | None],
    ) -> None:
        if url is None:
            raise RuntimeError(f"{service} URL was not configured")
        started = time.perf_counter()
        status_code: int | None = None
        response_bytes = 0
        error: str | None = None
        try:
            response = await self.client.get(url, params=params, headers=headers)
            status_code = response.status_code
            response_bytes = len(response.content)
            if not 200 <= response.status_code < 300:
                error = f"HTTP {response.status_code}"
            else:
                error = validator(response)
        except httpx.HTTPError as exc:
            error = type(exc).__name__
        self.metrics.record(
            RequestSample(
                service=service,
                elapsed_seconds=time.perf_counter() - started,
                success=error is None,
                status_code=status_code,
                response_bytes=response_bytes,
                error=error,
            )
        )
