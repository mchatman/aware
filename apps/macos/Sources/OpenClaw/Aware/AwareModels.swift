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
