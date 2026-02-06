import Foundation
import OSLog

/// Manages the OpenClaw node-host subprocess for browser proxy support.
/// This runs alongside MacNodeModeCoordinator to provide browser automation capabilities.
@MainActor
final class BrowserNodeCoordinator {
    static let shared = BrowserNodeCoordinator()
    
    private let logger = Logger(subsystem: "ai.openclaw", category: "browser-node")
    private var process: Process?
    private var isRunning = false
    
    private init() {}
    
    /// Start the browser node-host subprocess.
    func start() {
        guard !isRunning else {
            logger.debug("Browser node already running")
            return
        }
        
        Task {
            await startProcess()
        }
    }
    
    /// Stop the browser node-host subprocess.
    func stop() {
        guard isRunning, let process = process else { return }
        
        logger.info("Stopping browser node-host")
        process.terminate()
        self.process = nil
        self.isRunning = false
    }
    
    private func startProcess() async {
        // Get gateway config from the endpoint store
        guard let config = try? await GatewayEndpointStore.shared.requireConfig() else {
            logger.error("No gateway config available for browser node")
            return
        }
        
        // Find the bundled node-host binary
        guard let binaryURL = findNodeHostBinary() else {
            logger.error("Browser node-host binary not found in bundle")
            return
        }
        
        // Ensure browser config exists with openclaw profile as default
        ensureBrowserConfig()
        
        // Get gateway token from environment or config
        let token = ProcessInfo.processInfo.environment["OPENCLAW_GATEWAY_TOKEN"]
            ?? config.token
        
        let process = Process()
        process.executableURL = binaryURL
        process.arguments = buildArguments(for: binaryURL, config: config)
        
        // Set environment with gateway token
        var env = ProcessInfo.processInfo.environment
        if let token = token {
            env["OPENCLAW_GATEWAY_TOKEN"] = token
        }
        if let password = config.password {
            env["OPENCLAW_GATEWAY_PASSWORD"] = password
        }
        process.environment = env
        
        // Capture output for logging
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if !data.isEmpty, let output = String(data: data, encoding: .utf8) {
                self?.logger.debug("browser-node: \(output, privacy: .public)")
            }
        }
        
        process.terminationHandler = { [weak self] proc in
            Task { @MainActor in
                self?.logger.info("Browser node-host exited with code \(proc.terminationStatus)")
                self?.isRunning = false
                self?.process = nil
                
                // Auto-restart after delay if not intentionally stopped
                if proc.terminationStatus != 0 {
                    try? await Task.sleep(nanoseconds: 5_000_000_000) // 5 seconds
                    self?.start()
                }
            }
        }
        
        do {
            try process.run()
            self.process = process
            self.isRunning = true
            logger.info("Browser node-host started (PID: \(process.processIdentifier))")
        } catch {
            logger.error("Failed to start browser node-host: \(error.localizedDescription)")
        }
    }
    
    /// Ensure the OpenClaw config has browser.defaultProfile set to "openclaw"
    /// so the managed browser is used instead of the Chrome extension relay.
    private func ensureBrowserConfig() {
        let configDir = NSHomeDirectory() + "/.openclaw"
        let configPath = configDir + "/openclaw.json"
        
        // Create config directory if needed
        try? FileManager.default.createDirectory(atPath: configDir, withIntermediateDirectories: true)
        
        // Read existing config or start fresh
        var config: [String: Any] = [:]
        if let data = FileManager.default.contents(atPath: configPath),
           let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            config = existing
        }
        
        // Ensure browser config with openclaw as default profile
        var browserConfig = config["browser"] as? [String: Any] ?? [:]
        if browserConfig["defaultProfile"] == nil {
            browserConfig["defaultProfile"] = "openclaw"
            browserConfig["enabled"] = true
            config["browser"] = browserConfig
            
            // Write updated config
            if let data = try? JSONSerialization.data(withJSONObject: config, options: .prettyPrinted) {
                try? data.write(to: URL(fileURLWithPath: configPath))
                logger.info("Created browser config with openclaw profile as default")
            }
        }
    }
    
    private func findNodeHostBinary() -> URL? {
        // First, check the app bundle for the standalone binary
        if let bundled = Bundle.main.url(forResource: "aware-node-host", withExtension: nil) {
            return bundled
        }
        
        // Fallback: check for openclaw CLI in common locations
        let searchPaths = [
            "/usr/local/bin/openclaw",
            "/opt/homebrew/bin/openclaw",
            "\(NSHomeDirectory())/.npm-global/bin/openclaw",
            "\(NSHomeDirectory())/node_modules/.bin/openclaw"
        ]
        
        for path in searchPaths {
            if FileManager.default.isExecutableFile(atPath: path) {
                logger.debug("Found openclaw CLI at \(path)")
                return URL(fileURLWithPath: path)
            }
        }
        
        return nil
    }
    
    /// Check if we're using the openclaw CLI (vs bundled binary)
    private func isOpenClawCLI(_ url: URL) -> Bool {
        return url.lastPathComponent == "openclaw"
    }
    
    private func buildArguments(for binaryURL: URL, config: GatewayConnection.Config) -> [String] {
        var arguments: [String] = []
        
        // If using openclaw CLI, prepend "node run" subcommand
        if isOpenClawCLI(binaryURL) {
            arguments.append(contentsOf: ["node", "run"])
        }
        
        // Parse host and port from URL
        if let host = config.url.host {
            arguments.append(contentsOf: ["--host", host])
        }
        if let port = config.url.port {
            arguments.append(contentsOf: ["--port", String(port)])
        }
        
        // Check if TLS
        if config.url.scheme == "wss" {
            arguments.append("--tls")
        }
        
        // Set display name
        arguments.append(contentsOf: ["--display-name", "\(InstanceIdentity.displayName) (Browser)"])
        
        return arguments
    }
}
