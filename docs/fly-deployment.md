# Fly.io Deployment Guide

## Prerequisites

- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) installed
- Fly.io account and logged in (`fly auth login`)

## Initial Setup

### 1. Create the app (first time only)

```bash
fly apps create aware-gateway
```

### 2. Create persistent volume

```bash
fly volumes create openclaw_data --region sjc --size 1
```

### 3. Set secrets

**Required:**
```bash
# Generate a secure token
TOKEN=$(openssl rand -hex 32)
echo "Save this token: $TOKEN"

fly secrets set OPENCLAW_GATEWAY_TOKEN=$TOKEN
```

**Optional (for AI providers):**
```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly secrets set OPENAI_API_KEY=sk-...
```

**For development/testing only:**
```bash
# Auto-approve device pairing (NOT for production!)
fly secrets set OPENCLAW_AUTO_APPROVE_DEVICES=true
```

### 4. Deploy

```bash
fly deploy
```

## Device Pairing

With `OPENCLAW_AUTO_APPROVE_DEVICES=false` (production default), you need to manually approve devices:

```bash
# SSH into the machine
fly ssh console

# Inside the container, approve pending devices
node dist/index.js devices list
node dist/index.js devices approve <device-id>
```

Or temporarily enable auto-approve, connect your device, then disable:

```bash
fly secrets set OPENCLAW_AUTO_APPROVE_DEVICES=true
# ... connect device ...
fly secrets set OPENCLAW_AUTO_APPROVE_DEVICES=false
```

## Monitoring

```bash
# View logs
fly logs

# Check machine status
fly status

# SSH into running machine
fly ssh console
```

## Updating

```bash
# Rebuild and deploy
fly deploy

# Or just restart (no rebuild)
fly machines restart
```

## Connecting Clients

Use the gateway URL and token:

- **URL:** `https://aware-gateway.fly.dev`
- **Token:** The value you set in `OPENCLAW_GATEWAY_TOKEN`

Example client config (`~/.openclaw/openclaw.json`):
```json
{
  "gateway": {
    "mode": "remote-direct",
    "url": "https://aware-gateway.fly.dev",
    "token": "<your-token>"
  }
}
```

## Troubleshooting

### Config not updating
The config is only generated if `/data/openclaw.json` doesn't exist. To regenerate:

```bash
fly ssh console
rm /data/openclaw.json
exit
fly machines restart
```

### Health check failing
Check logs for startup errors:
```bash
fly logs --app aware-gateway
```

### Volume not mounting
Ensure volume exists in the same region as your machine:
```bash
fly volumes list
```
