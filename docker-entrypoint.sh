#!/bin/bash
set -e

# === Config Generation ===
# Generate config from environment variables if it doesn't exist
# This allows secrets to be passed via `fly secrets set` instead of baked into the image

# Use OPENCLAW_STATE_DIR (the env var the gateway reads) with AWARE_ fallback
STATE_DIR="${OPENCLAW_STATE_DIR:-${AWARE_STATE_DIR:-/data}}"
CONFIG_FILE="${STATE_DIR}/openclaw.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Generating gateway config at $CONFIG_FILE..."
    
    # Check for token (support both prefixes)
    GATEWAY_TOKEN="${AWARE_GATEWAY_TOKEN:-${OPENCLAW_GATEWAY_TOKEN:-}}"
    
    if [ -z "$GATEWAY_TOKEN" ]; then
        echo "ERROR: AWARE_GATEWAY_TOKEN is required. Set it with: fly secrets set AWARE_GATEWAY_TOKEN=<token>"
        exit 1
    fi
    
    # Auto-approve devices (default: false for production safety)
    AUTO_APPROVE="${AWARE_AUTO_APPROVE_DEVICES:-${OPENCLAW_AUTO_APPROVE_DEVICES:-false}}"
    
    # Trusted proxies for Fly.io (private network ranges)
    TRUSTED_PROXIES="${AWARE_TRUSTED_PROXIES:-\"172.16.0.0/12\", \"10.0.0.0/8\"}"
    
    # Generate config
    cat > "$CONFIG_FILE" << EOF
{
  "gateway": {
    "mode": "local",
    "port": 3000,
    "bind": "lan",
    "autoApproveDevices": ${AUTO_APPROVE},
    "trustedProxies": [${TRUSTED_PROXIES}],
    "auth": {
      "mode": "token",
      "token": "${GATEWAY_TOKEN}"
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
