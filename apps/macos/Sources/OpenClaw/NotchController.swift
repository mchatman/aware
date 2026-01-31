import AppKit
import QuartzCore
import SwiftUI

/// Manages the borderless panel that sits at the notch and reacts to agent events.
@MainActor
final class NotchController {
    static let shared = NotchController()

    private var window: NSPanel?
    private var hostingView: NSHostingView<NotchView>?
    private var trackingArea: NSTrackingArea?

    private let state = NotchState.shared
    private let logger = Logger(subsystem: "ai.openclaw", category: "notch")

    // MARK: - Layout

    /// How far below the top of the visible area (below menu bar) the pill sits.
    private let topInset: CGFloat = 4
    /// Extra hit-test padding around the panel for hover detection.
    private let hoverPadding: CGFloat = 20

    // MARK: - Lifecycle

    func setup() {
        self.ensureWindow()
        self.observeWorkActivity()
        self.observeControlChannel()
        self.logger.info("notch controller setup complete")
    }

    func show() {
        self.ensureWindow()
        self.state.isVisible = true
        self.updateView()
        guard let window else { return }

        let target = self.targetFrame()
        let start = NSRect(
            x: target.origin.x,
            y: target.origin.y + 4, // Slide down from above
            width: target.width,
            height: target.height)

        window.setFrame(start, display: true)
        window.alphaValue = 0
        window.orderFrontRegardless()

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            window.animator().setFrame(target, display: true)
            window.animator().alphaValue = 1
        }
    }

    func hide() {
        guard let window else { return }

        let frame = window.frame
        let target = NSRect(
            x: frame.origin.x,
            y: frame.origin.y + 4,
            width: frame.width,
            height: frame.height)

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.15
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            window.animator().setFrame(target, display: true)
            window.animator().alphaValue = 0
        } completionHandler: {
            Task { @MainActor in
                window.orderOut(nil)
                self.state.isVisible = false
            }
        }
    }

    func updateLayout(animate: Bool = true) {
        guard let window else { return }
        let frame = self.targetFrame()
        if animate {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.3
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                window.animator().setFrame(frame, display: true)
            }
        } else {
            window.setFrame(frame, display: true)
        }
    }

    // MARK: - Window setup

    private func ensureWindow() {
        if self.window != nil { return }

        let frame = self.targetFrame()
        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false)

        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .statusBar + 1 // Above the menu bar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.ignoresMouseEvents = false

        let view = NotchView(
            state: self.state,
            onTap: { [weak self] in self?.handleTap() },
            onDismiss: { [weak self] in self?.handleDismiss() })
        let host = NSHostingView(rootView: view)
        host.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView = host
        self.hostingView = host
        self.window = panel

        self.logger.info("notch window created")
    }

    private func updateView() {
        let view = NotchView(
            state: self.state,
            onTap: { [weak self] in self?.handleTap() },
            onDismiss: { [weak self] in self?.handleDismiss() })
        self.hostingView?.rootView = view
    }

    // MARK: - Positioning

    /// Calculates the frame centered at the top of the visible area, just below the menu bar.
    private func targetFrame() -> NSRect {
        guard let screen = NSScreen.main else {
            return NSRect(x: 0, y: 0, width: 200, height: 32)
        }

        let visible = screen.visibleFrame
        let fullFrame = screen.frame

        // The notch pill width/height depends on current expansion
        let pillWidth: CGFloat = {
            switch self.state.expansion {
            case .collapsed: return 200
            case .compact: return 260
            case .expanded: return 360
            }
        }()

        let pillHeight: CGFloat = {
            switch self.state.expansion {
            case .collapsed: return 32
            case .compact: return 40
            case .expanded: return 280
            }
        }()

        // Center horizontally on the full screen (aligns with notch)
        let x = fullFrame.midX - (pillWidth / 2)
        // Anchor to the top of the visible frame (just below the menu bar)
        let y = visible.maxY - pillHeight - self.topInset

        return NSRect(x: x, y: y, width: pillWidth, height: pillHeight)
    }

    // MARK: - Event observation

    private func observeWorkActivity() {
        // Poll WorkActivityStore for changes and route to notch state.
        // In production, this would use Observation framework or NotificationCenter.
        Task { [weak self] in
            var lastIconState: IconState?
            while !Task.isCancelled {
                guard let self else { return }
                let store = WorkActivityStore.shared
                let iconState = store.iconState
                let activity = store.current

                if iconState != lastIconState {
                    lastIconState = iconState
                    switch iconState {
                    case .idle:
                        if self.state.phase != .idle {
                            self.state.finishActivity()
                        }
                    case .workingMain(let kind), .workingOther(let kind), .overridden(let kind):
                        let label = activity?.label ?? Self.activityLabel(kind)
                        self.state.beginThinking(tool: label)
                        if !self.state.isVisible {
                            self.show()
                        }
                        self.updateLayout()
                    }
                }

                try? await Task.sleep(nanoseconds: 250_000_000) // 250ms
            }
        }
    }

    private func observeControlChannel() {
        Task { [weak self] in
            var lastState: ControlChannel.ConnectionState?
            while !Task.isCancelled {
                guard let self else { return }
                let current = ControlChannel.shared.state
                if current != lastState {
                    lastState = current
                    self.state.setConnected(current)
                }
                try? await Task.sleep(nanoseconds: 500_000_000) // 500ms
            }
        }
    }

    // MARK: - Helpers

    private static func activityLabel(_ kind: ActivityKind) -> String {
        switch kind {
        case .job: "working"
        case .tool(let toolKind): toolKind.rawValue
        }
    }

    // MARK: - Interaction

    private func handleTap() {
        switch self.state.expansion {
        case .collapsed:
            self.state.expansion = .compact
            self.updateLayout()
        case .compact:
            self.state.expansion = .expanded
            self.updateLayout()
        case .expanded:
            self.handleDismiss()
        }
    }

    private func handleDismiss() {
        self.state.collapse()
        self.updateLayout()
    }
}
