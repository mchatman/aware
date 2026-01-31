import Foundation
import Observation
import SwiftUI

/// Observable state model for the notch widget.
@MainActor
@Observable
final class NotchState {
    static let shared = NotchState()

    enum Phase: Equatable {
        case idle
        case listening
        case thinking(toolLabel: String?)
        case speaking
        case responding(text: String)
    }

    enum ExpansionLevel: Equatable {
        case collapsed   // Subtle pill hugging the notch
        case compact     // Slightly expanded (status indicator)
        case expanded    // Full response / interaction area
    }

    // MARK: - Published state

    private(set) var phase: Phase = .idle
    var expansion: ExpansionLevel = .collapsed
    private(set) var connectionState: ControlChannel.ConnectionState = .disconnected
    private(set) var responseText: String = ""
    private(set) var toolLabel: String?

    var isVisible: Bool = false
    var isHovered: Bool = false

    // MARK: - Derived

    var shouldShow: Bool {
        // Show when connected and either actively doing something or hovered
        switch self.phase {
        case .idle:
            return self.isHovered || self.expansion != .collapsed
        default:
            return true
        }
    }

    var accentColor: Color {
        switch self.phase {
        case .idle: .secondary
        case .listening: .green
        case .thinking: .orange
        case .speaking: .blue
        case .responding: .primary
        }
    }

    var pillOpacity: Double {
        switch self.phase {
        case .idle: self.isHovered ? 0.9 : 0.6
        default: 1.0
        }
    }

    // MARK: - Auto-collapse timer

    private var collapseTask: Task<Void, Never>?

    // MARK: - State transitions

    func setConnected(_ state: ControlChannel.ConnectionState) {
        self.connectionState = state
    }

    func beginListening() {
        self.cancelCollapse()
        self.phase = .listening
        self.expansion = .compact
        self.isVisible = true
    }

    func beginThinking(tool: String? = nil) {
        self.cancelCollapse()
        self.phase = .thinking(toolLabel: tool)
        self.toolLabel = tool
        self.expansion = .compact
        self.isVisible = true
    }

    func updateTool(_ label: String) {
        self.toolLabel = label
        if case .thinking = self.phase {
            self.phase = .thinking(toolLabel: label)
        }
    }

    func beginResponding(text: String) {
        self.cancelCollapse()
        self.responseText = text
        self.phase = .responding(text: text)
        self.expansion = .expanded
        self.isVisible = true
    }

    func appendResponse(_ text: String) {
        self.responseText = text
        self.phase = .responding(text: text)
    }

    func beginSpeaking() {
        self.phase = .speaking
        self.expansion = .compact
    }

    func finishActivity() {
        // Keep response visible briefly, then auto-collapse
        self.scheduleCollapse(after: 4.0)
    }

    func collapse() {
        self.cancelCollapse()
        self.phase = .idle
        self.expansion = .collapsed
        self.responseText = ""
        self.toolLabel = nil
    }

    func setIdle() {
        self.phase = .idle
        self.expansion = .collapsed
        self.responseText = ""
        self.toolLabel = nil
    }

    // MARK: - Private

    private func scheduleCollapse(after seconds: TimeInterval) {
        self.cancelCollapse()
        self.collapseTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.collapse()
            }
        }
    }

    private func cancelCollapse() {
        self.collapseTask?.cancel()
        self.collapseTask = nil
    }
}
