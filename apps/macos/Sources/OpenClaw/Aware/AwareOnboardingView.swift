import AppKit
import OSLog
import SwiftUI

private let log = Logger(subsystem: "ai.aware", category: "onboarding.aware")

// MARK: - Onboarding View

struct AwareOnboardingView: View {
    static let windowWidth: CGFloat = 460
    static let windowHeight: CGFloat = 520

    @State private var step: OnboardingStep = .createTeam
    @State private var teamName = ""
    @State private var isLoading = false
    @State private var error: String?

    var onComplete: (() -> Void)?

    private var teamManager: AwareTeamManager { .shared }

    enum OnboardingStep {
        case createTeam
        case connectWorkspace
        case done
    }

    var body: some View {
        VStack(spacing: 0) {
            switch step {
            case .createTeam: createTeamStep
            case .connectWorkspace: connectWorkspaceStep
            case .done: doneStep
            }
        }
        .padding(32)
        .frame(width: Self.windowWidth, height: Self.windowHeight)
        .background(.black.opacity(0.85))
    }

    // MARK: Step 1 — Create Team

    private var createTeamStep: some View {
        VStack(spacing: 24) {
            stepHeader(
                icon: "person.3.fill",
                title: "Create Your Team",
                subtitle: "A team is your shared workspace for connectors, members, and billing."
            )

            TextField("Team name", text: $teamName)
                .textFieldStyle(.roundedBorder)

            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Spacer()

            Button(action: createTeam) {
                if isLoading {
                    ProgressView().controlSize(.small).frame(maxWidth: .infinity)
                } else {
                    Text("Create Team").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .controlSize(.large)
            .disabled(teamName.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
            .keyboardShortcut(.defaultAction)
        }
    }

    // MARK: Step 2 — Connect Workspace

    private var connectWorkspaceStep: some View {
        VStack(spacing: 24) {
            stepHeader(
                icon: "link.badge.plus",
                title: "Connect Your Workspace",
                subtitle: "Link Google or Microsoft to pull in your calendar, email, and documents."
            )

            VStack(spacing: 12) {
                connectButton(provider: "google", label: "Connect Google Workspace", icon: "globe")
                connectButton(provider: "microsoft", label: "Connect Microsoft 365", icon: "cloud")
            }

            Spacer()

            Button("Skip for now") {
                withAnimation { step = .done }
            }
            .buttonStyle(.link)
            .font(.caption)
        }
    }

    // MARK: Step 3 — Done

    private var doneStep: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.green)

            Text("You're all set!")
                .font(.title2.bold())
                .foregroundStyle(.white)

            Text("Aware is ready to help your team stay in sync.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Spacer()

            Button(action: { onComplete?() }) {
                Text("Start Using Aware")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
        }
    }

    // MARK: Helpers

    private func stepHeader(icon: String, title: String, subtitle: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 40))
                .foregroundStyle(.blue)

            Text(title)
                .font(.title2.bold())
                .foregroundStyle(.white)

            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 8)
    }

    private func connectButton(provider: String, label: String, icon: String) -> some View {
        Button {
            Task { await teamManager.connectProvider(provider) }
        } label: {
            Label(label, systemImage: icon)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
    }

    private func createTeam() {
        let trimmed = teamName.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        isLoading = true
        error = nil

        Task {
            do {
                _ = try await teamManager.createTeam(name: trimmed)
                withAnimation { step = .connectWorkspace }
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}

// MARK: - Window Controller

@MainActor
final class AwareOnboardingWindowController {
    static let shared = AwareOnboardingWindowController()
    private var window: NSWindow?

    func show(onComplete: (() -> Void)? = nil) {
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let view = AwareOnboardingView(onComplete: { [weak self] in
            onComplete?()
            self?.close()
        })

        let hosting = NSHostingController(rootView: view)
        let window = NSWindow(contentViewController: hosting)
        window.title = "Aware — Setup"
        window.setContentSize(NSSize(
            width: AwareOnboardingView.windowWidth,
            height: AwareOnboardingView.windowHeight
        ))
        window.styleMask = [.titled, .closable, .fullSizeContentView]
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.backgroundColor = .black
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
    }

    func close() {
        window?.close()
        window = nil
    }
}
