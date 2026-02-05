/**
 * Google tools registration for Aware
 * These tools are available to the AI agent without requiring exec approval
 */

import * as gmail from "./gmail.js";
import * as calendar from "./calendar.js";
import { hasValidTokens, getAuthUrl } from "./oauth.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Gmail tools
 */
const gmailListTool: ToolDefinition = {
  name: "gmail_list",
  description:
    "List recent emails from Gmail inbox. Returns subject, from, date, and snippet for each email.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Gmail search query (e.g., 'in:inbox', 'from:example@gmail.com', 'is:unread'). Default: 'in:inbox'",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of emails to return (1-50). Default: 10",
      },
    },
  },
  handler: async (params) => {
    if (!hasValidTokens()) {
      return { error: "Google not authenticated", authUrl: getAuthUrl() };
    }
    const query = (params.query as string) || "in:inbox";
    const maxResults = Math.min(50, Math.max(1, (params.maxResults as number) || 10));
    const emails = await gmail.listEmails({ query, maxResults });
    return { emails, count: emails.length };
  },
};

const gmailReadTool: ToolDefinition = {
  name: "gmail_read",
  description: "Read the full content of a specific email by its ID.",
  parameters: {
    type: "object",
    properties: {
      messageId: {
        type: "string",
        description: "The email message ID to read",
      },
    },
    required: ["messageId"],
  },
  handler: async (params) => {
    if (!hasValidTokens()) {
      return { error: "Google not authenticated", authUrl: getAuthUrl() };
    }
    const email = await gmail.getEmail(params.messageId as string, true);
    return email || { error: "Email not found" };
  },
};

const gmailSendTool: ToolDefinition = {
  name: "gmail_send",
  description: "Send an email via Gmail.",
  parameters: {
    type: "object",
    properties: {
      to: {
        type: "string",
        description: "Recipient email address",
      },
      subject: {
        type: "string",
        description: "Email subject line",
      },
      body: {
        type: "string",
        description: "Email body (plain text)",
      },
      cc: {
        type: "string",
        description: "CC recipients (comma-separated)",
      },
    },
    required: ["to", "subject", "body"],
  },
  handler: async (params) => {
    if (!hasValidTokens()) {
      return { error: "Google not authenticated", authUrl: getAuthUrl() };
    }
    const messageId = await gmail.sendEmail({
      to: params.to as string,
      subject: params.subject as string,
      body: params.body as string,
      cc: params.cc as string | undefined,
    });
    return { success: true, messageId };
  },
};

const gmailSearchTool: ToolDefinition = {
  name: "gmail_search",
  description: "Search emails using Gmail query syntax.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Gmail search query (e.g., 'from:john subject:meeting newer_than:7d')",
      },
      maxResults: {
        type: "number",
        description: "Maximum results (1-50). Default: 10",
      },
    },
    required: ["query"],
  },
  handler: async (params) => {
    if (!hasValidTokens()) {
      return { error: "Google not authenticated", authUrl: getAuthUrl() };
    }
    const emails = await gmail.searchEmails(
      params.query as string,
      (params.maxResults as number) || 10,
    );
    return { emails, count: emails.length };
  },
};

const gmailUnreadCountTool: ToolDefinition = {
  name: "gmail_unread_count",
  description: "Get the count of unread emails in the inbox.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    if (!hasValidTokens()) {
      return { error: "Google not authenticated", authUrl: getAuthUrl() };
    }
    const count = await gmail.getUnreadCount();
    return { unreadCount: count };
  },
};

/**
 * Calendar tools
 */
const calendarListTool: ToolDefinition = {
  name: "calendar_list",
  description: "List upcoming calendar events.",
  parameters: {
    type: "object",
    properties: {
      days: {
        type: "number",
        description: "Number of days ahead to look (1-30). Default: 7",
      },
      maxResults: {
        type: "number",
        description: "Maximum events to return. Default: 10",
      },
    },
  },
  handler: async (params) => {
    if (!hasValidTokens()) {
      return { error: "Google not authenticated", authUrl: getAuthUrl() };
    }
    const days = Math.min(30, Math.max(1, (params.days as number) || 7));
    const events = await calendar.getUpcomingEvents(days);
    return { events, count: events.length };
  },
};

const calendarTodayTool: ToolDefinition = {
  name: "calendar_today",
  description: "Get today's calendar events.",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    if (!hasValidTokens()) {
      return { error: "Google not authenticated", authUrl: getAuthUrl() };
    }
    const events = await calendar.getTodayEvents();
    return { events, count: events.length };
  },
};

const calendarCreateTool: ToolDefinition = {
  name: "calendar_create",
  description: "Create a new calendar event.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Event title",
      },
      start: {
        type: "string",
        description: "Start time in ISO format (e.g., '2026-02-06T10:00:00-08:00')",
      },
      end: {
        type: "string",
        description: "End time in ISO format",
      },
      description: {
        type: "string",
        description: "Event description",
      },
      location: {
        type: "string",
        description: "Event location",
      },
      attendees: {
        type: "array",
        items: { type: "string" },
        description: "List of attendee email addresses",
      },
    },
    required: ["summary", "start", "end"],
  },
  handler: async (params) => {
    if (!hasValidTokens()) {
      return { error: "Google not authenticated", authUrl: getAuthUrl() };
    }
    const event = await calendar.createEvent({
      summary: params.summary as string,
      start: params.start as string,
      end: params.end as string,
      description: params.description as string | undefined,
      location: params.location as string | undefined,
      attendees: params.attendees as string[] | undefined,
    });
    return { success: true, event };
  },
};

const calendarDeleteTool: ToolDefinition = {
  name: "calendar_delete",
  description: "Delete a calendar event by ID.",
  parameters: {
    type: "object",
    properties: {
      eventId: {
        type: "string",
        description: "The event ID to delete",
      },
    },
    required: ["eventId"],
  },
  handler: async (params) => {
    if (!hasValidTokens()) {
      return { error: "Google not authenticated", authUrl: getAuthUrl() };
    }
    await calendar.deleteEvent(params.eventId as string);
    return { success: true };
  },
};

/**
 * All Google tools
 */
export const googleTools: ToolDefinition[] = [
  gmailListTool,
  gmailReadTool,
  gmailSendTool,
  gmailSearchTool,
  gmailUnreadCountTool,
  calendarListTool,
  calendarTodayTool,
  calendarCreateTool,
  calendarDeleteTool,
];

/**
 * Get tool by name
 */
export function getGoogleTool(name: string): ToolDefinition | undefined {
  return googleTools.find((t) => t.name === name);
}

/**
 * Execute a Google tool by name
 */
export async function executeGoogleTool(
  name: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const tool = getGoogleTool(name);
  if (!tool) {
    throw new Error(`Unknown Google tool: ${name}`);
  }
  return tool.handler(params);
}
