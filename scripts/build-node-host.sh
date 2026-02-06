#!/bin/bash
# Build the aware-node-host standalone binary for macOS
# Requires: bun (https://bun.sh)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/apps/macos/Sources/OpenClaw/Resources"

cd "$ROOT_DIR"

# Ensure dist is built
if [ ! -d "dist/node-host" ]; then
    echo "Building TypeScript..."
    pnpm build
fi

# Build for current architecture
ARCH=$(uname -m)
echo "Building aware-node-host for $ARCH..."

bun build aware-node-host.mjs \
    --compile \
    --outfile "$OUTPUT_DIR/aware-node-host" \
    --minify

# Make executable
chmod +x "$OUTPUT_DIR/aware-node-host"

echo "Built: $OUTPUT_DIR/aware-node-host"
ls -lh "$OUTPUT_DIR/aware-node-host"
