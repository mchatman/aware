import Foundation
import SwiftUI

// MARK: - Notch State

enum NotchState {
    case closed
    case open
}

// MARK: - Connection Status (for notch UI)

enum NotchConnectionStatus: Equatable {
    case disconnected
    case connecting
    case connected
}

// MARK: - Agent Phase (for notch display)

enum NotchAgentPhase: Equatable {
    /// No active work.
    case idle
    /// Agent run started, waiting for first output.
    case thinking
    /// Agent is calling a tool.
    case toolUse(String)
    /// Agent is streaming response text.
    case responding
}
