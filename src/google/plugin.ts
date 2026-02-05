/**
 * Google plugin for Aware
 * Registers Gmail and Calendar tools with the agent
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { jsonResult, readStringParam, readNumberParam } from "../agents/tools/common.js";
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

// Schema definitions
const GmailListSchema = Type.Object({
  query: Type.Optional(
    Type.String({
      description:
        "Gmail search query (e.g., 'in:inbox', 'from:example@gmail.com'). Default: 'in:inbox'",
    }),
  ),
  maxResults: Type.Optional(
    Type.Number({
      description: "Maximum emails to return (1-50). Default: 10",
      minimum: 1,
      maximum: 50,
    }),
  ),
});

const GmailReadSchema = Type.Object({
  messageId: Type.String({ description: "The email message ID to read" }),
});

const GmailSendSchema = Type.Object({
  to: Type.String({ description: "Recipient email address" }),
  subject: Type.String({ description: "Email subject" }),
  body: Type.String({ description: "Email body (plain text)" }),
  cc: Type.Optional(Type.String({ description: "CC recipients" })),
});

const GmailSearchSchema = Type.Object({
  query: Type.String({ description: "Gmail search query" }),
  maxResults: Type.Optional(
    Type.Number({ description: "Max results (1-50)", minimum: 1, maximum: 50 }),
  ),
});

const CalendarListSchema = Type.Object({
  days: Type.Optional(
    Type.Number({ description: "Days ahead (1-30). Default: 7", minimum: 1, maximum: 30 }),
  ),
});

const CalendarCreateSchema = Type.Object({
  summary: Type.String({ description: "Event title" }),
  start: Type.String({ description: "Start time (ISO format)" }),
  end: Type.String({ description: "End time (ISO format)" }),
  description: Type.Optional(Type.String({ description: "Event description" })),
  location: Type.Optional(Type.String({ description: "Event location" })),
});

const CalendarDeleteSchema = Type.Object({
  eventId: Type.String({ description: "Event ID to delete" }),
});

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
  // Use OPENCLAW_STATE_DIR or /data for tokens (not workspaceDir, which is for agent files)
  const dataDir = process.env.OPENCLAW_STATE_DIR || "/data";
  initGooglePlugin({ clientId, clientSecret, dataDir });

  const tools: AnyAgentTool[] = [];

  // Gmail List Tool
  tools.push({
    label: "Gmail List",
    name: "gmail_list",
    description: "List recent emails from Gmail inbox. Returns subject, from, date, and snippet.",
    parameters: GmailListSchema,
    execute: async (_toolCallId, args) => {
      if (!hasValidTokens()) {
        return jsonResult({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query") || "in:inbox";
      const maxResults = Math.min(50, Math.max(1, readNumberParam(params, "maxResults") || 10));
      const emails = await gmail.listEmails({ query, maxResults });
      return jsonResult({ emails, count: emails.length });
    },
  });

  // Gmail Read Tool
  tools.push({
    label: "Gmail Read",
    name: "gmail_read",
    description: "Read the full content of a specific email by its ID.",
    parameters: GmailReadSchema,
    execute: async (_toolCallId, args) => {
      if (!hasValidTokens()) {
        return jsonResult({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const params = args as Record<string, unknown>;
      const messageId = readStringParam(params, "messageId", { required: true });
      const email = await gmail.getEmail(messageId, true);
      return jsonResult(email || { error: "Email not found" });
    },
  });

  // Gmail Send Tool
  tools.push({
    label: "Gmail Send",
    name: "gmail_send",
    description: "Send an email via Gmail.",
    parameters: GmailSendSchema,
    execute: async (_toolCallId, args) => {
      if (!hasValidTokens()) {
        return jsonResult({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const params = args as Record<string, unknown>;
      const to = readStringParam(params, "to", { required: true });
      const subject = readStringParam(params, "subject", { required: true });
      const body = readStringParam(params, "body", { required: true });
      const cc = readStringParam(params, "cc");
      const messageId = await gmail.sendEmail({ to, subject, body, cc });
      return jsonResult({ success: true, messageId });
    },
  });

  // Gmail Search Tool
  tools.push({
    label: "Gmail Search",
    name: "gmail_search",
    description: "Search emails using Gmail query syntax.",
    parameters: GmailSearchSchema,
    execute: async (_toolCallId, args) => {
      if (!hasValidTokens()) {
        return jsonResult({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults") || 10;
      const emails = await gmail.searchEmails(query, maxResults);
      return jsonResult({ emails, count: emails.length });
    },
  });

  // Gmail Unread Count
  tools.push({
    label: "Gmail Unread Count",
    name: "gmail_unread_count",
    description: "Get count of unread emails in inbox.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!hasValidTokens()) {
        return jsonResult({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const count = await gmail.getUnreadCount();
      return jsonResult({ unreadCount: count });
    },
  });

  // Calendar Today
  tools.push({
    label: "Calendar Today",
    name: "calendar_today",
    description: "Get today's calendar events.",
    parameters: Type.Object({}),
    execute: async () => {
      if (!hasValidTokens()) {
        return jsonResult({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const events = await calendar.getTodayEvents();
      return jsonResult({ events, count: events.length });
    },
  });

  // Calendar List
  tools.push({
    label: "Calendar List",
    name: "calendar_list",
    description: "List upcoming calendar events.",
    parameters: CalendarListSchema,
    execute: async (_toolCallId, args) => {
      if (!hasValidTokens()) {
        return jsonResult({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const params = args as Record<string, unknown>;
      const days = Math.min(30, Math.max(1, readNumberParam(params, "days") || 7));
      const events = await calendar.getUpcomingEvents(days);
      return jsonResult({ events, count: events.length });
    },
  });

  // Calendar Create
  tools.push({
    label: "Calendar Create",
    name: "calendar_create",
    description: "Create a calendar event.",
    parameters: CalendarCreateSchema,
    execute: async (_toolCallId, args) => {
      if (!hasValidTokens()) {
        return jsonResult({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const params = args as Record<string, unknown>;
      const summary = readStringParam(params, "summary", { required: true });
      const start = readStringParam(params, "start", { required: true });
      const end = readStringParam(params, "end", { required: true });
      const description = readStringParam(params, "description");
      const location = readStringParam(params, "location");
      const event = await calendar.createEvent({ summary, start, end, description, location });
      return jsonResult({ success: true, event });
    },
  });

  // Calendar Delete
  tools.push({
    label: "Calendar Delete",
    name: "calendar_delete",
    description: "Delete a calendar event by ID.",
    parameters: CalendarDeleteSchema,
    execute: async (_toolCallId, args) => {
      if (!hasValidTokens()) {
        return jsonResult({ error: "Google not authenticated", authUrl: getAuthUrl() });
      }
      const params = args as Record<string, unknown>;
      const eventId = readStringParam(params, "eventId", { required: true });
      await calendar.deleteEvent(eventId);
      return jsonResult({ success: true });
    },
  });

  return tools;
}

/**
 * Google tool factory for plugin registration (unused, we integrate directly)
 */
export function googleToolFactory(ctx: OpenClawPluginToolContext): AnyAgentTool[] | null {
  return createGoogleTools(ctx);
}
