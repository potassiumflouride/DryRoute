import logging
from typing import Literal

import httpx
from pydantic import BaseModel

from dryroute_api.config import settings

logger = logging.getLogger(__name__)

TravelMode = Literal["foot", "bicycle", "motorcycle"]

# Mirrors frontend/src/types.ts's TravelMode by hand (kept in sync manually,
# same convention already used for GeocodeResult/Route across the language boundary).
_COSTING_BY_MODE: dict[TravelMode, str] = {
    "foot": "pedestrian",
    "bicycle": "bicycle",
    "motorcycle": "motorcycle",
}


class ValhallaRoutingError(Exception):
    pass


class RouteLeg(BaseModel):
    geometry: dict
    distanceMeters: float
    durationSeconds: float


class Route(BaseModel):
    legs: list[RouteLeg]
    distanceMeters: float
    durationSeconds: float


# Valhalla's public demo instance does not honor "shape_format": "geojson" for
# /route (it always returns the default Google-style encoded polyline), so the
# shape is decoded by hand rather than requested pre-formatted. Precision 6
# matches Valhalla's default "polyline6" encoding.
_POLYLINE_PRECISION = 6


def _decode_polyline(encoded: str, precision: int = _POLYLINE_PRECISION) -> list[tuple[float, float]]:
    inverse_precision = 10**-precision
    coordinates: list[tuple[float, float]] = []
    index = 0
    lat = 0
    lon = 0

    while index < len(encoded):
        for is_lat in (True, False):
            shift = 0
            result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else (result >> 1)
            if is_lat:
                lat += delta
            else:
                lon += delta
        coordinates.append((lon * inverse_precision, lat * inverse_precision))

    return coordinates


def _request_body(
    coordinates: list[tuple[float, float]],
    mode: TravelMode,
    exclude_polygons: list[list[tuple[float, float]]] | None,
) -> dict:
    body: dict = {
        "locations": [{"lat": lat, "lon": lon} for lon, lat in coordinates],
        "costing": _COSTING_BY_MODE[mode],
        "units": "kilometers",
    }
    if exclude_polygons:
        body["exclude_polygons"] = [[[lon, lat] for lon, lat in polygon] for polygon in exclude_polygons]
    return body


def _parse_route(payload: dict) -> Route:
    trip = payload.get("trip")
    if trip is None:
        raise ValhallaRoutingError(payload.get("error", "Valhalla routing failed"))

    legs = [
        RouteLeg(
            geometry={"type": "LineString", "coordinates": _decode_polyline(leg["shape"])},
            distanceMeters=leg["summary"]["length"] * 1000,
            durationSeconds=leg["summary"]["time"],
        )
        for leg in trip["legs"]
    ]

    return Route(
        legs=legs,
        distanceMeters=sum(leg.distanceMeters for leg in legs),
        durationSeconds=sum(leg.durationSeconds for leg in legs),
    )


async def _post_route(client: httpx.AsyncClient, body: dict) -> dict:
    response = await client.post(f"{settings.valhalla_url}/route", json=body, timeout=10.0)
    return response.json()


async def route(
    coordinates: list[tuple[float, float]],
    mode: TravelMode,
    exclude_polygons: list[list[tuple[float, float]]] | None = None,
) -> Route:
    if len(coordinates) < 2:
        raise ValhallaRoutingError("At least two coordinates are required to route")

    async with httpx.AsyncClient() as client:
        payload = await _post_route(client, _request_body(coordinates, mode, exclude_polygons))

        if payload.get("trip") is None and exclude_polygons:
            logger.warning(
                "Valhalla route failed with exclude_polygons (%s); retrying without rain avoidance",
                payload.get("error", "unknown error"),
            )
            payload = await _post_route(client, _request_body(coordinates, mode, None))

    return _parse_route(payload)
