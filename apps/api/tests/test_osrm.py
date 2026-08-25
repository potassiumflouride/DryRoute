import respx
from fastapi.testclient import TestClient
from httpx import Response

from dryroute_api.main import app

ORIGIN = {"lat": 1.3521, "lon": 103.8198}
DEST = {"lat": 1.3644, "lon": 103.9915}
WAYPOINT = {"lat": 1.3, "lon": 103.85}

# TestClient is used without the `with ... as client` context manager form
# throughout this file so the app's lifespan (which backfills the radar
# store from NEA on startup) does not run - these tests only exercise the
# /route endpoint, which does not touch the radar store.
client = TestClient(app)


def _osrm_route_response(distance: float = 1000.0, duration: float = 120.0) -> Response:
    return Response(
        200,
        json={
            "code": "Ok",
            "routes": [
                {
                    "distance": distance,
                    "duration": duration,
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[103.8198, 1.3521], [103.9915, 1.3644]],
                    },
                }
            ],
        },
    )


@respx.mock
def test_route_direct_returns_single_leg() -> None:
    mock = respx.get(url__regex=r"https://router\.project-osrm\.org/route/v1/driving/.*").mock(
        return_value=_osrm_route_response()
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


@respx.mock
def test_route_with_waypoint_returns_two_legs() -> None:
    mock = respx.get(url__regex=r"https://router\.project-osrm\.org/route/v1/driving/.*").mock(
        return_value=_osrm_route_response()
    )

    response = client.get(
        "/route",
        params={
            "origin_lat": ORIGIN["lat"],
            "origin_lon": ORIGIN["lon"],
            "dest_lat": DEST["lat"],
            "dest_lon": DEST["lon"],
            "waypoint_lat": WAYPOINT["lat"],
            "waypoint_lon": WAYPOINT["lon"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["legs"]) == 2
    assert body["distanceMeters"] == 2000.0
    assert body["durationSeconds"] == 240.0
    assert mock.call_count == 2


@respx.mock
def test_route_osrm_failure_returns_502() -> None:
    respx.get(url__regex=r"https://router\.project-osrm\.org/route/v1/driving/.*").mock(
        return_value=Response(200, json={"code": "NoRoute", "message": "no route found"})
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
