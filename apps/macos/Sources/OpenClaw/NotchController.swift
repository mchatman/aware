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

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
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

                    NotificationCenter.default.post(
                        name: .notchAgentUpdate,
                        object: nil,
                        userInfo: ["connectionStatus": status])
                }

                try? await Task.sleep(nanoseconds: 500_000_000)
            }
        }

        // Observe agent work activity for transcript/tool updates
        Task { [weak self] in
            var lastIconState: IconState?
            while !Task.isCancelled {
                guard self != nil else { return }
                let store = WorkActivityStore.shared
                let iconState = store.iconState
                let activity = store.current

                if iconState != lastIconState {
                    lastIconState = iconState

                    var userInfo: [String: Any] = [:]

                    switch iconState {
                    case .idle:
                        userInfo["isListening"] = false
                        userInfo["isSpeaking"] = false
                    case .workingMain, .workingOther, .overridden:
                        userInfo["isListening"] = true
                        if let label = activity?.label {
                            userInfo["transcript"] = "Working: \(label)"
                            userInfo["isSpeaking"] = true
                        }
                    }

                    NotificationCenter.default.post(
                        name: .notchAgentUpdate,
                        object: nil,
                        userInfo: userInfo)
                }

                try? await Task.sleep(nanoseconds: 250_000_000)
            }
        }
    }
}
