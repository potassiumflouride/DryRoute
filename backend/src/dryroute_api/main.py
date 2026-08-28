import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from dryroute_api import radar
from dryroute_api.routers import router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    store = radar.RadarStore()
    await radar.backfill(store)
    app.state.radar_store = store

    refresh_task = asyncio.create_task(radar.refresh_loop(store))
    yield
    refresh_task.cancel()


app = FastAPI(title="DryRoute API", lifespan=lifespan)
app.include_router(router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
