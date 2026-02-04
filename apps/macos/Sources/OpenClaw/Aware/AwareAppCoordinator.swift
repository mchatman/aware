import Foundation
import OSLog

private let log = Logger(subsystem: "ai.aware", category: "coordinator")

/// Coordinates the Aware app lifecycle: auth → gateway polling → connect.
///
/// Called from `AppDelegate.applicationDidFinishLaunching` instead of
/// the default OpenClaw onboarding flow.
@MainActor
final class AwareAppCoordinator {
    static let shared = AwareAppCoordinator()

    private let auth = AwareAuthManager.shared
    private let api = AwareAPIClient.shared
    private var pollingTask: Task<Void, Never>?

    /// Entry point — call once at app launch.
    func start() {
        log.info("Aware coordinator starting")

        Task {
            // Step 1: Restore existing session (if any).
            await auth.initialize()

            if auth.isAuthenticated {
                log.info("Session restored — checking gateway")
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
        // Fetch gateway status to get the latest info (including token).
        do {
            let gateway = try await api.getGatewayStatus()
            auth.updateGateway(gateway)

            if gateway.status == "running" {
                log.info("Gateway is running — connecting")
                enterMainApp()
            } else {
                log.info("Gateway status: \(gateway.status, privacy: .public) — polling")
                startGatewayPolling()
            }
        } catch {
            log.warning("Gateway status check failed: \(error.localizedDescription, privacy: .public) — polling")
            startGatewayPolling()
        }
    }

    // MARK: - Gateway Polling

    private func startGatewayPolling() {
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds
                guard !Task.isCancelled else { break }

                do {
                    let gateway = try await api.getGatewayStatus()
                    auth.updateGateway(gateway)

                    if gateway.status == "running" {
                        log.info("Gateway is now running — connecting")
                        enterMainApp()
                        return
                    }

                    log.debug("Gateway status: \(gateway.status, privacy: .public) — continuing poll")
                } catch {
                    log.warning("Gateway poll failed: \(error.localizedDescription, privacy: .public)")
                }
            }
        }
    }

    // MARK: - Main App

    private func enterMainApp() {
        pollingTask?.cancel()
        pollingTask = nil

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
        guard let endpoint = auth.gatewayEndpoint, !endpoint.isEmpty else {
            log.warning("No gateway endpoint — skipping connection")
            return
        }

        // Convert HTTPS endpoint to WSS for WebSocket connection.
        let wsUrl = endpoint
            .replacingOccurrences(of: "http://", with: "ws://")
            .replacingOccurrences(of: "https://", with: "wss://")

        log.info("Connecting to gateway: \(wsUrl, privacy: .public)")

        // Write gateway config so the connection system can resolve the token.
        OpenClawConfigFile.updateGatewayDict { gateway in
            var remote = gateway["remote"] as? [String: Any] ?? [:]
            remote["url"] = wsUrl
            remote["transport"] = "direct"
            if let token = self.auth.gatewayToken {
                remote["token"] = token
            }
            gateway["remote"] = remote
        }

        // Configure the app to connect to the gateway in remote/direct mode.
        let state = AppStateStore.shared
        state.connectionMode = .remote
        state.remoteUrl = wsUrl
        state.remoteTransport = .direct

        Task {
            await ConnectionModeCoordinator.shared.apply(mode: .remote, paused: state.isPaused)
        }
    }
}
