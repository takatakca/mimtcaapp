// « MIMT Connect » storage (supabase/migrations/0023_partners.sql). Service and rules: src/services/partners.ts.
//
// The repository owns the money-grade guarantees of the credit ledger, in ONE transaction per call after a row lock
// on the partner: idempotency keys (a key is used once, ever), balance never below zero. Memory and Postgres
// implementations behave the same (partners.repo.contract.test.ts).
import type { PartnerCallBilling, PartnerEventType } from "@mimt/shared";

export interface PartnerRow {
  id: string;
  businessId: string;
  name: string;
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

export type PartnerPatch = Partial<Pick<PartnerRow, "name" | "status" | "creditPerMinute" | "webhookUrl" | "webhookSecretEncrypted" | "creditsExhaustedAt">>;

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
  finalizedAt: Date | null;
  createdAt: Date;
}

export type NewPartnerCall = Pick<PartnerCallRow, "partnerId" | "callSid" | "direction" | "fromNumber" | "toNumber" | "huntGroupKey" | "startedAt">;
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
  createdAt: Date;
}

export interface PartnerRepository {
  createPartner(p: { businessId: string; name: string; creditPerMinute: number | null; createdBy: string | null }): Promise<PartnerRow>;
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
  updateCall(id: string, patch: PartnerCallPatch): Promise<PartnerCallRow | null>;
  /** First answer wins: sets the member and answeredAt only if nobody answered yet. Null when someone already had. */
  markAnswered(id: string, a: { memberId: string; externalId: string; legSid: string; at: Date }): Promise<PartnerCallRow | null>;
  /** Sets finalizedAt once. False when the call was already finalized (the debit and call.completed run once). */
  claimFinalize(id: string, at: Date): Promise<boolean>;
  /** Oldest first, startedAt strictly after `since`. */
  listCalls(partnerId: string, opts: { since?: Date; externalId?: string; limit: number }): Promise<PartnerCallRow[]>;
  /** Newest first (owner dashboard). */
  listRecentCalls(partnerId: string, limit: number): Promise<PartnerCallRow[]>;

  enqueueEvent(e: { partnerId: string; eventType: PartnerEventType; payload: Record<string, unknown>; at: Date }): Promise<PartnerWebhookEventRow>;
  listDueEvents(now: Date, limit: number): Promise<PartnerWebhookEventRow[]>;
  markEventDelivered(id: string, at: Date): Promise<void>;
  /** nextAttemptAt null = dead (no more attempts). */
  markEventFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void>;
  getEvent(id: string): Promise<PartnerWebhookEventRow | null>;
}
