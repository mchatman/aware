import AppKit
import Foundation
import OSLog

private let log = Logger(subsystem: "ai.aware", category: "teams")

private let selectedTeamIdKey = "aware.selectedTeamId"

// MARK: - Team Manager

/// Manages team state — current selection, members, connectors, billing.
///
/// Lives on `@MainActor` so SwiftUI views can bind directly.
@MainActor
@Observable
final class AwareTeamManager {
    static let shared = AwareTeamManager()

    private(set) var currentTeam: Aware.Team?
    private(set) var teams: [Aware.Team] = []
    private(set) var members: [Aware.TeamMember] = []
    private(set) var connectors: [Aware.Connector] = []
    private(set) var connections: [Aware.OAuthConnection] = []
    private(set) var subscription: Aware.Subscription?

    private(set) var isLoading: Bool = false
    private(set) var error: String?

    private let api = AwareAPIClient.shared

    private init() {}

    // MARK: Load

    /// Fetches the team list and restores the previously-selected team (if any).
    func loadTeams() async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            teams = try await api.listTeams()

            // Restore previous selection.
            if let savedId = UserDefaults.standard.string(forKey: selectedTeamIdKey),
               let saved = teams.first(where: { $0.id == savedId })
            {
                await selectTeam(saved)
            } else if let first = teams.first {
                await selectTeam(first)
            }

            log.info("Loaded \(self.teams.count) team(s)")
        } catch {
            self.error = error.localizedDescription
            log.error("Failed to load teams: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: Select

    /// Selects a team and loads all associated data in parallel.
    func selectTeam(_ team: Aware.Team) async {
        currentTeam = team
        UserDefaults.standard.set(team.id, forKey: selectedTeamIdKey)

        log.info("Selected team: \(team.name, privacy: .public) (\(team.id, privacy: .public))")

        // Fire all fetches concurrently.
        await withTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                do { self.members = try await self.api.listTeamMembers(teamId: team.id) }
                catch { log.warning("Members fetch failed: \(error.localizedDescription, privacy: .public)") }
            }
            group.addTask { @MainActor in
                do { self.connectors = try await self.api.listConnectors(teamId: team.id) }
                catch { log.warning("Connectors fetch failed: \(error.localizedDescription, privacy: .public)") }
            }
            group.addTask { @MainActor in
                do { self.connections = try await self.api.listConnections() }
                catch { log.warning("Connections fetch failed: \(error.localizedDescription, privacy: .public)") }
            }
            group.addTask { @MainActor in
                do { self.subscription = try await self.api.getSubscription(teamId: team.id) }
                catch {
                    // Subscription may 404 if the team has none — that's fine.
                    self.subscription = nil
                    log.debug("No subscription for team \(team.id, privacy: .public)")
                }
            }
        }
    }

    // MARK: Create

    @discardableResult
    func createTeam(name: String) async throws -> Aware.Team {
        let team = try await api.createTeam(name: name)
        teams.append(team)
        await selectTeam(team)
        log.info("Created team: \(team.name, privacy: .public)")
        return team
    }

    // MARK: OAuth

    /// Opens the OAuth authorization URL for a provider in the default browser.
    func connectProvider(_ provider: String) async {
        guard let team = currentTeam else {
            log.warning("connectProvider called with no current team")
            return
        }

        do {
            let oauth = try await api.getOAuthURL(provider: provider, scopes: nil)
            if let url = URL(string: oauth.url) {
                NSWorkspace.shared.open(url)
                log.info("Opened OAuth URL for \(provider, privacy: .public)")
            }
        } catch {
            self.error = error.localizedDescription
            log.error("OAuth URL failed for \(provider, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
        // Suppress unused-variable warning — team is used for context / future scoping.
        _ = team
    }

    // MARK: Refresh Helpers

    /// Re-fetches connectors and connections for the current team.
    func refreshConnectors() async {
        guard let team = currentTeam else { return }
        do {
            connectors = try await api.listConnectors(teamId: team.id)
            connections = try await api.listConnections()
        } catch {
            log.warning("Connector refresh failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Re-fetches members for the current team.
    func refreshMembers() async {
        guard let team = currentTeam else { return }
        do {
            members = try await api.listTeamMembers(teamId: team.id)
        } catch {
            log.warning("Members refresh failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
