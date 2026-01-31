import SwiftUI

struct TypewriterText: View {
    let fullText: String
    let isTyping: Bool
    @State private var displayedText = ""
    @State private var currentIndex = 0
    @State private var timer: Timer?

    var body: some View {
        Text(self.displayedText)
            .font(.system(size: 14))
            .foregroundColor(.white.opacity(0.9))
            .multilineTextAlignment(.leading)
            .onAppear {
                self.startTyping()
            }
            .onChange(of: self.fullText) { oldValue, newValue in
                if newValue != oldValue {
                    self.resetAndType()
                }
            }
            .onDisappear {
                self.timer?.invalidate()
            }
    }

    private func startTyping() {
        guard self.isTyping, self.currentIndex < self.fullText.count else {
            self.displayedText = self.fullText
            return
        }

        self.timer?.invalidate()
        self.timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in
            if self.currentIndex < self.fullText.count {
                let index = self.fullText.index(self.fullText.startIndex, offsetBy: self.currentIndex)
                self.displayedText.append(self.fullText[index])
                self.currentIndex += 1
            } else {
                self.timer?.invalidate()
            }
        }
    }

    private func resetAndType() {
        self.displayedText = ""
        self.currentIndex = 0
        self.startTyping()
    }
}
