import AppKit
import OSLog
import SwiftUI

private let log = Logger(subsystem: "ai.aware", category: "account.settings")

struct AwareAccountSettings: View {
    private let auth = AwareAuthManager.shared
    private let api = AwareAPIClient.shared

    @State private var googleConnections: [Aware.OAuthConnection] = []
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
                    } else if let conn = googleConnections.first(where: { $0.provider == "google" }) {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Google connected")
                                    .font(.body)
                                Text(conn.providerAccountId)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Disconnect") {
                                Task { await disconnectGoogle(id: conn.id) }
                            }
                        }
                    } else {
                        HStack {
                            Image(systemName: "xmark.circle")
                                .foregroundStyle(.secondary)
                            Text("Google not connected")
                            Spacer()
                            Button("Connect Google") {
                                connectGoogle()
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
        }
        .padding(20)
        .task { await loadConnections() }
    }

    // MARK: - Helpers

    private func loadConnections() async {
        isLoading = true
        defer { isLoading = false }

        do {
            googleConnections = try await api.listConnections()
        } catch {
            log.error("Failed to load connections: \(error)")
            googleConnections = []
        }
    }

    private func connectGoogle() {
        Task {
            do {
                let resp = try await api.getOAuthURL(provider: "google", scopes: nil)
                if let url = URL(string: resp.url) {
                    NSWorkspace.shared.open(url)
                }
            } catch {
                log.error("Failed to get Google auth URL: \(error)")
            }
        }
    }

    private func disconnectGoogle(id: String) async {
        do {
            try await api.removeConnection(id: id)
            googleConnections.removeAll { $0.id == id }
        } catch {
            log.error("Failed to disconnect Google: \(error)")
        }
    }
}
