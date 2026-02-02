"""Authentication endpoints for users and connector providers"""

import httpx
import json
import logging
import os
import secrets
from typing import Optional
from urllib.parse import urlencode

import redis
from fastapi import APIRouter, HTTPException, Query, Depends, status, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from fastapi.security import OAuth2PasswordRequestForm
from dependency_injector.wiring import Provide, inject

from app.core.config import settings
from app.core.containers import ApplicationContainer
from app.services.auth import AuthService
from app.services.users import UsersService
from app.schemas.users import UserCreate

logger = logging.getLogger(__name__)

router = APIRouter()

redis_client = redis.from_url(settings.REDIS_URI)


@router.post("/sign-up", status_code=status.HTTP_201_CREATED)
@inject
async def signup(
    user_in: UserCreate,
    users_service: UsersService = Depends(
        Provide[ApplicationContainer.services.users_service]
    ),
):
    return await users_service.create_user(user_in=user_in)


@router.post("/sign-in", status_code=status.HTTP_200_OK)
@inject
async def signin(
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service: AuthService = Depends(
        Provide[ApplicationContainer.services.auth_service]
    ),
):
    user = await auth_service.authenticate_user(
        email=form_data.username, password=form_data.password
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    session_token = await auth_service.create_session(user.id)
    return {"access_token": session_token, "token_type": "bearer"}


@router.get("/connectors/{provider}/connect")
async def connect_connector_provider(
    provider: str,
    request: Request
):
    """Connect a connector provider (initiate OAuth flow)"""
    try:
        # Get user_id from authenticated request
        if not hasattr(request, "user") or not request.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required to connect providers"
            )
        user_id = str(request.user.id)

        state = secrets.token_urlsafe(32)

        redis_client.set(f"oauth_state:{state}", user_id, ex=600)

        redirect_uri = f"{settings.BASE_URL}/api/v1/auth/connectors/{provider}/callback"

        if provider == "google":
            auth_params = {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "redirect_uri": redirect_uri,
                "scope": settings.GOOGLE_SCOPES,
                "response_type": "code",
                "state": state,
                "access_type": "offline",
                "prompt": "consent",
            }
            auth_url = f"{settings.GOOGLE_AUTH_URL}?{urlencode(auth_params)}"
        elif provider == "microsoft":
            auth_params = {
                "client_id": settings.MICROSOFT_CLIENT_ID,
                "redirect_uri": redirect_uri,
                "scope": settings.MICROSOFT_SCOPES,
                "response_type": "code",
                "state": state,
                "prompt": "consent",
            }
            auth_url = f"{settings.MICROSOFT_AUTH_URL}?{urlencode(auth_params)}"
        else:
            raise HTTPException(status_code=400, detail=f"Provider {provider} not supported")

        # Redirect directly to OAuth provider
        return RedirectResponse(url=auth_url, status_code=302)

    except Exception as e:
        logger.error(f"Error creating auth URL for {provider}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/connectors/{provider}/callback")
async def connector_provider_callback(
    provider: str,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None)
):
    """Handle OAuth callback for connector provider"""
    print(f"OAuth callback called for {provider} with code={code}, state={state}")
    try:
        user_id = redis_client.get(f"oauth_state:{state}")
        print(f"Got user_id from state: {user_id}")

        user_id = user_id.decode('utf-8')
        redis_client.delete(f"oauth_state:{state}")

        async with httpx.AsyncClient() as client:
            redirect_uri = f"{settings.BASE_URL}/api/v1/auth/connectors/{provider}/callback"

            if provider == "google":
                token_data = {
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri
                }
                response = await client.post(settings.GOOGLE_TOKEN_URL, data=token_data)
                tokens = response.json()


                token_key = f"token_google:{user_id}"
                stored_token_data = {
                    "access_token": tokens.get("access_token"),
                    "refresh_token": tokens.get("refresh_token"),
                    "token_uri": settings.GOOGLE_TOKEN_URL,
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "scopes": settings.GOOGLE_SCOPES.split(),
                    "expiry": None
                }

            elif provider == "microsoft":
                token_data = {
                    "client_id": settings.MICROSOFT_CLIENT_ID,
                    "client_secret": settings.MICROSOFT_CLIENT_SECRET,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri
                }
                response = await client.post(settings.MICROSOFT_TOKEN_URL, data=token_data)
                tokens = response.json()


                token_key = f"token_microsoft:{user_id}"
                stored_token_data = {
                    "access_token": tokens.get("access_token"),
                    "refresh_token": tokens.get("refresh_token"),
                    "token_uri": settings.MICROSOFT_TOKEN_URL,
                    "client_id": settings.MICROSOFT_CLIENT_ID,
                    "client_secret": settings.MICROSOFT_CLIENT_SECRET,
                    "scopes": settings.MICROSOFT_SCOPES.split(),
                    "expires_in": tokens.get("expires_in")
                }
            else:
                raise HTTPException(status_code=400, detail=f"Provider {provider} not supported")

        redis_client.set(token_key, json.dumps(stored_token_data))
        logger.info(f"Successfully stored {provider} tokens for user {user_id}")

        return RedirectResponse(url=f"{settings.AWARE_DASHBOARD_URL}?connected={provider}", status_code=302)

    except Exception as e:
        logger.error(f"OAuth callback error: {e}")
        return {"error": "callback_failed", "message": str(e)}


@router.delete("/connectors/{provider}/disconnect")
async def disconnect_connector_provider(
    provider: str,
    request: Request
):
    """Disconnect a connector provider (remove stored tokens)"""
    # Get user_id from authenticated request
    if not hasattr(request, "user") or not request.user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to disconnect providers"
        )
    user_id = str(request.user.id)

    if provider not in ["google", "microsoft"]:
        raise HTTPException(status_code=400, detail=f"Provider {provider} not supported")

    try:
        token_key = f"token_{provider}:{user_id}"

        # Check if tokens exist
        if not redis_client.exists(token_key):
            return {"error": "not_connected", "message": f"User {user_id} is not connected to {provider}"}

        # Delete tokens from Redis
        redis_client.delete(token_key)
        logger.info(f"Successfully disconnected {provider} for user {user_id}")

        return {
            "success": True,
            "message": f"Successfully disconnected {provider} account for user {user_id}",
            "user_id": user_id,
            "provider": provider
        }

    except Exception as e:
        logger.error(f"Disconnect error: {e}")
        return {"error": "disconnect_error", "message": str(e)}


@router.get("/connectors/status")
async def get_connectors_status(request: Request):
    """Get connection status for all providers"""
    user_id = str(request.user.id)

    # Check connection status directly in Redis
    return {
        "google": bool(redis_client.exists(f"token_google:{user_id}")),
        "microsoft": bool(redis_client.exists(f"token_microsoft:{user_id}"))
    }
