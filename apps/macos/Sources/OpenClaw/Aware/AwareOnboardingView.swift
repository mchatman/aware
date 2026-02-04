import AppKit
import AVFoundation
import OSLog
import Speech
import SwiftUI

private let log = Logger(subsystem: "ai.aware", category: "onboarding.aware")

// MARK: - Onboarding View

struct AwareOnboardingView: View {
    static let windowWidth: CGFloat = 460
    static let windowHeight: CGFloat = 520

    @State private var step: OnboardingStep = .welcome
    @State private var micGranted = false
    @State private var speechGranted = false
    @State private var isRequesting = false

    var onComplete: (() -> Void)?

    enum OnboardingStep {
        case welcome
        case permissions
        case done
    }

    var body: some View {
        VStack(spacing: 0) {
            switch step {
            case .welcome: welcomeStep
            case .permissions: permissionsStep
            case .done: doneStep
            }
        }
        .padding(32)
        .frame(width: Self.windowWidth, height: Self.windowHeight)
        .background(.black.opacity(0.85))
    }

    // MARK: Step 1 — Welcome

    private var welcomeStep: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.blue)

            Text("Welcome to Aware")
                .font(.title.bold())
                .foregroundStyle(.white)

            Text("Your personal AI assistant, right in your menu bar. Talk to it with your voice or hold the right Option key.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Spacer()

            Button(action: { withAnimation { step = .permissions } }) {
                Text("Get Started")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
        }
    }

    // MARK: Step 2 — Permissions

    private var permissionsStep: some View {
        VStack(spacing: 24) {
            stepHeader(
                icon: "lock.shield.fill",
                title: "Permissions",
                subtitle: "Aware needs microphone and speech recognition access for voice commands. Everything runs on-device."
            )

            VStack(spacing: 12) {
                permissionRow(
                    icon: "mic.fill",
                    label: "Microphone",
                    granted: micGranted
                )
                permissionRow(
                    icon: "waveform",
                    label: "Speech Recognition",
                    granted: speechGranted
                )
            }

            if !micGranted || !speechGranted {
                Button(action: requestPermissions) {
                    if isRequesting {
                        ProgressView().controlSize(.small).frame(maxWidth: .infinity)
                    } else {
                        Text("Grant Permissions")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.blue)
                .controlSize(.large)
                .disabled(isRequesting)
            }

            Spacer()

            if micGranted && speechGranted {
                Button(action: { withAnimation { step = .done } }) {
                    Text("Continue")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.blue)
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)
            } else {
                Button("Skip for now") {
                    withAnimation { step = .done }
                }
                .buttonStyle(.link)
                .font(.caption)
            }
        }
        .onAppear { checkPermissions() }
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

            VStack(spacing: 8) {
                tipRow(icon: "mic.fill", text: "Say a wake word to start talking")
                tipRow(icon: "option", text: "Hold right Option for push-to-talk")
            }
            .padding(.top, 8)

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

    private func permissionRow(icon: String, label: String, granted: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(granted ? .green : .secondary)
                .frame(width: 28)

            Text(label)
                .font(.body)
                .foregroundStyle(.white)

            Spacer()

            Image(systemName: granted ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(granted ? .green : .secondary)
        }
        .padding(12)
        .background(Color.secondary.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func tipRow(icon: String, text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.callout)
                .foregroundStyle(.blue)
                .frame(width: 24)
            Text(text)
                .font(.callout)
                .foregroundStyle(.secondary)
            Spacer()
        }
    }

    private func checkPermissions() {
        micGranted = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        speechGranted = SFSpeechRecognizer.authorizationStatus() == .authorized
    }

    private func requestPermissions() {
        isRequesting = true
        Task {
            // Request microphone
            let micResult = await AVCaptureDevice.requestAccess(for: .audio)
            await MainActor.run { micGranted = micResult }

            // Request speech recognition
            await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    Task { @MainActor in
                        speechGranted = status == .authorized
                        continuation.resume()
                    }
                }
            }

            await MainActor.run { isRequesting = false }
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
