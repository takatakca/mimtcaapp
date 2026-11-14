// « MIMT Connect » storage (supabase/migrations/0023_partners.sql). Service and rules: src/services/partners.ts.
//
// The repository owns the money-grade guarantees of the credit ledger, in ONE transaction per call after a row lock
// on the partner: idempotency keys (a key is used once, ever), balance never below zero. Memory and Postgres
// implementations behave the same (partners.repo.contract.test.ts).
import type {
  PartnerAvailabilityStatus,
  PartnerCallBilling,
  PartnerConsentAction,
  PartnerEventType,
  PartnerScope,
  PartnerScopeRequestItem,
  WeeklySchedule,
} from "@mimt/shared";

export interface PartnerRow {
  id: string;
  businessId: string;
  name: string;
  /** Short name in links sent to members (…/numero?partner=<slug>); null: the partner id is used. */
  slug: string | null;
  status: "active" | "suspended";
  /** Null: PARTNER_CREDIT_PER_MINUTE. */
  creditPerMinute: number | null;
  creditBalance: number;
  webhookUrl: string | null;
  webhookSecretEncrypted: string | null;
  creditsExhaustedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PartnerPatch = Partial<Pick<PartnerRow, "name" | "slug" | "status" | "creditPerMinute" | "webhookUrl" | "webhookSecretEncrypted" | "creditsExhaustedAt">>;

export interface PartnerApiKeyRow {
  id: string;
  partnerId: string;
  prefix: string;
  keySha256: string;
  label: string | null;
  createdBy: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface PartnerMemberRow {
  id: string;
  partnerId: string;
  externalId: string;
  name: string;
  email: string | null;
  phone: string | null;
  handle: string | null;
  language: "fr" | "en";
  active: boolean;
  extensionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PartnerMemberFields = Pick<PartnerMemberRow, "name" | "email" | "phone" | "handle" | "language" | "active" | "extensionId">;

export interface PartnerHuntGroupRow {
  id: string;
  partnerId: string;
  key: string;
  ringGroupId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PartnerLedgerRow {
  id: string;
  partnerId: string;
  delta: number;
  reason: "topup" | "call" | "adjustment";
  reference: string;
  idempotencyKey: string;
  balanceAfter: number;
  meta: Record<string, unknown>;
  createdBy: string | null;
  createdAt: Date;
}

export interface PartnerCreditInput {
  partnerId: string;
  reason: PartnerLedgerRow["reason"];
  /**
   * topup: > 0. call: the cost (>= 0); the debit is capped at the balance (what is missing is « unbilled », the
   * balance never goes below zero). adjustment: any sign, refused when it would go below zero.
   */
  credits: number;
  idempotencyKey: string;
  reference: string;
  meta?: Record<string, unknown>;
  createdBy?: string | null;
  at: Date;
}

export type PartnerCreditResult =
  | { status: "applied"; row: PartnerLedgerRow; balance: number }
  | { status: "duplicate"; row: PartnerLedgerRow; balance: number }
  | { status: "insufficient"; balance: number };

export interface PartnerCallRow {
  id: string;
  partnerId: string;
  callSid: string;
  direction: "inbound" | "outbound";
  fromNumber: string;
  toNumber: string;
  huntGroupKey: string | null;
  memberId: string | null;
  externalId: string | null;
  answeredLegSid: string | null;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  talkS: number | null;
  creditsCharged: number;
  billing: PartnerCallBilling;
  recordingId: string | null;
  /** Click-to-call: the partner's own reference. */
  reference: string | null;
  /** The account link the member was under when the call was placed or answered (its scopes govern this record). */
  linkId: string | null;
  finalizedAt: Date | null;
  createdAt: Date;
}

/** Outbound (click-to-call) calls know their member from the start; inbound ones learn it when someone answers. */
export type NewPartnerCall = Pick<PartnerCallRow, "partnerId" | "callSid" | "direction" | "fromNumber" | "toNumber" | "huntGroupKey" | "startedAt"> &
  Partial<Pick<PartnerCallRow, "memberId" | "externalId" | "reference" | "linkId">>;
export type PartnerCallPatch = Partial<Pick<PartnerCallRow, "endedAt" | "talkS" | "creditsCharged" | "billing" | "recordingId">>;

export interface PartnerWebhookEventRow {
  id: string;
  partnerId: string;
  eventType: PartnerEventType;
  payload: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
  lastError: string | null;
  /** The link the event is about: its scopes are checked again at delivery. */
  linkId: string | null;
  createdAt: Date;
}

/** One-time link code (0027_partner_links.sql): stored hashed, single use, 15 minutes, 5 wrong attempts. */
export interface PartnerLinkRequestRow {
  id: string;
  partnerId: string;
  memberId: string;
  codeSha256: string;
  expiresAt: Date;
  attempts: number;
  usedAt: Date | null;
  invalidatedAt: Date | null;
  /** link: a new link; upgrade: new scopes for the existing link `linkId`. */
  kind: "link" | "upgrade";
  linkId: string | null;
  /** What the person is asked for (0029). */
  scopes: PartnerScopeRequestItem[];
  createdAt: Date;
}

/** A member tied to a MIMT user with that user's consent. Revoked, never deleted. */
export interface PartnerMemberLinkRow {
  id: string;
  partnerId: string;
  memberId: string;
  userId: string;
  /** The member's line: one of the user's own numbers. */
  numberId: string | null;
  requestId: string | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
  revokedBy: "user" | "partner" | "system" | null;
  /** What the person granted (0029); every partner route and webhook checks it. */
  scopes: PartnerScope[];
  requiredScopes: PartnerScope[];
  purposes: Partial<Record<PartnerScope, string>>;
  consentVersion: string;
  scopeSetVersion: number;
  consentedAt: Date;
}

export type PartnerGrant = Pick<PartnerMemberLinkRow, "scopes" | "requiredScopes" | "purposes" | "consentVersion" | "scopeSetVersion">;

/** Acceptance of the MIMT Connect partner terms and DPA (0029). Never updated: a new acceptance is a new row. */
export interface PartnerTermsAcceptanceRow {
  id: string;
  partnerId: string;
  termsVersion: string;
  acceptedAt: Date;
  signerName: string;
  signerTitle: string;
  legalName: string;
  privacyContactEmail: string;
  purposes: Partial<Record<PartnerScope, string>>;
  recordedBy: string | null;
  createdAt: Date;
}

/** One consent step (0029). Never updated. Coarse device and network only, never a full IP address. */
export interface PartnerConsentReceiptRow {
  id: string;
  linkId: string;
  partnerId: string;
  memberId: string;
  userId: string;
  action: PartnerConsentAction;
  actor: "user" | "partner" | "system";
  scopes: PartnerScope[];
  changed: PartnerScope[];
  requiredScopes: PartnerScope[];
  purposes: Partial<Record<PartnerScope, string>>;
  consentVersion: string;
  scopeSetVersion: number;
  termsVersion: string | null;
  device: string | null;
  network: string | null;
  createdAt: Date;
}

/** One partner API access to a linked person's data (0029). No body, no query string, no IP. */
export interface PartnerAccessLogRow {
  id: string;
  partnerId: string;
  linkId: string;
  scope: PartnerScope;
  route: string;
  outcome: "allowed" | "denied";
  at: Date;
}

export type PartnerLinkCreateResult =
  | { status: "created"; link: PartnerMemberLinkRow }
  | { status: "member_taken" }
  | { status: "user_taken" };

/** Lot B (0028_partner_member_status.sql): a member's availability for the partner's hunt groups. */
export interface PartnerAvailabilityRow {
  memberId: string;
  partnerId: string;
  /** The partner's setting. */
  status: PartnerAvailabilityStatus;
  /** Weekly windows (America/Montreal); null = always. */
  weekly: WeeklySchedule | null;
  /** The partner's status holds until then (null = until changed). */
  until: Date | null;
  /** The linked MIMT user's own setting; wins over `status` while set. */
  userStatus: PartnerAvailabilityStatus | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PartnerAvailabilityPatch = Partial<Pick<PartnerAvailabilityRow, "status" | "weekly" | "until" | "userStatus">>;

export interface PartnerRepository {
  createPartner(p: { businessId: string; name: string; slug?: string | null; creditPerMinute: number | null; createdBy: string | null }): Promise<PartnerRow>;
  getPartnerBySlug(slug: string): Promise<PartnerRow | null>;
  getPartner(id: string): Promise<PartnerRow | null>;
  getPartnerByBusiness(businessId: string): Promise<PartnerRow | null>;
  listPartners(): Promise<PartnerRow[]>;
  updatePartner(id: string, patch: PartnerPatch): Promise<PartnerRow | null>;

  createApiKey(k: Pick<PartnerApiKeyRow, "partnerId" | "prefix" | "keySha256" | "label" | "createdBy">): Promise<PartnerApiKeyRow>;
  findApiKeyByHash(keySha256: string): Promise<PartnerApiKeyRow | null>;
  listApiKeys(partnerId: string): Promise<PartnerApiKeyRow[]>;
  /** Null when the key is not this partner's or already revoked. */
  revokeApiKey(partnerId: string, id: string, at: Date): Promise<PartnerApiKeyRow | null>;
  touchApiKey(id: string, at: Date): Promise<void>;

  /** Insert or update on (partnerId, externalId). */
  upsertMember(partnerId: string, externalId: string, fields: PartnerMemberFields): Promise<{ member: PartnerMemberRow; created: boolean }>;
  getMember(partnerId: string, externalId: string): Promise<PartnerMemberRow | null>;
  getMemberById(id: string): Promise<PartnerMemberRow | null>;
  getMemberByExtension(extensionId: string): Promise<PartnerMemberRow | null>;
  /** Ordered by externalId. */
  listMembers(partnerId: string): Promise<PartnerMemberRow[]>;

  upsertHuntGroup(h: { partnerId: string; key: string; ringGroupId: string }): Promise<PartnerHuntGroupRow>;
  getHuntGroup(partnerId: string, key: string): Promise<PartnerHuntGroupRow | null>;
  getHuntGroupByRingGroup(ringGroupId: string): Promise<PartnerHuntGroupRow | null>;
  listHuntGroups(partnerId: string): Promise<PartnerHuntGroupRow[]>;

  /** Moves credits atomically (see PartnerCreditInput). Same idempotency key = duplicate, nothing moves. */
  applyCredit(input: PartnerCreditInput): Promise<PartnerCreditResult>;
  /** Newest first. */
  listLedger(partnerId: string, limit: number): Promise<PartnerLedgerRow[]>;

  /** Insert once per CallSid; returns the existing row on a repeat. */
  createCall(c: NewPartnerCall): Promise<PartnerCallRow>;
  getCallBySid(callSid: string): Promise<PartnerCallRow | null>;
  getCallByRecording(partnerId: string, recordingId: string): Promise<PartnerCallRow | null>;
  updateCall(id: string, patch: PartnerCallPatch): Promise<PartnerCallRow | null>;
  /** First answer wins: sets the member and answeredAt only if nobody answered yet. Null when someone already had. */
  markAnswered(id: string, a: { memberId: string; externalId: string; legSid: string; at: Date; linkId?: string | null }): Promise<PartnerCallRow | null>;
  /** Sets finalizedAt once. False when the call was already finalized (the debit and call.completed run once). */
  claimFinalize(id: string, at: Date): Promise<boolean>;
  /** Oldest first, startedAt strictly after `since`. */
  listCalls(partnerId: string, opts: { since?: Date; externalId?: string; limit: number }): Promise<PartnerCallRow[]>;
  /** Newest first (owner dashboard). */
  listRecentCalls(partnerId: string, limit: number): Promise<PartnerCallRow[]>;
  /** Outbound calls of a member not finalized yet, started after `since` (one click-to-call at a time). */
  countOpenOutboundCalls(memberId: string, since: Date): Promise<number>;

  /** New link request; every earlier pending request of the member is invalidated in the same step. */
  createLinkRequest(r: {
    partnerId: string;
    memberId: string;
    codeSha256: string;
    expiresAt: Date;
    at: Date;
    kind?: "link" | "upgrade";
    linkId?: string | null;
    scopes?: PartnerScopeRequestItem[];
  }): Promise<PartnerLinkRequestRow>;
  getLinkRequest(id: string): Promise<PartnerLinkRequestRow | null>;
  findLinkRequestByHash(codeSha256: string): Promise<PartnerLinkRequestRow | null>;
  /** One wrong code on this request: attempts + 1, invalidated at `maxAttempts`. Null when unknown. */
  recordLinkRequestFailure(id: string, maxAttempts: number, at: Date): Promise<PartnerLinkRequestRow | null>;
  /** Marks the request used once: false when already used, invalidated or expired at `at`. */
  consumeLinkRequest(id: string, at: Date): Promise<boolean>;

  /** Refused (no row) when the member or the user (for this partner) already has an active link. */
  createLink(l: { partnerId: string; memberId: string; userId: string; requestId: string | null; at: Date; grant: PartnerGrant }): Promise<PartnerLinkCreateResult>;
  getLink(id: string): Promise<PartnerMemberLinkRow | null>;
  getActiveLinkByMember(memberId: string): Promise<PartnerMemberLinkRow | null>;
  getActiveLinkByUser(partnerId: string, userId: string): Promise<PartnerMemberLinkRow | null>;
  /** Active links of a user, every partner, newest first. */
  listActiveLinksByUser(userId: string): Promise<PartnerMemberLinkRow[]>;
  /** Null when the link is unknown or already revoked. */
  revokeLink(id: string, by: "user" | "partner" | "system", at: Date): Promise<PartnerMemberLinkRow | null>;
  /** Only on an active link; null otherwise. */
  setLinkNumber(id: string, numberId: string | null): Promise<PartnerMemberLinkRow | null>;
  /** Replaces the grant of an ACTIVE link (consentedAt = at); null otherwise. */
  setLinkGrant(id: string, grant: PartnerGrant, at: Date): Promise<PartnerMemberLinkRow | null>;

  addTermsAcceptance(t: Omit<PartnerTermsAcceptanceRow, "id" | "createdAt"> & { at: Date }): Promise<PartnerTermsAcceptanceRow>;
  /** Newest first (by when it was recorded). */
  latestTermsAcceptance(partnerId: string): Promise<PartnerTermsAcceptanceRow | null>;

  addConsentReceipt(r: Omit<PartnerConsentReceiptRow, "id" | "createdAt"> & { at: Date }): Promise<PartnerConsentReceiptRow>;
  /** Newest first. */
  listConsentReceipts(linkId: string, limit: number): Promise<PartnerConsentReceiptRow[]>;

  logAccess(e: Omit<PartnerAccessLogRow, "id">): Promise<void>;
  /** Newest first. */
  listAccessLog(linkId: string, limit: number): Promise<PartnerAccessLogRow[]>;
  /** Deletes entries older than `before`; returns how many. */
  pruneAccessLog(before: Date): Promise<number>;

  getAvailability(memberId: string): Promise<PartnerAvailabilityRow | null>;
  listAvailability(partnerId: string): Promise<PartnerAvailabilityRow[]>;
  /** Insert (defaults: available, no schedule, no end, no user status) or update; only defined fields change. */
  upsertAvailability(partnerId: string, memberId: string, patch: PartnerAvailabilityPatch): Promise<PartnerAvailabilityRow>;
  /**
   * Stores the subscription view last sent for an ACTIVE link. True when it differs from the stored one (the caller
   * then sends member.subscription_changed); false when unchanged or the link is not active.
   */
  swapLinkSubscriptionState(linkId: string, state: string): Promise<boolean>;

  enqueueEvent(e: { partnerId: string; eventType: PartnerEventType; payload: Record<string, unknown>; at: Date; linkId?: string | null }): Promise<PartnerWebhookEventRow>;
  listDueEvents(now: Date, limit: number): Promise<PartnerWebhookEventRow[]>;
  markEventDelivered(id: string, at: Date): Promise<void>;
  /** nextAttemptAt null = dead (no more attempts). */
  markEventFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void>;
  getEvent(id: string): Promise<PartnerWebhookEventRow | null>;
}
