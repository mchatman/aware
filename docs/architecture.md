# Aware — Hybrid Architecture

## Overview

Aware is a B2B voice AI assistant. The architecture splits responsibilities between two services:

- **BlueFairy (FastAPI)** — Auth, user/tenant management, OAuth connectors, WebSocket gateway
- **OpenClaw (Node.js)** — AI agent, LLM orchestration, tools (Google/Microsoft via gog/mog), memory, conversation management

Voice processing (STT + TTS) happens **on-device** in the Mac app — no WebRTC, no server-side audio.

## Request Flow

```
┌──────────────────────┐
│      Mac App         │
│  ┌────────────────┐  │
│  │ Apple STT      │  │  (on-device speech-to-text)
│  │ Edge TTS       │  │  (on-device text-to-speech)
│  └───────┬────────┘  │
│          │ text       │
└──────────┼───────────┘
           │ WebSocket (authenticated)
           ▼
┌──────────────────────┐
│    BlueFairy (API)   │
│  ┌────────────────┐  │
│  │ Auth Middleware │  │  JWT/session validation
│  │ Tenant Router  │  │  user → OpenClaw session
│  │ Token Injector │  │  OAuth tokens from Redis
│  │ WS Proxy       │  │  stream relay
│  └───────┬────────┘  │
│          │            │
│  Postgres │ Redis    │
└──────────┼───────────┘
           │ HTTP (internal)
           ▼
┌──────────────────────┐
│   OpenClaw Gateway   │
│  ┌────────────────┐  │
│  │ Agent Session  │  │  per-user conversation
│  │ LLM (Anthropic)│  │  Claude for reasoning
│  │ Tools          │  │  gog (Google), mog (Microsoft)
│  │ Memory         │  │  conversation history
│  └────────────────┘  │
└──────────────────────┘
```

## Service Responsibilities

### BlueFairy (FastAPI)

| Responsibility | Details |
|---|---|
| **User Auth** | Email/password sign-up/sign-in, session tokens in Redis |
| **OAuth Connectors** | Google + Microsoft OAuth flows, token storage/refresh in Redis |
| **WebSocket Gateway** | Mac app connects here, authenticated persistent connection |
| **Session Routing** | Maps authenticated user → OpenClaw session ID |
| **Proxy** | Forwards messages to OpenClaw, streams responses back |
| **Billing** | (Future) Stripe integration, usage tracking |

### OpenClaw Gateway

| Responsibility | Details |
|---|---|
| **Agent/LLM** | Conversation management, system prompts, LLM calls |
| **Tools** | gog (Google Calendar, Gmail, Drive, etc.), mog (Microsoft Graph) |
| **Memory** | Per-user conversation history and context |
| **Streaming** | Token-by-token response streaming |

### Mac App

| Responsibility | Details |
|---|---|
| **STT** | Apple Speech framework (on-device) |
| **TTS** | Edge TTS (on-device) |
| **UI** | Notch-resident assistant interface |
| **Connection** | WebSocket to BlueFairy |

## WebSocket Protocol

### Mac App → BlueFairy

```jsonc
// Send a message
{
  "type": "message",
  "content": "What's on my calendar today?"
}

// Ping/keepalive
{
  "type": "ping"
}
```

### BlueFairy → Mac App

```jsonc
// Streaming response chunk
{
  "type": "chunk",
  "content": "You have "
}

// Response complete
{
  "type": "done",
  "fullContent": "You have 3 meetings today..."
}

// Error
{
  "type": "error",
  "message": "Failed to process request"
}

// Pong
{
  "type": "pong"
}
```

## Per-User Session Management

Each authenticated user gets a dedicated OpenClaw session:

1. User authenticates with BlueFairy (existing auth flow)
2. BlueFairy checks Redis for `openclaw_session:{user_id}`
3. If no session exists, BlueFairy creates one via OpenClaw API
4. Messages are sent to that session, responses streamed back
5. Sessions persist across connections (reconnect = same conversation)

## OAuth Token Flow

Users connect Google/Microsoft through BlueFairy's existing OAuth flows. When OpenClaw needs to use tools:

1. BlueFairy stores OAuth tokens in Redis (`token_google:{user_id}`, `token_microsoft:{user_id}`)
2. Before proxying a message to OpenClaw, BlueFairy fetches the user's tokens
3. Tokens are passed as environment/config to OpenClaw's tool execution
4. Token refresh is handled by BlueFairy

## Deployment (Single VPS)

```yaml
# docker-compose.yml
services:
  bluefairy:
    build: ./bluefairy
    ports:
      - "8000:8000"
    depends_on:
      - postgres
      - redis
      - openclaw

  openclaw:
    build: .
    ports:
      - "3420:3420"  # internal only
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

  postgres:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
    # TLS termination, reverse proxy
```

**Estimated cost:** $10-30/month (Hetzner/DigitalOcean VPS)

## Migration Path

### From BlueFairy (current → hybrid)

**Remove:**
- `app/rtc/` — WebRTC/FastRTC (voice moves to client)
- `app/services/ai.py` — Direct OpenAI calls (replaced by OpenClaw)
- `app/services/tts.py` — Server-side TTS (replaced by client-side)
- `app/mcp/` — MCP client (replaced by OpenClaw tools)
- FastRTC dependencies from pyproject.toml

**Add:**
- `app/services/openclaw.py` — OpenClaw proxy client
- `app/api/endpoints/ws.py` — WebSocket endpoint for Mac app
- `app/services/sessions.py` — User → OpenClaw session mapping

**Keep:**
- `app/api/endpoints/auth.py` — Auth + OAuth connectors
- `app/services/auth.py` — Auth service
- `app/services/users.py` — User management
- `app/models/` — User + Conversation models
- `app/core/` — Config, containers, middleware
