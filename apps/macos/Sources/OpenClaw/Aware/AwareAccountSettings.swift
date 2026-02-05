import AppKit
import OSLog
import SwiftUI

private let log = Logger(subsystem: "ai.aware", category: "account.settings")

struct AwareAccountSettings: View {
    private let auth = AwareAuthManager.shared
    private let api = AwareAPIClient.shared

    @State private var googleConnected = false
    @State private var googleEmail: String?
    @State private var isPollingGoogle = false
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
                                auth.logout()
                                // Re-show auth window.
                                AwareAppCoordinator.shared.start()
                            }
                            .buttonStyle(.bordered)
                        }
                    } else {
                        Text("Not signed in")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(8)
            }

            // MARK: Google
            GroupBox("Google Workspace") {
                VStack(alignment: .leading, spacing: 12) {
                    if isLoading {
                        HStack {
                            ProgressView().controlSize(.small)
                            Text("Checking connection…")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(8)
                    } else if googleConnected {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.title2)
                                .foregroundStyle(.green)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(googleEmail ?? "Connected")
                                    .font(.body)
                                Text("Gmail, Calendar, Drive, Contacts")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Disconnect") {
                                Task { await disconnectGoogle() }
                            }
                            .buttonStyle(.bordered)
                        }
                    } else {
                        HStack {
                            Image(systemName: "exclamationmark.circle")
                                .font(.title2)
                                .foregroundStyle(.orange)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Not connected")
                                    .font(.body)
                                Text("Connect to access Gmail, Calendar, Drive, and Contacts")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(action: connectGoogle) {
                                if isPollingGoogle {
                                    HStack(spacing: 4) {
                                        ProgressView().controlSize(.small)
                                        Text("Waiting…")
                                    }
                                } else {
                                    Text("Connect Google")
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(isPollingGoogle)
                        }
                    }
                }
                .padding(8)
            }

            Spacer()
        }
        .padding(16)
        .task { await checkGoogleStatus() }
    }

    // MARK: - Actions

    private func checkGoogleStatus() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let status = try await api.getGoogleStatus()
            googleConnected = status.connected
            googleEmail = status.email
        } catch {
            log.warning("Failed to check Google status: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func connectGoogle() {
        Task {
            guard let url = await api.googleAuthURL(),
                  let nsUrl = URL(string: url) else { return }

            NSWorkspace.shared.open(nsUrl)
            isPollingGoogle = true

            while !googleConnected {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                do {
                    let status = try await api.getGoogleStatus()
                    if status.connected {
                        googleConnected = true
                        googleEmail = status.email
                        isPollingGoogle = false
                    }
                } catch {
                    log.warning("Google poll failed: \(error.localizedDescription, privacy: .public)")
                }
            }
        }
    }

    private func disconnectGoogle() async {
        do {
            let _: Aware.GoogleStatus = try await api.delete("/auth/google")
            googleConnected = false
            googleEmail = nil
            log.info("Google disconnected")
        } catch {
            log.error("Failed to disconnect Google: \(error.localizedDescription, privacy: .public)")
        }
    }
}
