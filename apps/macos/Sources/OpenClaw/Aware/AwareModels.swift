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
        let accessToken: String
        let refreshToken: String
    }

    struct User: Codable, Sendable, Identifiable {
        let id: String
        let email: String
        let name: String
        var createdAt: String?
    }

    // MARK: Teams

    struct Team: Codable, Sendable, Identifiable {
        let id: String
        let name: String
        let slug: String
        var role: String?
        let createdAt: String
    }

    struct TeamMember: Codable, Sendable, Identifiable {
        let id: String
        let userId: String
        let role: String
        let joinedAt: String
        let email: String
        let name: String
    }

    // MARK: Connectors

    struct Connector: Codable, Sendable, Identifiable {
        let id: String
        let teamId: String
        let provider: String
        let enabled: Bool
        let scopes: String?
        let createdAt: String
    }

    // MARK: Billing

    struct Subscription: Codable, Sendable {
        let planTier: String
        let status: String
        let currentPeriodStart: String?
        let currentPeriodEnd: String?
        let cancelAtPeriodEnd: Bool
    }

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
}
