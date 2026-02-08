import Foundation

// MARK: - Aware API Models

/// Namespace for all Aware backend API types.
/// Keeps model names short while avoiding collisions with the rest of the app.
enum Aware {

    // MARK: Generic Wrappers

    struct APIResponse<T: Codable & Sendable>: Codable, Sendable {
        let data: T
    }

    struct APIErrorBody: Codable, Sendable {
        let error: String
        let code: String?
    }

    // MARK: Auth

    struct AuthResponse: Codable, Sendable {
        let user: User
        let token: String
        let gateway: Gateway?

        // Map `token` to accessToken for compatibility
        var accessToken: String { token }
        // No refresh token in this API
        var refreshToken: String { token }
    }

    struct Gateway: Codable, Sendable {
        let shortId: String
        let status: String
        let endpoint: String?
        let token: String?
    }

    struct User: Codable, Sendable, Identifiable {
        let id: String
        let email: String
        var name: String? = nil
        var createdAt: String?
    }

    /// `GET /api/auth/me` returns `{ data: { user: {...} } }`
    struct UserWrapper: Codable, Sendable {
        let user: User
    }

    // MARK: Teams

    struct Team: Codable, Sendable, Identifiable {
        let id: String
        let name: String
        let slug: String
        var role: String?
        let createdAt: String
        var updatedAt: String?
        /// Gateway WebSocket URL for this team's tenant container.
        var gatewayUrl: String?
        /// Tenant container status: provisioning, running, stopped, error.
        var tenantStatus: String?
    }

    struct TeamMember: Codable, Sendable, Identifiable {
        let id: String
        let userId: String
        let role: String
        let joinedAt: String
        let email: String
        let name: String
    }

    /// `POST /api/teams` returns `{ data: { team: {...} } }`
    struct TeamWrapper: Codable, Sendable { let team: Team }
    /// `GET /api/teams` returns `{ data: { teams: [...] } }`
    struct TeamsWrapper: Codable, Sendable { let teams: [Team] }
    /// `GET /api/teams/:id/members` returns `{ data: { members: [...] } }`
    struct MembersWrapper: Codable, Sendable { let members: [TeamMember] }
    /// `POST /api/teams/:id/members` returns `{ data: { member: {...} } }`
    struct MemberWrapper: Codable, Sendable { let member: TeamMember }

    // MARK: Connectors

    struct Connector: Codable, Sendable, Identifiable {
        let id: String
        let teamId: String
        let provider: String
        let enabled: Bool
        let scopes: String?
        let createdAt: String
        var updatedAt: String?
    }

    /// `GET /api/teams/:id/connectors` returns `{ data: { connectors: [...] } }`
    struct ConnectorsWrapper: Codable, Sendable { let connectors: [Connector] }
    /// `POST /api/teams/:id/connectors` returns `{ data: { connector: {...} } }`
    struct ConnectorWrapper: Codable, Sendable { let connector: Connector }

    // MARK: Billing

    struct Subscription: Codable, Sendable {
        let planTier: String
        let status: String
        let currentPeriodStart: String?
        let currentPeriodEnd: String?
        let cancelAtPeriodEnd: Bool
    }

    /// `GET /api/teams/:id/billing` returns `{ data: { subscription: {...} } }`
    struct SubscriptionWrapper: Codable, Sendable { let subscription: Subscription }

    struct CheckoutResponse: Codable, Sendable {
        let url: String
    }

    struct PortalResponse: Codable, Sendable {
        let url: String
    }

    // MARK: OAuth

    struct OAuthConnection: Codable, Sendable, Identifiable {
        let id: String
        let provider: String
        let providerAccountId: String
        let scope: String?
        let createdAt: String
    }

    struct OAuthAuthorizeResponse: Codable, Sendable {
        let url: String
        let state: String
    }

    /// `GET /api/oauth/connections` returns `{ data: { connections: [...] } }`
    struct ConnectionsWrapper: Codable, Sendable { let connections: [OAuthConnection] }
}
