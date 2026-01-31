import Foundation
import SwiftUI

// MARK: - Notch State

enum NotchState {
    case closed
    case open
}

// MARK: - Connection Status (for notch UI)

enum NotchConnectionStatus {
    case disconnected
    case connecting
    case connected
}
