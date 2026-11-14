// « MIMT Connect » partner platform (docs/MIMT-CONNECT.md): a MIMT business account exposed to a client's own
// system through API keys and signed webhooks. besoinavocat.ca is the first partner; nothing here is specific to it.

import type { WeeklySchedule } from "./business.js";
import type { PlanCode } from "./plans.js";
import type { PortInNumberStatus, PortInStatus } from "./portIn.js";
import type { PartnerConsentReceiptDto, PartnerScope, PartnerScopeRequestItem } from "./partnerScopes.js";

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
  // Lot B (issue #97): the linked person's subscription, number transfers, and availability for hunt groups.
  "member.subscription_changed",
  "member.port_in_updated",
  "member.availability_changed",
  // Consent (2026-10-31): the scopes the linked person granted changed (approval, upgrade, one scope removed).
  "member.consent_updated",
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
  /** Scopes the linked person granted (empty when not linked). */
  scopes: PartnerScope[];
  /** Version of the consent text the person approved (null when not linked). */
  consentVersion: string | null;
  /** False when the person approved an older consent text: send an upgrade request to ask again. */
  consentCurrent: boolean | null;
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
  /** link: a new link; upgrade: the member is already linked and the person is asked to change the granted scopes. */
  kind: "link" | "upgrade";
  /** What the person will be asked for, as validated against the partner's declared purposes. */
  scopes: PartnerScopeRequestItem[];
  /** Shown to the member by the partner; never stored in clear by MIMT. */
  code: string;
  /** Page of the MIMT web app where the signed-in member approves the link. */
  url: string;
  expiresAt: string;
}

/** POST /v1/me/partner-links/preview: who asks, why, and exactly what the person is asked to grant. */
export interface PartnerLinkPreview {
  requestId: string;
  kind: "link" | "upgrade";
  partnerName: string;
  /** From the partner's accepted terms (registry name and privacy contact). */
  partnerLegalName: string | null;
  privacyContactEmail: string | null;
  termsVersion: string | null;
  externalId: string;
  memberName: string;
  /** Requested scopes with the partner's purpose; `granted`: already granted today (upgrade only). */
  scopes: Array<{ scope: PartnerScope; purpose: string; required: boolean; granted: boolean }>;
  /** Scopes granted today (upgrade); empty for a new link. */
  currentScopes: PartnerScope[];
  /** The consent text version this screen shows; sent back on approval. */
  consentVersion: string;
  expiresAt: string;
}

export interface PartnerLinkCodeRequest {
  code: string;
  /** From the link URL (`r=`): wrong codes then count against this request (5 → expired). */
  requestId?: string;
}

/** POST /v1/me/partner-links/approve (step-up). */
export interface PartnerLinkApproveRequest extends PartnerLinkCodeRequest {
  /** The scopes the person checked: a subset of the requested ones, including every required one. */
  scopes: PartnerScope[];
  /** The version shown (409 consent_text_changed when the texts changed since). */
  consentVersion: string;
}

/** A link as its MIMT user sees it (Compte › Intégrations › Partenaires). */
export interface MyPartnerLinkDto {
  id: string;
  partnerName: string;
  partnerLegalName: string | null;
  privacyContactEmail: string | null;
  externalId: string;
  memberName: string;
  /** The line the partner uses as caller ID (one of the user's numbers), if one was attached. */
  lineNumber: string | null;
  /** What the partner may see or do now. */
  scopes: PartnerScope[];
  /** Scopes the partner said its service needs (removing one may end the service; it is still allowed). */
  requiredScopes: PartnerScope[];
  /** The partner's purpose for each granted scope. */
  purposes: Partial<Record<PartnerScope, string>>;
  consentVersion: string;
  /** False when the approved text is older than the current one (the grant stays as approved). */
  consentCurrent: boolean;
  consentedAt: string;
  /** The latest consent receipt. */
  receipt: PartnerConsentReceiptDto | null;
  /** The person's own availability for this partner's hunt groups (null: the partner's setting applies). */
  userStatus: PartnerAvailabilityStatus | null;
  /** Whether this partner's hunt groups ring the person right now, all rules applied. */
  effectiveStatus: PartnerAvailabilityStatus;
  createdAt: string;
}

/** DELETE /v1/me/partner-links/:id/scopes/:scope. Removing the last scope unlinks (link null). */
export interface PartnerScopeRevokeResponse {
  unlinked: boolean;
  link: MyPartnerLinkDto | null;
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

// ------------------------------------------------------------------------------------- lot B (issue #97)

/** GET /v1/partner/members/:externalId/subscription: status of the linked person's own MIMT plan. */
export type PartnerMemberSubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "none";

/**
 * Minimal on purpose (Law 25): never card details, amounts or invoices. MIMT never charges on the partner's say-so:
 * `planUrl` sends the person to choose and pay for their plan in MIMT themselves.
 */
export interface PartnerMemberSubscriptionDto {
  plan: PlanCode;
  status: PartnerMemberSubscriptionStatus;
  currentPeriodEnd: string | null;
  /** The account can place and receive calls (not suspended or closed). */
  canCall: boolean;
  planUrl: string;
}

/** One number transfer of the linked person: never the carrier account number or PIN. */
export interface PartnerMemberPortInDto {
  id: string;
  /** First number of the request (most requests carry one). */
  e164: string;
  numbers: Array<{ e164: string; status: PortInNumberStatus }>;
  status: PortInStatus;
  updatedAt: string;
  /** Firm order commitment date when the carrier gave one, else the date the person asked for; null if neither. */
  expectedDate: string | null;
}

export interface PartnerMemberPortInsResponse {
  portIns: PartnerMemberPortInDto[];
  /** Where the person starts a number transfer in MIMT. */
  portUrl: string;
}

/** Availability of a member for the partner's hunt groups. */
export const PARTNER_AVAILABILITY_STATUSES = ["available", "busy", "offline"] as const;
export type PartnerAvailabilityStatus = (typeof PARTNER_AVAILABILITY_STATUSES)[number];

/** PUT /v1/partner/members/:externalId/availability (replaces the partner's setting; omitted fields are cleared). */
export interface PartnerAvailabilityRequest {
  status: PartnerAvailabilityStatus;
  /** Weekly windows in America/Montreal (same shape as business hours): outside them an available member is offline. */
  weekly?: WeeklySchedule | null;
  /** The status holds until then; afterwards the member is available again (still within `weekly`). */
  until?: string | null;
}

export interface PartnerAvailabilityDto {
  externalId: string;
  /** The partner's setting. */
  status: PartnerAvailabilityStatus;
  weekly: WeeklySchedule | null;
  until: string | null;
  /** The linked person's own setting from the MIMT apps: it wins over `status` while set. */
  userStatus: PartnerAvailabilityStatus | null;
  /** What hunt groups apply right now. */
  effectiveStatus: PartnerAvailabilityStatus;
  /** Which rule decided `effectiveStatus`. */
  source: "user" | "partner" | "schedule" | "default";
  updatedAt: string | null;
}

/** PUT /v1/me/partner-links/:id/availability: the person's own status (null hands control back to the partner). */
export interface MyPartnerAvailabilityRequest {
  status: PartnerAvailabilityStatus | null;
}
