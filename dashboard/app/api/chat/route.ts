import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentSessions, memberships, usageRecords } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, errorResponse, ApiError } from "@/lib/api-helpers";
import crypto from "crypto";

const OPENCLAW_API_URL =
  process.env.OPENCLAW_API_URL || "http://localhost:3001";
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY;

/**
 * POST /api/chat
 * Send a message to OpenClaw and stream the response via SSE.
 * Body: { message: string, orgId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await request.json();

    const { message, orgId } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 },
      );
    }

    if (!orgId || typeof orgId !== "string") {
      return NextResponse.json(
        { error: "orgId is required" },
        { status: 400 },
      );
    }

    // Verify membership
    const membership = await db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.orgId, orgId), eq(memberships.userId, user.id!)),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (!membership) {
      throw new ApiError(403, "You are not a member of this organization");
    }

    // Get or create agent session
    let session = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.orgId, orgId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!session) {
      const sessionKey = `org_${orgId}_${crypto.randomBytes(16).toString("hex")}`;
      [session] = await db
        .insert(agentSessions)
        .values({
          id: crypto.randomUUID(),
          orgId,
          openclawSessionKey: sessionKey,
          config: {},
        })
        .returning();
    }

    // Record the message usage
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];

    await db.insert(usageRecords).values({
      orgId,
      userId: user.id!,
      type: "message",
      count: 1,
      date: todayStr,
    });

    // Send to OpenClaw and stream the response
    const openclawResponse = await fetch(`${OPENCLAW_API_URL}/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(OPENCLAW_API_KEY
          ? { Authorization: `Bearer ${OPENCLAW_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        message,
        sessionKey: session.openclawSessionKey,
        config: session.config,
      }),
    });

    if (!openclawResponse.ok) {
      const errText = await openclawResponse.text();
      console.error("OpenClaw API error:", errText);
      return NextResponse.json(
        { error: "Failed to communicate with AI agent" },
        { status: 502 },
      );
    }

    if (!openclawResponse.body) {
      return NextResponse.json(
        { error: "No response body from AI agent" },
        { status: 502 },
      );
    }

    // Stream the SSE response through to the client
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = openclawResponse.body.getReader();

    let totalTokensIn = 0;
    let totalTokensOut = 0;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });

            // Parse SSE events to track token usage
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.usage) {
                    totalTokensIn += data.usage.prompt_tokens || 0;
                    totalTokensOut += data.usage.completion_tokens || 0;
                  }
                } catch {
                  // Not all SSE data lines are JSON — that's fine
                }
              }
            }

            controller.enqueue(value);
          }

          controller.close();

          // Record token usage after stream completes
          if (totalTokensIn > 0) {
            await db.insert(usageRecords).values({
              orgId,
              userId: user.id!,
              type: "tokens_in",
              count: totalTokensIn,
              date: todayStr,
            });
          }

          if (totalTokensOut > 0) {
            await db.insert(usageRecords).values({
              orgId,
              userId: user.id!,
              type: "tokens_out",
              count: totalTokensOut,
              date: todayStr,
            });
          }
        } catch (err) {
          console.error("Stream error:", err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
