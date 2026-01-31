import SwiftUI

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
            maxHeight: ScreenMetrics.openNotchSize.height,
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

    var body: some View {
        let connStatus = self.vm.parsedConnectionStatus

        VStack(spacing: 0) {
            // Top section: status + wave + controls
            HStack(spacing: 12) {
                // Connection status + agent phase
                HStack(spacing: 8) {
                    let statusColor = self.connectionStatusColor(connStatus)
                    ZStack {
                        Circle().fill(statusColor).frame(width: 12, height: 12)
                            .blur(radius: 3).opacity(0.18)
                        Circle().fill(statusColor).frame(width: 12, height: 12)
                            .blur(radius: 1).opacity(0.15)
                        Circle().fill(statusColor).frame(width: 12, height: 12)
                    }

                    Text(self.statusText(connStatus))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white.opacity(0.9))
                        .lineLimit(1)
                }

                Spacer()

                // Wave visualization
                SmoothWaveView(
                    isAnimating: connStatus != .disconnected,
                    state: self.smoothWaveState(connStatus),
                    audioLevel: 0)
                    .frame(height: 30)
                    .mask(
                        LinearGradient(
                            gradient: Gradient(stops: [
                                .init(color: .clear, location: 0),
                                .init(color: .black, location: 0.1),
                                .init(color: .black, location: 0.9),
                                .init(color: .clear, location: 1),
                            ]),
                            startPoint: .leading,
                            endPoint: .trailing))

                Spacer()

                // Phase icon
                self.phaseIcon
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.white.opacity(0.8))
                    .frame(width: 24, height: 24)
            }
            .padding(.horizontal, 20)
            .frame(height: 60)
            .background(Color.black)

            // Divider
            ZStack {
                Rectangle().fill(Color.white.opacity(0.18))
                    .frame(maxWidth: .infinity).frame(height: 2.5).blur(radius: 3)
                Rectangle().fill(Color.white.opacity(0.15))
                    .frame(maxWidth: .infinity).frame(height: 1).blur(radius: 1)
                Rectangle().fill(Color.white.opacity(0.12))
                    .frame(maxWidth: .infinity).frame(height: 0.5)
            }
            .frame(maxWidth: .infinity)

            // Transcript area
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if !self.vm.transcript.isEmpty {
                            HStack(alignment: .top, spacing: 14) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(self.accentColor, lineWidth: 1)
                                        .frame(width: 36, height: 36)
                                        .blur(radius: 3).opacity(0.6)
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(self.accentColor.opacity(0.5), lineWidth: 1)
                                        .frame(width: 36, height: 36)
                                    Image(systemName: "sparkles")
                                        .font(.system(size: 18, weight: .medium))
                                        .foregroundColor(self.accentColor)
                                }

                                TypewriterText(
                                    fullText: self.vm.transcript,
                                    isTyping: self.vm.agentPhase == .responding)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 20)
                        } else if self.vm.agentPhase == .thinking {
                            HStack(spacing: 8) {
                                ProgressView()
                                    .controlSize(.small)
                                    .scaleEffect(0.8)
                                Text("Thinking…")
                                    .font(.system(size: 14))
                                    .foregroundColor(.white.opacity(0.6))
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 20)
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
                            .padding(.horizontal, 20)
                            .padding(.vertical, 20)
                        }

                        // Scroll anchor
                        Color.clear.frame(height: 1).id("bottom")
                    }
                }
                .onChange(of: self.vm.transcript) { _, _ in
                    withAnimation(.easeOut(duration: 0.15)) {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
            }
            .frame(maxHeight: .infinity)
            .background(Color.black.opacity(0.95))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .transition(.opacity)
    }

    // MARK: - Computed

    private var accentColor: Color {
        Color(red: 0.4, green: 0.6, blue: 1.0)
    }

    @ViewBuilder
    private var phaseIcon: some View {
        switch self.vm.agentPhase {
        case .idle:
            Image(systemName: "moon.zzz.fill")
        case .thinking:
            Image(systemName: "brain")
        case .toolUse:
            Image(systemName: "gearshape.fill")
        case .responding:
            Image(systemName: "text.bubble.fill")
        }
    }

    private func smoothWaveState(_ connStatus: NotchConnectionStatus) -> SmoothWaveView.VisualizationState {
        switch connStatus {
        case .disconnected: .idle
        case .connecting: .connecting
        case .connected:
            switch self.vm.agentPhase {
            case .responding: .speaking
            case .thinking, .toolUse: .listening
            case .idle: .idle
            }
        }
    }

    private func connectionStatusColor(_ status: NotchConnectionStatus) -> Color {
        switch status {
        case .connected: .green
        case .connecting: .gray
        case .disconnected: .red
        }
    }

    private func statusText(_ connStatus: NotchConnectionStatus) -> String {
        switch connStatus {
        case .disconnected: "Disconnected"
        case .connecting: "Connecting"
        case .connected:
            switch self.vm.agentPhase {
            case .idle: "Connected"
            case .thinking: "Thinking…"
            case let .toolUse(label): label
            case .responding: "Responding…"
            }
        }
    }
}
