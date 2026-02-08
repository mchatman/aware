import SwiftUI

struct GeneralSettings: View {
    @Bindable var state: AppState

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 12) {
                SettingsToggleRow(
                    title: "Aware active",
                    subtitle: "Pause to temporarily stop Aware.",
                    binding: self.activeBinding)

                Divider()

                SettingsToggleRow(
                    title: "Launch at login",
                    subtitle: "Automatically start Aware after you sign in.",
                    binding: self.$state.launchAtLogin)

                SettingsToggleRow(
                    title: "Show Dock icon",
                    subtitle: "Keep Aware visible in the Dock instead of menu-bar-only mode.",
                    binding: self.$state.showDockIcon)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.bottom, 16)
        }
    }

    private var activeBinding: Binding<Bool> {
        Binding(
            get: { !self.state.isPaused },
            set: { self.state.isPaused = !$0 })
    }
}

#if DEBUG
struct GeneralSettings_Previews: PreviewProvider {
    static var previews: some View {
        GeneralSettings(state: .preview)
            .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
    }
}
#endif
