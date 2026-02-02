"""Session management service mapping users to OpenClaw sessions"""

import logging
from typing import Optional

from app.services.openclaw import OpenClawService

logger = logging.getLogger(__name__)

REDIS_KEY_PREFIX = "openclaw_session"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days


class SessionService:
    """Maps authenticated user IDs to OpenClaw session keys via Redis"""

    def __init__(self, redis, openclaw_service: OpenClawService) -> None:
        self.redis = redis  # async context-manager factory (RedisManager.session)
        self.openclaw_service = openclaw_service

    def _redis_key(self, user_id: str) -> str:
        return f"{REDIS_KEY_PREFIX}:{user_id}"

    async def get_or_create_session(self, user_id: str) -> str:
        """Return the OpenClaw session key for *user_id*, creating one if needed."""
        async with self.redis() as redis_client:
            existing: Optional[bytes] = await redis_client.get(self._redis_key(user_id))
            if existing:
                return existing.decode("utf-8")

            session_key = self.openclaw_service.create_session_key(user_id)
            await redis_client.setex(
                self._redis_key(user_id),
                SESSION_TTL_SECONDS,
                session_key,
            )
            logger.info("Created OpenClaw session %s for user %s", session_key, user_id)
            return session_key

    async def get_session(self, user_id: str) -> Optional[str]:
        """Return existing session key or None."""
        async with self.redis() as redis_client:
            value: Optional[bytes] = await redis_client.get(self._redis_key(user_id))
            return value.decode("utf-8") if value else None

    async def delete_session(self, user_id: str) -> None:
        """Remove the stored session mapping."""
        async with self.redis() as redis_client:
            await redis_client.delete(self._redis_key(user_id))
