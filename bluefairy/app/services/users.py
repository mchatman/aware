"""Users service for user management operations"""

from fastapi import HTTPException
from uuid import UUID

from app.models.user import User
from app.repositories.users import UserRepository
from app.schemas.users import UserCreate, UserResponse, UserInDB
from app.services.auth import AuthService


class UsersService:
    def __init__(self, users_repository: UserRepository, auth_service: AuthService):
        self.users_repository = users_repository
        self.auth_service = auth_service

    async def create_user(self, user_in: UserCreate) -> UserResponse:
        existing_user = await self.users_repository.get_by(email=user_in.email)
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already registered")

        user_in_db = UserInDB(
            **user_in.model_dump(exclude={"password"}),
            hashed_password=self.auth_service.hash_password(user_in.password),
        )

        user = await self.users_repository.create(user_in_db)
        return UserResponse.model_validate(user)

    async def create_default_user(self, user_id: str, email: str) -> None:
        """Create default user for WebRTC authentication workaround"""
        try:
            # Check if default user already exists
            existing_user = await self.users_repository.get(user_id)
            if existing_user:
                print(f"Default user {user_id} already exists")
                return

            # Create default user
            user_in_db = UserInDB(
                id=UUID(user_id),
                email=email,
                hashed_password="",  # No password for default user
            )

            await self.users_repository.create(user_in_db)
            print(f"Created default user: {user_id}")
        except Exception as e:
            print(f"Error creating default user: {e}")
            # Don't raise, just log the error so app continues to start
            pass