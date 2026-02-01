import Combine
import SwiftUI

// MARK: - Notch View Model

class NotchViewModel: ObservableObject {
    let animation: Animation? = .bouncy
    @Published private(set) var notchState: NotchState = .closed
    @Published var screen: String?
    @Published var notchSize: CGSize = ScreenMetrics.closedNotchSize()
    @Published var closedNotchSize: CGSize = ScreenMetrics.closedNotchSize()

    // MARK: - Agent State (set by NotchController)

    /// Gateway connection status string: "connected", "connecting", "disconnected".
    @Published var connectionStatus: String = "disconnected"
    /// Current agent phase for display.
    @Published var agentPhase: NotchAgentPhase = .idle
    /// Accumulated assistant response text.
    @Published var transcript: String = ""
    /// Whether contextual previews are visible.
    @Published var showContextualPreviews: Bool = false

    var effectiveClosedNotchHeight: CGFloat {
        self.closedNotchSize.height
    }

    var parsedConnectionStatus: NotchConnectionStatus {
        switch self.connectionStatus {
        case "connected": .connected
        case "connecting": .connecting
        default: .disconnected
        }
    }

    init(screen: String? = nil) {
        self.screen = screen
        self.notchSize = ScreenMetrics.closedNotchSize(screenName: screen)
        self.closedNotchSize = self.notchSize
    }

    /// Last measured text area height from the view.
    private var measuredTextAreaHeight: CGFloat = 0

    func open() {
        withAnimation(.bouncy) {
            self.notchSize = CGSize(
                width: ScreenMetrics.openNotchSize.width,
                height: ScreenMetrics.minOpenHeight)
            self.notchState = .open
        }
    }

    /// Called from the view when the rendered text area height changes.
    func updateTextAreaHeight(_ height: CGFloat) {
        self.measuredTextAreaHeight = height
        guard self.notchState == .open else { return }

        // Chrome: header(48) + progress+padding(15) + status(30) + padding(~30) + notch header
        let chrome: CGFloat = 123 + self.effectiveClosedNotchHeight
        var needed = chrome + height

        if self.showContextualPreviews {
            needed += 280
        }

        let target = max(ScreenMetrics.minOpenHeight, min(needed, ScreenMetrics.openNotchSize.height))

        if abs(target - self.notchSize.height) > 2 {
            withAnimation(.smooth(duration: 0.3)) {
                self.notchSize = CGSize(width: ScreenMetrics.openNotchSize.width, height: target)
            }
        }
    }

    func close() {
        withAnimation(.smooth) {
            self.notchSize = ScreenMetrics.closedNotchSize(screenName: self.screen)
            self.closedNotchSize = self.notchSize
            self.notchState = .closed
        }
    }
}
