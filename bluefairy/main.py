from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.authentication import AuthenticationMiddleware

from app.core.containers import ApplicationContainer
from app.api.routers import api_router
from app.core.middleware.auth import CookieToHeaderMiddleware

app = FastAPI(title="BlueFairy")

app.container = ApplicationContainer()

# Middleware is executed in reverse order — last added runs first
app.add_middleware(
    AuthenticationMiddleware,
    backend=app.container.services.auth_backend(),
)
app.add_middleware(CookieToHeaderMiddleware)

# Add CORS middleware last (runs first in the chain)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3333",
        "http://localhost:3000",
        "http://localhost:8000",
        "https://rtc.wareit.ai",
        "https://dashboard.wareit.ai",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=[
        "Accept",
        "Accept-Language",
        "Content-Language",
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Origin",
        "Access-Control-Request-Method",
        "Access-Control-Request-Headers",
    ],
    expose_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.on_event("startup")
async def startup_event() -> None:
    await app.container.gateways.database_manager().create_database()


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
