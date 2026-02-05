/**
 * Google OAuth 2.0 authentication
 *
 * Uses googleapis directly for OAuth (no separate google-auth-library needed)
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

/**
 * Initialize the OAuth client
 */
export function initGoogleAuth(config: GoogleAuthConfig, dataDir: string): void {
  authConfig = config;
  tokenPath = path.join(dataDir, "google-tokens.json");

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
 * Check if we have valid tokens
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
  try {
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
    }
  } catch {
    // ignore
  }
}
