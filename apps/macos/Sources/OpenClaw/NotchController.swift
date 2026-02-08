import AppKit
import SwiftUI

// MARK: - Notch Window

class NotchPanel: NSPanel {
    override init(
        contentRect: NSRect,
        styleMask: NSWindow.StyleMask,
        backing: NSWindow.BackingStoreType,
        defer flag: Bool
    ) {
        super.init(
            contentRect: contentRect,
            styleMask: styleMask,
            backing: backing,
            defer: flag)

        self.isFloatingPanel = true
        self.isOpaque = false
        self.titleVisibility = .hidden
        self.titlebarAppearsTransparent = true
        self.backgroundColor = .clear
        self.isMovable = false

        self.collectionBehavior = [
            .fullScreenAuxiliary,
            .stationary,
            .canJoinAllSpaces,
            .ignoresCycle,
        ]

        self.isReleasedWhenClosed = false
        self.level = .mainMenu + 3
        self.hasShadow = false
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        let point = event.locationInWindow
        // Check if click is in the gear icon area (stored by NotchSettingsAction)
        let gearFrame = NotchSettingsAction.gearFrame
        guard gearFrame != .zero else {
            super.mouseDown(with: event)
            return
        }
        // Convert SwiftUI coords (top-left origin) to window coords (bottom-left origin)
        let windowHeight = self.frame.height
        let gearInWindow = CGRect(
            x: gearFrame.origin.x,
            y: windowHeight - gearFrame.origin.y - gearFrame.height,
            width: gearFrame.width,
            height: gearFrame.height
        ).insetBy(dx: -10, dy: -10)

        if gearInWindow.contains(point) {
            Task { @MainActor in
                NotchSettingsAction.open()
            }
        } else {
            super.mouseDown(with: event)
        }
    }

    // Allow clicks to register without requiring the panel to be key first
    override func accessibilityPerformPress() -> Bool { true }
}

// MARK: - Notch Controller

@MainActor
final class NotchController {
    static let shared = NotchController()

    private var window: NSWindow?
    private let vm = NotchViewModel()
    private let logger = Logger(subsystem: "ai.openclaw", category: "notch")

    func setup() {
        self.showNotchWindow()
        self.observeGateway()
        self.logger.info("notch controller setup complete")
    }

    // MARK: - Window

    private func showNotchWindow() {
        let selectedScreen = NSScreen.main ?? NSScreen.screens.first!

        self.vm.screen = selectedScreen.localizedName
        self.vm.notchSize = ScreenMetrics.closedNotchSize(screenName: selectedScreen.localizedName)

        let window = self.createNotchWindow(for: selectedScreen)
        self.window = window
        self.positionWindow(window, on: selectedScreen, changeAlpha: true)

        if self.vm.notchState == .closed {
            self.vm.close()
        }
    }

    private func createNotchWindow(for screen: NSScreen) -> NSWindow {
        let window = NotchPanel(
            contentRect: NSRect(
                x: 0, y: 0,
                width: ScreenMetrics.openNotchSize.width,
                height: ScreenMetrics.openNotchSize.height),
            styleMask: [.borderless, .nonactivatingPanel, .utilityWindow, .hudWindow],
            backing: .buffered,
            defer: false)

        window.contentView = NSHostingView(
            rootView: NotchContentView()
                .environmentObject(self.vm))

        window.orderFrontRegardless()

        return window
    }

    private func positionWindow(_ window: NSWindow, on screen: NSScreen, changeAlpha: Bool = false) {
        if changeAlpha {
            window.alphaValue = 0
        }

        DispatchQueue.main.async { [weak window] in
            guard let window else { return }
            let screenFrame = screen.frame
            window.setFrameOrigin(
                NSPoint(
                    x: screenFrame.origin.x + (screenFrame.width / 2) - window.frame.width / 2,
                    y: screenFrame.origin.y + screenFrame.height - window.frame.height))
            window.alphaValue = 1
        }
    }

    // MARK: - Gateway observation

    private func observeGateway() {
        let store = WorkActivityStore.shared

        // Connection state polling (ControlChannel.state isn't yet push-observable)
        Task { [weak self] in
            var lastState: ControlChannel.ConnectionState?
            while !Task.isCancelled {
                guard let self else { return }
                let current = ControlChannel.shared.state

                if current != lastState {
                    lastState = current
                    let status: String
                    switch current {
                    case .connected: status = "connected"
                    case .connecting: status = "connecting"
                    default: status = "disconnected"
                    }
                    self.vm.connectionStatus = status
                }

                try? await Task.sleep(nanoseconds: 500_000_000)
            }
        }

        // Observe work activity + assistant text at 30fps for responsive UI
        Task { [weak self] in
            var lastIconState: IconState?
            var lastTextLength = 0

            while !Task.isCancelled {
                guard let self else { return }

                let iconState = store.iconState
                let text = store.assistantText
                let isStreaming = store.isStreaming
                let activity = store.current

                let iconChanged = iconState != lastIconState
                let textChanged = text.count != lastTextLength

                if iconChanged || textChanged {
                    lastIconState = iconState
                    lastTextLength = text.count

                    // Determine agent phase for notch display
                    let phase: NotchAgentPhase
                    if !text.isEmpty, isStreaming {
                        phase = .responding
                    } else if activity != nil {
                        switch activity!.kind {
                        case .job:
                            phase = .thinking
                        case .tool:
                            phase = .toolUse(activity!.label)
                        }
                    } else {
                        phase = .idle
                    }

                    self.vm.agentPhase = phase
                    self.vm.transcript = text
                }

                try? await Task.sleep(nanoseconds: 33_000_000) // ~30fps
            }
        }
    }
}
