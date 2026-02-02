"""Base repository with generic CRUD operations"""

from contextlib import AbstractAsyncContextManager
from typing import Callable, Generic, Optional, Sequence, Type, TypeVar

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database.session import Base

ModelType = TypeVar("ModelType", bound=Base)
CreateSchemaType = TypeVar("CreateSchemaType", bound=BaseModel)
UpdateSchemaType = TypeVar("UpdateSchemaType", bound=BaseModel)


class BaseRepository(Generic[ModelType, CreateSchemaType, UpdateSchemaType]):
    _model: Type[ModelType]

    def __init__(
        self, session_factory: Callable[..., AbstractAsyncContextManager[AsyncSession]]
    ) -> None:
        self.session_factory = session_factory

    async def get(self, entity_id: str) -> Optional[ModelType]:
        query = select(self._model).filter_by(id=entity_id)

        async with self.session_factory() as session:
            result = await session.execute(query)
            return result.scalar_one_or_none()

    async def get_all(self, **kwargs) -> Sequence[ModelType]:
        query = select(self._model).filter_by(**kwargs)

        async with self.session_factory() as session:
            result = await session.execute(query)
            return result.scalars().all()

    async def create(self, entity_in: CreateSchemaType) -> ModelType:
        entity = self._model(**entity_in.model_dump())

        async with self.session_factory() as session:
            session.add(entity)
            await session.commit()
            await session.refresh(entity)

            return entity

    async def delete(self, id: str) -> Optional[ModelType]:
        query = select(self._model).filter_by(id=id)

        async with self.session_factory() as session:
            result = await session.execute(query)
            entity = result.scalar_one_or_none()
            if entity:
                await session.delete(entity)
                await session.commit()
            return entity

    async def get_by(self, **kwargs) -> Optional[ModelType]:
        """Get an entity by field(s)"""
        query = select(self._model).filter_by(**kwargs)

        async with self.session_factory() as session:
            result = await session.execute(query)
            return result.scalar_one_or_none()