/**
 * OAuth token refresh service for the Aware API.
 * Exchanges a stored refresh_token for a fresh access_token
 * via the provider's token endpoint, then updates the DB.
 * @module
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db/connection.js";
import { oauthAccounts, type OAuthAccount } from "../db/schema.js";
import { getProviderConfig } from "../config/oauth-providers.js";

/** Shape returned by OAuth provider token endpoints. */
interface TokenRefreshResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Refresh an OAuth access token using the stored refresh_token.
 * Updates the oauthAccounts row with the new token data.
 *
 * @param account - The OAuth account row containing the refresh_token.
 * @returns The fresh access token and its expiry.
 * @throws If the account has no refresh_token, provider is unknown,
 *         credentials are missing, or the provider rejects the request.
 */
export async function refreshOAuthToken(
  account: OAuthAccount,
): Promise<{ accessToken: string; expiresAt: Date }> {
  if (!account.refreshToken) {
    throw new Error("No refresh token available for this account");
  }

  const config = getProviderConfig(account.provider);
  if (!config) {
    throw new Error(`Unknown OAuth provider: ${account.provider}`);
  }

  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];

  if (!clientId || !clientSecret) {
    throw new Error(`OAuth credentials not configured for provider: ${account.provider}`);
  }

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed for ${account.provider} (${res.status}): ${text}`);
  }

  const tokens = (await res.json()) as TokenRefreshResponse;

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : new Date(Date.now() + 3600 * 1000); // default 1 hour

  const db = getDb();
  await db
    .update(oauthAccounts)
    .set({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? account.refreshToken,
      expiresAt,
      scope: tokens.scope ?? account.scope,
      updatedAt: new Date(),
    })
    .where(eq(oauthAccounts.id, account.id));

  return { accessToken: tokens.access_token, expiresAt };
}
