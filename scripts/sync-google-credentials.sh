#!/bin/bash
# sync-google-credentials.sh
# Syncs Google OAuth credentials from Aware control plane to gog's keyring
#
# Required env vars:
#   GOOGLE_CLIENT_ID       - OAuth client ID
#   GOOGLE_CLIENT_SECRET   - OAuth client secret
#   CONTROL_PLANE_URL      - Aware control plane base URL
#   AWARE_USER_TOKEN       - User's JWT token for control plane auth
#   GOG_KEYRING_PASSWORD   - Password for gog's encrypted keyring

set -e

# Check required env vars
if [ -z "$GOOGLE_CLIENT_ID" ]; then
  echo "Error: GOOGLE_CLIENT_ID is required"
  exit 1
fi

if [ -z "$GOOGLE_CLIENT_SECRET" ]; then
  echo "Error: GOOGLE_CLIENT_SECRET is required"
  exit 1
fi

if [ -z "$GOG_KEYRING_PASSWORD" ]; then
  echo "Error: GOG_KEYRING_PASSWORD is required"
  exit 1
fi

# Create gog config directory
GOG_CONFIG_DIR="${HOME}/.config/gog"
mkdir -p "$GOG_CONFIG_DIR"

# Create client_secret.json for gog
cat > "$GOG_CONFIG_DIR/credentials.json" << EOF
{
  "installed": {
    "client_id": "${GOOGLE_CLIENT_ID}",
    "client_secret": "${GOOGLE_CLIENT_SECRET}",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "redirect_uris": ["http://localhost"]
  }
}
EOF

echo "✓ Created gog credentials.json"

# Set gog to use file-based keyring
export GOG_KEYRING_BACKEND=file

# If control plane URL and token are provided, sync tokens
if [ -n "$CONTROL_PLANE_URL" ] && [ -n "$AWARE_USER_TOKEN" ]; then
  echo "Fetching Google tokens from control plane..."
  
  # Get token info from control plane
  RESPONSE=$(curl -s -f "${CONTROL_PLANE_URL}/auth/google/token" \
    -H "Authorization: Bearer ${AWARE_USER_TOKEN}" \
    -H "Content-Type: application/json")
  
  if [ $? -ne 0 ]; then
    echo "Warning: Could not fetch Google tokens from control plane (user may not have connected Google)"
    exit 0
  fi
  
  # Parse response
  EMAIL=$(echo "$RESPONSE" | jq -r '.email // empty')
  REFRESH_TOKEN=$(echo "$RESPONSE" | jq -r '.refreshToken // empty')
  SCOPES=$(echo "$RESPONSE" | jq -r '.scopes // empty')
  
  if [ -z "$EMAIL" ] || [ -z "$REFRESH_TOKEN" ]; then
    echo "Warning: No Google account connected"
    exit 0
  fi
  
  echo "Syncing credentials for ${EMAIL}..."
  
  # Determine services from scopes
  SERVICES="gmail,calendar,drive,contacts,docs,sheets"
  
  # Run gog-token-sync
  gog-token-sync \
    --email "$EMAIL" \
    --refresh-token "$REFRESH_TOKEN" \
    --services "$SERVICES" \
    --password "$GOG_KEYRING_PASSWORD"
  
  # Set default account
  export GOG_ACCOUNT="$EMAIL"
  echo "export GOG_ACCOUNT=\"$EMAIL\"" >> "$HOME/.bashrc"
  
  echo "✓ Google credentials synced for ${EMAIL}"
else
  echo "Skipping token sync (CONTROL_PLANE_URL or AWARE_USER_TOKEN not set)"
fi

echo "✓ Google credential sync complete"
