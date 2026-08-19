from fastapi import APIRouter

from dryroute_api import geocoding
from dryroute_api.geocoding import GeocodeResult

router = APIRouter()


@router.get("/geocode")
async def geocode(q: str) -> list[GeocodeResult]:
    return await geocoding.search(q)
