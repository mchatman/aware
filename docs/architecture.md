# Aware — Architecture

## Overview

Aware is a B2B voice AI assistant that lives in the Mac notch. The architecture:

- **Mac App (SwiftUI)** — The product. Voice assistant + all management (auth, billing, team, connectors, settings)
- **Backend API (Next.js)** — Auth, billing, team management, OAuth connectors, OpenClaw proxy. API routes only — no web UI.
- **OpenClaw Gateway (Node.js)** — AI agent, LLM orchestration, tools, memory, streaming
- **Marketing Website** — Docs, company info, download link. Separate from the product.

Voice processing (STT + TTS) happens on-device — no server-side audio.

## Monorepo Structure

```
mchatman/aware
├── dashboard/           # Backend API (Next.js — API routes only)
│   ├── app/api/         # API routes
│   ├── lib/db/          # Drizzle schema + migrations
│   ├── lib/auth.ts      # Auth.js config
│   ├── lib/stripe.ts    # Stripe helpers
│   └── lib/openclaw.ts  # OpenClaw client
├── apps/
│   ├── macos/           # Mac app (SwiftUI)
│   ├── ios/             # iOS app (future)
│   └── android/         # Android app (future)
├── src/                 # OpenClaw gateway (Node.js)
├── Swabble/             # Swift package
└── docker-compose.yml   # Full stack orchestration
```

## API Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/*` | GET/POST | Auth.js (sign up, sign in, OAuth) |
| `/api/organizations` | GET/POST | List/create orgs |
| `/api/organizations/[orgId]` | GET/PATCH/DELETE | Org CRUD |
| `/api/organizations/[orgId]/members` | GET | List members |
| `/api/organizations/[orgId]/members/[id]` | PATCH/DELETE | Manage members |
| `/api/organizations/[orgId]/invitations` | GET/POST | List/create invites |
| `/api/organizations/[orgId]/connectors/[provider]/connect` | GET | Start OAuth flow |
| `/api/organizations/[orgId]/connectors/[provider]/callback` | GET | OAuth callback |
| `/api/organizations/[orgId]/billing/checkout` | POST | Stripe checkout |
| `/api/organizations/[orgId]/billing/portal` | POST | Stripe portal |
| `/api/organizations/[orgId]/analytics` | GET | Usage stats |
| `/api/chat` | POST | OpenClaw proxy (SSE streaming) |
| `/api/stripe/webhook` | POST | Stripe events |
