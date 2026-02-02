/**
 * Shared OAuth provider configuration used by OAuth routes
 * and the token-refresh service.
 * @module
 */

/** Shape of an OAuth provider's endpoints and credentials. */
export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  defaultScopes: string[];
}

/** Supported OAuth providers keyed by enum value. */
export const PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    defaultScopes: [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
  },
  microsoft: {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
    defaultScopes: ["openid", "profile", "email", "offline_access"],
  },
};

/**
 * Look up provider config by name.
 * Returns `undefined` for unknown providers.
 */
export function getProviderConfig(provider: string): OAuthProviderConfig | undefined {
  return PROVIDERS[provider];
}
