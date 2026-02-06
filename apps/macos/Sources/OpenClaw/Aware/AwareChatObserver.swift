import Foundation
import OpenClawChatUI
import OSLog

private let log = Logger(subsystem: "ai.aware", category: "chat-observer")

/// Observes chat messages and triggers TTS auto-playback.
@MainActor
final class AwareChatObserver {
    static let shared = AwareChatObserver()
    
    private var observedViewModel: OpenClawChatViewModel?
    private var lastMessageCount = 0
    private var observationTask: Task<Void, Never>?
    
    private init() {}
    
    /// Start observing a chat view model for new messages.
    func observe(_ viewModel: OpenClawChatViewModel) {
        // Stop observing previous
        observationTask?.cancel()
        
        self.observedViewModel = viewModel
        self.lastMessageCount = viewModel.messages.count
        
        // Process existing messages (in case there are unplayed ones)
        for message in viewModel.messages {
            AwareTTSAutoPlayer.shared.processMessage(message)
        }
        
        // Start polling for new messages
        // Note: Swift Observation doesn't support async observation yet,
        // so we poll periodically
        observationTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 200_000_000) // 200ms
                guard !Task.isCancelled else { return }
                await self?.checkForNewMessages()
            }
        }
        
        log.info("Started observing chat for TTS auto-play")
    }
    
    /// Stop observing.
    func stopObserving() {
        observationTask?.cancel()
        observationTask = nil
        observedViewModel = nil
    }
    
    private func checkForNewMessages() {
        guard let viewModel = observedViewModel else { return }
        
        let currentCount = viewModel.messages.count
        if currentCount > lastMessageCount {
            // New messages arrived
            let newMessages = viewModel.messages.suffix(currentCount - lastMessageCount)
            for message in newMessages {
                AwareTTSAutoPlayer.shared.processMessage(message)
            }
            lastMessageCount = currentCount
        }
    }
}
