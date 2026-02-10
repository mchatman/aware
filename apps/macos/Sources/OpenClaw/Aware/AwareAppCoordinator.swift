import Foundation
import OSLog

private let log = Logger(subsystem: "ai.aware", category: "coordinator")

/// Coordinates the Aware app lifecycle: auth → gateway provisioning → connect.
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
            // Try to restore existing Aware session.
            await auth.initialize()

            if auth.isAuthenticated {
                log.info("Session restored — proceeding to gateway")
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
        // Trigger gateway provisioning (creates if needed, no-op if running).
        do {
            try await api.connectGateway()
        } catch {
            log.warning("Gateway connect trigger failed: \(error.localizedDescription, privacy: .public)")
        }

        // Fetch gateway status to get endpoint + token.
        do {
            let gateway = try await api.getGatewayStatus()
            auth.updateGateway(gateway)

            if gateway.status == "running" {
                log.info("Gateway is running")
                enterMainApp()
            } else {
                log.info("Gateway status: \(gateway.status, privacy: .public) — polling")
                startGatewayPolling()
            }
        } catch {
            log.warning("Gateway status failed: \(error.localizedDescription, privacy: .public) — polling")
            startGatewayPolling()
        }
    }

    // MARK: - Gateway Polling

    private func startGatewayPolling() {
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000) // 3s
                guard !Task.isCancelled else { break }

                do {
                    let gateway = try await api.getGatewayStatus()
                    auth.updateGateway(gateway)

                    if gateway.status == "running" {
                        log.info("Gateway is now running")
                        enterMainApp()
                        return
                    }
                    log.debug("Gateway status: \(gateway.status, privacy: .public)")
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

        // The endpoint from the Go server is already wss://.
        let wsUrl: String
        if endpoint.hasPrefix("ws://") || endpoint.hasPrefix("wss://") {
            wsUrl = endpoint
        } else {
            wsUrl = endpoint
                .replacingOccurrences(of: "http://", with: "ws://")
                .replacingOccurrences(of: "https://", with: "wss://")
        }

        log.info("Connecting to gateway: \(wsUrl, privacy: .public)")

        // Build the full URL with token for the WS proxy.
        var connectUrl = wsUrl
        if let token = auth.gatewayToken {
            let sep = connectUrl.contains("?") ? "&" : "?"
            connectUrl += "\(sep)token=\(token)"
        }

        // Write config so GatewayEndpointStore picks it up.
        var root = OpenClawConfigFile.loadDict()
        var gw = root["gateway"] as? [String: Any] ?? [:]
        var remote = gw["remote"] as? [String: Any] ?? [:]
        remote["url"] = connectUrl
        remote["transport"] = "direct"
        if let token = auth.gatewayToken {
            remote["token"] = token
        }
        gw["remote"] = remote
        gw["mode"] = "remote"
        root["gateway"] = gw
        OpenClawConfigFile.saveDict(root)

        // Configure the app to connect in remote/direct mode.
        let state = AppStateStore.shared
        state.connectionMode = .remote
        state.remoteUrl = connectUrl
        state.remoteTransport = .direct

        Task {
            await ConnectionModeCoordinator.shared.apply(mode: .remote, paused: state.isPaused)
        }
    }
}
