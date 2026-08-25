from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, Response

from dryroute_api import geocoding, osrm, radar
from dryroute_api.geocoding import GeocodeResult
from dryroute_api.osrm import OsrmRoutingError, Route
from dryroute_api.radar import RadarFrame

router = APIRouter()


@router.get("/geocode")
async def geocode(q: str) -> list[GeocodeResult]:
    return await geocoding.search(q)


@router.get("/route")
async def get_route(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    waypoints: str | None = None,
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

    try:
        return await osrm.route(coordinates)
    except OsrmRoutingError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


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
