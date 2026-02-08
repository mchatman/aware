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

    /// Entry point — call once at app launch.
    func start() {
        log.info("Aware coordinator starting")

        Task {
            // Step 1: Restore existing session (if any).
            await auth.initialize()

            if auth.isAuthenticated {
                log.info("Session restored — proceeding to main app")
                enterMainApp()
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

        // Close any lingering auth windows.
        AwareAuthWindowController.shared.close()

        // Connect to the user's gateway.
        connectToGateway()
    }

    // MARK: - Gateway Connection

    private func connectToGateway() {
        guard let gateway = auth.gateway else {
            log.warning("No gateway info from auth — skipping gateway connection")
            return
        }

        guard let endpoint = gateway.endpoint,
              !endpoint.isEmpty,
              gateway.status == "running" else {
            log.info("Gateway not ready (status: \(gateway.status, privacy: .public)) — skipping gateway connection")
            return
        }

        // Convert HTTP URL to WebSocket URL for the gateway connection.
        let wsUrl = endpoint
            .replacingOccurrences(of: "http://", with: "ws://")
            .replacingOccurrences(of: "https://", with: "wss://")

        log.info("Connecting to gateway: \(wsUrl, privacy: .public)")

        // Configure the app to connect to the gateway in direct/remote mode.
        let state = AppStateStore.shared
        state.connectionMode = .remote
        state.remoteUrl = wsUrl

        Task {
            await ConnectionModeCoordinator.shared.apply(mode: .remote, paused: state.isPaused)
        }
    }
}
