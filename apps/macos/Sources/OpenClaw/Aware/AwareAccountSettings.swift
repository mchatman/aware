import AppKit
import OSLog
import SwiftUI

private let log = Logger(subsystem: "ai.aware", category: "account.settings")

struct AwareAccountSettings: View {
    private let auth = AwareAuthManager.shared

    @State private var googleStatus: GoogleStatus = .loading
    @State private var isLoading = true

    enum GoogleStatus {
        case loading
        case connected
        case notConnected
    }

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
                    switch googleStatus {
                    case .loading:
                        ProgressView()
                            .controlSize(.small)
                    case .connected:
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Text("Google connected")
                                .font(.body)
                            Spacer()
                        }
                    case .notConnected:
                        HStack {
                            Image(systemName: "xmark.circle")
                                .foregroundStyle(.secondary)
                            Text("Google not connected")
                            Spacer()
                        }
                    }

                    Text("Gmail, Calendar, Drive, and Contacts access via gog CLI.")
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
        googleStatus = .loading

        do {
            let report = try await GatewayConnection.shared.skillsStatus()
            // Check if the "gog" skill is installed and has no missing binaries.
            if let gogSkill = report.skills.first(where: { $0.name == "gog" }),
               gogSkill.missing.bins.isEmpty {
                googleStatus = .connected
            } else {
                googleStatus = .notConnected
            }
        } catch {
            log.error("Failed to load skills status: \(error)")
            googleStatus = .notConnected
        }
    }
}
