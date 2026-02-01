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

    func open() {
        withAnimation(.bouncy) {
            self.notchSize = self.dynamicOpenSize
            self.notchState = .open
        }
    }

    func recalculateSize() {
        guard self.notchState == .open else { return }

        let target = self.dynamicOpenSize
        if abs(target.height - self.notchSize.height) > 2 {
            withAnimation(.smooth(duration: 0.3)) {
                self.notchSize = target
            }
        }
    }

    /// Compute open size from data model (no layout measurement).
    private var dynamicOpenSize: CGSize {
        // Base: header(48) + progress bar(15) + status bar(30) + padding(37) + notch header offset
        var height: CGFloat = 130 + self.effectiveClosedNotchHeight

        if !self.transcript.isEmpty {
            // Estimate text height: ~18px per line, ~50 chars per line at font size 14
            let lineCount = max(1, ceil(CGFloat(self.transcript.count) / 50))
            height += min(lineCount * 18, 300) + 44
        } else {
            height += 50
        }

        if self.showContextualPreviews {
            height += 280
        }

        let clamped = max(ScreenMetrics.minOpenHeight, min(height, ScreenMetrics.openNotchSize.height))
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
