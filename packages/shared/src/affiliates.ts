// « Programme d'agents affiliés MIMT » (docs/MIMT-AFFILIATES.md). Shared by the API (apps/api services/affiliates.ts),
// the public application form on mimt.ca (/affilies/) and the affiliate dashboard in the web app (/affilie).
// The contract (docs/legal/contrat-affilie.md) uses the same numbers through its {{placeholders}}.

/** Default terms of a new affiliate. The admin can change them per affiliate before the contract is sent. */
export const AFFILIATE_DEFAULTS = {
  /** Basis points of net revenue (2000 = 20 %). */
  commissionBps: 2000,
  /** Months of commission per referred customer, from that customer's first paid invoice. */
  durationMonths: 12,
  /** Minimum payable balance before a payout, CAD cents. */
  payoutThresholdCents: 5000,
} as const;

/** Bounds the admin may set (also CHECK constraints in 0019_affiliates.sql). */
export const AFFILIATE_LIMITS = {
  commissionBps: { min: 100, max: 5000 },
  durationMonths: { min: 1, max: 36 },
  payoutThresholdCents: { min: 0, max: 100_000 },
} as const;

/** Days a commission waits (refund / chargeback window) before it becomes payable. */
export const AFFILIATE_HOLD_DAYS = 30;
/** Days after the click (first touch) within which the customer's first paid invoice must happen. */
export const AFFILIATE_ATTRIBUTION_DAYS = 60;
/** Version of the privacy notice shown on the application form (stored with each application). */
export const AFFILIATE_PRIVACY_NOTICE_VERSION = "2026-10-affilies-v1";
/** Query parameter of an affiliate link (https://app.mimt.ca/?aff=CODE). */
export const AFFILIATE_LINK_PARAM = "aff";

export type AffiliateStatus = "applied" | "approved" | "rejected" | "contract_sent" | "active" | "suspended" | "terminated";

export const AFFILIATE_PROVINCES = ["QC", "ON", "BC", "AB", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU"] as const;
export type AffiliateProvince = (typeof AFFILIATE_PROVINCES)[number];

export const AFFILIATE_CHANNELS = ["website", "social", "video", "newsletter", "podcast", "in_person", "community", "other"] as const;
export type AffiliateChannel = (typeof AFFILIATE_CHANNELS)[number];

export const AFFILIATE_AUDIENCE_SIZES = ["lt_1k", "1k_10k", "10k_50k", "gt_50k"] as const;
export type AffiliateAudienceSize = (typeof AFFILIATE_AUDIENCE_SIZES)[number];

/** Codes are read aloud and typed by hand: no 0/O/1/I. */
export const AFFILIATE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE = /^[A-Z0-9]{6,12}$/;

/** "ab-cd 1234" → "ABCD1234", or null when it cannot be a code. */
export function normalizeAffiliateCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  return CODE.test(code) ? code : null;
}

/** Commission on one invoice: percentage of net revenue (before taxes), rounded down to the cent. */
export function affiliateCommissionCents(netRevenueCents: number, commissionBps: number): number {
  if (netRevenueCents <= 0 || commissionBps <= 0) return 0;
  return Math.floor((netRevenueCents * commissionBps) / 10_000);
}

/** 2000 → "20", 1250 → "12,5" (fr) / "12.5" (en). */
export function formatCommissionPct(bps: number, lang: "fr" | "en" = "fr"): string {
  const s = String(bps / 100);
  return lang === "fr" ? s.replace(".", ",") : s;
}

// ------------------------------------------------------------------------------------------ API shapes

/** POST /v1/public/affiliates/applications (mimt.ca form, no account). */
export interface AffiliateApplicationRequest {
  legalName: string;
  businessName?: string;
  email: string;
  phone: string;
  province: AffiliateProvince;
  channels: AffiliateChannel[];
  audienceSize: AffiliateAudienceSize;
  gstNumber?: string;
  qstNumber?: string;
  locale: "fr-CA" | "en-CA";
  consents: {
    /** Read the Law 25 privacy notice of the program (required). */
    privacyNotice: true;
    privacyNoticeVersion: string;
    /** CASL: news and offers by email (optional, separate, unchecked by default). */
    marketing: boolean;
  };
  /** 18 years or older (required). */
  adult: true;
  /** Honeypot: must be empty. */
  website?: string;
  /** ms since the form was shown (bots submit instantly). */
  elapsedMs?: number;
}

/** Same answer whether the email was new or not (no account enumeration). */
export interface AffiliateApplicationResponse {
  received: true;
}

export interface AffiliateTermsDto {
  commissionBps: number;
  durationMonths: number;
  payoutThresholdCents: number;
}

export type AffiliateCommissionStatus = "pending" | "payable" | "paid" | "reversed";

export interface AffiliateCommissionDto {
  id: string;
  kind: "invoice" | "clawback";
  status: AffiliateCommissionStatus;
  netRevenueCents: number;
  commissionBps: number;
  /** After refunds/chargebacks (negative for a clawback). */
  amountCents: number;
  earnedAt: string;
  payableAt: string;
  paidAt: string | null;
}

/** GET /v1/affiliates/me — the dashboard of an active (or suspended) affiliate. 404 not_affiliate otherwise. */
export interface AffiliateDashboardResponse {
  status: AffiliateStatus;
  code: string;
  link: string;
  terms: AffiliateTermsDto;
  holdDays: number;
  attributionDays: number;
  /** Accounts attributed to this affiliate. */
  signups: number;
  /** Of those, accounts with at least one commissionable paid invoice. */
  payingCustomers: number;
  totals: { pendingCents: number; payableCents: number; paidCents: number };
  commissions: AffiliateCommissionDto[];
}

/** POST /v1/affiliates/attribution — first touch of a signed-in account (code from the link it arrived with). */
export interface AffiliateAttributionRequest {
  code: string;
  /** When the link was opened (ISO); clamped to now, refused when older than AFFILIATE_ATTRIBUTION_DAYS. */
  touchedAt?: string;
}
export interface AffiliateAttributionResponse {
  /** false when the account was already attributed (first touch wins) or cannot be (existing customer, own code). */
  attributed: boolean;
}

/** Admin view of an application (personal fields decrypted for staff only). */
export interface AdminAffiliateDto {
  id: string;
  status: AffiliateStatus;
  code: string | null;
  legalName: string;
  businessName: string | null;
  email: string;
  phone: string;
  province: AffiliateProvince;
  channels: AffiliateChannel[];
  audienceSize: AffiliateAudienceSize;
  gstNumber: string | null;
  qstNumber: string | null;
  locale: "fr-CA" | "en-CA";
  caslConsent: boolean;
  terms: AffiliateTermsDto;
  contractMode: "docusign" | "manual" | null;
  envelopeId: string | null;
  contractSentAt: string | null;
  signedAt: string | null;
  statusReason: string | null;
  createdAt: string;
}

/** POST /v1/admin/affiliates/:id/contract. */
export type SendContractResponse =
  | { mode: "docusign"; envelopeId: string; affiliate: AdminAffiliateDto }
  | { mode: "manual"; contractText: string; affiliate: AdminAffiliateDto };
