from fastapi import FastAPI

from app.api.creative import router as creative_router

app = FastAPI(
    title="Creative Curator API",
    description="Creative direction sessions for the Creative Curator workspace.",
    version="0.1.0",
)

app.include_router(creative_router, prefix="/creative")


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}
