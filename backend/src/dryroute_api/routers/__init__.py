from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, Response

from dryroute_api import geocoding, radar, scoring, valhalla
from dryroute_api.geocoding import GeocodeResult
from dryroute_api.radar import RadarFrame
from dryroute_api.valhalla import Route, TravelMode, ValhallaRoutingError

router = APIRouter()


@router.get("/geocode")
async def geocode(q: str) -> list[GeocodeResult]:
    return await geocoding.search(q)


@router.get("/route")
async def get_route(
    request: Request,
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    waypoints: str | None = None,
    mode: TravelMode = "motorcycle",
) -> Route:
    coordinates = [(origin_lon, origin_lat)]
    if waypoints:
        try:
            for pair in waypoints.split(";"):
                lat_str, lon_str = pair.split(",")
                coordinates.append((float(lon_str), float(lat_str)))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Malformed waypoints parameter") from exc
    coordinates.append((dest_lon, dest_lat))

    store: radar.RadarStore | None = getattr(request.app.state, "radar_store", None)
    exclude_polygons = await scoring.current_rain_polygons(store)

    try:
        route = await valhalla.route(coordinates, mode, exclude_polygons)
    except ValhallaRoutingError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if exclude_polygons:
        for leg in route.legs:
            segments = scoring.rain_intersections(leg.geometry["coordinates"], exclude_polygons)
            leg.rainSegments = [{"type": "LineString", "coordinates": s} for s in segments] or None

    return route


@router.get("/radar/frames")
async def radar_frames(request: Request) -> list[RadarFrame]:
    store: radar.RadarStore = request.app.state.radar_store
    return await store.list_frames()


@router.get("/radar/frames/{timestamp}.png")
async def radar_frame_image(timestamp: str, request: Request) -> Response:
    try:
        parsed_timestamp = datetime.fromisoformat(timestamp)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Radar frame not found") from exc

    store: radar.RadarStore = request.app.state.radar_store
    image_bytes = await store.get_image(parsed_timestamp)
    if image_bytes is None:
        raise HTTPException(status_code=404, detail="Radar frame not found")
    return Response(content=image_bytes, media_type="image/png")
