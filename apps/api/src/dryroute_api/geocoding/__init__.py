import httpx
from pydantic import BaseModel

ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"


class GeocodeResult(BaseModel):
    name: str
    address: str
    lat: float
    lon: float


async def search(query: str) -> list[GeocodeResult]:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            ONEMAP_SEARCH_URL,
            params={
                "searchVal": query,
                "returnGeom": "Y",
                "getAddrDetails": "Y",
                "pageNum": 1,
            },
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()

    def _name(result: dict) -> str:
        for field in ("BUILDING", "ROAD_NAME", "SEARCHVAL"):
            value = result[field]
            if value != "NIL":
                return value
        return result["SEARCHVAL"]

    return [
        GeocodeResult(
            name=_name(result),
            address=result["ADDRESS"],
            lat=float(result["LATITUDE"]),
            lon=float(result["LONGITUDE"]),
        )
        for result in payload.get("results", [])
    ]
