import AppKit
import OSLog
import SwiftUI

private let log = Logger(subsystem: "ai.aware", category: "account.settings")

struct AwareAccountSettings: View {
    private let auth = AwareAuthManager.shared

    @State private var googleAccount: String?
    @State private var isLoading = true

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // MARK: Account
            GroupBox("Account") {
                VStack(alignment: .leading, spacing: 12) {
                    if let user = auth.currentUser {
                        HStack {
                            Image(systemName: "person.circle.fill")
                                .font(.title2)
                                .foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(user.email)
                                    .font(.body)
                                Text("Signed in")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Sign Out") {
                                Task {
                                    await auth.logout()
                                    // Clear saved connection config.
                                    let state = AppStateStore.shared
                                    state.connectionMode = .unconfigured
                                    state.remoteUrl = ""
                                    // Remove gateway remote URL from config file on disk.
                                    OpenClawConfigFile.updateGatewayDict { gateway in
                                        gateway.removeValue(forKey: "remote")
                                    }
                                    // Fully disconnect: stop gateway, tunnels, control channel.
                                    await ConnectionModeCoordinator.shared.apply(mode: .unconfigured, paused: false)
                                    // Close settings and return to auth screen.
                                    AwareSettingsWindowController.shared.close()
                                    AwareAppCoordinator.shared.start()
                                }
                            }
                        }
                    } else {
                        Text("Not signed in")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(8)
            }

            // MARK: Google
            GroupBox("Google") {
                VStack(alignment: .leading, spacing: 12) {
                    if isLoading {
                        ProgressView()
                            .controlSize(.small)
                    } else if let account = googleAccount {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Google connected")
                                    .font(.body)
                                Text(account)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Disconnect") {
                                Task { await disconnectGoogle() }
                            }
                        }
                    } else {
                        HStack {
                            Image(systemName: "xmark.circle")
                                .foregroundStyle(.secondary)
                            Text("Google not connected")
                            Spacer()
                        }
                    }

                    Text("Gmail, Calendar, Drive, and Contacts access.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(8)
            }

            Spacer()

            // MARK: Quit
            Button {
                NSApp.terminate(nil)
            } label: {
                Label("Quit Aware", systemImage: "power")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        }
        .padding(20)
        .task { await loadGoogleStatus() }
    }

    // MARK: - Helpers

    private func loadGoogleStatus() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let data = try await GatewayConnection.shared.requestRaw(method: .configGet)
            googleAccount = Self.extractGmailAccount(from: data)
        } catch {
            log.error("Failed to load gateway config: \(error)")
            googleAccount = nil
        }
    }

    /// Extracts `config.hooks.gmail.account` from the gateway config snapshot JSON.
    static func extractGmailAccount(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let config = json["config"] as? [String: Any],
              let hooks = config["hooks"] as? [String: Any],
              let gmail = hooks["gmail"] as? [String: Any],
              let account = gmail["account"] as? String,
              !account.isEmpty else {
            return nil
        }
        return account
    }

    private func disconnectGoogle() async {
        do {
            // Remove the gmail hook config via gateway config.patch
            try await GatewayConnection.shared.requestVoid(
                method: .configPatch,
                params: ["raw": AnyCodable("{\"hooks\":{\"gmail\":{\"account\":null}}}")]
            )
            googleAccount = nil
            log.info("Disconnected Google (removed hooks.gmail.account)")
        } catch {
            log.error("Failed to disconnect Google: \(error)")
        }
    }
}
