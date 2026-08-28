from io import BytesIO

import numpy as np
from PIL import Image
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from skimage import measure

from dryroute_api.config import settings
from dryroute_api.radar import BoundaryBox, RadarStore

MIN_POLYGON_VERTICES = 4
SIMPLIFY_TOLERANCE_DEGREES = 0.001
_METERS_PER_DEGREE = 111_320  # good enough approximation this close to the equator

# Valhalla's public demo instance rejects a request once the *combined*
# circumference of all exclude_polygons rings exceeds 100km ("Exceeded maximum
# circumference for exclude_polygons: 100000 meters"), observed empirically.
# Stay well under that so a single request isn't perpetually falling back to
# "no rain avoidance" during widespread rain coverage.
MAX_TOTAL_PERIMETER_METERS = 80_000
MAX_SIMPLIFY_ATTEMPTS = 6


def _pixel_to_lonlat(row: float, col: float, width: int, height: int, boundary_box: BoundaryBox) -> tuple[float, float]:
    upper_left = boundary_box.upper_left
    lower_right = boundary_box.lower_right
    lon = upper_left.longitude + (col / (width - 1)) * (lower_right.longitude - upper_left.longitude)
    lat = upper_left.latitude + (row / (height - 1)) * (lower_right.latitude - upper_left.latitude)
    return lon, lat


def _simplify_under_budget(polygon: Polygon, max_perimeter_meters: float) -> Polygon | None:
    tolerance = SIMPLIFY_TOLERANCE_DEGREES
    simplified = polygon
    for _ in range(MAX_SIMPLIFY_ATTEMPTS):
        simplified = polygon.simplify(tolerance, preserve_topology=True)
        if simplified.is_empty:
            return None
        if simplified.length * _METERS_PER_DEGREE <= max_perimeter_meters:
            return simplified
        tolerance *= 2
    return None


def _extract_polygons(image_bytes: bytes, boundary_box: BoundaryBox) -> list[list[tuple[float, float]]]:
    image = Image.open(BytesIO(image_bytes)).convert("RGBA")
    alpha = np.asarray(image)[:, :, 3]
    height, width = alpha.shape

    mask = (alpha > settings.rain_alpha_threshold).astype(float)
    contours = measure.find_contours(mask, level=0.5)

    candidates: list[Polygon] = []
    for contour in contours:
        if len(contour) < MIN_POLYGON_VERTICES:
            continue

        ring = [_pixel_to_lonlat(row, col, width, height, boundary_box) for row, col in contour]
        polygon = Polygon(ring)
        if not polygon.is_valid or polygon.area == 0:
            continue

        candidates.append(polygon)

    # Larger rain cells matter more for routing - simplify/admit them first so
    # the combined-perimeter budget favors significant coverage over noise.
    candidates.sort(key=lambda p: p.area, reverse=True)

    polygons: list[list[tuple[float, float]]] = []
    remaining_budget = MAX_TOTAL_PERIMETER_METERS
    for polygon in candidates:
        if remaining_budget <= 0:
            break
        simplified = _simplify_under_budget(polygon, remaining_budget)
        if simplified is None:
            continue
        remaining_budget -= simplified.length * _METERS_PER_DEGREE
        polygons.append(list(simplified.exterior.coords))

    return polygons


def rain_intersections(
    coordinates: list[tuple[float, float]], polygons: list[list[tuple[float, float]]]
) -> list[list[tuple[float, float]]]:
    """Portions of a route line (lon/lat coords) that fall inside the given rain polygons."""
    if not polygons or len(coordinates) < 2:
        return []

    line = LineString(coordinates)
    rain_area = unary_union([Polygon(ring) for ring in polygons])
    overlap = line.intersection(rain_area)

    if overlap.is_empty:
        return []
    if isinstance(overlap, LineString):
        return [list(overlap.coords)]
    if hasattr(overlap, "geoms"):
        return [list(geom.coords) for geom in overlap.geoms if isinstance(geom, LineString)]
    return []


async def current_rain_polygons(store: RadarStore | None) -> list[list[tuple[float, float]]]:
    """Rain coverage polygons (lon/lat rings) derived from the latest NEA radar frame."""
    if not settings.rain_avoidance_enabled:
        return []
    if store is None:
        return []

    latest = await store.latest()
    if latest is None:
        return []

    frame, image_bytes = latest
    return _extract_polygons(image_bytes, frame.boundary_box)
