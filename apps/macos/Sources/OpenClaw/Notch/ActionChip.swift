import SwiftUI

// MARK: - Action Chip

struct ActionChip: View {
    let label: String
    var tealColor: Color = Color(red: 0.0, green: 0.75, blue: 0.65)

    var body: some View {
        Text(self.label)
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .tracking(0.5)
            .foregroundColor(self.tealColor)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(
                Capsule()
                    .stroke(self.tealColor.opacity(0.4), lineWidth: 1)
                    .background(self.tealColor.opacity(0.08))
                    .clipShape(Capsule()))
    }
}
