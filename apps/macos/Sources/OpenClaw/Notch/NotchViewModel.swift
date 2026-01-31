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
            self.notchSize = ScreenMetrics.openNotchSize
            self.notchState = .open
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
