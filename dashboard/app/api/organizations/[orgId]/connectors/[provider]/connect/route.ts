import { NextRequest, NextResponse } from "next/server";
import { requireOrgMembership, errorResponse } from "@/lib/api-helpers";

type RouteContext = { params: Promise<{ orgId: string; provider: string }> };

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

const MICROSOFT_SCOPES = [
  "Files.ReadWrite.All",
  "Sites.ReadWrite.All",
  "Mail.ReadWrite",
  "Calendars.ReadWrite",
  "offline_access",
  "openid",
  "profile",
  "email",
];

/**
 * GET /api/organizations/[orgId]/connectors/[provider]/connect
 * Initiate OAuth flow — redirects to provider auth URL.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { orgId, provider } = await context.params;
    await requireOrgMembership(orgId, ["owner", "admin"]);

    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (!baseUrl) {
      return NextResponse.json(
        { error: "Server misconfiguration: missing base URL" },
        { status: 500 },
      );
    }

    const callbackUrl = `${baseUrl}/api/organizations/${orgId}/connectors/${provider}/callback`;
    const state = Buffer.from(JSON.stringify({ orgId, provider })).toString(
      "base64url",
    );

    if (provider === "google") {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) {
        return NextResponse.json(
          { error: "Google OAuth is not configured" },
          { status: 500 },
        );
      }

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        state,
      });

      return NextResponse.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      );
    }

    if (provider === "microsoft") {
      const clientId = process.env.MICROSOFT_CLIENT_ID;
      const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
      if (!clientId) {
        return NextResponse.json(
          { error: "Microsoft OAuth is not configured" },
          { status: 500 },
        );
      }

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: "code",
        scope: MICROSOFT_SCOPES.join(" "),
        response_mode: "query",
        state,
      });

      return NextResponse.redirect(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`,
      );
    }

    return NextResponse.json(
      { error: "Invalid provider. Must be 'google' or 'microsoft'" },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
