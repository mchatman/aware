import SwiftUI

// MARK: - Content Height Preference Key

struct NotchContentHeightKey: PreferenceKey {
    nonisolated(unsafe) static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

// MARK: - Notch Content View

struct NotchContentView: View {
    @EnvironmentObject var vm: NotchViewModel

    @State private var hoverWorkItem: DispatchWorkItem?

    var body: some View {
        ZStack(alignment: .top) {
            let mainLayout = NotchLayout()
                .frame(alignment: .top)
                .padding(.horizontal, self.vm.notchState == .open ? 20 : 0)
                .padding([.horizontal, .bottom], self.vm.notchState == .open ? 12 : 0)
                .background(.black)
                .mask {
                    self.vm.notchState == .open
                        ? NotchShape(topCornerRadius: 19, bottomCornerRadius: 24)
                            .drawingGroup()
                        : NotchShape(topCornerRadius: 6, bottomCornerRadius: 14)
                            .drawingGroup()
                }

            mainLayout
                .animation(.spring.speed(1.2), value: self.vm.notchState)
                .onHover { hovering in
                    self.handleHover(hovering)
                }
        }
        .padding(.bottom, 8)
        .frame(
            maxWidth: ScreenMetrics.openNotchSize.width,
            maxHeight: self.vm.notchState == .open
                ? self.vm.notchSize.height
                : ScreenMetrics.openNotchSize.height,
            alignment: .top)
        .shadow(
            color: self.vm.notchState == .open ? .black.opacity(0.2) : .clear,
            radius: 6)
        .environmentObject(self.vm)
    }

    @ViewBuilder
    func NotchLayout() -> some View {
        VStack(alignment: .leading) {
            VStack(alignment: .leading) {
                if self.vm.notchState == .open {
                    NotchHeaderView()
                        .frame(height: max(24, self.vm.effectiveClosedNotchHeight))
                        .animation(
                            .spring(response: 1, dampingFraction: 1, blendDuration: 0.8),
                            value: self.vm.notchState)
                } else {
                    Rectangle().fill(.clear)
                        .frame(
                            width: self.vm.closedNotchSize.width - 20,
                            height: self.vm.effectiveClosedNotchHeight)
                }
            }
            .zIndex(2)

            if self.vm.notchState == .open {
                NotchHomeView()
                    .zIndex(1)
            }
        }
    }

    // MARK: - Hover

    private func handleHover(_ hovering: Bool) {
        self.hoverWorkItem?.cancel()
        self.hoverWorkItem = nil

        if hovering {
            let task = DispatchWorkItem {
                guard self.vm.notchState == .closed else { return }
                self.vm.open()
            }
            self.hoverWorkItem = task
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: task)
        } else {
            if self.vm.notchState == .open {
                self.vm.close()
            }
        }
    }
}

// MARK: - Notch Header

struct NotchHeaderView: View {
    @EnvironmentObject var vm: NotchViewModel

    var body: some View {
        HStack(spacing: 0) {
            HStack {}
                .frame(maxWidth: .infinity, alignment: .leading)
                .opacity(self.vm.notchState == .closed ? 0 : 1)
                .blur(radius: self.vm.notchState == .closed ? 20 : 0)
                .animation(.smooth.delay(0.1), value: self.vm.notchState)
                .zIndex(2)

            if self.vm.notchState == .open {
                Rectangle()
                    .fill(.black)
                    .frame(width: self.vm.closedNotchSize.width)
                    .mask { NotchShape() }
            }

            HStack {}
                .font(.system(.headline, design: .rounded))
                .frame(maxWidth: .infinity, alignment: .trailing)
                .opacity(self.vm.notchState == .closed ? 0 : 1)
                .blur(radius: self.vm.notchState == .closed ? 20 : 0)
                .animation(.smooth.delay(0.1), value: self.vm.notchState)
                .zIndex(2)
        }
        .foregroundColor(.gray)
    }
}

// MARK: - Notch Home View

struct NotchHomeView: View {
    @EnvironmentObject var vm: NotchViewModel

    // Color palette
    private let bgColor = Color.black
    private let tealAccent = Color(red: 0.0, green: 0.75, blue: 0.65)
    private let blueAccent = Color(red: 0.4, green: 0.6, blue: 1.0)

    var body: some View {
        let connStatus = self.vm.parsedConnectionStatus

        VStack(spacing: 0) {
            // 1. Header bar
            self.headerBar(connStatus)

            // 2. Gradient progress bar
            GradientProgressBar()
                .padding(.horizontal, 16)
                .padding(.vertical, 6)

            // 3. AI message / agent state
            self.aiMessageSection
                .padding(.top, 12)
                .padding(.bottom, 12)

            // 4. Bottom status bar
            self.bottomStatusBar(connStatus)
        }
        .fixedSize(horizontal: false, vertical: true)
        .background(self.bgColor)
        .overlay(
            GeometryReader { geo in
                Color.clear.preference(key: NotchContentHeightKey.self, value: geo.size.height)
            })
        .onPreferenceChange(NotchContentHeightKey.self) { height in
            DispatchQueue.main.async {
                self.vm.updateContentHeight(height)
            }
        }
        .transition(.opacity)
    }

    // MARK: - Header Bar

    private func headerBar(_ connStatus: NotchConnectionStatus) -> some View {
        HStack(spacing: 10) {
            // Left: icon + label
            HStack(spacing: 7) {
                ZStack {
                    Circle()
                        .fill(self.connectionStatusColor(connStatus).opacity(0.15))
                        .frame(width: 28, height: 28)
                    Image(systemName: "cpu")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(self.connectionStatusColor(connStatus))
                }

                Text("AI Assistant")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white.opacity(0.9))
            }

            Spacer()

            // Right: phase icon + settings
            HStack(spacing: 14) {
                self.phaseIcon
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.white.opacity(0.7))
                    .frame(width: 24, height: 24)

                Image(systemName: "gearshape.fill")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.white.opacity(0.7))
                    .frame(width: 24, height: 24)
            }
        }
        .padding(.horizontal, 18)
        .frame(height: 48)
    }

    // MARK: - AI Message Section

    private var aiMessageSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                // Sparkles icon with border
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(self.blueAccent, lineWidth: 1)
                        .frame(width: 32, height: 32)
                        .blur(radius: 3)
                        .opacity(0.5)

                    RoundedRectangle(cornerRadius: 8)
                        .stroke(self.blueAccent.opacity(0.5), lineWidth: 1)
                        .frame(width: 32, height: 32)

                    Image(systemName: "sparkles")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(self.blueAccent)
                }

                // Message content based on agent phase
                VStack(alignment: .leading, spacing: 6) {
                    if !self.vm.transcript.isEmpty {
                        TypewriterText(
                            fullText: self.vm.transcript,
                            isTyping: self.vm.agentPhase == .responding)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else if self.vm.agentPhase == .thinking {
                        HStack(spacing: 8) {
                            ProgressView()
                                .controlSize(.small)
                                .scaleEffect(0.8)
                            Text("Thinking…")
                                .font(.system(size: 14))
                                .foregroundColor(.white.opacity(0.6))
                        }
                    } else if case let .toolUse(label) = self.vm.agentPhase {
                        HStack(spacing: 8) {
                            Image(systemName: "gearshape.fill")
                                .font(.system(size: 14))
                                .foregroundColor(.orange.opacity(0.8))
                                .rotationEffect(.degrees(self.vm.agentPhase != .idle ? 360 : 0))
                                .animation(
                                    .linear(duration: 2).repeatForever(autoreverses: false),
                                    value: self.vm.agentPhase)
                            Text(label)
                                .font(.system(size: 13))
                                .foregroundColor(.white.opacity(0.7))
                                .lineLimit(1)
                        }
                    } else {
                        Text("Awaiting input…")
                            .font(.system(size: 14))
                            .foregroundColor(.white.opacity(0.35))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }

        }
        .padding(.horizontal, 18)
    }

    // MARK: - Contextual Previews Section

    private var contextualPreviewsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Section header
            HStack(spacing: 6) {
                Circle()
                    .fill(self.tealAccent)
                    .frame(width: 6, height: 6)

                Text("CONTEXTUAL PREVIEWS")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.2)
                    .foregroundColor(.white.opacity(0.5))

                Spacer()

                Text("VIEW ALL")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.5)
                    .foregroundColor(self.tealAccent)
            }
            .padding(.horizontal, 18)

            // Preview card
            ContextualPreviewCard()
                .padding(.horizontal, 14)
        }
        .padding(.vertical, 4)
    }

    // MARK: - Bottom Status Bar

    private func bottomStatusBar(_ connStatus: NotchConnectionStatus) -> some View {
        HStack {
            HStack(spacing: 6) {
                Circle()
                    .fill(self.connectionStatusColor(connStatus))
                    .frame(width: 6, height: 6)

                Text(connStatus == .connected ? "Connected" : "Disconnected")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.white.opacity(0.3))
            }

            Spacer()
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 10)
    }

    // MARK: - Computed

    @ViewBuilder
    private var phaseIcon: some View {
        switch self.vm.agentPhase {
        case .idle:
            Image(systemName: "mic.fill")
        case .thinking:
            Image(systemName: "brain")
        case .toolUse:
            Image(systemName: "gearshape.fill")
        case .responding:
            Image(systemName: "text.bubble.fill")
        }
    }

    private func connectionStatusColor(_ status: NotchConnectionStatus) -> Color {
        switch status {
        case .connected: .green
        case .connecting: .gray
        case .disconnected: .red
        }
    }
}
