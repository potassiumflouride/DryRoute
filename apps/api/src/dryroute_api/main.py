from fastapi import FastAPI

from dryroute_api.routers import router

app = FastAPI(title="DryRoute API")
app.include_router(router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
