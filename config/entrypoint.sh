#!/bin/sh
# Aware Gateway entrypoint
# Seeds default config on first boot, then hands off to CMD.

STATE_DIR="${OPENCLAW_STATE_DIR:-/data}"
CONFIG_FILE="$STATE_DIR/openclaw.json"
SEED_CONFIG="/app/config/seed.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "[aware] First boot — seeding config from $SEED_CONFIG"
  mkdir -p "$STATE_DIR"
  cp "$SEED_CONFIG" "$CONFIG_FILE"
fi

exec "$@"
