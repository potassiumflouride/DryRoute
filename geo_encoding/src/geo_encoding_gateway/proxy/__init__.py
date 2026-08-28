import asyncio

import httpx
from fastapi import Request, Response

from geo_encoding_gateway.auth import OneMapAuthError, TokenManager
from geo_encoding_gateway.config import settings
from geo_encoding_gateway.rate_limiter import RateLimiter, RateLimitExceededError

_HOP_BY_HOP_REQUEST_HEADERS = {"host", "authorization", "content-length", "connection"}
_HOP_BY_HOP_RESPONSE_HEADERS = {"content-length", "connection", "transfer-encoding"}


async def forward_request(
    request: Request,
    path: str,
    token_manager: TokenManager,
    rate_limiter: RateLimiter,
) -> Response:
    body = await request.body()
    forward_headers = {
        k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP_REQUEST_HEADERS
    }

    try:
        token = await token_manager.get_token()
    except OneMapAuthError as exc:
        return Response(content=str(exc), status_code=503, media_type="text/plain")

    forward_headers["Authorization"] = f"Bearer {token}"
    url = f"{settings.onemap_base_url}/{path}"

    upstream_response: httpx.Response | None = None
    for attempt in range(settings.onemap_retry_max_attempts):
        try:
            await rate_limiter.acquire(
                wait=True, max_wait_seconds=settings.rate_limit_max_wait_seconds
            )
        except RateLimitExceededError:
            return Response(content="Rate limit exceeded", status_code=429)

        try:
            async with httpx.AsyncClient() as client:
                upstream_response = await client.request(
                    request.method,
                    url,
                    params=request.query_params,
                    content=body,
                    headers=forward_headers,
                    timeout=settings.upstream_timeout_seconds,
                )
        except httpx.RequestError:
            return Response(content="OneMap upstream unreachable", status_code=502)

        if upstream_response.status_code != httpx.codes.TOO_MANY_REQUESTS:
            break
        await asyncio.sleep(settings.onemap_retry_backoff_seconds * (attempt + 1))

    response_headers = {
        k: v
        for k, v in upstream_response.headers.items()
        if k.lower() not in _HOP_BY_HOP_RESPONSE_HEADERS
    }
    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=response_headers,
    )
