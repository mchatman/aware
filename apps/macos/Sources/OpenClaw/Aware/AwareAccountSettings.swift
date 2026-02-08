import AppKit
import OSLog
import SwiftUI

private let log = Logger(subsystem: "ai.aware", category: "account.settings")

struct AwareAccountSettings: View {
    private let auth = AwareAuthManager.shared
    private let api = AwareAPIClient.shared

    @State private var googleStatus: Aware.GoogleStatus?
    @State private var isLoadingGoogle = true

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
                                    // Disconnect the gateway (auth gate will prevent reconnection).
                                    await GatewayConnection.shared.shutdown()
                                    await ControlChannel.shared.disconnect()
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
                    if isLoadingGoogle {
                        ProgressView()
                            .controlSize(.small)
                    } else if let status = googleStatus, status.connected {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Google connected")
                                    .font(.body)
                                if let email = status.email {
                                    Text(email)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
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
                            Button("Connect Google") {
                                Task { await connectGoogle() }
                            }
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
        isLoadingGoogle = true
        defer { isLoadingGoogle = false }

        do {
            googleStatus = try await api.googleStatus()
        } catch {
            log.error("Failed to load Google status: \(error)")
            googleStatus = nil
        }
    }

    private func connectGoogle() async {
        guard let url = await api.googleAuthUrl(),
              let authUrl = URL(string: url) else {
            log.error("Failed to build Google auth URL")
            return
        }
        NSWorkspace.shared.open(authUrl)

        // Poll for status after a delay (user completes OAuth in browser).
        Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            await loadGoogleStatus()
        }
    }

    private func disconnectGoogle() async {
        do {
            try await api.googleDisconnect()
            googleStatus = Aware.GoogleStatus(connected: false, email: nil, scopes: nil, connectedAt: nil)
            log.info("Disconnected Google")
        } catch {
            log.error("Failed to disconnect Google: \(error)")
        }
    }
}
