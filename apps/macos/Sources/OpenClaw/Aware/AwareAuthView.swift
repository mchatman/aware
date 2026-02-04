import AppKit
import OSLog
import SwiftUI

private let log = Logger(subsystem: "ai.aware", category: "auth.ui")

// MARK: - Auth View

struct AwareAuthView: View {
    static let windowWidth: CGFloat = 400
    static let windowHeight: CGFloat = 500

    @State private var mode: AuthMode = .login
    @State private var email = ""
    @State private var password = ""

    var onAuthenticated: (() -> Void)?

    private var auth: AwareAuthManager { .shared }

    enum AuthMode: String {
        case login = "Sign In"
        case register = "Create Account"
    }

    var body: some View {
        VStack(spacing: 0) {
            branding
            form
            Spacer(minLength: 16)
            footer
        }
        .padding(32)
        .frame(width: Self.windowWidth, height: Self.windowHeight)
        .background(.black.opacity(0.85))
        .onChange(of: auth.isAuthenticated) { _, authenticated in
            if authenticated { onAuthenticated?() }
        }
    }

    // MARK: Subviews

    private var branding: some View {
        VStack(spacing: 8) {
            Text("aware")
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
            Text(mode == .login ? "Welcome back" : "Get started")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.bottom, 32)
    }

    private var form: some View {
        VStack(spacing: 16) {
            TextField("Email", text: $email)
                .textFieldStyle(.roundedBorder)
                .textContentType(.emailAddress)
            #if compiler(>=6.2)
                .autocorrectionDisabled()
            #else
                .disableAutocorrection(true)
            #endif

            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)
                .textContentType(mode == .register ? .newPassword : .password)

            if let error = auth.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }

            Button(action: submit) {
                if auth.isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .frame(maxWidth: .infinity)
                } else {
                    Text(mode.rawValue)
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .controlSize(.large)
            .disabled(auth.isLoading || !isFormValid)
            .keyboardShortcut(.defaultAction)
        }
    }

    private var footer: some View {
        HStack(spacing: 4) {
            Text(mode == .login ? "Don't have an account?" : "Already have an account?")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button(mode == .login ? "Sign up" : "Sign in") {
                withAnimation(.easeInOut(duration: 0.2)) {
                    mode = mode == .login ? .register : .login
                    auth.error = nil
                }
            }
            .buttonStyle(.link)
            .font(.caption)
        }
    }

    // MARK: Logic

    private var isFormValid: Bool {
        let hasEmail = !email.trimmingCharacters(in: .whitespaces).isEmpty
        let hasPassword = password.count >= 8
        return hasEmail && hasPassword
    }

    private func submit() {
        Task {
            if mode == .register {
                await auth.register(
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password
                )
            } else {
                await auth.login(
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password
                )
            }
        }
    }
}

// MARK: - Window Controller

/// Presents the auth view in its own NSWindow, matching the `OnboardingController` pattern.
@MainActor
final class AwareAuthWindowController {
    static let shared = AwareAuthWindowController()
    private var window: NSWindow?

    func show(onAuthenticated: (() -> Void)? = nil) {
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let view = AwareAuthView(onAuthenticated: { [weak self] in
            onAuthenticated?()
            self?.close()
        })

        let hosting = NSHostingController(rootView: view)
        let window = NSWindow(contentViewController: hosting)
        window.title = "Aware — Sign In"
        window.setContentSize(NSSize(
            width: AwareAuthView.windowWidth,
            height: AwareAuthView.windowHeight
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
