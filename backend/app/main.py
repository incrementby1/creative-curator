from fastapi import FastAPI
from app.api.creative import router as creative_router

app = FastAPI(title="Creative Loop MVP")

app.include_router(creative_router, prefix="/creative")