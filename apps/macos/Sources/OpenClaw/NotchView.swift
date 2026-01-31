import SwiftUI

// MARK: - Notch Content View

struct NotchContentView: View {
    @EnvironmentObject var vm: NotchViewModel

    @State private var hoverWorkItem: DispatchWorkItem?
    @State private var transcript: String = ""
    @State private var connectionStatus: NotchConnectionStatus = .disconnected
    @State private var isListening: Bool = false
    @State private var isSpeaking: Bool = false
    @State private var audioLevel: Float = 0.0

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
        .onReceive(NotificationCenter.default.publisher(for: .notchAgentUpdate)) { notification in
            self.handleAgentUpdate(notification)
        }
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
                NotchHomeView(
                    transcript: self.transcript,
                    connectionStatus: self.connectionStatus,
                    isListening: self.isListening,
                    isSpeaking: self.isSpeaking,
                    audioLevel: self.audioLevel)
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

    // MARK: - Agent Events

    private func handleAgentUpdate(_ notification: Notification) {
        guard let info = notification.userInfo else { return }

        if let status = info["connectionStatus"] as? String {
            switch status {
            case "connected": self.connectionStatus = .connected
            case "connecting": self.connectionStatus = .connecting
            default: self.connectionStatus = .disconnected
            }
        }

        if let text = info["transcript"] as? String {
            self.transcript = text
        }

        if let speaking = info["isSpeaking"] as? Bool {
            self.isSpeaking = speaking
        }

        if let listening = info["isListening"] as? Bool {
            self.isListening = listening
        }

        if let level = info["audioLevel"] as? Float {
            self.audioLevel = level
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

    let transcript: String
    let connectionStatus: NotchConnectionStatus
    let isListening: Bool
    let isSpeaking: Bool
    let audioLevel: Float

    var body: some View {
        VStack(spacing: 0) {
            // Top section: status + wave + controls
            HStack(spacing: 12) {
                // Connection status
                HStack(spacing: 8) {
                    let statusColor = self.connectionStatusColor
                    ZStack {
                        Circle().fill(statusColor).frame(width: 12, height: 12)
                            .blur(radius: 3).opacity(0.18)
                        Circle().fill(statusColor).frame(width: 12, height: 12)
                            .blur(radius: 1).opacity(0.15)
                        Circle().fill(statusColor).frame(width: 12, height: 12)
                    }

                    Text(self.connectionStatusText)
                        .font(.system(size: 16, weight: .regular))
                        .foregroundColor(.white.opacity(0.9))
                }

                Spacer()

                // Wave visualization
                SmoothWaveView(
                    isAnimating: self.shouldAnimate,
                    state: self.smoothWaveState,
                    audioLevel: self.audioLevel)
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

                // Mic button
                Button(action: {}) {
                    Image(systemName: self.isListening ? "mic.fill" : "mic.slash.fill")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(PlainButtonStyle())
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

            // Transcript
            ScrollView {
                if !self.transcript.isEmpty {
                    HStack(alignment: .top, spacing: 14) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color(red: 0.4, green: 0.6, blue: 1.0), lineWidth: 1)
                                .frame(width: 36, height: 36)
                                .blur(radius: 3).opacity(0.6)
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color(red: 0.4, green: 0.6, blue: 1.0).opacity(0.5), lineWidth: 1)
                                .frame(width: 36, height: 36)
                            Image(systemName: "sparkles")
                                .font(.system(size: 18, weight: .medium))
                                .foregroundColor(Color(red: 0.4, green: 0.6, blue: 1.0))
                        }

                        TypewriterText(fullText: self.transcript, isTyping: self.isSpeaking)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 20)
                }
            }
            .frame(maxHeight: .infinity)
            .background(Color.black.opacity(0.95))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .transition(.opacity)
    }

    // MARK: - Computed

    private var shouldAnimate: Bool {
        self.connectionStatus != .disconnected
    }

    private var smoothWaveState: SmoothWaveView.VisualizationState {
        switch self.connectionStatus {
        case .disconnected: .idle
        case .connecting: .connecting
        case .connected:
            if self.isSpeaking { .speaking }
            else if self.isListening { .listening }
            else { .idle }
        }
    }

    private var connectionStatusColor: Color {
        switch self.connectionStatus {
        case .connected: .green
        case .connecting: .gray
        case .disconnected: .red
        }
    }

    private var connectionStatusText: String {
        switch self.connectionStatus {
        case .connected: "Connected"
        case .connecting: "Connecting"
        case .disconnected: "Disconnected"
        }
    }
}

// MARK: - Notification

extension Notification.Name {
    static let notchAgentUpdate = Notification.Name("openclaw.notch.agentUpdate")
}
