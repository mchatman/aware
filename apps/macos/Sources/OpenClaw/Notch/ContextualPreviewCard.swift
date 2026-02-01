import SwiftUI

// MARK: - Diff Line Model

struct DiffLine: Identifiable {
    let id = UUID()
    let lineNumber: String
    let label: String
    let value: String
    let type: DiffLineType

    enum DiffLineType {
        case context
        case addition
        case deletion
    }
}

// MARK: - Contextual Preview Card

struct ContextualPreviewCard: View {
    private let cardBg = Color(red: 0.1, green: 0.1, blue: 0.12)
    private let greenColor = Color(red: 0.3, green: 0.85, blue: 0.5)
    private let redColor = Color(red: 0.9, green: 0.35, blue: 0.35)
    private let tealColor = Color(red: 0.0, green: 0.75, blue: 0.65)

    private let diffLines: [DiffLine] = [
        DiffLine(lineNumber: "12", label: "Q2 Marketing Spend", value: "$38,500", type: .context),
        DiffLine(lineNumber: "13", label: "Q3 Projection (Est)", value: "$45,000", type: .deletion),
        DiffLine(lineNumber: "13", label: "Q3 Projection (Final)", value: "$48,200", type: .addition),
        DiffLine(lineNumber: "14", label: "Q4 Forecast", value: "$52,000", type: .addition),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            self.cardHeader
            self.diffContent
            self.cardFooter
        }
        .background(self.cardBg)
        .cornerRadius(10)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.white.opacity(0.08), lineWidth: 1))
    }

    // MARK: - Card Header

    private var cardHeader: some View {
        HStack(spacing: 8) {
            Image(systemName: "tablecells")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(self.tealColor)

            VStack(alignment: .leading, spacing: 1) {
                Text("Revenue Sheet")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white.opacity(0.9))
                HStack(spacing: 4) {
                    Circle()
                        .fill(self.tealColor)
                        .frame(width: 5, height: 5)
                    Text("master · 2m ago")
                        .font(.system(size: 10))
                        .foregroundColor(.white.opacity(0.4))
                }
            }

            Spacer()

            // Diff button
            HStack(spacing: 3) {
                Image(systemName: "arrow.left.arrow.right")
                    .font(.system(size: 9))
                Text("Diff")
                    .font(.system(size: 10, weight: .medium))
            }
            .foregroundColor(.white.opacity(0.5))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(Color.white.opacity(0.15), lineWidth: 1))

            // External link icon
            Image(systemName: "arrow.up.right.square")
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.3))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    // MARK: - Diff Content

    private var diffContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            // File header
            HStack(spacing: 6) {
                Image(systemName: "doc.text")
                    .font(.system(size: 10))
                    .foregroundColor(.white.opacity(0.35))
                Text("Sheet1.csv")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundColor(.white.opacity(0.5))
                Spacer()
                Text("@@ -12,4 +12,5 @@")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(Color(red: 0.4, green: 0.6, blue: 1.0).opacity(0.6))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.03))

            // Diff lines
            ForEach(self.diffLines) { line in
                self.diffLineRow(line)
            }
        }
        .background(Color.black.opacity(0.25))
    }

    private func diffLineRow(_ line: DiffLine) -> some View {
        HStack(spacing: 0) {
            // Prefix
            Text(self.linePrefix(for: line.type))
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(self.lineColor(for: line.type))
                .frame(width: 14)

            // Line number
            Text(line.lineNumber)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.white.opacity(0.2))
                .frame(width: 24, alignment: .trailing)
                .padding(.trailing, 8)

            // Label
            self.diffLabelText(line)

            Spacer()

            // Value
            self.diffValueText(line)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 3)
        .background(self.lineBackground(for: line.type))
    }

    @ViewBuilder
    private func diffLabelText(_ line: DiffLine) -> some View {
        switch line.type {
        case .deletion:
            Text(line.label)
                .font(.system(size: 11, design: .monospaced))
                .strikethrough(true, color: self.redColor.opacity(0.6))
                .foregroundColor(self.redColor.opacity(0.7))
        case .addition:
            Text(line.label)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(self.greenColor)
        case .context:
            Text(line.label)
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.white.opacity(0.45))
        }
    }

    @ViewBuilder
    private func diffValueText(_ line: DiffLine) -> some View {
        switch line.type {
        case .deletion:
            Text(line.value)
                .font(.system(size: 11, design: .monospaced))
                .strikethrough(true, color: self.redColor.opacity(0.6))
                .foregroundColor(self.redColor.opacity(0.7))
        case .addition:
            Text(line.value)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundColor(self.greenColor)
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(self.greenColor.opacity(0.12))
                .cornerRadius(3)
        case .context:
            Text(line.value)
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.white.opacity(0.35))
        }
    }

    private func linePrefix(for type: DiffLine.DiffLineType) -> String {
        switch type {
        case .context: " "
        case .addition: "+"
        case .deletion: "-"
        }
    }

    private func lineColor(for type: DiffLine.DiffLineType) -> Color {
        switch type {
        case .context: .clear
        case .addition: self.greenColor
        case .deletion: self.redColor
        }
    }

    @ViewBuilder
    private func lineBackground(for type: DiffLine.DiffLineType) -> some View {
        switch type {
        case .addition:
            self.greenColor.opacity(0.06)
        case .deletion:
            self.redColor.opacity(0.06)
        case .context:
            Color.clear
        }
    }

    // MARK: - Card Footer

    private var cardFooter: some View {
        HStack(spacing: 8) {
            // Additions badge
            HStack(spacing: 3) {
                Text("+")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                Text("2 additions")
                    .font(.system(size: 10, weight: .medium))
            }
            .foregroundColor(self.greenColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(self.greenColor.opacity(0.1))
            .cornerRadius(4)

            // Deletions badge
            HStack(spacing: 3) {
                Text("-")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                Text("1 deletion")
                    .font(.system(size: 10, weight: .medium))
            }
            .foregroundColor(self.redColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(self.redColor.opacity(0.1))
            .cornerRadius(4)

            Spacer()

            // Author
            HStack(spacing: 5) {
                ZStack {
                    Circle()
                        .fill(Color(red: 0.9, green: 0.6, blue: 0.2))
                        .frame(width: 16, height: 16)
                    Text("A")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.white)
                }
                Text("Edited by Alex")
                    .font(.system(size: 10))
                    .foregroundColor(.white.opacity(0.4))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.02))
    }
}
