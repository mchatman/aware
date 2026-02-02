"""Authentication service for user registration and login"""

import uuid
import secrets
from typing import Optional
from passlib.context import CryptContext
from redis.asyncio import Redis

from app.models.user import User
from app.repositories.users import UserRepository
from app.schemas.users import UserCreate


SESSION_EXPIRY_SECONDS = 3600 * 24 * 7  # 1 week


class AuthService:
    def __init__(self, users_repository: UserRepository, redis):
        self.users_repository = users_repository
        self.redis = redis
        self.pwd_context = CryptContext(
            schemes=["bcrypt"],
            deprecated="auto",
            bcrypt__min_rounds=12
        )

    def hash_password(self, password: str) -> str:
        # bcrypt has a 72 byte limit, truncate if necessary
        password_bytes = password.encode('utf-8')
        if len(password_bytes) > 72:
            password = password_bytes[:72].decode('utf-8', errors='ignore')
        return self.pwd_context.hash(password)

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        return self.pwd_context.verify(plain_password, hashed_password)

    async def authenticate_user(self, email: str, password: str) -> Optional[User]:
        user = await self.users_repository.get_by(email=email)
        if not user:
            return None
        if not self.verify_password(password, user.hashed_password):
            return None
        return user

    async def create_session(self, user_id: uuid.UUID) -> str:
        session_id = secrets.token_urlsafe(32)
        async with self.redis() as redis_client:
            await redis_client.setex(
                f"session:{session_id}",
                SESSION_EXPIRY_SECONDS,
                str(user_id)
            )
        return session_id

    async def get_session(self, session_id: str) -> Optional[User]:
        async with self.redis() as redis_client:
            user_id = await redis_client.get(f"session:{session_id}")
            if not user_id:
                return None
        return await self.users_repository.get(user_id.decode('utf-8'))

    async def delete_session(self, session_id: str) -> None:
        async with self.redis() as redis_client:
            await redis_client.delete(f"session:{session_id}")