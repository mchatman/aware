import AppKit
import SwiftUI

/// Manages the Aware settings window independently of SwiftUI's Settings scene.
/// This allows settings to be opened from non-activating panels (like the notch).
@MainActor
final class AwareSettingsWindowController: NSWindowController, NSWindowDelegate {
    static let shared = AwareSettingsWindowController()

    private var updater: UpdaterProviding?

    private init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: SettingsTab.windowWidth, height: SettingsTab.windowHeight),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false)

        super.init(window: window)
        setupWindow()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setUpdater(_ updater: UpdaterProviding) {
        self.updater = updater
        setupWindow()
    }

    private func setupWindow() {
        guard let window else { return }
        window.title = "Aware Settings"
        window.titlebarAppearsTransparent = false
        window.titleVisibility = .visible
        window.toolbarStyle = .unified
        window.isMovableByWindowBackground = true
        window.collectionBehavior = [.managed, .participatesInCycle, .fullScreenAuxiliary]
        window.hidesOnDeactivate = false
        window.isExcludedFromWindowsMenu = false
        window.isRestorable = true
        window.identifier = NSUserInterfaceItemIdentifier("AwareSettingsWindow")
        window.delegate = self

        let state = AppStateStore.shared
        let settingsView = SettingsRootView(state: state, updater: updater)
            .environment(TailscaleService.shared)
        window.contentView = NSHostingView(rootView: settingsView)
    }

    func showWindow() {
        NSApp.setActivationPolicy(.regular)

        if window?.isVisible == true {
            NSApp.activate(ignoringOtherApps: true)
            window?.orderFrontRegardless()
            window?.makeKeyAndOrderFront(nil)
            return
        }

        window?.center()
        window?.orderFrontRegardless()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        DispatchQueue.main.async { [weak self] in
            self?.window?.makeKeyAndOrderFront(nil)
        }
    }

    override func close() {
        super.close()
        relinquishFocus()
    }

    private func relinquishFocus() {
        window?.orderOut(nil)
        NSApp.setActivationPolicy(.accessory)
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        relinquishFocus()
    }

    func windowDidBecomeKey(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
    }
}
