import Foundation

// MARK: - Aware API Models

/// Namespace for all Aware backend API types.
/// Keeps model names short while avoiding collisions with the rest of the app.
///
/// The Go server wraps responses in `{"ok": true, "data": {...}}` and uses
/// camelCase keys.  The `APIResponse` wrapper + `convertFromSnakeCase`
/// decoder handle both conventions.
enum Aware {

    // MARK: Generic Wrappers

    /// Generic envelope: `{"ok": bool, "data": T}` or `{"error": {...}}`.
    struct APIResponse<T: Codable & Sendable>: Codable, Sendable {
        let ok: Bool?
        let data: T?
        let error: APIErrorDetail?
    }

    struct APIErrorDetail: Codable, Sendable {
        let code: String?
        let message: String
    }

    /// Legacy error shape: `{"error": "..."}`.
    struct APIErrorBody: Codable, Sendable {
        let error: String
        let code: String?
    }

    // MARK: Auth

    /// Decoded from `data` of `POST /api/auth/login` and `/api/auth/signup`.
    struct AuthResponse: Codable, Sendable {
        let user: User
        let accessToken: String
        let refreshToken: String
        let expiresAt: String?

        /// Gateway info is NOT included in auth responses from the Go server.
        /// The Mac app fetches it separately via `GET /api/gateway/status`.
    }

    /// Decoded from `data` of `GET /api/gateway/status`.
    struct Gateway: Codable, Sendable {
        let status: String
        let healthFailures: Int?
        let lastHealthyAt: String?
        let startedAt: String?
        /// WebSocket endpoint (only when status == "running").
        let endpoint: String?
        /// Gateway auth token (only when status == "running").
        let token: String?
    }

    struct User: Codable, Sendable, Identifiable {
        let id: String
        let email: String
        var name: String? = nil
        var displayName: String? = nil
        var createdAt: String?
    }

    /// Decoded from `data` of `GET /api/auth/me`.
    struct MeResponse: Codable, Sendable {
        let user: User
    }

    // MARK: Google

    struct GoogleStatus: Codable, Sendable {
        let connected: Bool
        let email: String?
        let scopes: String?
        let connectedAt: String?
    }

}
