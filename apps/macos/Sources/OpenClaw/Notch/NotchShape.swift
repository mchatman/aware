import SwiftUI

struct NotchShape: Shape {
    private var topCornerRadius: CGFloat
    private var bottomCornerRadius: CGFloat

    init(
        topCornerRadius: CGFloat? = nil,
        bottomCornerRadius: CGFloat? = nil
    ) {
        self.topCornerRadius = topCornerRadius ?? 6
        self.bottomCornerRadius = bottomCornerRadius ?? 14
    }

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get {
            .init(
                self.topCornerRadius,
                self.bottomCornerRadius
            )
        }
        set {
            self.topCornerRadius = newValue.first
            self.bottomCornerRadius = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()

        path.move(to: CGPoint(x: rect.minX, y: rect.minY))

        path.addQuadCurve(
            to: CGPoint(x: rect.minX + self.topCornerRadius, y: rect.minY + self.topCornerRadius),
            control: CGPoint(x: rect.minX + self.topCornerRadius, y: rect.minY))

        path.addLine(
            to: CGPoint(x: rect.minX + self.topCornerRadius, y: rect.maxY - self.bottomCornerRadius))

        path.addQuadCurve(
            to: CGPoint(x: rect.minX + self.topCornerRadius + self.bottomCornerRadius, y: rect.maxY),
            control: CGPoint(x: rect.minX + self.topCornerRadius, y: rect.maxY))

        path.addLine(
            to: CGPoint(x: rect.maxX - self.topCornerRadius - self.bottomCornerRadius, y: rect.maxY))

        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - self.topCornerRadius, y: rect.maxY - self.bottomCornerRadius),
            control: CGPoint(x: rect.maxX - self.topCornerRadius, y: rect.maxY))

        path.addLine(
            to: CGPoint(x: rect.maxX - self.topCornerRadius, y: rect.minY + self.topCornerRadius))

        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY),
            control: CGPoint(x: rect.maxX - self.topCornerRadius, y: rect.minY))

        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))

        return path
    }
}
