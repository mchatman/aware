import Foundation
import OSLog

/// Manages Chrome with CDP and the OpenClaw node-host subprocess for browser proxy support.
/// Uses CDP attach mode to control the user's Chrome browser.
@MainActor
final class BrowserNodeCoordinator {
    static let shared = BrowserNodeCoordinator()
    
    private let logger = Logger(subsystem: "ai.openclaw", category: "browser-node")
    private var nodeProcess: Process?
    private var chromeProcess: Process?
    private var isRunning = false
    
    /// CDP port for Chrome remote debugging
    private let cdpPort = 9222
    
    private init() {}
    
    /// Start Chrome with CDP and the browser node-host subprocess.
    func start() {
        guard !isRunning else {
            logger.debug("Browser node already running")
            return
        }
        
        Task {
            await startBrowserStack()
        }
    }
    
    /// Stop Chrome and the browser node-host subprocess.
    func stop() {
        logger.info("Stopping browser stack")
        
        if let nodeProcess = nodeProcess {
            nodeProcess.terminate()
            self.nodeProcess = nil
        }
        
        // Don't kill Chrome - user might have other tabs open
        // Just disconnect gracefully
        
        isRunning = false
    }
    
    private func startBrowserStack() async {
        // Get gateway config from the endpoint store
        guard let config = try? await GatewayEndpointStore.shared.requireConfig() else {
            logger.error("No gateway config available for browser node")
            return
        }
        
        // Ensure browser config points to CDP
        ensureBrowserConfig()
        
        // Launch Chrome with remote debugging if not already running
        await launchChromeWithCDP()
        
        // Wait a moment for Chrome to start
        try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
        
        // Verify Chrome CDP is available
        guard await isCDPAvailable() else {
            logger.error("Chrome CDP not available after launch")
            return
        }
        
        // Find and start the node-host
        guard let binaryURL = findNodeHostBinary() else {
            logger.error("Browser node-host binary not found in bundle")
            return
        }
        
        await startNodeHost(binaryURL: binaryURL, config: config)
    }
    
    /// Launch Chrome with remote debugging enabled
    private func launchChromeWithCDP() async {
        // Check if Chrome is already running with CDP
        if await isCDPAvailable() {
            logger.info("Chrome CDP already available on port \(self.cdpPort)")
            return
        }
        
        // Find Chrome
        let chromePaths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "\(NSHomeDirectory())/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        ]
        
        var chromePath: String?
        for path in chromePaths {
            if FileManager.default.isExecutableFile(atPath: path) {
                chromePath = path
                break
            }
        }
        
        guard let chromePath = chromePath else {
            logger.error("Chrome not found. Please install Google Chrome.")
            return
        }
        
        logger.info("Launching Chrome with CDP on port \(self.cdpPort)")
        
        // Use a dedicated user data directory to avoid profile picker
        let userDataDir = NSHomeDirectory() + "/.openclaw/chrome-cdp"
        try? FileManager.default.createDirectory(atPath: userDataDir, withIntermediateDirectories: true)
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: chromePath)
        process.arguments = [
            "--remote-debugging-port=\(cdpPort)",
            "--no-first-run",
            "--no-default-browser-check",
            "--user-data-dir=\(userDataDir)"
        ]
        
        // Detach Chrome so it persists after we exit
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        
        do {
            try process.run()
            chromeProcess = process
            logger.info("Chrome launched with PID \(process.processIdentifier)")
            
            // Bring Chrome to the foreground
            activateChrome()
        } catch {
            logger.error("Failed to launch Chrome: \(error.localizedDescription)")
        }
    }
    
    /// Bring Chrome to the foreground using AppleScript
    private func activateChrome() {
        let script = """
            tell application "Google Chrome"
                activate
            end tell
            """
        
        var error: NSDictionary?
        if let appleScript = NSAppleScript(source: script) {
            appleScript.executeAndReturnError(&error)
            if let error = error {
                logger.warning("Failed to activate Chrome: \(error)")
            }
        }
    }
    
    /// Check if Chrome CDP is available
    private func isCDPAvailable() async -> Bool {
        let url = URL(string: "http://127.0.0.1:\(cdpPort)/json/version")!
        
        do {
            let (_, response) = try await URLSession.shared.data(from: url)
            if let httpResponse = response as? HTTPURLResponse {
                return httpResponse.statusCode == 200
            }
        } catch {
            // CDP not available
        }
        
        return false
    }
    
    /// Configure OpenClaw to use CDP attach mode
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
        
        // Configure browser for CDP attach
        var browserConfig = config["browser"] as? [String: Any] ?? [:]
        let expectedCdpUrl = "http://127.0.0.1:\(cdpPort)"
        
        // Update if not already configured for CDP
        if browserConfig["cdpUrl"] as? String != expectedCdpUrl {
            browserConfig["enabled"] = true
            browserConfig["cdpUrl"] = expectedCdpUrl
            browserConfig["attachOnly"] = true  // Don't try to launch, just attach
            // Remove managed browser settings
            browserConfig.removeValue(forKey: "defaultProfile")
            config["browser"] = browserConfig
            
            // Write updated config
            if let data = try? JSONSerialization.data(withJSONObject: config, options: .prettyPrinted) {
                try? data.write(to: URL(fileURLWithPath: configPath))
                logger.info("Configured browser for CDP attach at \(expectedCdpUrl)")
            }
        }
    }
    
    private func startNodeHost(binaryURL: URL, config: GatewayConnection.Config) async {
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
                self?.nodeProcess = nil
                
                // Auto-restart after delay if not intentionally stopped
                if proc.terminationStatus != 0 {
                    try? await Task.sleep(nanoseconds: 5_000_000_000) // 5 seconds
                    self?.start()
                }
            }
        }
        
        do {
            try process.run()
            self.nodeProcess = process
            self.isRunning = true
            logger.info("Browser node-host started (PID: \(process.processIdentifier))")
        } catch {
            logger.error("Failed to start browser node-host: \(error.localizedDescription)")
        }
    }
    
    private func findNodeHostBinary() -> URL? {
        // First, check the app bundle for the standalone binary (from Bundle.module resources)
        if let bundled = Bundle.main.url(forResource: "aware-node-host", withExtension: nil) {
            logger.debug("Found bundled aware-node-host at \(bundled.path)")
            return bundled
        }
        
        // Also check in the executable's directory (for dev builds)
        if let executablePath = Bundle.main.executablePath {
            let execDir = URL(fileURLWithPath: executablePath).deletingLastPathComponent()
            let devPath = execDir.appendingPathComponent("aware-node-host")
            if FileManager.default.isExecutableFile(atPath: devPath.path) {
                logger.debug("Found aware-node-host in executable dir: \(devPath.path)")
                return devPath
            }
            
            // Check Resources subdirectory
            let resourcePath = execDir.appendingPathComponent("OpenClaw_OpenClaw.bundle/Contents/Resources/aware-node-host")
            if FileManager.default.isExecutableFile(atPath: resourcePath.path) {
                logger.debug("Found aware-node-host in resources: \(resourcePath.path)")
                return resourcePath
            }
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
        
        logger.error("No aware-node-host or openclaw CLI found")
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
        
        // Use explicit port if set, otherwise derive from scheme
        let isTLS = config.url.scheme == "wss" || config.url.scheme == "https"
        let port = config.url.port ?? (isTLS ? 443 : 80)
        arguments.append(contentsOf: ["--port", String(port)])
        
        // Check if TLS
        if isTLS {
            arguments.append("--tls")
        }
        
        // Set display name
        arguments.append(contentsOf: ["--display-name", "\(InstanceIdentity.displayName) (Browser)"])
        
        return arguments
    }
}
