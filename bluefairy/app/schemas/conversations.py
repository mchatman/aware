"""Conversation schemas for API validation"""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ConversationCreate(BaseModel):
    """Schema for creating a conversation"""
    user_id: uuid.UUID
    session_id: Optional[str] = None
    messages: List[Dict[str, Any]]
    summary: Optional[str] = None


class ConversationUpdate(BaseModel):
    """Schema for updating a conversation"""
    messages: Optional[List[Dict[str, Any]]] = None
    summary: Optional[str] = None


class ConversationResponse(BaseModel):
    """Schema for conversation response"""
    id: uuid.UUID
    user_id: uuid.UUID
    session_id: Optional[str]
    messages: List[Dict[str, Any]]
    summary: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True