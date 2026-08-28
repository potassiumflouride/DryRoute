import asyncio
import logging
import time

import httpx

from geo_encoding_gateway.config import settings

logger = logging.getLogger(__name__)


class OneMapAuthError(Exception):
    pass


class TokenManager:
    def __init__(self) -> None:
        self._access_token: str | None = None
        self._expiry_timestamp: float | None = None
        self._lock = asyncio.Lock()

    def _needs_refresh(self) -> bool:
        if self._access_token is None or self._expiry_timestamp is None:
            return True
        return time.time() >= self._expiry_timestamp - settings.token_refresh_buffer_seconds

    async def get_token(self) -> str:
        if not self._needs_refresh():
            return self._access_token  # type: ignore[return-value]
        async with self._lock:
            if self._needs_refresh():
                await self._refresh()
        return self._access_token  # type: ignore[return-value]

    async def _refresh(self) -> None:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                settings.onemap_token_url,
                json={"email": settings.onemap_email, "password": settings.onemap_password},
                timeout=settings.upstream_timeout_seconds,
            )
        if response.status_code != httpx.codes.OK:
            raise OneMapAuthError(f"OneMap auth failed with status {response.status_code}")
        payload = response.json()
        self._access_token = payload["access_token"]
        self._expiry_timestamp = float(payload["expiry_timestamp"])
        logger.info("Refreshed OneMap token, expires at %s", self._expiry_timestamp)


async def refresh_loop(manager: TokenManager) -> None:
    while True:
        try:
            await manager.get_token()
        except OneMapAuthError:
            logger.exception("OneMap token refresh failed; will retry")
        await asyncio.sleep(settings.token_refresh_check_interval_seconds)
