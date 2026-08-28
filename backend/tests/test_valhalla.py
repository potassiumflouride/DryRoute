import json

import pytest
import respx
from fastapi.testclient import TestClient
from httpx import Response

from dryroute_api.main import app

ORIGIN = {"lat": 1.3521, "lon": 103.8198}
DEST = {"lat": 1.3644, "lon": 103.9915}
WAYPOINT = {"lat": 1.3, "lon": 103.85}

VALHALLA_ROUTE_URL = "https://valhalla1.openstreetmap.de/route"

# TestClient is used without the `with ... as client` context manager form
# throughout this file so the app's lifespan (which backfills the radar
# store from NEA on startup) does not run - the router falls back to an
# empty radar store (no rain polygons) in that case, so /route still works.
client = TestClient(app)


def _encode_polyline(coordinates: list[list[float]], precision: int = 6) -> str:
    """Encode (lon, lat) pairs into Valhalla's default polyline6 format - the
    inverse of dryroute_api.valhalla._decode_polyline, used to build realistic
    mock responses (the real public Valhalla instance returns this format
    regardless of the "shape_format" request option)."""
    factor = 10**precision
    chunks: list[str] = []
    prev_lat = 0
    prev_lon = 0
    for lon, lat in coordinates:
        lat_i = round(lat * factor)
        lon_i = round(lon * factor)
        for delta in (lat_i - prev_lat, lon_i - prev_lon):
            value = delta << 1
            if delta < 0:
                value = ~value
            while value >= 0x20:
                chunks.append(chr((value & 0x1F | 0x20) + 63))
                value >>= 5
            chunks.append(chr(value + 63))
        prev_lat, prev_lon = lat_i, lon_i
    return "".join(chunks)


def _leg(distance_km: float, duration_s: float, coordinates: list[list[float]]) -> dict:
    return {
        "shape": _encode_polyline(coordinates),
        "summary": {"length": distance_km, "time": duration_s},
    }


def _valhalla_response(legs: list[dict]) -> Response:
    return Response(200, json={"trip": {"legs": legs}})


@respx.mock
def test_route_direct_returns_single_leg() -> None:
    mock = respx.post(VALHALLA_ROUTE_URL).mock(
        return_value=_valhalla_response(
            [_leg(1.0, 120.0, [[103.8198, 1.3521], [103.9915, 1.3644]])]
        )
    )

    response = client.get(
        "/route",
        params={
            "origin_lat": ORIGIN["lat"],
            "origin_lon": ORIGIN["lon"],
            "dest_lat": DEST["lat"],
            "dest_lon": DEST["lon"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["legs"]) == 1
    assert body["distanceMeters"] == 1000.0
    assert body["durationSeconds"] == 120.0
    assert mock.call_count == 1

    geometry = body["legs"][0]["geometry"]
    assert geometry["type"] == "LineString"
    decoded = geometry["coordinates"]
    assert len(decoded) == 2
    assert decoded[0] == pytest.approx([103.8198, 1.3521], abs=1e-5)
    assert decoded[1] == pytest.approx([103.9915, 1.3644], abs=1e-5)


@respx.mock
def test_route_with_waypoint_returns_two_legs() -> None:
    mock = respx.post(VALHALLA_ROUTE_URL).mock(
        return_value=_valhalla_response(
            [
                _leg(1.0, 120.0, [[103.8198, 1.3521], [103.85, 1.3]]),
                _leg(1.0, 120.0, [[103.85, 1.3], [103.9915, 1.3644]]),
            ]
        )
    )

    response = client.get(
        "/route",
        params={
            "origin_lat": ORIGIN["lat"],
            "origin_lon": ORIGIN["lon"],
            "dest_lat": DEST["lat"],
            "dest_lon": DEST["lon"],
            "waypoints": f"{WAYPOINT['lat']},{WAYPOINT['lon']}",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["legs"]) == 2
    assert body["distanceMeters"] == 2000.0
    assert body["durationSeconds"] == 240.0
    # Valhalla takes all via-points in a single request, unlike OSRM's
    # per-leg fan-out - one call covers the whole multi-leg route.
    assert mock.call_count == 1

    sent_body = json.loads(mock.calls[0].request.content)
    assert len(sent_body["locations"]) == 3


@respx.mock
def test_route_valhalla_failure_returns_502() -> None:
    respx.post(VALHALLA_ROUTE_URL).mock(
        return_value=Response(400, json={"error_code": 154, "error": "No path could be found for input"})
    )

    response = client.get(
        "/route",
        params={
            "origin_lat": ORIGIN["lat"],
            "origin_lon": ORIGIN["lon"],
            "dest_lat": DEST["lat"],
            "dest_lon": DEST["lon"],
        },
    )

    assert response.status_code == 502


@pytest.mark.parametrize(
    ("mode", "expected_costing"),
    [
        ("foot", "pedestrian"),
        ("bicycle", "bicycle"),
        ("motorcycle", "motorcycle"),
    ],
)
@respx.mock
def test_route_uses_costing_for_mode(mode: str, expected_costing: str) -> None:
    mock = respx.post(VALHALLA_ROUTE_URL).mock(
        return_value=_valhalla_response([_leg(1.0, 120.0, [[103.8198, 1.3521], [103.9915, 1.3644]])])
    )

    response = client.get(
        "/route",
        params={
            "origin_lat": ORIGIN["lat"],
            "origin_lon": ORIGIN["lon"],
            "dest_lat": DEST["lat"],
            "dest_lon": DEST["lon"],
            "mode": mode,
        },
    )

    assert response.status_code == 200
    sent_body = json.loads(mock.calls[0].request.content)
    assert sent_body["costing"] == expected_costing


@respx.mock
def test_route_falls_back_when_excluded_polygons_are_infeasible(monkeypatch: pytest.MonkeyPatch) -> None:
    import dryroute_api.scoring as scoring_module

    async def fake_rain_polygons(_store: object) -> list[list[tuple[float, float]]]:
        return [[(103.8, 1.3), (103.9, 1.3), (103.9, 1.35), (103.8, 1.35), (103.8, 1.3)]]

    monkeypatch.setattr(scoring_module, "current_rain_polygons", fake_rain_polygons)

    mock = respx.post(VALHALLA_ROUTE_URL).mock(
        side_effect=[
            Response(400, json={"error_code": 154, "error": "No path could be found for input"}),
            _valhalla_response([_leg(1.0, 120.0, [[103.8198, 1.3521], [103.9915, 1.3644]])]),
        ]
    )

    response = client.get(
        "/route",
        params={
            "origin_lat": ORIGIN["lat"],
            "origin_lon": ORIGIN["lon"],
            "dest_lat": DEST["lat"],
            "dest_lon": DEST["lon"],
        },
    )

    assert response.status_code == 200
    assert mock.call_count == 2

    first_body = json.loads(mock.calls[0].request.content)
    second_body = json.loads(mock.calls[1].request.content)
    assert "exclude_polygons" in first_body
    assert "exclude_polygons" not in second_body


@respx.mock
def test_route_flags_segments_crossing_rain(monkeypatch: pytest.MonkeyPatch) -> None:
    import dryroute_api.scoring as scoring_module

    async def fake_rain_polygons(_store: object) -> list[list[tuple[float, float]]]:
        # Straddles the midpoint of the mocked route leg below.
        return [[(103.87, 1.3), (103.93, 1.3), (103.93, 1.4), (103.87, 1.4), (103.87, 1.3)]]

    monkeypatch.setattr(scoring_module, "current_rain_polygons", fake_rain_polygons)

    respx.post(VALHALLA_ROUTE_URL).mock(
        return_value=_valhalla_response(
            [_leg(1.0, 120.0, [[103.8198, 1.3521], [103.9915, 1.3644]])]
        )
    )

    response = client.get(
        "/route",
        params={
            "origin_lat": ORIGIN["lat"],
            "origin_lon": ORIGIN["lon"],
            "dest_lat": DEST["lat"],
            "dest_lon": DEST["lon"],
        },
    )

    assert response.status_code == 200
    leg = response.json()["legs"][0]
    assert leg["rainSegments"]
    assert leg["rainSegments"][0]["type"] == "LineString"
    assert len(leg["rainSegments"][0]["coordinates"]) >= 2


@respx.mock
def test_route_omits_rain_segments_when_no_rain() -> None:
    respx.post(VALHALLA_ROUTE_URL).mock(
        return_value=_valhalla_response(
            [_leg(1.0, 120.0, [[103.8198, 1.3521], [103.9915, 1.3644]])]
        )
    )

    response = client.get(
        "/route",
        params={
            "origin_lat": ORIGIN["lat"],
            "origin_lon": ORIGIN["lon"],
            "dest_lat": DEST["lat"],
            "dest_lon": DEST["lon"],
        },
    )

    assert response.status_code == 200
    assert response.json()["legs"][0]["rainSegments"] is None
