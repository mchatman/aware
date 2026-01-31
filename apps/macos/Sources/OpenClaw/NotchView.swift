import SwiftUI

/// The main notch widget view — morphs between a subtle pill and an expanded response panel.
struct NotchView: View {
    @Bindable var state: NotchState
    var onTap: () -> Void = {}
    var onDismiss: () -> Void = {}

    // MARK: - Layout constants

    private var pillWidth: CGFloat {
        switch self.state.expansion {
        case .collapsed: 200
        case .compact: 260
        case .expanded: 360
        }
    }

    private var pillHeight: CGFloat {
        switch self.state.expansion {
        case .collapsed: 32
        case .compact: 40
        case .expanded: min(self.expandedHeight, 280)
        }
    }

    private var expandedHeight: CGFloat {
        let textLines = max(1, self.state.responseText.components(separatedBy: "\n").count)
        let estimatedHeight = CGFloat(textLines) * 18 + 60
        return max(100, estimatedHeight)
    }

    private var cornerRadius: CGFloat {
        switch self.state.expansion {
        case .collapsed: 16
        case .compact: 18
        case .expanded: 22
        }
    }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            self.content
        }
        .frame(width: self.pillWidth, height: self.pillHeight)
        .background(self.background)
        .clipShape(RoundedRectangle(cornerRadius: self.cornerRadius, style: .continuous))
        .overlay(self.border)
        .shadow(color: self.shadowColor, radius: self.shadowRadius, x: 0, y: 2)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: self.state.expansion)
        .animation(.easeInOut(duration: 0.2), value: self.state.phase)
        .onHover { hovering in
            self.state.isHovered = hovering
        }
        .onTapGesture {
            self.onTap()
        }
    }

    // MARK: - Content by state

    @ViewBuilder
    private var content: some View {
        switch self.state.expansion {
        case .collapsed:
            self.collapsedContent
        case .compact:
            self.compactContent
        case .expanded:
            self.expandedContent
        }
    }

    // MARK: - Collapsed: subtle pill

    private var collapsedContent: some View {
        HStack(spacing: 6) {
            self.statusDot
            Text(self.statusLabel)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
    }

    // MARK: - Compact: status + indicator

    private var compactContent: some View {
        HStack(spacing: 8) {
            self.statusDot
            Text(self.statusLabel)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(.primary)
                .lineLimit(1)
            Spacer()
            if case .listening = self.state.phase {
                self.waveformIndicator
            }
            if case .thinking = self.state.phase {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.7)
            }
        }
        .padding(.horizontal, 14)
    }

    // MARK: - Expanded: full response

    private var expandedContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack(spacing: 8) {
                self.statusDot
                Text(self.statusLabel)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.primary)
                Spacer()
                Button(action: self.onDismiss) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)

            // Response text
            if !self.state.responseText.isEmpty {
                ScrollView(.vertical, showsIndicators: false) {
                    Text(self.state.responseText)
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 10)
            }

            Spacer(minLength: 0)
        }
    }

    // MARK: - Shared components

    private var statusDot: some View {
        Circle()
            .fill(self.state.accentColor)
            .frame(width: 8, height: 8)
            .opacity(self.dotPulseOpacity)
    }

    private var statusLabel: String {
        switch self.state.phase {
        case .idle: "Kit"
        case .listening: "Listening..."
        case let .thinking(tool):
            if let tool { "Working · \(tool)" } else { "Thinking..." }
        case .speaking: "Speaking..."
        case .responding: "Kit"
        }
    }

    private var waveformIndicator: some View {
        HStack(spacing: 2) {
            ForEach(0..<5, id: \.self) { i in
                WaveformBar(index: i)
            }
        }
        .frame(width: 24, height: 16)
    }

    // MARK: - Styling

    private var background: some View {
        RoundedRectangle(cornerRadius: self.cornerRadius, style: .continuous)
            .fill(.regularMaterial)
    }

    private var border: some View {
        RoundedRectangle(cornerRadius: self.cornerRadius, style: .continuous)
            .strokeBorder(Color.white.opacity(0.15), lineWidth: 1)
    }

    private var shadowColor: Color {
        switch self.state.phase {
        case .idle: .clear
        case .listening: .green.opacity(0.2)
        case .thinking: .orange.opacity(0.15)
        case .speaking: .blue.opacity(0.15)
        case .responding: .black.opacity(0.2)
        }
    }

    private var shadowRadius: CGFloat {
        switch self.state.expansion {
        case .collapsed: 0
        case .compact: 4
        case .expanded: 8
        }
    }

    @State private var dotPulseOpacity: Double = 1.0
}

// MARK: - Waveform bar animation

private struct WaveformBar: View {
    let index: Int
    @State private var height: CGFloat = 4

    var body: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(Color.green)
            .frame(width: 2, height: self.height)
            .onAppear {
                withAnimation(
                    .easeInOut(duration: Double.random(in: 0.3...0.6))
                        .repeatForever(autoreverses: true)
                        .delay(Double(self.index) * 0.1)
                ) {
                    self.height = CGFloat.random(in: 4...14)
                }
            }
    }
}
