/**
 * Google plugin for Aware
 * Registers Gmail and Calendar tools with the agent
 */

import type { AnyAgentTool } from "../agents/tools/common.js";
import type { OpenClawPluginToolContext } from "../plugins/types.js";
import { initGoogleAuth, hasValidTokens, getAuthUrl } from "./oauth.js";
import * as gmail from "./gmail.js";
import * as calendar from "./calendar.js";

// Cache the initialized state
let isInitialized = false;

/**
 * Initialize Google integration
 */
export function initGooglePlugin(params: {
  clientId: string;
  clientSecret: string;
  dataDir: string;
}): void {
  if (isInitialized) return;

  initGoogleAuth({ clientId: params.clientId, clientSecret: params.clientSecret }, params.dataDir);
  isInitialized = true;
  console.log("[google] Plugin initialized");
}

/**
 * Create Google tools for the agent
 */
export function createGoogleTools(ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  // Check if Google is configured
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // Google not configured, return empty array
    return [];
  }

  // Initialize on first tool creation
  const dataDir = ctx.workspaceDir || process.env.OPENCLAW_STATE_DIR || "/data";
  initGooglePlugin({ clientId, clientSecret, dataDir });

  const tools: AnyAgentTool[] = [];

  // Gmail List Tool
  tools.push({
    name: "gmail_list",
    description: "List recent emails from Gmail inbox. Returns subject, from, date, and snippet.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Gmail search query (e.g., 'in:inbox', 'from:example@gmail.com'). Default: 'in:inbox'",
        },
        maxResults: {
          type: "number",
          description: "Maximum emails to return (1-50). Default: 10",
        },
      },
    },
    execute: async ({ input }) => {
      if (!hasValidTokens()) {
        return JSON.stringify({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const query = (input as { query?: string }).query || "in:inbox";
      const maxResults = Math.min(
        50,
        Math.max(1, (input as { maxResults?: number }).maxResults || 10),
      );
      const emails = await gmail.listEmails({ query, maxResults });
      return JSON.stringify({ emails, count: emails.length });
    },
  });

  // Gmail Read Tool
  tools.push({
    name: "gmail_read",
    description: "Read the full content of a specific email by its ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        messageId: {
          type: "string",
          description: "The email message ID to read",
        },
      },
      required: ["messageId"],
    },
    execute: async ({ input }) => {
      if (!hasValidTokens()) {
        return JSON.stringify({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const email = await gmail.getEmail((input as { messageId: string }).messageId, true);
      return JSON.stringify(email || { error: "Email not found" });
    },
  });

  // Gmail Send Tool
  tools.push({
    name: "gmail_send",
    description: "Send an email via Gmail.",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body (plain text)" },
        cc: { type: "string", description: "CC recipients" },
      },
      required: ["to", "subject", "body"],
    },
    execute: async ({ input }) => {
      if (!hasValidTokens()) {
        return JSON.stringify({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const { to, subject, body, cc } = input as {
        to: string;
        subject: string;
        body: string;
        cc?: string;
      };
      const messageId = await gmail.sendEmail({ to, subject, body, cc });
      return JSON.stringify({ success: true, messageId });
    },
  });

  // Gmail Search Tool
  tools.push({
    name: "gmail_search",
    description: "Search emails using Gmail query syntax.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Gmail search query" },
        maxResults: { type: "number", description: "Max results (1-50)" },
      },
      required: ["query"],
    },
    execute: async ({ input }) => {
      if (!hasValidTokens()) {
        return JSON.stringify({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const { query, maxResults } = input as { query: string; maxResults?: number };
      const emails = await gmail.searchEmails(query, maxResults || 10);
      return JSON.stringify({ emails, count: emails.length });
    },
  });

  // Gmail Unread Count
  tools.push({
    name: "gmail_unread_count",
    description: "Get count of unread emails in inbox.",
    inputSchema: { type: "object" as const, properties: {} },
    execute: async () => {
      if (!hasValidTokens()) {
        return JSON.stringify({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const count = await gmail.getUnreadCount();
      return JSON.stringify({ unreadCount: count });
    },
  });

  // Calendar Today
  tools.push({
    name: "calendar_today",
    description: "Get today's calendar events.",
    inputSchema: { type: "object" as const, properties: {} },
    execute: async () => {
      if (!hasValidTokens()) {
        return JSON.stringify({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const events = await calendar.getTodayEvents();
      return JSON.stringify({ events, count: events.length });
    },
  });

  // Calendar List
  tools.push({
    name: "calendar_list",
    description: "List upcoming calendar events.",
    inputSchema: {
      type: "object" as const,
      properties: {
        days: { type: "number", description: "Days ahead (1-30). Default: 7" },
      },
    },
    execute: async ({ input }) => {
      if (!hasValidTokens()) {
        return JSON.stringify({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const days = Math.min(30, Math.max(1, (input as { days?: number }).days || 7));
      const events = await calendar.getUpcomingEvents(days);
      return JSON.stringify({ events, count: events.length });
    },
  });

  // Calendar Create
  tools.push({
    name: "calendar_create",
    description: "Create a calendar event.",
    inputSchema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "Event title" },
        start: { type: "string", description: "Start time (ISO format)" },
        end: { type: "string", description: "End time (ISO format)" },
        description: { type: "string", description: "Event description" },
        location: { type: "string", description: "Event location" },
      },
      required: ["summary", "start", "end"],
    },
    execute: async ({ input }) => {
      if (!hasValidTokens()) {
        return JSON.stringify({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const { summary, start, end, description, location } = input as {
        summary: string;
        start: string;
        end: string;
        description?: string;
        location?: string;
      };
      const event = await calendar.createEvent({ summary, start, end, description, location });
      return JSON.stringify({ success: true, event });
    },
  });

  // Calendar Delete
  tools.push({
    name: "calendar_delete",
    description: "Delete a calendar event by ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        eventId: { type: "string", description: "Event ID to delete" },
      },
      required: ["eventId"],
    },
    execute: async ({ input }) => {
      if (!hasValidTokens()) {
        return JSON.stringify({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      await calendar.deleteEvent((input as { eventId: string }).eventId);
      return JSON.stringify({ success: true });
    },
  });

  return tools;
}

/**
 * Google tool factory for plugin registration
 */
export function googleToolFactory(ctx: OpenClawPluginToolContext): AnyAgentTool[] | null {
  // Check if Google is configured
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("[google] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET, skipping tools");
    return null;
  }

  // Initialize on first tool creation
  const dataDir = ctx.workspaceDir || process.env.OPENCLAW_STATE_DIR || "/data";
  initGooglePlugin({ clientId, clientSecret, dataDir });

  return createGoogleTools(ctx);
}
