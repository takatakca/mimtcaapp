// « MIMT Connect » partner platform (docs/MIMT-CONNECT.md): a MIMT business account exposed to a client's own
// system through API keys and signed webhooks. besoinavocat.ca is the first partner; nothing here is specific to it.

/** Webhook events sent to a partner. Payloads carry ids and call metadata only: never audio, never a transcript. */
export const PARTNER_EVENTS = [
  "call.ringing",
  "call.answered",
  "call.completed",
  "recording.ready",
  // Account link (issue #97, lot A): a member tied to a real MIMT user with that user's consent, and the line they chose.
  "member.linked",
  "member.unlinked",
  "member.number_changed",
] as const;
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
  /** True when a MIMT user approved the link to this member (their MIMT apps then ring for it). */
  linked: boolean;
  /** « Ligne » of the member: one of the linked user's own MIMT numbers, caller ID of click-to-call. */
  lineNumber: string | null;
  /** Where to send the person to choose and pay for a number in MIMT (null once linked with a line). */
  chooseNumberUrl: string | null;
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
  /** inbound: a caller to a hunt group; outbound: click-to-call placed for a member. */
  direction: "inbound" | "outbound";
  /** The partner's own reference for a click-to-call (null for inbound calls). */
  reference: string | null;
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

// ------------------------------------------------------------------------------------------------ account link

/**
 * One-time link code: 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L). Valid 15 minutes, stored
 * hashed, single use, and dead after 5 wrong attempts on its request.
 */
export const PARTNER_LINK_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PARTNER_LINK_CODE_LENGTH = 8;
export const PARTNER_LINK_CODE_TTL_S = 15 * 60;
export const PARTNER_LINK_MAX_ATTEMPTS = 5;

/** Upper-cases and drops spaces and dashes (people type « abcd-2345 »). */
export const normalizeLinkCode = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, "");

/** POST /v1/partner/members/:externalId/link-requests (partner API). */
export interface PartnerLinkRequestCreated {
  requestId: string;
  /** Shown to the member by the partner; never stored in clear by MIMT. */
  code: string;
  /** Page of the MIMT web app where the signed-in member approves the link. */
  url: string;
  expiresAt: string;
}

/** What the partner can see and do once linked (shown on the /lier consent page). */
export const PARTNER_LINK_PERMISSIONS = ["calls", "click_to_call", "number"] as const;
export type PartnerLinkPermission = (typeof PARTNER_LINK_PERMISSIONS)[number];

/** POST /v1/me/partner-links/preview: what the person is about to approve. */
export interface PartnerLinkPreview {
  requestId: string;
  partnerName: string;
  externalId: string;
  memberName: string;
  permissions: PartnerLinkPermission[];
  expiresAt: string;
}

export interface PartnerLinkCodeRequest {
  code: string;
  /** From the link URL (`r=`): wrong codes then count against this request (5 → expired). */
  requestId?: string;
}

/** A link as its MIMT user sees it (Compte › Intégrations › Partenaires). */
export interface MyPartnerLinkDto {
  id: string;
  partnerName: string;
  externalId: string;
  memberName: string;
  /** The line the partner uses as caller ID (one of the user's numbers), if one was attached. */
  lineNumber: string | null;
  permissions: PartnerLinkPermission[];
  createdAt: string;
}

export interface MyPartnerLinksResponse {
  links: MyPartnerLinkDto[];
}

/** GET /v1/partner/members/:externalId/numbers. */
export interface PartnerMemberNumbersResponse {
  /** The linked user's active MIMT numbers. */
  numbers: Array<{ e164: string }>;
  /** The number attached as the member's line, if any. */
  current: string | null;
  /** Set when no number is attached: the page where the person chooses and pays for one in MIMT. */
  chooseNumberUrl: string | null;
}

/** POST /v1/partner/members/:externalId/calls. */
export interface PartnerClickToCallRequest {
  to: string;
  reference?: string;
  /** app (default): the member's MIMT apps ring first; mobile: their cellphone, with the « appuyez sur 1 ». */
  via?: "app" | "mobile";
}

export interface PartnerClickToCallResponse {
  callId: string;
}
