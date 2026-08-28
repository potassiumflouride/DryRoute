import asyncio
import json
import time

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from httpx import Response

from geo_encoding_gateway.auth import OneMapAuthError
from geo_encoding_gateway.config import settings
from geo_encoding_gateway.main import app
from geo_encoding_gateway.rate_limiter import RateLimiter

TOKEN_URL = "https://www.onemap.gov.sg/api/auth/post/getToken"
SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"


def _mock_token(expires_in: float = 100000) -> None:
    respx.post(TOKEN_URL).mock(
        return_value=Response(
            200, json={"access_token": "test-token", "expiry_timestamp": time.time() + expires_in}
        )
    )


@respx.mock
def test_proxy_forwards_get_with_query_and_injects_auth() -> None:
    _mock_token()
    mock = respx.get(SEARCH_URL).mock(
        return_value=Response(200, json={"found": 1, "results": [{"ADDRESS": "ORCHARD"}]})
    )

    with TestClient(app) as client:
        response = client.get(
            "/onemap/api/common/elastic/search",
            params={"searchVal": "orchard", "returnGeom": "Y", "getAddrDetails": "Y", "pageNum": 1},
        )

    assert response.status_code == 200
    assert response.json() == {"found": 1, "results": [{"ADDRESS": "ORCHARD"}]}
    assert mock.call_count == 1
    sent_request = mock.calls[0].request
    assert sent_request.headers["Authorization"] == "Bearer test-token"
    assert sent_request.url.params["searchVal"] == "orchard"


@respx.mock
def test_proxy_forwards_post_body() -> None:
    _mock_token()
    mock = respx.post("https://www.onemap.gov.sg/api/public/routingsvc/route").mock(
        return_value=Response(200, json={"status": "ok"})
    )

    with TestClient(app) as client:
        response = client.post(
            "/onemap/api/public/routingsvc/route",
            json={"start": "1.29,103.85", "end": "1.36,103.99"},
        )

    assert response.status_code == 200
    assert mock.call_count == 1
    sent_body = json.loads(mock.calls[0].request.content)
    assert sent_body == {"start": "1.29,103.85", "end": "1.36,103.99"}


@respx.mock
def test_proxy_returns_429_when_local_rate_limit_exceeded(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_token()
    onemap_mock = respx.get(SEARCH_URL).mock(return_value=Response(200, json={}))
    monkeypatch.setattr(settings, "rate_limit_max_wait_seconds", 0.05)

    with TestClient(app) as client:
        drained_limiter = RateLimiter(capacity=1, refill_rate_per_second=1 / 1000)
        asyncio.run(drained_limiter.acquire())
        client.app.state.rate_limiter = drained_limiter

        response = client.get("/onemap/api/common/elastic/search", params={"searchVal": "x"})

    assert response.status_code == 429
    assert onemap_mock.call_count == 0


@respx.mock
def test_proxy_passes_through_onemap_429_after_retries_exhausted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_token()
    monkeypatch.setattr(settings, "onemap_retry_max_attempts", 2)
    monkeypatch.setattr(settings, "onemap_retry_backoff_seconds", 0)
    mock = respx.get(SEARCH_URL).mock(return_value=Response(429, headers={"Retry-After": "1"}))

    with TestClient(app) as client:
        response = client.get("/onemap/api/common/elastic/search", params={"searchVal": "x"})

    assert response.status_code == 429
    assert mock.call_count == 2


@respx.mock
def test_app_startup_fails_fast_when_onemap_auth_fails() -> None:
    respx.post(TOKEN_URL).mock(return_value=Response(401, json={"error": "bad credentials"}))
    onemap_mock = respx.get(SEARCH_URL).mock(return_value=Response(200, json={}))

    with pytest.raises(OneMapAuthError), TestClient(app):
        pass

    assert onemap_mock.call_count == 0


@respx.mock
def test_proxy_returns_503_when_token_refresh_fails_mid_flight() -> None:
    # First fetch succeeds with a token that's already within the refresh
    # buffer (so any later get_token() call attempts a real refresh) - every
    # refresh after that fails, simulating OneMap becoming unreachable once
    # the token needs renewing after the gateway is already serving. A
    # counting side_effect (rather than a fixed-length list) tolerates the
    # background refresh_loop task also calling get_token() concurrently.
    call_count = {"n": 0}

    def _token_side_effect(_request: httpx.Request) -> Response:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return Response(200, json={"access_token": "t1", "expiry_timestamp": time.time() + 1})
        return Response(500, json={"error": "onemap unavailable"})

    respx.post(TOKEN_URL).mock(side_effect=_token_side_effect)
    onemap_mock = respx.get(SEARCH_URL).mock(return_value=Response(200, json={}))

    with TestClient(app) as client:
        response = client.get("/onemap/api/common/elastic/search", params={"searchVal": "x"})

    assert response.status_code == 503
    assert onemap_mock.call_count == 0


@respx.mock
def test_proxy_returns_502_on_upstream_network_error() -> None:
    _mock_token()
    respx.get(SEARCH_URL).mock(side_effect=httpx.ConnectError("connection refused"))

    with TestClient(app) as client:
        response = client.get("/onemap/api/common/elastic/search", params={"searchVal": "x"})

    assert response.status_code == 502
