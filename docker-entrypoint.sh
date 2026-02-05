#!/bin/bash
set -e

# === Config Generation ===
# Generate openclaw.json from environment variables if it doesn't exist
# This allows secrets to be passed via `fly secrets set` instead of baked into the image

CONFIG_FILE="${OPENCLAW_STATE_DIR:-/data}/openclaw.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Generating OpenClaw config at $CONFIG_FILE..."
    
    # Require gateway token in production
    if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
        echo "ERROR: OPENCLAW_GATEWAY_TOKEN is required. Set it with: fly secrets set OPENCLAW_GATEWAY_TOKEN=<token>"
        exit 1
    fi
    
    # Auto-approve devices (default: false for production safety)
    AUTO_APPROVE="${OPENCLAW_AUTO_APPROVE_DEVICES:-false}"
    
    # Generate config
    cat > "$CONFIG_FILE" << EOF
{
  "gateway": {
    "mode": "local",
    "port": 3000,
    "bind": "lan",
    "autoApproveDevices": ${AUTO_APPROVE},
    "auth": {
      "mode": "token",
      "token": "${OPENCLAW_GATEWAY_TOKEN}"
    }
  }
}
EOF
    
    echo "Config generated (autoApproveDevices: $AUTO_APPROVE)"
else
    echo "Using existing config at $CONFIG_FILE"
fi

# === gog Config ===
# Setup gog config symlink if persistent data exists
if [ -d "/data/gogcli" ]; then
    mkdir -p /root/.config
    ln -sf /data/gogcli /root/.config/gogcli
    echo "gog config linked to /data/gogcli"
fi

# Execute the main command
exec "$@"
