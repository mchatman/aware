/**
 * Google OAuth token management for Aware
 * Handles token storage, refresh, and client creation
 */

import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import * as fs from "fs";
import * as path from "path";

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

let oauthClient: OAuth2Client | null = null;
let tokensPath: string = "";

/**
 * Initialize the Google OAuth client
 */
export function initGoogleAuth(config: GoogleAuthConfig, dataDir: string): OAuth2Client {
  const { clientId, clientSecret, redirectUri = "http://localhost" } = config;

  oauthClient = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  tokensPath = path.join(dataDir, "google-tokens.json");

  // Load existing tokens if available
  if (fs.existsSync(tokensPath)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf-8")) as GoogleTokens;
      oauthClient.setCredentials(tokens);
      console.log("[google] Loaded existing tokens");
    } catch (err) {
      console.error("[google] Failed to load tokens:", err);
    }
  }

  // Set up token refresh handler
  oauthClient.on("tokens", (tokens) => {
    console.log("[google] Tokens refreshed");
    saveTokens(tokens as GoogleTokens);
  });

  return oauthClient;
}

/**
 * Get the OAuth client (must be initialized first)
 */
export function getOAuthClient(): OAuth2Client {
  if (!oauthClient) {
    throw new Error("Google OAuth client not initialized. Call initGoogleAuth first.");
  }
  return oauthClient;
}

/**
 * Check if we have valid tokens
 */
export function hasValidTokens(): boolean {
  if (!oauthClient) return false;
  const creds = oauthClient.credentials;
  return !!(creds.access_token && creds.refresh_token);
}

/**
 * Generate authorization URL for OAuth flow
 */
export function getAuthUrl(): string {
  if (!oauthClient) {
    throw new Error("Google OAuth client not initialized");
  }

  return oauthClient.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // Force consent to get refresh token
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  if (!oauthClient) {
    throw new Error("Google OAuth client not initialized");
  }

  const { tokens } = await oauthClient.getToken(code);
  oauthClient.setCredentials(tokens);
  saveTokens(tokens as GoogleTokens);

  return tokens as GoogleTokens;
}

/**
 * Save tokens to disk
 */
function saveTokens(tokens: GoogleTokens): void {
  if (!tokensPath) return;

  try {
    // Merge with existing tokens (preserve refresh_token if not in new tokens)
    let existingTokens: Partial<GoogleTokens> = {};
    if (fs.existsSync(tokensPath)) {
      existingTokens = JSON.parse(fs.readFileSync(tokensPath, "utf-8"));
    }

    const mergedTokens = {
      ...existingTokens,
      ...tokens,
      refresh_token: tokens.refresh_token || existingTokens.refresh_token,
    };

    fs.writeFileSync(tokensPath, JSON.stringify(mergedTokens, null, 2));
    console.log("[google] Tokens saved");
  } catch (err) {
    console.error("[google] Failed to save tokens:", err);
  }
}

/**
 * Clear stored tokens (for logout)
 */
export function clearTokens(): void {
  if (tokensPath && fs.existsSync(tokensPath)) {
    fs.unlinkSync(tokensPath);
  }
  if (oauthClient) {
    oauthClient.setCredentials({});
  }
}

export { SCOPES };
