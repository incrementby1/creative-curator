from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.creative import router as creative_router
from app.api.settings import clear_settings_service_cache, router as settings_router
from app.api.projects import router as projects_router, users_router


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
