import AppKit
import AVFoundation
import Foundation
import Observation
import SwiftUI

/// Menu contents for the Aware menu bar extra.
struct MenuContent: View {
    @Bindable var state: AppState
    let updater: UpdaterProviding?
    @Bindable private var updateStatus: UpdateStatus
    private let gatewayManager = GatewayProcessManager.shared
    private let healthStore = HealthStore.shared
    private let controlChannel = ControlChannel.shared
    private let activityStore = WorkActivityStore.shared
    @Environment(\.openSettings) private var openSettings
    @State private var availableMics: [AudioInputDevice] = []
    @State private var loadingMics = false
    @State private var micObserver = AudioInputDeviceObserver()
    @State private var micRefreshTask: Task<Void, Never>?

    init(state: AppState, updater: UpdaterProviding?) {
        self._state = Bindable(wrappedValue: state)
        self.updater = updater
        self._updateStatus = Bindable(wrappedValue: updater?.updateStatus ?? UpdateStatus.disabled)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: self.activeBinding) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(self.connectionLabel)
                    self.statusLine(label: self.healthStatus.label, color: self.healthStatus.color)
                }
            }
            .disabled(self.state.connectionMode == .unconfigured)

            Divider()
            Toggle(isOn: self.voiceWakeBinding) {
                Label("Voice Wake", systemImage: "mic.fill")
            }
            .disabled(!voiceWakeSupported)
            .opacity(voiceWakeSupported ? 1 : 0.5)
            if self.showVoiceWakeMicPicker {
                self.voiceWakeMicMenu
            }
            Divider()
            Button {
                Task { @MainActor in
                    let sessionKey = await WebChatManager.shared.preferredSessionKey()
                    WebChatManager.shared.show(sessionKey: sessionKey)
                }
            } label: {
                Label("Open Chat", systemImage: "bubble.left.and.bubble.right")
            }
            Button {
                Task { await self.state.setTalkEnabled(!self.state.talkEnabled) }
            } label: {
                Label(self.state.talkEnabled ? "Stop Talk Mode" : "Talk Mode", systemImage: "waveform.circle.fill")
            }
            .disabled(!voiceWakeSupported)
            .opacity(voiceWakeSupported ? 1 : 0.5)
            Divider()
            Button("Settings…") { self.open(tab: .general) }
                .keyboardShortcut(",", modifiers: [.command])
            Button("About Aware") { self.open(tab: .about) }
            if let updater, updater.isAvailable, self.updateStatus.isUpdateReady {
                Button("Update ready, restart now?") { updater.checkForUpdates(nil) }
            }
            Button("Quit") { NSApplication.shared.terminate(nil) }
        }
        .task(id: self.state.swabbleEnabled) {
            if self.state.swabbleEnabled {
                await self.loadMicrophones(force: true)
            }
        }
        .task {
            VoicePushToTalkHotkey.shared.setEnabled(voiceWakeSupported && self.state.voicePushToTalkEnabled)
        }
        .onChange(of: self.state.voicePushToTalkEnabled) { _, enabled in
            VoicePushToTalkHotkey.shared.setEnabled(voiceWakeSupported && enabled)
        }
        .onAppear {
            self.startMicObserver()
        }
        .onDisappear {
            self.micRefreshTask?.cancel()
            self.micRefreshTask = nil
            self.micObserver.stop()
        }
        .task { @MainActor in
            SettingsWindowOpener.shared.register(openSettings: self.openSettings)
        }
    }

    private var connectionLabel: String {
        switch self.state.connectionMode {
        case .unconfigured:
            "Aware Not Configured"
        case .remote:
            "Remote Aware Active"
        case .local:
            "Aware Active"
        }
    }

    private var healthStatus: (label: String, color: Color) {
        if let activity = self.activityStore.current {
            let color: Color = activity.role == .main ? .accentColor : .gray
            let roleLabel = activity.role == .main ? "Main" : "Other"
            let text = "\(roleLabel) · \(activity.label)"
            return (text, color)
        }

        let health = self.healthStore.state
        switch health {
        case .ok:
            return ("Connected", .green)
        case .linkingNeeded:
            return ("Login required", .red)
        case .degraded:
            return ("Disconnected", .orange)
        case .unknown:
            return ("Connecting…", .secondary)
        }
    }

    @ViewBuilder
    private func statusLine(label: String, color: Color) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.leading)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .layoutPriority(1)
        }
        .padding(.top, 2)
    }

    private var activeBinding: Binding<Bool> {
        Binding(get: { !self.state.isPaused }, set: { self.state.isPaused = !$0 })
    }

    private var voiceWakeBinding: Binding<Bool> {
        Binding(
            get: { self.state.swabbleEnabled },
            set: { newValue in
                Task { await self.state.setVoiceWakeEnabled(newValue) }
            })
    }

    private var showVoiceWakeMicPicker: Bool {
        voiceWakeSupported && self.state.swabbleEnabled
    }

    private var voiceWakeMicMenu: some View {
        Menu {
            self.microphoneMenuItems

            if self.loadingMics {
                Divider()
                Label("Refreshing microphones…", systemImage: "arrow.triangle.2.circlepath")
                    .labelStyle(.titleOnly)
                    .foregroundStyle(.secondary)
                    .disabled(true)
            }
        } label: {
            HStack {
                Text("Microphone")
                Spacer()
                Text(self.selectedMicLabel)
                    .foregroundStyle(.secondary)
            }
        }
        .task { await self.loadMicrophones() }
    }

    private var selectedMicLabel: String {
        if self.state.voiceWakeMicID.isEmpty { return self.defaultMicLabel }
        if let match = self.availableMics.first(where: { $0.uid == self.state.voiceWakeMicID }) {
            return match.name
        }
        if !self.state.voiceWakeMicName.isEmpty { return self.state.voiceWakeMicName }
        return "Unavailable"
    }

    private var microphoneMenuItems: some View {
        Group {
            if self.isSelectedMicUnavailable {
                Label("Disconnected (using System default)", systemImage: "exclamationmark.triangle")
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(.secondary)
                    .disabled(true)
                Divider()
            }
            Button {
                self.state.voiceWakeMicID = ""
                self.state.voiceWakeMicName = ""
            } label: {
                Label(self.defaultMicLabel, systemImage: self.state.voiceWakeMicID.isEmpty ? "checkmark" : "")
                    .labelStyle(.titleAndIcon)
            }
            .buttonStyle(.plain)

            ForEach(self.availableMics) { mic in
                Button {
                    self.state.voiceWakeMicID = mic.uid
                    self.state.voiceWakeMicName = mic.name
                } label: {
                    Label(mic.name, systemImage: self.state.voiceWakeMicID == mic.uid ? "checkmark" : "")
                        .labelStyle(.titleAndIcon)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var isSelectedMicUnavailable: Bool {
        let selected = self.state.voiceWakeMicID
        guard !selected.isEmpty else { return false }
        return !self.availableMics.contains(where: { $0.uid == selected })
    }

    private var defaultMicLabel: String {
        if let host = Host.current().localizedName, !host.isEmpty {
            return "Auto-detect (\(host))"
        }
        return "System default"
    }

    private func open(tab: SettingsTab) {
        SettingsTabRouter.request(tab)
        NSApp.activate(ignoringOtherApps: true)
        self.openSettings()
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .openclawSelectSettingsTab, object: tab)
        }
    }

    @MainActor
    private func loadMicrophones(force: Bool = false) async {
        guard self.showVoiceWakeMicPicker else {
            self.availableMics = []
            self.loadingMics = false
            return
        }
        if !force, !self.availableMics.isEmpty { return }
        self.loadingMics = true
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external, .microphone],
            mediaType: .audio,
            position: .unspecified)
        let connectedDevices = discovery.devices.filter(\.isConnected)
        self.availableMics = connectedDevices
            .sorted { lhs, rhs in
                lhs.localizedName.localizedCaseInsensitiveCompare(rhs.localizedName) == .orderedAscending
            }
            .map { AudioInputDevice(uid: $0.uniqueID, name: $0.localizedName) }
        self.availableMics = self.filterAliveInputs(self.availableMics)
        self.updateSelectedMicName()
        self.loadingMics = false
    }

    private func startMicObserver() {
        self.micObserver.start {
            Task { @MainActor in
                self.scheduleMicRefresh()
            }
        }
    }

    @MainActor
    private func scheduleMicRefresh() {
        self.micRefreshTask?.cancel()
        self.micRefreshTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await self.loadMicrophones(force: true)
        }
    }

    private func filterAliveInputs(_ inputs: [AudioInputDevice]) -> [AudioInputDevice] {
        let aliveUIDs = AudioInputDeviceObserver.aliveInputDeviceUIDs()
        guard !aliveUIDs.isEmpty else { return inputs }
        return inputs.filter { aliveUIDs.contains($0.uid) }
    }

    @MainActor
    private func updateSelectedMicName() {
        let selected = self.state.voiceWakeMicID
        if selected.isEmpty {
            self.state.voiceWakeMicName = ""
            return
        }
        if let match = self.availableMics.first(where: { $0.uid == selected }) {
            self.state.voiceWakeMicName = match.name
        }
    }

    private struct AudioInputDevice: Identifiable, Equatable {
        let uid: String
        let name: String
        var id: String { self.uid }
    }
}
