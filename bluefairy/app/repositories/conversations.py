"""Conversation repository for database operations"""

from typing import List

from sqlalchemy import select
# from pgvector.sqlalchemy import Vector  # Temporarily disabled for deployment

from app.models.conversation import Conversation  # ConversationEmbedding temporarily disabled
from app.repositories.base import BaseRepository


class ConversationRepository(BaseRepository):
    _model = Conversation

    async def get_by_session_id(self, session_id: str) -> Conversation | None:
        """Get conversation by session ID"""
        query = select(self._model).filter_by(session_id=session_id)

        async with self.session_factory() as session:
            result = await session.execute(query)
            return result.scalar_one_or_none()

    # Temporarily disabled for deployment until vector extension is available
    # async def find_conversations(self, query_embedding: List[float], user_id: str, limit: int = 10) -> List[Conversation]:
    #     """Find conversations using vector similarity search"""
    #     query = (
    #         select(self._model)
    #         .join(ConversationEmbedding)
    #         .where(self._model.user_id == user_id)
    #         .order_by(ConversationEmbedding.embedding.cosine_distance(query_embedding))
    #         .limit(limit)
    #     )
    #
    #     async with self.session_factory() as session:
    #         result = await session.execute(query)
    #         return list(result.scalars().all())