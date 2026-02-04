#!/bin/sh
# Aware Gateway entrypoint
# Seeds default config on first boot, then starts the gateway.

STATE_DIR="${OPENCLAW_STATE_DIR:-/data}"
CONFIG_FILE="$STATE_DIR/openclaw.json"
SEED_CONFIG="/app/config/seed.json"

# First boot: seed config if none exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo "[aware] First boot — seeding config from $SEED_CONFIG"
  mkdir -p "$STATE_DIR"
  cp "$SEED_CONFIG" "$CONFIG_FILE"
fi

# Hand off to the gateway
exec node dist/index.js gateway --allow-unconfigured --port 3000 --bind lan
