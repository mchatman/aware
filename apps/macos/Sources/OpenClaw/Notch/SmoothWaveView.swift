import SwiftUI

// MARK: - Smooth Wave View

struct SmoothWaveView: View {
    let isAnimating: Bool
    let state: VisualizationState
    let audioLevel: Float

    @State private var phase: Double = 0
    @State private var animationTimer: Timer?

    enum VisualizationState {
        case idle
        case connecting
        case listening
        case speaking
    }

    init(isAnimating: Bool, state: VisualizationState = .listening, audioLevel: Float = 0.0) {
        self.isAnimating = isAnimating
        self.state = state
        self.audioLevel = audioLevel
    }

    var body: some View {
        Canvas { context, size in
            self.drawWave(context: context, size: size)
        }
        .frame(height: 60)
        .onAppear {
            if self.isAnimating {
                self.startAnimation()
            }
        }
        .onChange(of: self.isAnimating) { _, newValue in
            if newValue {
                self.startAnimation()
            } else {
                self.stopAnimation()
            }
        }
        .onChange(of: self.state) { _, _ in
            if self.isAnimating {
                self.stopAnimation()
                self.startAnimation()
            }
        }
        .animation(.easeInOut(duration: 0.3), value: self.audioLevel)
    }

    // MARK: - Drawing

    private func drawWave(context: GraphicsContext, size: CGSize) {
        let width = size.width
        let height = size.height
        let centerY = height / 2
        let waveWidth = width
        let waveStartX: CGFloat = 0

        switch self.state {
        case .connecting:
            if self.isAnimating {
                self.drawConnectingDots(context: context, centerX: width / 2, centerY: centerY)
            } else {
                self.drawAnimatedWave(
                    context: context, waveStartX: waveStartX, waveWidth: waveWidth,
                    centerY: centerY, height: height)
            }
        case .speaking, .listening, .idle:
            self.drawAnimatedWave(
                context: context, waveStartX: waveStartX, waveWidth: waveWidth,
                centerY: centerY, height: height)
        }
    }

    private func drawConnectingDots(context: GraphicsContext, centerX: CGFloat, centerY: CGFloat) {
        let dotCount = 5
        let spacing: CGFloat = 12
        let totalWidth = CGFloat(dotCount - 1) * spacing
        let startX = centerX - totalWidth / 2

        for i in 0..<dotCount {
            let x = startX + CGFloat(i) * spacing
            let animationOffset = Double(i) * 0.2
            let scale = 1.0 + 0.5 * sin(self.phase + animationOffset)
            let opacity = 0.6 + 0.4 * sin(self.phase + animationOffset)

            let radius: CGFloat = 3 * CGFloat(scale)
            let dotPath = Path(ellipseIn: CGRect(
                x: x - radius, y: centerY - radius,
                width: radius * 2, height: radius * 2))

            let dotColor = Color(red: 0.3, green: 0.6, blue: 1.0).opacity(opacity)
            context.fill(dotPath, with: .color(dotColor))
        }
    }

    private func drawAnimatedWave(
        context: GraphicsContext, waveStartX: CGFloat, waveWidth: CGFloat,
        centerY: CGFloat, height _: CGFloat
    ) {
        let path = self.createWavePath(waveStartX: waveStartX, waveWidth: waveWidth, centerY: centerY)
        let gradient = self.createGradient()

        context.stroke(
            path,
            with: .linearGradient(
                gradient,
                startPoint: CGPoint(x: waveStartX, y: centerY),
                endPoint: CGPoint(x: waveStartX + waveWidth, y: centerY)),
            lineWidth: self.lineWidth)
    }

    private func createWavePath(waveStartX: CGFloat, waveWidth: CGFloat, centerY: CGFloat) -> Path {
        var path = Path()
        let points = Int(waveWidth / 2)
        let amplitude = self.waveAmplitude
        let frequency = self.waveFrequency

        let startY = centerY + amplitude * sin(self.phase)
        path.move(to: CGPoint(x: waveStartX, y: startY))

        for i in 1...points {
            let x = waveStartX + CGFloat(i) * (waveWidth / CGFloat(points))
            let normalizedX = (x - waveStartX) / waveWidth
            let waveValue = amplitude * sin(frequency * normalizedX * 2 * .pi + self.phase)
            let y = centerY + waveValue

            let previousX = waveStartX + CGFloat(i - 1) * (waveWidth / CGFloat(points))
            let controlX = (previousX + x) / 2
            let controlY = centerY + amplitude * sin(
                frequency * ((controlX - waveStartX) / waveWidth) * 2 * .pi + self.phase)

            path.addQuadCurve(to: CGPoint(x: x, y: y), control: CGPoint(x: controlX, y: controlY))
        }

        return path
    }

    private func createGradient() -> Gradient {
        Gradient(colors: [
            Color(red: 0.0, green: 0.8, blue: 0.9),
            Color(red: 0.7, green: 0.3, blue: 0.9),
        ])
    }

    // MARK: - Computed Properties

    private var waveAmplitude: CGFloat {
        switch self.state {
        case .idle: 4.0
        case .connecting: 0.0
        case .listening: 6.0 + CGFloat(self.audioLevel) * 4.0
        case .speaking: 10.0 + CGFloat(self.audioLevel) * 8.0
        }
    }

    private var waveFrequency: Double {
        switch self.state {
        case .idle: 1.5
        case .connecting: 0.0
        case .listening: 2.0
        case .speaking: 3.5
        }
    }

    private var animationSpeed: Double {
        switch self.state {
        case .idle: 0.015
        case .connecting: 0.08
        case .listening: 0.03
        case .speaking: 0.05
        }
    }

    private var lineWidth: CGFloat {
        switch self.state {
        case .idle: 2.0
        case .connecting: 2.0
        case .listening: 3.0
        case .speaking: 4.0
        }
    }

    // MARK: - Animation

    private func startAnimation() {
        guard self.isAnimating else { return }
        self.animationTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { _ in
            self.phase += self.animationSpeed
            if self.phase > 2 * .pi {
                self.phase -= 2 * .pi
            }
        }
    }

    private func stopAnimation() {
        self.animationTimer?.invalidate()
        self.animationTimer = nil
    }
}
