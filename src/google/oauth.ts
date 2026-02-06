/**
 * Google OAuth 2.0 authentication
 *
 * Supports two modes:
 * 1. Local tokens (from CLI auth or file)
 * 2. Remote tokens (fetched from control plane for multi-tenant)
 */

import fs from "node:fs";
import path from "node:path";
import { google, Auth } from "googleapis";

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
}

// Use the Credentials type from googleapis
export type TokenData = Auth.Credentials;

// OAuth scopes needed for Gmail and Calendar
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

let oauth2Client: Auth.OAuth2Client | null = null;
let tokenPath: string = "";
let authConfig: GoogleAuthConfig | null = null;
let controlPlaneUrl: string | null = null;
let gatewayToken: string | null = null;
let remoteFetchAttempted = false;

/**
 * Initialize the OAuth client
 */
export function initGoogleAuth(config: GoogleAuthConfig, dataDir: string): void {
  authConfig = config;
  tokenPath = path.join(dataDir, "google-tokens.json");

  // Get control plane config for remote token fetching
  controlPlaneUrl = process.env.CONTROL_PLANE_URL || null;
  gatewayToken = process.env.AWARE_GATEWAY_TOKEN || null;

  oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    "urn:ietf:wg:oauth:2.0:oob", // Out-of-band redirect for CLI apps
  );

  // Try to load existing tokens
  loadTokens();

  // Set up token refresh callback
  oauth2Client.on("tokens", (tokens: TokenData) => {
    console.log("[google] Tokens refreshed");
    if (tokens.refresh_token) {
      saveTokens(tokens);
    } else {
      // Merge with existing tokens to keep refresh_token
      const existing = loadTokensFromFile();
      if (existing) {
        saveTokens({ ...existing, ...tokens });
      }
    }
  });
}

/**
 * Load tokens from file
 */
function loadTokensFromFile(): TokenData | null {
  try {
    if (fs.existsSync(tokenPath)) {
      const data = fs.readFileSync(tokenPath, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("[google] Failed to load tokens:", err);
  }
  return null;
}

/**
 * Load tokens and set on client
 */
function loadTokens(): void {
  const tokens = loadTokensFromFile();
  if (tokens && oauth2Client) {
    oauth2Client.setCredentials(tokens);
    console.log("[google] Loaded existing tokens");
  }
}

/**
 * Save tokens to file
 */
function saveTokens(tokens: TokenData): void {
  try {
    const dir = path.dirname(tokenPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    console.log("[google] Tokens saved");
  } catch (err) {
    console.error("[google] Failed to save tokens:", err);
  }
}

/**
 * Fetch tokens from control plane (for multi-tenant)
 */
async function fetchRemoteTokens(): Promise<TokenData | null> {
  if (!controlPlaneUrl || !gatewayToken) {
    console.log("[google] Control plane not configured, skipping remote fetch");
    return null;
  }

  try {
    console.log(`[google] Fetching tokens from control plane: ${controlPlaneUrl}`);
    const response = await fetch(`${controlPlaneUrl}/internal/google/tokens`, {
      headers: { Authorization: `Bearer ${gatewayToken}` },
    });

    if (!response.ok) {
      const text = await response.text();
      console.log(`[google] Control plane returned ${response.status}: ${text}`);
      return null;
    }

    const data = await response.json();
    if (!data.accessToken) {
      console.log("[google] No tokens returned from control plane");
      return null;
    }

    console.log(`[google] Got tokens from control plane for ${data.googleEmail}`);

    // Convert to TokenData format
    const tokens: TokenData = {
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
      expiry_date: new Date(data.expiresAt).getTime(),
    };

    return tokens;
  } catch (err) {
    console.error("[google] Failed to fetch from control plane:", err);
    return null;
  }
}

/**
 * Ensure we have valid tokens, fetching from control plane if needed
 */
async function ensureTokens(): Promise<boolean> {
  if (!oauth2Client) return false;

  // Check if we have local tokens
  const creds = oauth2Client.credentials;
  if (creds.access_token || creds.refresh_token) {
    return true;
  }

  // Try to fetch from control plane (only once per session to avoid spam)
  if (!remoteFetchAttempted) {
    remoteFetchAttempted = true;
    const remoteTokens = await fetchRemoteTokens();
    if (remoteTokens) {
      oauth2Client.setCredentials(remoteTokens);
      saveTokens(remoteTokens);
      return true;
    }
  }

  return false;
}

/**
 * Get the authorization URL for initial auth
 */
export function getAuthUrl(): string {
  if (!oauth2Client) {
    throw new Error("Google auth not initialized");
  }
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // Force consent to get refresh token
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(code: string): Promise<TokenData> {
  if (!oauth2Client) {
    throw new Error("Google auth not initialized");
  }

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  saveTokens(tokens);
  return tokens;
}

/**
 * Check if we have valid tokens (async version that may fetch remote)
 */
export async function ensureValidTokens(): Promise<boolean> {
  return ensureTokens();
}

/**
 * Check if we have valid tokens (sync check only, no remote fetch)
 */
export function hasValidTokens(): boolean {
  if (!oauth2Client) return false;
  const creds = oauth2Client.credentials;
  return !!(creds.access_token || creds.refresh_token);
}

/**
 * Get the OAuth client for making API calls
 */
export function getOAuth2Client(): Auth.OAuth2Client {
  if (!oauth2Client) {
    throw new Error("Google auth not initialized");
  }
  return oauth2Client;
}

/**
 * Set tokens directly (e.g., from gog keyring)
 */
export function setTokens(tokens: TokenData): void {
  if (!oauth2Client) {
    throw new Error("Google auth not initialized");
  }
  oauth2Client.setCredentials(tokens);
  saveTokens(tokens);
}

/**
 * Clear tokens (logout)
 */
export function clearTokens(): void {
  if (oauth2Client) {
    oauth2Client.setCredentials({});
  }
  remoteFetchAttempted = false; // Allow re-fetching
  try {
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
    }
  } catch {
    // ignore
  }
}

/**
 * Force re-fetch from control plane on next check
 */
export function invalidateTokenCache(): void {
  remoteFetchAttempted = false;
}
