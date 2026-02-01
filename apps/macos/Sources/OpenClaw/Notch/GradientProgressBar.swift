import SwiftUI

// MARK: - Gradient Progress Bar

struct GradientProgressBar: View {
    @State private var phase: CGFloat = 0

    private let barHeight: CGFloat = 3
    private let gradientColors: [Color] = [
        Color(red: 0.2, green: 0.4, blue: 1.0),   // blue
        Color(red: 0.0, green: 0.8, blue: 0.53),   // green
        Color(red: 0.8, green: 0.2, blue: 0.8),    // magenta
    ]

    var body: some View {
        ZStack {
            // Glow layer
            Capsule()
                .fill(
                    LinearGradient(
                        colors: self.gradientColors,
                        startPoint: UnitPoint(x: self.phase, y: 0.5),
                        endPoint: UnitPoint(x: self.phase + 1.0, y: 0.5)))
                .frame(height: self.barHeight + 2)
                .blur(radius: 4)
                .opacity(0.5)

            // Main bar
            Capsule()
                .fill(
                    LinearGradient(
                        colors: self.gradientColors,
                        startPoint: UnitPoint(x: self.phase, y: 0.5),
                        endPoint: UnitPoint(x: self.phase + 1.0, y: 0.5)))
                .frame(height: self.barHeight)
        }
        .onAppear {
            withAnimation(.linear(duration: 3.0).repeatForever(autoreverses: true)) {
                self.phase = 0.5
            }
        }
    }
}
