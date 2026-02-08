import Foundation
import OSLog

private let log = Logger(subsystem: "ai.aware", category: "api")

// MARK: - Error Types

enum AwareAPIError: Error, Sendable, LocalizedError {
    case network(underlying: String)
    case unauthorized
    case serverError(String)
    case decodingError(String)
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .network(let msg): "Network error: \(msg)"
        case .unauthorized: "Session expired — please sign in again."
        case .serverError(let msg): msg
        case .decodingError(let msg): "Decoding error: \(msg)"
        case .invalidURL: "Invalid URL"
        }
    }
}

// MARK: - API Client

/// Actor-isolated HTTP client for the Aware backend API.
///
/// Thread-safe by construction — all mutable state (tokens, base URL)
/// lives inside the actor.  Callers awaiting across isolation boundaries
/// is the only synchronisation needed.
actor AwareAPIClient {
    static let shared = AwareAPIClient()

    private var baseURL: String = "https://aware-api.fly.dev"
    private var accessToken: String?

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    // MARK: Configuration

    func configure(baseURL: String) {
        self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        log.info("API base URL set to \(self.baseURL, privacy: .public)")
    }

    func setAccessToken(_ token: String?) {
        self.accessToken = token
    }

    // MARK: Auth

    func register(email: String, password: String, name: String) async throws -> Aware.AuthResponse {
        try await post("/auth/signup", body: [
            "email": email,
            "password": password,
        ])
    }

    func login(email: String, password: String) async throws -> Aware.AuthResponse {
        try await post("/auth/login", body: [
            "email": email,
            "password": password,
        ])
    }

    func getMe() async throws -> Aware.User {
        let wrapper: Aware.UserWrapper = try await get("/auth/me")
        return wrapper.user
    }

    func logout() async throws {
        let _: EmptyData = try await post("/auth/logout", body: nil)
    }

    // MARK: Google

    func googleStatus() async throws -> Aware.GoogleStatus {
        try await get("/auth/google/status")
    }

    func googleDisconnect() async throws {
        let _: EmptyData = try await delete("/auth/google")
    }

    /// Returns the OAuth URL for connecting Google. Opens in browser.
    func googleAuthUrl() async -> String? {
        guard let token = accessToken else { return nil }
        return "\(baseURL)/auth/google?token=\(token)"
    }

    // MARK: - Private Helpers

    /// Placeholder type for endpoints that return no meaningful data.
    private struct EmptyData: Codable, Sendable {}

    private func get<T: Codable & Sendable>(_ path: String) async throws -> T {
        try await request("GET", path: path, body: nil, authenticated: true)
    }

    private func post<T: Codable & Sendable>(_ path: String, body: [String: String]?) async throws -> T {
        try await request("POST", path: path, body: body, authenticated: true)
    }

    private func delete<T: Codable & Sendable>(_ path: String) async throws -> T {
        try await request("DELETE", path: path, body: nil, authenticated: true)
    }

    private func request<T: Codable & Sendable>(
        _ method: String,
        path: String,
        body: [String: String]?,
        authenticated: Bool
    ) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw AwareAPIError.invalidURL
        }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        if authenticated, let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            req.httpBody = try encoder.encode(body)
        }

        log.debug("\(method, privacy: .public) \(path, privacy: .public)")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            log.error("Network error: \(error.localizedDescription, privacy: .public)")
            throw AwareAPIError.network(underlying: error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AwareAPIError.network(underlying: "Invalid response type")
        }

        let status = httpResponse.statusCode
        log.debug("\(method, privacy: .public) \(path, privacy: .public) → \(status)")

        if status == 401 {
            throw AwareAPIError.unauthorized
        }

        if status < 200 || status >= 300 {
            // Try to decode the structured error body.
            if let apiError = try? decoder.decode(Aware.APIErrorBody.self, from: data) {
                throw AwareAPIError.serverError(apiError.error)
            }
            throw AwareAPIError.serverError("HTTP \(status)")
        }

        // For endpoints that return no body (204 etc.) with EmptyData target.
        if data.isEmpty || status == 204 {
            if let empty = EmptyData() as? T { return empty }
        }

        do {
            let wrapped = try decoder.decode(Aware.APIResponse<T>.self, from: data)
            return wrapped.data
        } catch {
            // Fallback: try decoding T directly (some endpoints may not wrap).
            do {
                return try decoder.decode(T.self, from: data)
            } catch let fallbackError {
                log.error("Decode failed for \(path, privacy: .public): \(fallbackError.localizedDescription, privacy: .public)")
                throw AwareAPIError.decodingError(fallbackError.localizedDescription)
            }
        }
    }
}
