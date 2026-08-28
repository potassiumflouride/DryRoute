from fastapi import APIRouter, Request, Response

from geo_encoding_gateway.proxy import forward_request

router = APIRouter()


@router.api_route("/onemap/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def onemap_proxy(path: str, request: Request) -> Response:
    return await forward_request(
        request,
        path,
        request.app.state.token_manager,
        request.app.state.rate_limiter,
    )
