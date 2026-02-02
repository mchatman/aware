import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { connectors } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgMembership, errorResponse } from "@/lib/api-helpers";
import crypto from "crypto";

type RouteContext = { params: Promise<{ orgId: string; provider: string }> };

/**
 * GET /api/organizations/[orgId]/connectors/[provider]/callback
 * Handle OAuth callback — exchange code for tokens, store in connectors table.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { orgId, provider } = await context.params;
    const { user } = await requireOrgMembership(orgId, ["owner", "admin"]);

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
    const dashboardUrl = `${baseUrl}/${orgId}/settings/connectors`;

    if (error) {
      return NextResponse.redirect(
        `${dashboardUrl}?error=${encodeURIComponent(error)}`,
      );
    }

    if (!code) {
      return NextResponse.redirect(`${dashboardUrl}?error=no_code`);
    }

    const callbackUrl = `${baseUrl}/api/organizations/${orgId}/connectors/${provider}/callback`;
    let tokenData: {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (provider === "google") {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: callbackUrl,
          grant_type: "authorization_code",
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error("Google token exchange failed:", errorBody);
        return NextResponse.redirect(
          `${dashboardUrl}?error=token_exchange_failed`,
        );
      }

      tokenData = await response.json();
    } else if (provider === "microsoft") {
      const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
      const response = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: process.env.MICROSOFT_CLIENT_ID!,
            client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
            redirect_uri: callbackUrl,
            grant_type: "authorization_code",
          }),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        console.error("Microsoft token exchange failed:", errorBody);
        return NextResponse.redirect(
          `${dashboardUrl}?error=token_exchange_failed`,
        );
      }

      tokenData = await response.json();
    } else {
      return NextResponse.redirect(`${dashboardUrl}?error=invalid_provider`);
    }

    const tokenExpiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    // Upsert the connector
    const existing = await db
      .select({ id: connectors.id })
      .from(connectors)
      .where(
        and(eq(connectors.orgId, orgId), eq(connectors.provider, provider as "google" | "microsoft")),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (existing) {
      await db
        .update(connectors)
        .set({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || null,
          tokenExpiresAt,
          scopes: tokenData.scope || null,
          connectedById: user.id!,
          updatedAt: new Date(),
        })
        .where(eq(connectors.id, existing.id));
    } else {
      await db.insert(connectors).values({
        id: crypto.randomUUID(),
        orgId,
        provider: provider as "google" | "microsoft",
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        tokenExpiresAt,
        scopes: tokenData.scope || null,
        connectedById: user.id!,
      });
    }

    return NextResponse.redirect(`${dashboardUrl}?connected=${provider}`);
  } catch (error) {
    console.error("OAuth callback error:", error);
    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
    return NextResponse.redirect(
      `${baseUrl}/settings/connectors?error=callback_failed`,
    );
  }
}
