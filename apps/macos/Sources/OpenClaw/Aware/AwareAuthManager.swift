import Foundation
import OSLog
import Security

private let log = Logger(subsystem: "ai.aware", category: "auth")

private let keychainService = "ai.aware.tokens"
private let tokenKey = "aware.token"
private let gatewayEndpointKey = "aware.gatewayEndpoint"
private let gatewayTokenKey = "aware.gatewayToken"
private let currentUserDefaultsKey = "aware.currentUser"

// MARK: - Auth Manager

/// Manages authentication state, token storage (Keychain), and gateway info.
///
/// All public API is `@MainActor` so SwiftUI views can observe changes directly.
@MainActor
@Observable
final class AwareAuthManager {
    static let shared = AwareAuthManager()

    private(set) var isAuthenticated: Bool = false
    private(set) var currentUser: Aware.User?
    private(set) var isLoading: Bool = false
    var error: String?

    /// The gateway WebSocket endpoint (e.g. `wss://aw-xxxx.fly.dev`).
    private(set) var gatewayEndpoint: String?

    /// The token used to authenticate with the gateway WebSocket.
    private(set) var gatewayToken: String?

    private let api = AwareAPIClient.shared

    private init() {}

    // MARK: Lifecycle

    /// Call once at app launch.  Tries to restore a session from stored tokens.
    func initialize() async {
        isLoading = true
        defer { isLoading = false }

        // Restore cached user for instant UI while we validate.
        restoreCachedUser()

        guard let storedToken = loadFromKeychain(key: tokenKey) else {
            log.info("No stored token — user is signed out")
            clearSession()
            return
        }

        // Set the token so the API client can make authenticated requests.
        await api.setAccessToken(storedToken)

        // Validate the token by calling /auth/me.
        do {
            let me = try await api.getMe()
            currentUser = me.user
            isAuthenticated = true
            cacheUser(me.user)

            // Restore gateway info from keychain.
            gatewayEndpoint = loadFromKeychain(key: gatewayEndpointKey)
            gatewayToken = loadFromKeychain(key: gatewayTokenKey)

            // Update gateway info from /auth/me response if available.
            if let gateway = me.gateway {
                gatewayEndpoint = gateway.endpoint
                saveToKeychain(key: gatewayEndpointKey, value: gateway.endpoint)
            }

            log.info("Session restored via /auth/me")
        } catch {
            log.warning("Token validation failed: \(error.localizedDescription, privacy: .public)")
            clearSession()
        }
    }

    // MARK: Auth Actions

    func register(email: String, password: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let auth = try await api.register(email: email, password: password)
            await applyAuth(auth)
            log.info("Registered as \(email, privacy: .public)")
        } catch {
            self.error = friendlyError(error)
            log.error("Register failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    func login(email: String, password: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let auth = try await api.login(email: email, password: password)
            await applyAuth(auth)
            log.info("Logged in as \(email, privacy: .public)")
        } catch {
            self.error = friendlyError(error)
            log.error("Login failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    func logout() {
        clearSession()
        log.info("Logged out")
    }

    /// Updates stored gateway info (called after polling gateway status).
    func updateGateway(_ gateway: Aware.Gateway) {
        gatewayEndpoint = gateway.endpoint
        saveToKeychain(key: gatewayEndpointKey, value: gateway.endpoint)

        if let token = gateway.token {
            gatewayToken = token
            saveToKeychain(key: gatewayTokenKey, value: token)
        }
    }

    // MARK: - Private Helpers

    private func applyAuth(_ auth: Aware.AuthResponse) async {
        saveToKeychain(key: tokenKey, value: auth.token)
        cacheUser(auth.user)

        await api.setAccessToken(auth.token)

        currentUser = auth.user
        isAuthenticated = true
        error = nil

        // Store gateway info if present.
        if let gateway = auth.gateway {
            gatewayEndpoint = gateway.endpoint
            saveToKeychain(key: gatewayEndpointKey, value: gateway.endpoint)

            if let token = gateway.token {
                gatewayToken = token
                saveToKeychain(key: gatewayTokenKey, value: token)
            }
        }
    }

    private func clearSession() {
        deleteFromKeychain(key: tokenKey)
        deleteFromKeychain(key: gatewayEndpointKey)
        deleteFromKeychain(key: gatewayTokenKey)
        UserDefaults.standard.removeObject(forKey: currentUserDefaultsKey)

        Task { await api.setAccessToken(nil) }

        currentUser = nil
        isAuthenticated = false
        gatewayEndpoint = nil
        gatewayToken = nil
    }

    private func friendlyError(_ error: Error) -> String {
        if let apiErr = error as? AwareAPIError {
            return apiErr.localizedDescription
        }
        return error.localizedDescription
    }

    // MARK: User Cache (UserDefaults)

    private func cacheUser(_ user: Aware.User) {
        if let data = try? JSONEncoder().encode(user) {
            UserDefaults.standard.set(data, forKey: currentUserDefaultsKey)
        }
    }

    private func restoreCachedUser() {
        guard let data = UserDefaults.standard.data(forKey: currentUserDefaultsKey) else { return }
        currentUser = try? JSONDecoder().decode(Aware.User.self, from: data)
    }

    // MARK: Keychain

    private func saveToKeychain(key: String, value: String) {
        guard let data = value.data(using: .utf8) else { return }

        // Delete any existing item first.
        deleteFromKeychain(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        if status != errSecSuccess {
            log.error("Keychain save failed for \(key, privacy: .public): \(status)")
        }
    }

    private func loadFromKeychain(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func deleteFromKeychain(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
