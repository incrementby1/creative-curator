from contextlib import asynccontextmanager
import json
from typing import Any, Awaitable, Callable

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.creative import router as creative_router
from app.api.settings import clear_settings_service_cache, router as settings_router
from app.api.projects import router as projects_router, users_router


MAX_ANNOTATION_BODY_BYTES = 8 * 1024 * 1024


class AnnotationBodyTooLarge(Exception):
    pass


def _append_annotation_body(target: bytearray, chunk: bytes) -> None:
    if len(chunk) > MAX_ANNOTATION_BODY_BYTES - len(target):
        raise AnnotationBodyTooLarge()
    target.extend(chunk)


class AnnotationBodyLimitMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app

    @staticmethod
    def _applies(scope: dict[str, Any]) -> bool:
        path = scope.get("path", "")
        return (
            scope.get("type") == "http"
            and scope.get("method") == "PUT"
            and path.startswith("/projects/")
            and path.endswith("/annotations")
        )

    async def _reject(self, send: Callable[..., Awaitable[None]]) -> None:
        body = json.dumps({"detail": {"code": "annotation_payload_too_large"}}, separators=(",", ":")).encode()
        await send({"type": "http.response.start", "status": 413, "headers": [
            (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
        ]})
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: dict[str, Any], receive: Callable[..., Awaitable[dict[str, Any]]],
                       send: Callable[..., Awaitable[None]]) -> None:
        if not self._applies(scope):
            await self.app(scope, receive, send)
            return
        headers = {name.lower(): value for name, value in scope.get("headers", ())}
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                declared = int(content_length)
            except ValueError:
                declared = 0
            if declared > MAX_ANNOTATION_BODY_BYTES:
                await self._reject(send)
                return
        body = bytearray()
        while True:
            message = await receive()
            if message.get("type") != "http.request":
                async def replay_terminal() -> dict[str, Any]:
                    return message
                await self.app(scope, replay_terminal, send)
                return
            try:
                _append_annotation_body(body, message.get("body", b""))
            except AnnotationBodyTooLarge:
                await self._reject(send)
                return
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay() -> dict[str, Any]:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    clear_settings_service_cache()


app = FastAPI(
    title="Creative Curator API",
    description="Creative direction sessions for the Creative Curator workspace.",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(AnnotationBodyLimitMiddleware)

app.include_router(creative_router, prefix="/creative")
app.include_router(settings_router, prefix="/settings")
app.include_router(projects_router, prefix="/projects")
app.include_router(users_router, prefix="/users")


@app.exception_handler(RequestValidationError)
async def safe_request_validation_error(
    _request: object, exc: RequestValidationError
) -> JSONResponse:
    errors = [
        {
            "type": item.get("type", "validation_error"),
            "loc": item.get("loc", ()),
            "msg": "Invalid request.",
        }
        for item in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errors})


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}
