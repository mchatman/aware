import AVFoundation
import Foundation
import OpenClawChatUI
import OpenClawKit
import OSLog

private let log = Logger(subsystem: "ai.aware", category: "tts-autoplay")

/// Automatically plays TTS audio attachments from assistant messages.
@MainActor
final class AwareTTSAutoPlayer {
    static let shared = AwareTTSAutoPlayer()
    
    private var player: AVAudioPlayer?
    private var processedMessageIds: Set<UUID> = []
    private var isEnabled = true
    
    private init() {}
    
    /// Enable or disable auto-playback.
    func setEnabled(_ enabled: Bool) {
        self.isEnabled = enabled
        if !enabled {
            stop()
        }
    }
    
    /// Process a message and auto-play any TTS audio.
    func processMessage(_ message: OpenClawChatMessage) {
        guard isEnabled else { return }
        guard message.role == "assistant" else { return }
        guard !processedMessageIds.contains(message.id) else { return }
        
        processedMessageIds.insert(message.id)
        
        // Limit cache size
        if processedMessageIds.count > 100 {
            processedMessageIds.removeFirst()
        }
        
        // Check for mediaUrl first (TTS audio from gateway)
        if let mediaUrl = message.mediaUrl, !mediaUrl.isEmpty {
            playMediaUrl(mediaUrl)
            return
        }
        
        // Check mediaUrls array
        if let mediaUrls = message.mediaUrls, let firstUrl = mediaUrls.first {
            playMediaUrl(firstUrl)
            return
        }
        
        // Find audio content in message parts
        for content in message.content {
            if let mimeType = content.mimeType,
               mimeType.hasPrefix("audio/"),
               let audioContent = content.content {
                playAudioContent(audioContent, mimeType: mimeType)
                return // Play first audio only
            }
        }
    }
    
    private func playMediaUrl(_ path: String) {
        // mediaUrl is typically a relative path like /media/abc123.mp3
        // We need the gateway base URL to construct the full URL
        guard let gatewayUrl = getGatewayBaseUrl() else {
            log.warning("No gateway URL available for media playback")
            return
        }
        
        let fullUrl: String
        if path.hasPrefix("http://") || path.hasPrefix("https://") {
            fullUrl = path
        } else {
            // Construct full URL from gateway base + path
            fullUrl = gatewayUrl + path
        }
        
        log.info("Playing TTS from: \(fullUrl, privacy: .public)")
        playURL(fullUrl)
    }
    
    private func getGatewayBaseUrl() -> String? {
        // Get gateway URL from auth manager
        if let endpoint = AwareAuthManager.shared.gatewayEndpoint {
            // Convert wss:// to https://
            return endpoint
                .replacingOccurrences(of: "wss://", with: "https://")
                .replacingOccurrences(of: "ws://", with: "http://")
        }
        return nil
    }
    
    /// Stop current playback.
    func stop() {
        player?.stop()
        player = nil
    }
    
    private func playAudioContent(_ content: AnyCodable, mimeType: String) {
        // Content might be base64 data or a URL
        if let base64String = content.value as? String {
            // Try to decode as base64
            if let data = Data(base64Encoded: base64String) {
                playData(data)
            } else if base64String.hasPrefix("http://") || base64String.hasPrefix("https://") {
                // It's a URL
                playURL(base64String)
            } else if base64String.hasPrefix("/") || base64String.contains("/media/") {
                // It's a path - construct URL
                // For now, log and skip - need gateway URL
                log.warning("Audio path detected but playback not implemented: \(base64String, privacy: .public)")
            }
        } else if let dict = content.value as? [String: Any],
                  let data = dict["data"] as? String {
            if let audioData = Data(base64Encoded: data) {
                playData(audioData)
            }
        }
    }
    
    private func playData(_ data: Data) {
        do {
            let player = try AVAudioPlayer(data: data)
            self.player = player
            player.prepareToPlay()
            player.play()
            log.info("Playing TTS audio (\(data.count) bytes)")
        } catch {
            log.error("Failed to play TTS audio: \(error.localizedDescription, privacy: .public)")
        }
    }
    
    private func playURL(_ urlString: String) {
        guard let url = URL(string: urlString) else {
            log.error("Invalid audio URL: \(urlString, privacy: .public)")
            return
        }
        
        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                await MainActor.run {
                    playData(data)
                }
            } catch {
                log.error("Failed to download audio: \(error.localizedDescription, privacy: .public)")
            }
        }
    }
}
