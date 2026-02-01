import Cocoa
import SwiftUI

// MARK: - Screen Metrics

struct ScreenMetrics {
    static let openNotchSize: CGSize = .init(width: 640, height: 560)

    static func closedNotchSize(screenName: String? = nil) -> CGSize {
        var notchHeight: CGFloat = 32
        var notchWidth: CGFloat = 185

        var selectedScreen = NSScreen.main

        if let customScreen = screenName {
            selectedScreen = NSScreen.screens.first(where: { $0.localizedName == customScreen })
        }

        if let screen = selectedScreen {
            if let topLeftNotchpadding: CGFloat = screen.auxiliaryTopLeftArea?.width,
               let topRightNotchpadding: CGFloat = screen.auxiliaryTopRightArea?.width
            {
                notchWidth = screen.frame.width - topLeftNotchpadding - topRightNotchpadding + 4
            }

            if screen.safeAreaInsets.top > 0 {
                notchHeight = screen.safeAreaInsets.top
            } else {
                notchHeight = screen.frame.maxY - screen.visibleFrame.maxY
            }
        }

        return .init(width: notchWidth, height: notchHeight)
    }
}
