// « Programme d'agents affiliés » storage (supabase/migrations/0019_affiliates.sql). Service: src/services/affiliates.ts.
import type { AffiliateAudienceSize, AffiliateChannel, AffiliateCommissionStatus, AffiliateProvince, AffiliateStatus } from "@mimt/shared";

export interface AffiliateRow {
  id: string;
  status: AffiliateStatus;
  code: string | null;
  /** MessageCipher blob of AffiliatePii (JSON). Never logged, never returned to the affiliate's customers. */
  piiEnc: string;
  emailHash: string;
  phoneHash: string;
  province: AffiliateProvince;
  channels: AffiliateChannel[];
  audienceSize: AffiliateAudienceSize;
  locale: "fr-CA" | "en-CA";
  privacyNoticeVersion: string;
  caslConsent: boolean;
  adultAttested: boolean;
  commissionBps: number;
  durationMonths: number;
  payoutThresholdCents: number;
  userId: string | null;
  contractMode: "docusign" | "manual" | null;
  envelopeId: string | null;
  contractSentAt: Date | null;
  signedAt: Date | null;
  decidedAt: Date | null;
  statusReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewAffiliate = Pick<
  AffiliateRow,
  "piiEnc" | "emailHash" | "phoneHash" | "province" | "channels" | "audienceSize" | "locale" | "privacyNoticeVersion" | "caslConsent" | "adultAttested"
>;

export type AffiliatePatch = Partial<
  Pick<
    AffiliateRow,
    | "status"
    | "code"
    | "commissionBps"
    | "durationMonths"
    | "payoutThresholdCents"
    | "contractMode"
    | "envelopeId"
    | "contractSentAt"
    | "signedAt"
    | "decidedAt"
    | "statusReason"
  >
>;

export interface AffiliateReferralRow {
  telecomAccountId: string;
  affiliateId: string;
  source: "signup" | "checkout" | "hold";
  touchedAt: Date;
  expiresAt: Date;
  commissionStartAt: Date | null;
  createdAt: Date;
}

export interface AffiliateCommissionRow {
  id: string;
  affiliateId: string;
  telecomAccountId: string | null;
  kind: "invoice" | "clawback";
  sourceRef: string;
  stripeInvoiceId: string;
  netRevenueCents: number;
  commissionBps: number;
  commissionCents: number;
  reversedCents: number;
  status: AffiliateCommissionStatus;
  reversalReason: "refund" | "chargeback" | "fraud" | null;
  earnedAt: Date;
  payableAt: Date;
  paidAt: Date | null;
  payoutRef: string | null;
  createdAt: Date;
}

export type NewAffiliateCommission = Pick<
  AffiliateCommissionRow,
  "affiliateId" | "telecomAccountId" | "stripeInvoiceId" | "netRevenueCents" | "commissionBps" | "commissionCents" | "earnedAt" | "payableAt"
>;

/** What a refund or chargeback changed. Null: no invoice commission for that invoice, or nothing more to reverse. */
export interface ReversalResult {
  commission: AffiliateCommissionRow;
  /** Set when the commission was already paid out: the negative row taken from the next payout. */
  clawback: AffiliateCommissionRow | null;
}

/** Amount a ledger row adds to the affiliate's balance (after reversals; negative for a clawback). */
export const commissionAmount = (r: Pick<AffiliateCommissionRow, "commissionCents" | "reversedCents">) => r.commissionCents - r.reversedCents;

export interface AffiliateRepository {
  /** Null when an application with this email hash is still open (not rejected). */
  createApplication(a: NewAffiliate): Promise<AffiliateRow | null>;
  get(id: string): Promise<AffiliateRow | null>;
  findByCode(code: string): Promise<AffiliateRow | null>;
  findByEnvelope(envelopeId: string): Promise<AffiliateRow | null>;
  findByUser(userId: string): Promise<AffiliateRow | null>;
  /** Affiliates not bound to a user yet, with this phone hash and a status that has a dashboard. */
  findUnboundByPhoneHash(phoneHash: string): Promise<AffiliateRow[]>;
  list(filter: { status?: AffiliateStatus; limit: number }): Promise<AffiliateRow[]>;
  /**
   * Applies the patch only when the current status is one of `from` (status transitions are compare-and-set).
   * Null when the affiliate does not exist or is in another status. A code already taken also returns null.
   */
  update(id: string, from: readonly AffiliateStatus[], patch: AffiliatePatch): Promise<AffiliateRow | null>;
  /** Binds the dashboard user once. False when already bound (to anyone) or the user has another affiliate. */
  bindUser(id: string, userId: string): Promise<boolean>;
  /** Deletes rejected applications decided before `before` (Law 25: no longer needed). Returns how many. */
  purgeRejected(before: Date): Promise<number>;

  /** First touch wins: inserts once per account; returns the row that is stored and whether it was created now. */
  recordReferral(r: Omit<AffiliateReferralRow, "commissionStartAt" | "createdAt">): Promise<{ row: AffiliateReferralRow; created: boolean }>;
  getReferral(telecomAccountId: string): Promise<AffiliateReferralRow | null>;
  /** Sets commission_start_at once (first commissionable invoice). Returns the stored row. */
  startCommission(telecomAccountId: string, at: Date): Promise<AffiliateReferralRow | null>;
  countReferrals(affiliateId: string): Promise<{ signups: number; paying: number }>;
  addHoldTouch(numberHoldId: string, affiliateId: string, touchedAt: Date): Promise<void>;
  getHoldTouch(numberHoldId: string): Promise<{ affiliateId: string; touchedAt: Date } | null>;

  /** One row per invoice (source_ref 'invoice:<id>'). Null when that invoice is already in the ledger. */
  addCommission(c: NewAffiliateCommission): Promise<AffiliateCommissionRow | null>;
  /** The commission row of a Stripe invoice (kind invoice), if any. */
  getInvoiceCommission(stripeInvoiceId: string): Promise<AffiliateCommissionRow | null>;
  /**
   * Refund / chargeback of an invoice: the commission's reversed amount goes up to `targetReversedCents` (capped at
   * the commission). Pending/payable rows are reduced (status reversed when fully reversed); a paid row gets a
   * negative clawback row (payable at once), unique per (invoice, target) so a retried event writes it once.
   */
  applyReversal(stripeInvoiceId: string, targetReversedCents: number, reason: "refund" | "chargeback" | "fraud", at: Date): Promise<ReversalResult | null>;
  /** pending → payable for rows whose hold is over. Returns how many moved. */
  releaseDue(now: Date): Promise<number>;
  listCommissions(affiliateId: string): Promise<AffiliateCommissionRow[]>;
  listPayable(): Promise<AffiliateCommissionRow[]>;
  /** payable → paid for this affiliate (only `ids` when given). Returns the rows marked. */
  markPaid(affiliateId: string, input: { ids?: string[]; payoutRef: string; at: Date }): Promise<AffiliateCommissionRow[]>;
}
