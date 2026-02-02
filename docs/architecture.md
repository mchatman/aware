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

## Monorepo Structure

```
mchatman/aware
├── apps/
│   ├── macos/          # Mac app (Swift, notch UI)
│   ├── ios/            # iOS app
│   └── android/        # Android app
├── bluefairy/          # FastAPI backend
│   ├── app/
│   │   ├── api/        # Endpoints (auth, WebSocket)
│   │   ├── core/       # Config, DI containers, middleware
│   │   ├── models/     # SQLAlchemy models (User, Conversation)
│   │   ├── services/   # OpenClaw proxy, sessions, auth
│   │   └── repositories/
│   ├── main.py
│   ├── pyproject.toml
│   └── Dockerfile
├── src/                # OpenClaw gateway (Node.js)
├── docs/
│   └── architecture.md # This file
└── docker-compose.yml  # Full stack orchestration
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

## Deployment

### Development (docker-compose)

```bash
docker compose up
```

Runs all services locally: BlueFairy, OpenClaw, Postgres, Redis.

### Production (single VPS)

Estimated cost: $10-30/month (Hetzner/DigitalOcean)

Same docker-compose with Nginx for TLS termination + reverse proxy.
