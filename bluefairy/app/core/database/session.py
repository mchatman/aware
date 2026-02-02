"""Database and Redis session management"""

from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Callable

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
import redis.asyncio as aioredis


class Base(DeclarativeBase):
    pass


class DatabaseManager:
    def __init__(self, database_uri: str) -> None:
        self._engine = create_async_engine(database_uri, echo=True, future=True)
        self._session_factory = async_sessionmaker(self._engine, expire_on_commit=False)

    @asynccontextmanager
    async def session(self) -> Callable[..., AbstractAsyncContextManager[AsyncSession]]:
        async with self._session_factory() as session:
            yield session

    async def create_database(self) -> None:
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)


class RedisManager:
    def __init__(self, redis_uri: str) -> None:
        self._redis = aioredis.from_url(redis_uri)

    @asynccontextmanager
    async def session(self) -> Callable[..., AbstractAsyncContextManager[aioredis.Redis]]:
        async with self._redis as session:
            yield session

    async def close(self) -> None:
        await self._redis.close()