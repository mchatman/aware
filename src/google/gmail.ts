/**
 * Gmail API wrapper for Aware
 */

import { google, gmail_v1 } from "googleapis";
import { getOAuth2Client, hasValidTokens } from "./oauth.js";

let gmailClient: gmail_v1.Gmail | null = null;

function getGmailClient(): gmail_v1.Gmail {
  if (!hasValidTokens()) {
    throw new Error("Google not authenticated. Please complete OAuth flow first.");
  }

  if (!gmailClient) {
    gmailClient = google.gmail({ version: "v1", auth: getOAuth2Client() });
  }
  return gmailClient;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body?: string;
  labels: string[];
}

export interface EmailListOptions {
  maxResults?: number;
  query?: string;
  labelIds?: string[];
}

/**
 * List emails matching criteria
 */
export async function listEmails(options: EmailListOptions = {}): Promise<EmailMessage[]> {
  const gmail = getGmailClient();
  const { maxResults = 10, query = "in:inbox", labelIds } = options;

  const response = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: query,
    labelIds,
  });

  const messages = response.data.messages || [];
  const emails: EmailMessage[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;
    const email = await getEmail(msg.id, false);
    if (email) emails.push(email);
  }

  return emails;
}

/**
 * Get a single email by ID
 */
export async function getEmail(
  messageId: string,
  includeBody = true,
): Promise<EmailMessage | null> {
  const gmail = getGmailClient();

  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: includeBody ? "full" : "metadata",
    metadataHeaders: ["Subject", "From", "To", "Date"],
  });

  const msg = response.data;
  if (!msg.id || !msg.threadId) return null;

  const headers = msg.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

  let body = "";
  if (includeBody && msg.payload) {
    body = extractBody(msg.payload);
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    snippet: msg.snippet || "",
    subject: getHeader("Subject"),
    from: getHeader("From"),
    to: getHeader("To"),
    date: getHeader("Date"),
    body,
    labels: msg.labelIds || [],
  };
}

/**
 * Extract plain text body from email payload
 */
function extractBody(payload: gmail_v1.Schema$MessagePart): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const body = extractBody(part);
      if (body) return body;
    }
  }

  // Fallback to HTML if no plain text
  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = Buffer.from(payload.body.data, "base64").toString("utf-8");
    // Basic HTML stripping
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  return "";
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  threadId?: string;
}

/**
 * Send an email
 */
export async function sendEmail(options: SendEmailOptions): Promise<string> {
  const gmail = getGmailClient();
  const { to, subject, body, cc, bcc, replyTo, threadId } = options;

  // Build RFC 2822 message
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ];

  if (cc) messageParts.push(`Cc: ${cc}`);
  if (bcc) messageParts.push(`Bcc: ${bcc}`);
  if (replyTo) messageParts.push(`In-Reply-To: ${replyTo}`);

  messageParts.push("", body);

  const rawMessage = messageParts.join("\r\n");
  const encodedMessage = Buffer.from(rawMessage).toString("base64url");

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedMessage,
      threadId,
    },
  });

  return response.data.id || "";
}

/**
 * Search emails with Gmail query syntax
 */
export async function searchEmails(query: string, maxResults = 10): Promise<EmailMessage[]> {
  return listEmails({ query, maxResults });
}

/**
 * Get unread email count
 */
export async function getUnreadCount(): Promise<number> {
  const gmail = getGmailClient();

  const response = await gmail.users.labels.get({
    userId: "me",
    id: "INBOX",
  });

  return response.data.messagesUnread || 0;
}

/**
 * Mark email as read
 */
export async function markAsRead(messageId: string): Promise<void> {
  const gmail = getGmailClient();

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["UNREAD"],
    },
  });
}

/**
 * Archive an email (remove from inbox)
 */
export async function archiveEmail(messageId: string): Promise<void> {
  const gmail = getGmailClient();

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["INBOX"],
    },
  });
}
