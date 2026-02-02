from typing import Final

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application configuration settings with automatic environment variable injection"""

    # API Configuration
    API_V1_STR: Final[str] = "/api/v1"
    BASE_URL: str = "http://localhost:8000"
    AWARE_DASHBOARD_URL: str = "http://localhost:3000"
    HTTP_TIMEOUT: Final[float] = 60.0

    # OpenClaw
    OPENCLAW_BASE_URL: str = "http://localhost:3420"

    # Service URLs
    REDIS_URI: str = "redis://127.0.0.1:6379/0"
    POSTGRES_DATABASE_URI: str = "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/bluefairy"

    # API Keys (kept for OAuth connectors)
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    MICROSOFT_CLIENT_ID: str = ""
    MICROSOFT_CLIENT_SECRET: str = ""
    MICROSOFT_TENANT_ID: str = ""

    # Google OAuth configuration (constants)
    GOOGLE_AUTH_URL: Final[str] = "https://accounts.google.com/o/oauth2/v2/auth"
    GOOGLE_TOKEN_URL: Final[str] = "https://oauth2.googleapis.com/token"
    GOOGLE_SCOPES: Final[str] = " ".join([
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/contacts.readonly",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/documents",
    ])

    # Microsoft OAuth configuration (constants)
    MICROSOFT_AUTH_URL: Final[str] = (
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    )
    MICROSOFT_TOKEN_URL: Final[str] = (
        "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    )
    MICROSOFT_SCOPES: Final[str] = " ".join([
        "https://graph.microsoft.com/Files.ReadWrite",
        "https://graph.microsoft.com/Files.ReadWrite.All",
        "https://graph.microsoft.com/Sites.ReadWrite.All",
        "offline_access",
    ])

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings: Final[Settings] = Settings()
