import asyncio
import time

import pytest
import respx
from httpx import Response

from geo_encoding_gateway.auth import OneMapAuthError, TokenManager
from geo_encoding_gateway.config import settings

TOKEN_URL = "https://www.onemap.gov.sg/api/auth/post/getToken"


@respx.mock
def test_get_token_fetches_on_first_call() -> None:
    mock = respx.post(TOKEN_URL).mock(
        return_value=Response(200, json={"access_token": "t1", "expiry_timestamp": time.time() + 10000})
    )

    manager = TokenManager()
    token = asyncio.run(manager.get_token())

    assert token == "t1"
    assert mock.call_count == 1


@respx.mock
def test_get_token_does_not_refetch_before_buffer_window() -> None:
    mock = respx.post(TOKEN_URL).mock(
        return_value=Response(200, json={"access_token": "t1", "expiry_timestamp": time.time() + 10000})
    )

    manager = TokenManager()

    async def _fetch_twice() -> tuple[str, str]:
        return await manager.get_token(), await manager.get_token()

    first, second = asyncio.run(_fetch_twice())

    assert first == second == "t1"
    assert mock.call_count == 1


@respx.mock
def test_get_token_refreshes_when_within_buffer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "token_refresh_buffer_seconds", 5)
    mock = respx.post(TOKEN_URL).mock(
        side_effect=[
            Response(200, json={"access_token": "t1", "expiry_timestamp": time.time() + 2}),
            Response(200, json={"access_token": "t2", "expiry_timestamp": time.time() + 10000}),
        ]
    )

    manager = TokenManager()

    async def _fetch_twice() -> tuple[str, str]:
        return await manager.get_token(), await manager.get_token()

    first, second = asyncio.run(_fetch_twice())

    assert first == "t1"
    assert second == "t2"
    assert mock.call_count == 2


@respx.mock
def test_concurrent_get_token_calls_refresh_only_once() -> None:
    mock = respx.post(TOKEN_URL).mock(
        return_value=Response(200, json={"access_token": "t1", "expiry_timestamp": time.time() + 10000})
    )

    manager = TokenManager()

    async def _fetch_concurrently() -> list[str]:
        return await asyncio.gather(*(manager.get_token() for _ in range(20)))

    tokens = asyncio.run(_fetch_concurrently())

    assert tokens == ["t1"] * 20
    assert mock.call_count == 1


@respx.mock
def test_get_token_raises_on_auth_failure() -> None:
    respx.post(TOKEN_URL).mock(return_value=Response(401, json={"error": "invalid credentials"}))

    manager = TokenManager()

    with pytest.raises(OneMapAuthError):
        asyncio.run(manager.get_token())
