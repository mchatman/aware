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
            .onChange(of: self.fullText) { _, newValue in
                if newValue.hasPrefix(self.displayedText) {
                    // Text grew (streaming) — continue from where we are
                    if self.timer == nil {
                        self.startTyping()
                    }
                    // Timer already running? It'll catch up naturally.
                } else {
                    // Completely different text — reset
                    self.resetAndType()
                }
            }
            .onChange(of: self.isTyping) { _, newValue in
                if !newValue {
                    // Streaming finished — show all remaining text immediately
                    self.timer?.invalidate()
                    self.timer = nil
                    self.displayedText = self.fullText
                    self.currentIndex = self.fullText.count
                }
            }
            .onDisappear {
                self.timer?.invalidate()
                self.timer = nil
            }
    }

    private func startTyping() {
        // If not actively typing, show all text immediately
        guard self.isTyping else {
            self.timer?.invalidate()
            self.timer = nil
            self.displayedText = self.fullText
            self.currentIndex = self.fullText.count
            return
        }

        guard self.currentIndex < self.fullText.count else {
            return
        }

        // Don't restart if timer is already running
        guard self.timer == nil else { return }

        self.timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in
            if self.currentIndex < self.fullText.count {
                let index = self.fullText.index(self.fullText.startIndex, offsetBy: self.currentIndex)
                self.displayedText.append(self.fullText[index])
                self.currentIndex += 1
            } else {
                self.timer?.invalidate()
                self.timer = nil
            }
        }
    }

    private func resetAndType() {
        self.timer?.invalidate()
        self.timer = nil
        self.displayedText = ""
        self.currentIndex = 0
        self.startTyping()
    }
}
