import asyncio

import httpx
from pydantic import BaseModel

OSRM_DEMO_BASE_URL = "https://router.project-osrm.org"

# The public OSRM demo server only exposes a "driving" profile - there is no
# dedicated motorcycle profile available. "driving" is used as the closest
# available approximation until a self-hosted motorcycle OSRM instance
# (see config.py's osrm_motorcycle_url) is stood up.
PROFILE = "driving"


class OsrmRoutingError(Exception):
    pass


class RouteLeg(BaseModel):
    geometry: dict
    distanceMeters: float
    durationSeconds: float


class Route(BaseModel):
    legs: list[RouteLeg]
    distanceMeters: float
    durationSeconds: float


async def _route_leg(client: httpx.AsyncClient, origin: tuple[float, float], destination: tuple[float, float]) -> RouteLeg:
    origin_lon, origin_lat = origin
    dest_lon, dest_lat = destination
    coordinates = f"{origin_lon},{origin_lat};{dest_lon},{dest_lat}"

    response = await client.get(
        f"{OSRM_DEMO_BASE_URL}/route/v1/{PROFILE}/{coordinates}",
        params={"overview": "full", "geometries": "geojson"},
        timeout=10.0,
    )
    response.raise_for_status()
    payload = response.json()

    if payload.get("code") != "Ok":
        raise OsrmRoutingError(payload.get("message", "OSRM routing failed"))

    route = payload["routes"][0]
    return RouteLeg(
        geometry=route["geometry"],
        distanceMeters=route["distance"],
        durationSeconds=route["duration"],
    )


async def route(coordinates: list[tuple[float, float]]) -> Route:
    if len(coordinates) < 2:
        raise OsrmRoutingError("At least two coordinates are required to route")

    async with httpx.AsyncClient() as client:
        legs = await asyncio.gather(
            *(
                _route_leg(client, coordinates[i], coordinates[i + 1])
                for i in range(len(coordinates) - 1)
            )
        )

    return Route(
        legs=list(legs),
        distanceMeters=sum(leg.distanceMeters for leg in legs),
        durationSeconds=sum(leg.durationSeconds for leg in legs),
    )
