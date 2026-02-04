import Foundation

// MARK: - Aware API Models

/// Namespace for all Aware backend API types.
/// Keeps model names short while avoiding collisions with the rest of the app.
enum Aware {

    // MARK: Error

    struct APIErrorBody: Codable, Sendable {
        let error: String
    }

    // MARK: Auth

    struct AuthResponse: Codable, Sendable {
        let token: String
        let user: User
        let gateway: Gateway?
    }

    struct User: Codable, Sendable, Identifiable {
        let id: String
        let email: String
    }

    struct MeResponse: Codable, Sendable {
        let user: User
        let gateway: Gateway?
    }

    // MARK: Gateway

    struct Gateway: Codable, Sendable {
        let shortId: String
        let status: String
        let endpoint: String
        var token: String?
        var region: String?
        var machineId: String?
        var ready: Bool?
        var createdAt: String?
    }
}
