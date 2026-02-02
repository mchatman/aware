"""OpenClaw proxy service for communicating with the OpenClaw webchat API"""

import json
import logging
import uuid
from typing import AsyncGenerator

import httpx

logger = logging.getLogger(__name__)


class OpenClawService:
    """Service that proxies messages to OpenClaw's webchat HTTP API"""

    def __init__(self, base_url: str = "http://localhost:3420") -> None:
        self.base_url = base_url.rstrip("/")
        self.message_url = f"{self.base_url}/webchat/api/message"

    async def send_message(
        self, session_key: str, message: str
    ) -> AsyncGenerator[str, None]:
        """Send a message to OpenClaw and yield streamed response chunks.

        Args:
            session_key: The OpenClaw session key for this user.
            message: The user's message text.

        Yields:
            Text chunks from the streamed SSE response.
        """
        payload = {"message": message, "sessionKey": session_key}
        timeout = httpx.Timeout(120.0, connect=10.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                self.message_url,
                json=payload,
                headers={"Accept": "text/event-stream"},
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    logger.error(
                        "OpenClaw API error %s: %s",
                        response.status_code,
                        body.decode(errors="replace")[:500],
                    )
                    raise OpenClawAPIException(
                        f"OpenClaw returned {response.status_code}"
                    )

                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue

                    data_str = line[len("data:"):].strip()
                    if not data_str:
                        continue

                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        # Plain text chunk (some SSE implementations)
                        yield data_str
                        continue

                    # Extract text from common SSE payload shapes
                    if isinstance(data, dict):
                        text = data.get("text") or data.get("content") or data.get("chunk") or ""
                        if text:
                            yield text
                    elif isinstance(data, str):
                        yield data

    def create_session_key(self, user_id: str) -> str:
        """Create a deterministic session key for a user.

        OpenClaw's webchat API auto-creates sessions on first message,
        so we just need a stable, unique key per user.
        """
        return f"bluefairy:{user_id}"


class OpenClawAPIException(Exception):
    """Raised when the OpenClaw API returns an error"""

    pass
