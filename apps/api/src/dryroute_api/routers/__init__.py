from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, Response

from dryroute_api import geocoding, radar
from dryroute_api.geocoding import GeocodeResult
from dryroute_api.radar import RadarFrame

router = APIRouter()


@router.get("/geocode")
async def geocode(q: str) -> list[GeocodeResult]:
    return await geocoding.search(q)


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
