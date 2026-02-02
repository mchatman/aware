"""Conversation database models"""

import uuid
from datetime import datetime
from typing import Any, Dict, List

# from pgvector.sqlalchemy import Vector  # Temporarily disabled for deployment
from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.core.database.session import Base


class Conversation(Base):
    """Conversation model storing chat history"""

    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, index=True
    )
    session_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    messages: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=True)

    # Relationship to embedding - temporarily disabled for deployment
    # embedding: Mapped["ConversationEmbedding"] = relationship(
    #     "ConversationEmbedding",
    #     back_populates="conversation",
    #     uselist=False,
    #     cascade="all, delete-orphan",
    # )


