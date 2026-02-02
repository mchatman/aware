import Foundation
import OSLog

private let log = Logger(subsystem: "ai.aware", category: "coordinator")

/// Coordinates the Aware app lifecycle: auth → onboarding → main app.
///
/// Called from `AppDelegate.applicationDidFinishLaunching` instead of
/// the default OpenClaw onboarding flow.
@MainActor
final class AwareAppCoordinator {
    static let shared = AwareAppCoordinator()

    private let auth = AwareAuthManager.shared
    private let teams = AwareTeamManager.shared

    /// Entry point — call once at app launch.
    func start() {
        log.info("Aware coordinator starting")

        Task {
            // Step 1: Restore existing session (if any).
            await auth.initialize()

            if auth.isAuthenticated {
                log.info("Session restored — checking team setup")
                await proceedAfterAuth()
            } else {
                log.info("No session — showing auth window")
                showAuth()
            }
        }
    }

    // MARK: - Auth

    private func showAuth() {
        AwareAuthWindowController.shared.show { [weak self] in
            log.info("Auth succeeded")
            Task { @MainActor in
                await self?.proceedAfterAuth()
            }
        }
    }

    // MARK: - Post-Auth

    private func proceedAfterAuth() async {
        // Load teams for the authenticated user.
        await teams.loadTeams()

        if teams.teams.isEmpty {
            // New user — needs onboarding (create team, connect workspace).
            log.info("No teams found — showing onboarding")
            showOnboarding()
        } else {
            // Existing user — select their team and proceed.
            if let team = teams.teams.first {
                log.info("Selecting team: \(team.name, privacy: .public)")
                await teams.selectTeam(team)
            }
            enterMainApp()
        }
    }

    // MARK: - Onboarding

    private func showOnboarding() {
        AwareOnboardingWindowController.shared.show { [weak self] in
            log.info("Onboarding complete")
            Task { @MainActor in
                self?.enterMainApp()
            }
        }
    }

    // MARK: - Main App

    private func enterMainApp() {
        log.info("Entering main app")

        // Mark OpenClaw onboarding as seen so it never triggers.
        UserDefaults.standard.set(true, forKey: onboardingSeenKey)
        UserDefaults.standard.set(currentOnboardingVersion, forKey: onboardingVersionKey)
        AppStateStore.shared.onboardingSeen = true

        // Close any lingering auth/onboarding windows.
        AwareAuthWindowController.shared.close()
        AwareOnboardingWindowController.shared.close()

        // Connect to the team's tenant gateway.
        connectToTenantGateway()
    }

    // MARK: - Gateway Connection

    private func connectToTenantGateway() {
        guard let team = teams.currentTeam else {
            log.warning("No current team — skipping gateway connection")
            return
        }

        guard let gatewayUrl = team.gatewayUrl,
              !gatewayUrl.isEmpty,
              team.tenantStatus == "running" else {
            log.info("Tenant not ready (status: \(team.tenantStatus ?? "none", privacy: .public)) — skipping gateway connection")
            return
        }

        // Convert HTTP URL to WebSocket URL for the gateway connection.
        let wsUrl = gatewayUrl
            .replacingOccurrences(of: "http://", with: "ws://")
            .replacingOccurrences(of: "https://", with: "wss://")

        log.info("Connecting to tenant gateway: \(wsUrl, privacy: .public)")

        // Configure the app to connect to the tenant gateway in direct/remote mode.
        let state = AppStateStore.shared
        state.connectionMode = .remote
        state.remoteUrl = wsUrl

        Task {
            await ConnectionModeCoordinator.shared.apply(mode: .remote, paused: state.isPaused)
        }
    }
}
