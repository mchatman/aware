from dependency_injector import containers, providers

from app.services.conversations import ConversationService
from app.services.auth import AuthService
from app.services.users import UsersService
from app.services.openclaw import OpenClawService
from app.services.sessions import SessionService
from app.core.config import settings
from app.core.database.session import DatabaseManager, RedisManager
from app.core.middleware.auth import SessionAuthenticationBackend
from app.repositories.conversations import ConversationRepository
from app.repositories.users import UserRepository


class GatewayContainer(containers.DeclarativeContainer):
    config = providers.Configuration()

    database_manager = providers.Singleton(
        DatabaseManager,
        database_uri=settings.POSTGRES_DATABASE_URI,
    )

    redis_manager = providers.Singleton(
        RedisManager,
        redis_uri=settings.REDIS_URI,
    )


class RepositoriesContainer(containers.DeclarativeContainer):
    gateways = providers.DependenciesContainer()

    conversation_repository = providers.Factory(
        ConversationRepository,
        session_factory=gateways.database_manager.provided.session,
    )

    users_repository = providers.Factory(
        UserRepository,
        session_factory=gateways.database_manager.provided.session,
    )


class ServicesContainer(containers.DeclarativeContainer):
    config = providers.Configuration()
    repositories = providers.DependenciesContainer()
    gateways = providers.DependenciesContainer()

    openclaw_service = providers.Singleton(
        OpenClawService,
        base_url=settings.OPENCLAW_BASE_URL,
    )

    session_service = providers.Singleton(
        SessionService,
        redis=gateways.redis_manager.provided.session,
        openclaw_service=openclaw_service,
    )

    conversation_service = providers.Singleton(
        ConversationService,
        conversation_repository=repositories.conversation_repository,
    )

    auth_service = providers.Singleton(
        AuthService,
        users_repository=repositories.users_repository,
        redis=gateways.redis_manager.provided.session,
    )

    users_service = providers.Singleton(
        UsersService,
        users_repository=repositories.users_repository,
        auth_service=auth_service,
    )

    auth_backend = providers.Singleton(
        SessionAuthenticationBackend,
        auth_service=auth_service,
    )


class ApplicationContainer(containers.DeclarativeContainer):
    wiring_config = containers.WiringConfiguration(
        modules=[
            "app.api.endpoints.auth",
            "app.api.endpoints.ws",
        ]
    )

    gateways = providers.Container(GatewayContainer)

    repositories = providers.Container(
        RepositoriesContainer,
        gateways=gateways,
    )

    services = providers.Container(
        ServicesContainer,
        repositories=repositories,
        gateways=gateways,
    )
