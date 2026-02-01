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
    /// Reported content height from NotchHomeView.
    @Published var contentHeight: CGFloat = 0

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

    func open() {
        withAnimation(.bouncy) {
            self.notchSize = self.dynamicOpenSize
            self.notchState = .open
        }
    }

    func updateContentHeight(_ height: CGFloat) {
        self.contentHeight = height
        guard self.notchState == .open else { return }

        let target = self.dynamicOpenSize
        if abs(target.height - self.notchSize.height) > 2 {
            withAnimation(.smooth(duration: 0.3)) {
                self.notchSize = target
            }
        }
    }

    /// Compute open size from reported content height + notch header overhead.
    private var dynamicOpenSize: CGSize {
        let headerOffset = self.effectiveClosedNotchHeight + 44
        let total = self.contentHeight + headerOffset
        let clamped = max(ScreenMetrics.minOpenHeight, min(total, ScreenMetrics.openNotchSize.height))
        return CGSize(width: ScreenMetrics.openNotchSize.width, height: clamped)
    }

    func close() {
        withAnimation(.smooth) {
            self.notchSize = ScreenMetrics.closedNotchSize(screenName: self.screen)
            self.closedNotchSize = self.notchSize
            self.notchState = .closed
        }
    }
}
