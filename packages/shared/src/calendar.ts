// « Google Agenda » connector (docs/MIMT-CALENDAR.md): calls, missed calls, voicemails and AI call summaries become
// events in the user's Google Calendar. API: apps/api/src/routes/calendar.ts. Kill switch CALENDAR=on|off (default off).

/**
 * OAuth scopes. calendar.events is the least-privilege scope that can insert events (sensitive: Google verification,
 * no CASA assessment). openid + email only show which Google account is connected. Creating a dedicated « MIMT »
 * calendar (calendars.insert) needs the broader calendar scope, so events go to the primary calendar only.
 */
export const GOOGLE_CALENDAR_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"] as const;
export const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Where the API sends the browser back after Google: /compte/integrations?gc=ok|error. */
export const CALENDAR_RETURN_PATH = "/compte/integrations";

export type CalendarTarget = "primary";

export interface CalendarSettings {
  /** Answered calls (inbound and outbound). */
  syncCalls: boolean;
  /** Missed inbound calls (not answered, or sent to voicemail). */
  syncMissedCalls: boolean;
  syncVoicemails: boolean;
  /** AI call summaries (Affaires Pro call recording + AI consent). */
  syncSummaries: boolean;
  /**
   * Law 25 opt-in: put the AI summary or a short transcript excerpt in the event description. Off by default: the
   * event then holds metadata only (who, when, how long) and a link to the item in app.mimt.ca. Also needs the
   * user's AI consent (ai_processing).
   */
  includeContent: boolean;
  /** Only the primary calendar (see GOOGLE_CALENDAR_SCOPES). */
  calendar: CalendarTarget;
}

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  syncCalls: true,
  syncMissedCalls: true,
  syncVoicemails: true,
  syncSummaries: true,
  includeContent: false,
  calendar: "primary",
};

export type CalendarConnectionStatus = "active" | "needs_reconnect";
/** Why the user may use the connector. */
export type CalendarEntitlementSource = "plan" | "addon" | "business";

/** GET /v1/integrations/google-calendar */
export interface GoogleCalendarStatusResponse {
  /** False when GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REDIRECT_URI are not set: the card says « non configuré ». */
  configured: boolean;
  entitled: boolean;
  entitlement: CalendarEntitlementSource | null;
  /** No google_calendar add-on was ever bought on this account: the checkout includes the 14-day trial. */
  trialAvailable: boolean;
  /** The add-on can be bought on the current plan (Essentiel, Premium). */
  canBuy: boolean;
  connected: boolean;
  status: CalendarConnectionStatus | null;
  /** Google account email (from the openid email scope). */
  email: string | null;
  calendarId: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  settings: CalendarSettings;
}

/** GET /v1/integrations/google-calendar/connect */
export interface GoogleCalendarConnectResponse {
  authUrl: string;
}

/** PUT /v1/integrations/google-calendar: any subset of the settings. */
export type GoogleCalendarSettingsRequest = Partial<CalendarSettings>;
