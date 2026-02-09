import Foundation
import OSLog
import Security

private let log = Logger(subsystem: "ai.aware", category: "auth")

private let keychainService = "ai.aware.tokens"
private let accessTokenKey = "aware.accessToken"
private let currentUserDefaultsKey = "aware.currentUser"

// MARK: - Auth Manager

/// Manages authentication state, token storage (Keychain), and automatic refresh.
///
/// All public API is `@MainActor` so SwiftUI views can observe changes directly.
@MainActor
@Observable
final class AwareAuthManager {
    static let shared = AwareAuthManager()

    private(set) var isAuthenticated: Bool = false
    private(set) var currentUser: Aware.User?
    private(set) var gateway: Aware.Gateway?
    private(set) var isLoading: Bool = false
    var error: String?

    private let api = AwareAPIClient.shared

    private init() {}

    // MARK: Lifecycle

    /// Call once at app launch.  Tries to restore a session from stored tokens.
    func initialize() async {
        isLoading = true
        defer { isLoading = false }

        // Restore cached user for instant UI while we validate.
        restoreCachedUser()

        guard let storedToken = loadFromKeychain(key: accessTokenKey) else {
            log.info("No stored access token — user is signed out")
            clearSession()
            return
        }

        // Set the token so the API client can make authenticated requests.
        await api.setAccessToken(storedToken)

        // Validate the token by fetching the current user.
        do {
            let me = try await api.getMe()
            currentUser = me.user
            cacheUser(me.user)
            gateway = me.gateway
            isAuthenticated = true
            error = nil
            log.info("Session restored via /auth/me")
        } catch {
            log.warning("Session validation failed: \(error.localizedDescription, privacy: .public)")
            clearSession()
        }
    }

    // MARK: Auth Actions

    func register(email: String, password: String, name: String) async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            let auth = try await api.register(email: email, password: password, name: name)
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

    func logout() async {
        isLoading = true
        defer { isLoading = false }

        do {
            try await api.logout()
        } catch {
            // Best-effort — clear local state regardless.
            log.warning("Server logout failed: \(error.localizedDescription, privacy: .public)")
        }

        clearSession()
        log.info("Logged out")
    }

    // MARK: - Private Helpers

    private func applyAuth(_ auth: Aware.AuthResponse) async {
        saveToKeychain(key: accessTokenKey, value: auth.accessToken)
        cacheUser(auth.user)

        await api.setAccessToken(auth.accessToken)

        currentUser = auth.user
        gateway = auth.gateway
        isAuthenticated = true
        error = nil
    }

    private func clearSession() {
        deleteFromKeychain(key: accessTokenKey)
        UserDefaults.standard.removeObject(forKey: currentUserDefaultsKey)

        Task { await api.setAccessToken(nil) }

        currentUser = nil
        gateway = nil
        isAuthenticated = false
    }

    private func friendlyError(_ error: Error) -> String {
        if let apiErr = error as? AwareAPIError {
            return apiErr.localizedDescription
        }
        return error.localizedDescription
    }

    // MARK: User Cache (UserDefaults)

    private func cacheUser(_ user: Aware.User) {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        if let data = try? encoder.encode(user) {
            UserDefaults.standard.set(data, forKey: currentUserDefaultsKey)
        }
    }

    private func restoreCachedUser() {
        guard let data = UserDefaults.standard.data(forKey: currentUserDefaultsKey) else { return }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        currentUser = try? decoder.decode(Aware.User.self, from: data)
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
