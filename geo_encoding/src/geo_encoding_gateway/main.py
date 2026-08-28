import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from geo_encoding_gateway.auth import TokenManager, refresh_loop
from geo_encoding_gateway.config import settings
from geo_encoding_gateway.rate_limiter import RateLimiter
from geo_encoding_gateway.routers import router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    token_manager = TokenManager()
    await token_manager.get_token()
    app.state.token_manager = token_manager
    app.state.rate_limiter = RateLimiter(
        capacity=settings.rate_limit_max_calls,
        refill_rate_per_second=settings.rate_limit_max_calls / settings.rate_limit_window_seconds,
    )

    refresh_task = asyncio.create_task(refresh_loop(token_manager))
    yield
    refresh_task.cancel()


app = FastAPI(title="DryRoute Geo Encoding Gateway", lifespan=lifespan)
app.include_router(router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
