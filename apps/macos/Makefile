# Aware Mac App Build
# Requires: bun, swift

.PHONY: all clean node-host app release

# Default target
all: node-host app

# Build the node-host binary with Bun
node-host:
	@echo "Building aware-node-host..."
	@cd ../.. && pnpm build 2>/dev/null || npm run build 2>/dev/null || echo "Skipping TS build"
	@cd ../.. && bun build aware-node-host.mjs --compile --outfile apps/macos/Sources/OpenClaw/Resources/aware-node-host --minify
	@chmod +x Sources/OpenClaw/Resources/aware-node-host
	@echo "Built: Sources/OpenClaw/Resources/aware-node-host"

# Build the Swift app (debug)
app:
	swift build

# Build release version
release: node-host
	swift build -c release

# Clean build artifacts
clean:
	swift package clean
	rm -f Sources/OpenClaw/Resources/aware-node-host

# Install bun if not present
install-bun:
	@which bun > /dev/null || curl -fsSL https://bun.sh/install | bash

# Full rebuild
rebuild: clean all
