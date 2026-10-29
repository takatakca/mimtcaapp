// « MIMT Connect » partner platform (docs/MIMT-CONNECT.md): a MIMT business account exposed to a client's own
// system through API keys and signed webhooks. besoinavocat.ca is the first partner; nothing here is specific to it.

/** Webhook events sent to a partner. Payloads carry ids and call metadata only: never audio, never a transcript. */
export const PARTNER_EVENTS = ["call.ringing", "call.answered", "call.completed", "recording.ready"] as const;
export type PartnerEventType = (typeof PARTNER_EVENTS)[number];

/** Header carrying `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. */
export const PARTNER_SIGNATURE_HEADER = "X-MIMT-Signature";

/** A partner's own id for a member (lawyer, agent…): letters, digits, `.`, `_`, `-`, `@`, `:`; 1 to 100 characters. */
export const PARTNER_EXTERNAL_ID = /^[A-Za-z0-9._:@-]{1,100}$/;
/** Hunt group key chosen by the partner, e.g. `trouver-un-avocat`. */
export const PARTNER_HUNT_KEY = /^[a-z0-9][a-z0-9_-]{0,59}$/;

/**
 * Billing of one call. billed: fully debited; partial: the balance ran out during the debit (what was left was taken);
 * unbilled: no credits left, the call still rang (we never drop a caller); free: not answered by a member.
 */
export type PartnerCallBilling = "pending" | "billed" | "partial" | "unbilled" | "free";

export interface PartnerMemberDto {
  externalId: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** MIMT @handle whose apps ring (the user must be an active member of the business). */
  handle: string | null;
  language: "fr" | "en";
  active: boolean;
  /** Internal extension number in the business PBX. */
  extension: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerMemberRequest {
  name: string;
  email?: string | null;
  phone?: string | null;
  handle?: string | null;
  language?: "fr" | "en";
  active?: boolean;
}

export interface PartnerHuntGroupRequest {
  name?: string;
  /** External ids, in ring order for the sequential strategy. */
  members: string[];
  strategy: "simultaneous" | "sequential";
  /** Seconds each attempt rings (whole group for simultaneous, each member for sequential). */
  ringTimeoutS?: number;
  /** When nobody answers: the group's voicemail (default) or a polite goodbye. */
  fallback?: "voicemail" | "hangup";
  /** Business number (E.164) whose calls hunt this group. */
  did?: string | null;
}

export interface PartnerHuntGroupDto {
  key: string;
  name: string;
  members: string[];
  strategy: "simultaneous" | "sequential";
  ringTimeoutS: number;
  fallback: "voicemail" | "hangup";
  did: string | null;
}

export interface PartnerCallDto {
  id: string;
  direction: "inbound" | "outbound";
  huntGroup: string | null;
  /** externalId of the member who answered; null when nobody did. */
  externalId: string | null;
  from: string;
  to: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  /** Talk time with the member, in seconds. */
  durationS: number;
  credits: number;
  billing: PartnerCallBilling;
  /** Short-lived signed URL through the MIMT API (never a Twilio URL). */
  recordingUrl: string | null;
  recordingUrlExpiresAt: string | null;
}

export interface PartnerCallsResponse {
  calls: PartnerCallDto[];
  /** Pass as `since` to get the next page (null when this page is the end). */
  nextSince: string | null;
}

export interface PartnerLedgerEntryDto {
  id: string;
  delta: number;
  reason: "topup" | "call" | "adjustment";
  reference: string;
  balanceAfter: number;
  createdAt: string;
}

export interface PartnerCreditsResponse {
  balance: number;
  creditPerMinute: number;
  ledger: PartnerLedgerEntryDto[];
}

export interface PartnerApiKeyDto {
  id: string;
  /** First characters of the key, to recognize it. The full key is shown once, at creation. */
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** The only response that ever contains the full key. */
export interface PartnerApiKeyCreated {
  key: string;
  apiKey: PartnerApiKeyDto;
}

export interface PartnerDto {
  id: string;
  businessId: string;
  name: string;
  status: "active" | "suspended";
  creditPerMinute: number;
  balance: number;
  webhookUrl: string | null;
  createdAt: string;
}

/** Business owner view (webphone « Partenaire »). */
export interface PartnerOverviewResponse {
  partner: PartnerDto;
  apiKeys: PartnerApiKeyDto[];
  calls: PartnerCallDto[];
}

/** PUT webhook: the signing secret is returned once, when first set or rotated. */
export interface PartnerWebhookResponse {
  webhookUrl: string | null;
  secret: string | null;
}
