"""Authentication middleware using Starlette's AuthenticationBackend"""

import logging

from starlette.authentication import AuthenticationBackend, SimpleUser
from starlette.requests import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.services.auth import AuthService

logger = logging.getLogger(__name__)


class SessionAuthenticationBackend(AuthenticationBackend):
    def __init__(self, auth_service: AuthService):
        self.auth_service = auth_service
        self.unauthenticated_paths = {
            "/api/v1/auth/sign-up",
            "/api/v1/auth/sign-in",
            "/api/v1/auth/connectors/google/callback",
            "/api/v1/auth/connectors/microsoft/callback",
            "/health",
            "/docs",
            "/openapi.json",
        }

    async def authenticate(self, request: Request):
        """Authenticate the request using bearer token"""
        # Skip authentication for public routes
        if any(request.url.path.startswith(path) for path in self.unauthenticated_paths):
            return None

        authorization = request.headers.get("Authorization")
        if not authorization:
            return None

        try:
            scheme, credentials = authorization.split()
            if scheme.lower() != "bearer":
                return None
        except ValueError:
            return None

        user = await self.auth_service.get_session(credentials)
        if not user:
            return None

        return SimpleUser(str(user.id)), user


class CookieToHeaderMiddleware(BaseHTTPMiddleware):
    """Middleware to convert session_token cookie to Authorization header"""

    async def dispatch(self, request: Request, call_next):
        # Convert session_token cookie to Authorization header if present
        if not request.headers.get("Authorization"):
            session_token = request.cookies.get("session_token")
            if session_token:
                headers = dict(request.scope["headers"])
                headers[b"authorization"] = f"Bearer {session_token}".encode()
                request.scope["headers"] = list(headers.items())

        response = await call_next(request)
        return response
