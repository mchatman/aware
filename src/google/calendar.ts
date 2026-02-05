/**
 * Google Calendar API wrapper for Aware
 */

import { google, calendar_v3 } from "googleapis";
import { getOAuth2Client, hasValidTokens } from "./oauth.js";

let calendarClient: calendar_v3.Calendar | null = null;

function getCalendarClient(): calendar_v3.Calendar {
  if (!hasValidTokens()) {
    throw new Error("Google not authenticated. Please complete OAuth flow first.");
  }

  if (!calendarClient) {
    calendarClient = google.calendar({ version: "v3", auth: getOAuth2Client() });
  }
  return calendarClient;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees?: string[];
  status: string;
  htmlLink?: string;
}

export interface ListEventsOptions {
  calendarId?: string;
  timeMin?: string; // ISO date string
  timeMax?: string; // ISO date string
  maxResults?: number;
  singleEvents?: boolean;
  orderBy?: "startTime" | "updated";
}

/**
 * List calendar events
 */
export async function listEvents(options: ListEventsOptions = {}): Promise<CalendarEvent[]> {
  const calendar = getCalendarClient();
  const {
    calendarId = "primary",
    timeMin = new Date().toISOString(),
    timeMax,
    maxResults = 10,
    singleEvents = true,
    orderBy = "startTime",
  } = options;

  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    maxResults,
    singleEvents,
    orderBy,
  });

  const events = response.data.items || [];
  return events.map(formatEvent);
}

/**
 * Get today's events
 */
export async function getTodayEvents(calendarId = "primary"): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  return listEvents({
    calendarId,
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    maxResults: 50,
  });
}

/**
 * Get upcoming events (next 7 days)
 */
export async function getUpcomingEvents(
  days = 7,
  calendarId = "primary",
): Promise<CalendarEvent[]> {
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + days);

  return listEvents({
    calendarId,
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    maxResults: 50,
  });
}

export interface CreateEventOptions {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO date string or date for all-day
  end: string;
  allDay?: boolean;
  attendees?: string[];
  reminders?: { method: "email" | "popup"; minutes: number }[];
}

/**
 * Create a calendar event
 */
export async function createEvent(options: CreateEventOptions): Promise<CalendarEvent> {
  const calendar = getCalendarClient();
  const {
    calendarId = "primary",
    summary,
    description,
    location,
    start,
    end,
    allDay = false,
    attendees,
    reminders,
  } = options;

  const eventBody: calendar_v3.Schema$Event = {
    summary,
    description,
    location,
    start: allDay ? { date: start.split("T")[0] } : { dateTime: start },
    end: allDay ? { date: end.split("T")[0] } : { dateTime: end },
  };

  if (attendees) {
    eventBody.attendees = attendees.map((email) => ({ email }));
  }

  if (reminders) {
    eventBody.reminders = {
      useDefault: false,
      overrides: reminders,
    };
  }

  const response = await calendar.events.insert({
    calendarId,
    requestBody: eventBody,
    sendUpdates: attendees ? "all" : "none",
  });

  return formatEvent(response.data);
}

/**
 * Update a calendar event
 */
export async function updateEvent(
  eventId: string,
  updates: Partial<CreateEventOptions>,
  calendarId = "primary",
): Promise<CalendarEvent> {
  const calendar = getCalendarClient();

  // Get existing event
  const existing = await calendar.events.get({ calendarId, eventId });
  const event = existing.data;

  // Apply updates
  if (updates.summary !== undefined) event.summary = updates.summary;
  if (updates.description !== undefined) event.description = updates.description;
  if (updates.location !== undefined) event.location = updates.location;

  if (updates.start !== undefined) {
    event.start = updates.allDay
      ? { date: updates.start.split("T")[0] }
      : { dateTime: updates.start };
  }

  if (updates.end !== undefined) {
    event.end = updates.allDay ? { date: updates.end.split("T")[0] } : { dateTime: updates.end };
  }

  if (updates.attendees !== undefined) {
    event.attendees = updates.attendees.map((email) => ({ email }));
  }

  const response = await calendar.events.update({
    calendarId,
    eventId,
    requestBody: event,
    sendUpdates: updates.attendees ? "all" : "none",
  });

  return formatEvent(response.data);
}

/**
 * Delete a calendar event
 */
export async function deleteEvent(eventId: string, calendarId = "primary"): Promise<void> {
  const calendar = getCalendarClient();

  await calendar.events.delete({
    calendarId,
    eventId,
    sendUpdates: "all",
  });
}

/**
 * Get a single event by ID
 */
export async function getEvent(eventId: string, calendarId = "primary"): Promise<CalendarEvent> {
  const calendar = getCalendarClient();

  const response = await calendar.events.get({
    calendarId,
    eventId,
  });

  return formatEvent(response.data);
}

/**
 * Format API event to our simplified structure
 */
function formatEvent(event: calendar_v3.Schema$Event): CalendarEvent {
  const isAllDay = !!event.start?.date;

  return {
    id: event.id || "",
    summary: event.summary || "(No title)",
    description: event.description || undefined,
    location: event.location || undefined,
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    allDay: isAllDay,
    attendees: event.attendees?.map((a) => a.email || "").filter(Boolean),
    status: event.status || "confirmed",
    htmlLink: event.htmlLink || undefined,
  };
}

/**
 * List available calendars
 */
export async function listCalendars(): Promise<
  { id: string; summary: string; primary: boolean }[]
> {
  const calendar = getCalendarClient();

  const response = await calendar.calendarList.list();
  const calendars = response.data.items || [];

  return calendars.map((cal) => ({
    id: cal.id || "",
    summary: cal.summary || "",
    primary: cal.primary || false,
  }));
}
