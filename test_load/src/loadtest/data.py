from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Point:
    lat: float
    lon: float


@dataclass(frozen=True)
class RouteCase:
    origin: Point
    destination: Point
    waypoints: tuple[Point, ...] = ()


# Spread requests across Singapore rather than repeatedly exercising one cached route.
ROUTE_CASES = (
    RouteCase(Point(1.3521, 103.8198), Point(1.3644, 103.9915)),
    RouteCase(Point(1.2801, 103.8509), Point(1.3048, 103.8318)),
    RouteCase(Point(1.3331, 103.7422), Point(1.4360, 103.7865)),
    RouteCase(Point(1.3502, 103.9496), Point(1.3173, 103.8923)),
    RouteCase(Point(1.2966, 103.7764), Point(1.4069, 103.9023)),
    RouteCase(Point(1.2838, 103.8591), Point(1.3521, 103.8198), (Point(1.3048, 103.8318),)),
    RouteCase(Point(1.3331, 103.7422), Point(1.3502, 103.9496), (Point(1.3521, 103.8198),)),
)

GEOCODE_QUERIES = (
    "Orchard Road",
    "Jurong East",
    "Changi Airport",
    "Woodlands Checkpoint",
    "Marina Bay",
    "Punggol",
    "National University of Singapore",
    "Tampines Mall",
)

TILE_CENTRES = (
    Point(1.3521, 103.8198),
    Point(1.2801, 103.8509),
    Point(1.3331, 103.7422),
    Point(1.3502, 103.9496),
    Point(1.4360, 103.7865),
    Point(1.2966, 103.7764),
)

TILE_MIN_ZOOM = 12
TILE_MAX_ZOOM = 15


def lon_lat_to_tile(point: Point, zoom: int) -> tuple[int, int]:
    """Convert WGS84 coordinates to a slippy-map XYZ tile."""
    latitude = min(max(point.lat, -85.05112878), 85.05112878)
    scale = 1 << zoom
    x = int((point.lon + 180.0) / 360.0 * scale)
    lat_radians = math.radians(latitude)
    y = int((1.0 - math.asinh(math.tan(lat_radians)) / math.pi) / 2.0 * scale)
    return min(max(x, 0), scale - 1), min(max(y, 0), scale - 1)
