"""WebSocket endpoint for the Mac app ↔ OpenClaw proxy"""

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from dependency_injector.wiring import Provide, inject

from app.core.containers import ApplicationContainer
from app.services.auth import AuthService
from app.services.conversations import ConversationService
from app.services.openclaw import OpenClawAPIException, OpenClawService
from app.services.sessions import SessionService

logger = logging.getLogger(__name__)

router = APIRouter()


async def _authenticate_ws(
    websocket: WebSocket,
    auth_service: AuthService,
) -> str | None:
    """Authenticate a WebSocket connection.

    Checks for a token in:
      1. query parameter ``token``
      2. cookie ``session_token``

    Returns the user ID string on success, or None.
    """
    token: str | None = websocket.query_params.get("token")
    if not token:
        token = websocket.cookies.get("session_token")
    if not token:
        return None

    user = await auth_service.get_session(token)
    if not user:
        return None
    return str(user.id)


@router.websocket("/ws")
@inject
async def websocket_endpoint(
    websocket: WebSocket,
    auth_service: AuthService = Provide[ApplicationContainer.services.auth_service],
    session_service: SessionService = Provide[ApplicationContainer.services.session_service],
    openclaw_service: OpenClawService = Provide[ApplicationContainer.services.openclaw_service],
    conversation_service: ConversationService = Provide[ApplicationContainer.services.conversation_service],
) -> None:
    # --- authenticate before accepting ---
    user_id = await _authenticate_ws(websocket, auth_service)
    if user_id is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    logger.info("WebSocket connected for user %s", user_id)

    # Resolve the user's OpenClaw session once per connection
    session_key = await session_service.get_or_create_session(user_id)

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json(
                    {"type": "error", "message": "Invalid JSON"}
                )
                continue

            msg_type = msg.get("type")

            # --- keepalive ---
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            # --- user message ---
            if msg_type == "message":
                content = msg.get("content", "").strip()
                if not content:
                    await websocket.send_json(
                        {"type": "error", "message": "Empty message"}
                    )
                    continue

                full_response = ""
                try:
                    async for chunk in openclaw_service.send_message(
                        session_key, content
                    ):
                        full_response += chunk
                        await websocket.send_json(
                            {"type": "chunk", "content": chunk}
                        )

                    await websocket.send_json(
                        {"type": "done", "fullContent": full_response}
                    )

                    # Persist the exchange
                    try:
                        await conversation_service.create_conversation(
                            user_id=user_id,
                            session_id=session_key,
                            user_message=content,
                            assistant_message=full_response,
                        )
                    except Exception:
                        logger.exception("Failed to persist conversation")

                except OpenClawAPIException as exc:
                    logger.error("OpenClaw error: %s", exc)
                    await websocket.send_json(
                        {"type": "error", "message": "Failed to get response from AI"}
                    )
                except Exception:
                    logger.exception("Unexpected error streaming from OpenClaw")
                    await websocket.send_json(
                        {"type": "error", "message": "Internal server error"}
                    )
                continue

            # --- unknown type ---
            await websocket.send_json(
                {"type": "error", "message": f"Unknown message type: {msg_type}"}
            )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for user %s", user_id)
