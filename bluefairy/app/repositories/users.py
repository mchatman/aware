"""User repository for database operations"""

from app.repositories.base import BaseRepository
from app.models.user import User
from app.schemas.users import UserCreate, UserUpdate


class UserRepository(BaseRepository[User, UserCreate, UserUpdate]):
    """Repository for User model operations"""
    _model = User