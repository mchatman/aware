#!/usr/bin/env node
/**
 * Standalone node-host binary entry point
 * Build with: bun build src/node-host/standalone.ts --compile --outfile aware-node-host
 */

import { runNodeHost } from "./runner.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: {
    host?: string;
    port?: number;
    tls?: boolean;
    tlsFingerprint?: string;
    nodeId?: string;
    displayName?: string;
  } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--host":
        opts.host = next;
        i++;
        break;
      case "--port":
        opts.port = parseInt(next, 10);
        i++;
        break;
      case "--tls":
        opts.tls = true;
        break;
      case "--tls-fingerprint":
        opts.tlsFingerprint = next;
        opts.tls = true;
        i++;
        break;
      case "--node-id":
        opts.nodeId = next;
        i++;
        break;
      case "--display-name":
        opts.displayName = next;
        i++;
        break;
      case "--help":
      case "-h":
        console.log(`
aware-node-host - OpenClaw node host with browser proxy

Usage:
  aware-node-host [options]

Options:
  --host <host>              Gateway host (default: 127.0.0.1)
  --port <port>              Gateway port (default: 18789)
  --tls                      Use TLS for gateway connection
  --tls-fingerprint <sha256> Expected TLS certificate fingerprint
  --node-id <id>             Override node ID
  --display-name <name>      Override display name
  --help, -h                 Show this help

Environment:
  OPENCLAW_GATEWAY_TOKEN     Gateway authentication token
  OPENCLAW_GATEWAY_PASSWORD  Gateway authentication password
`);
        process.exit(0);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  const host = opts.host || process.env.OPENCLAW_GATEWAY_HOST || "127.0.0.1";
  const port = opts.port || parseInt(process.env.OPENCLAW_GATEWAY_PORT || "18789", 10);
  const tls = opts.tls || process.env.OPENCLAW_GATEWAY_TLS === "true";

  console.log(`[aware-node-host] Connecting to ${tls ? "wss" : "ws"}://${host}:${port}`);

  await runNodeHost({
    gatewayHost: host,
    gatewayPort: port,
    gatewayTls: tls,
    gatewayTlsFingerprint: opts.tlsFingerprint,
    nodeId: opts.nodeId,
    displayName: opts.displayName,
  });
}

main().catch((err) => {
  console.error("[aware-node-host] Fatal error:", err);
  process.exit(1);
});
