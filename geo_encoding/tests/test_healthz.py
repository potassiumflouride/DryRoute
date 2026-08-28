from fastapi.testclient import TestClient

from geo_encoding_gateway.main import app

# TestClient is used without the `with ... as client` context manager form so
# the app's lifespan (which fetches a real OneMap token on startup) does not
# run - /healthz doesn't depend on any lifespan-created state.
client = TestClient(app)


def test_healthz() -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
