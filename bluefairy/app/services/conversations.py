"""Conversation service for managing chat history"""

import uuid
from typing import List

from app.repositories.conversations import ConversationRepository
from app.schemas.conversations import ConversationCreate, ConversationResponse


class ConversationService:
    """Service for managing conversations"""

    def __init__(self, conversation_repository: ConversationRepository) -> None:
        self.conversation_repository = conversation_repository

    async def create_conversation(
        self,
        user_id: str | uuid.UUID,
        session_id: str,
        user_message: str,
        assistant_message: str,
    ) -> ConversationResponse:
        """Create a new conversation or append to an existing one"""
        if isinstance(user_id, str):
            user_id = uuid.UUID(user_id)

        existing = await self.conversation_repository.get_by_session_id(session_id)

        messages = [
            {"role": "user", "content": user_message},
            {"role": "assistant", "content": assistant_message},
        ]

        if existing:
            existing.messages.extend(messages)
            return ConversationResponse.model_validate(existing)
        else:
            conversation_data = ConversationCreate(
                user_id=user_id,
                session_id=session_id,
                messages=messages,
            )
            new_conversation = await self.conversation_repository.create(
                conversation_data
            )
            return ConversationResponse.model_validate(new_conversation)
