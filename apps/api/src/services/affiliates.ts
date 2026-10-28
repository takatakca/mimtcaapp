// « Programme d'agents affiliés MIMT » (docs/MIMT-AFFILIATES.md).
// - Public application (mimt.ca/affilies/) → admin approves (code + terms) → contract (DocuSign or manual) → signed =
//   active. Personal fields are one encrypted blob (Law 25); email/phone are keyed hashes for dedupe and binding.
// - Attribution: first touch wins, one affiliate per account, the first paid invoice within 60 days of the click,
//   never the affiliate themself (same user, phone, email or card).
// - Ledger: one commission per paid Stripe invoice of a referred customer during duration_months, pending 30 days,
//   then payable; refunds/chargebacks reverse it (clawback row when already paid).
import { randomInt } from "node:crypto";
import {
  AFFILIATE_ATTRIBUTION_DAYS,
  AFFILIATE_CODE_ALPHABET,
  AFFILIATE_DEFAULTS,
  AFFILIATE_HOLD_DAYS,
  AFFILIATE_LINK_PARAM,
  affiliateCommissionCents,
  formatCommissionPct,
  normalizeAffiliateCode,
  type AdminAffiliateDto,
  type AffiliateApplicationRequest,
  type AffiliateCommissionDto,
  type AffiliateDashboardResponse,
  type AffiliateStatus,
  type AffiliateTermsDto,
  type SendContractResponse,
} from "@mimt/shared";
import type { FastifyBaseLogger } from "fastify";
import { CONTRACT_EN, CONTRACT_FR } from "../affiliates/contractTemplate.js";
import type { AppDeps } from "../deps.js";
import type { ContractTabs } from "../gateways/docusign.js";
import { conflict, HttpError, notFound } from "../lib/errors.js";
import { addDays, DAY_MS } from "../lib/time.js";
import { commissionAmount, type AffiliateCommissionRow, type AffiliateRow } from "../repo/affiliates.js";
import type { Subscription, TelecomAccount, User } from "../repo/types.js";

type Log = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

/** What the application blob holds (encrypted with MessageCipher). */
export interface AffiliatePii {
  legalName: string;
  businessName: string | null;
  email: string;
  phone: string;
  gstNumber: string | null;
  qstNumber: string | null;
}

/** Statuses that earn commissions and see the dashboard (payouts are withheld while suspended). */
const EARNING = new Set<AffiliateStatus>(["active", "suspended"]);
const PAID_SOURCES = new Set<Subscription["source"]>(["stripe", "iap_apple", "iap_google"]);
/** Rejected applications are deleted this long after the decision (Law 25: kept only as long as needed). */
export const REJECTED_RETENTION_DAYS = 90;
const CODE_LENGTH = 8;

const emailKey = (email: string) => email.trim().toLowerCase();

/** "514 555-0199", "+1 (514) 555-0199" → "+15145550199"; null when not a North American number. */
export function normalizeNanpPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
}

export const affiliateLink = (appBaseUrl: string, code: string) => `${appBaseUrl.replace(/\/$/, "")}/?${AFFILIATE_LINK_PARAM}=${code}`;

function readPii(deps: AppDeps, row: AffiliateRow): AffiliatePii {
  return JSON.parse(deps.cipher.decrypt(row.piiEnc)) as AffiliatePii;
}

const termsOf = (r: AffiliateRow): AffiliateTermsDto => ({ commissionBps: r.commissionBps, durationMonths: r.durationMonths, payoutThresholdCents: r.payoutThresholdCents });

export function adminAffiliateDto(deps: AppDeps, r: AffiliateRow): AdminAffiliateDto {
  const pii = readPii(deps, r);
  return {
    id: r.id,
    status: r.status,
    code: r.code,
    legalName: pii.legalName,
    businessName: pii.businessName,
    email: pii.email,
    phone: pii.phone,
    province: r.province,
    channels: r.channels,
    audienceSize: r.audienceSize,
    gstNumber: pii.gstNumber,
    qstNumber: pii.qstNumber,
    locale: r.locale,
    caslConsent: r.caslConsent,
    terms: termsOf(r),
    contractMode: r.contractMode,
    envelopeId: r.envelopeId,
    contractSentAt: r.contractSentAt?.toISOString() ?? null,
    signedAt: r.signedAt?.toISOString() ?? null,
    statusReason: r.statusReason,
    createdAt: r.createdAt.toISOString(),
  };
}

// ------------------------------------------------------------------------------------------ application

/**
 * Stores an application (already validated by the route). Returns nothing either way: a second application with the
 * same email is ignored silently, so the form never reveals who applied.
 */
export async function submitAffiliateApplication(deps: AppDeps, body: AffiliateApplicationRequest & { phoneE164: string }): Promise<void> {
  const pii: AffiliatePii = {
    legalName: body.legalName.trim(),
    businessName: body.businessName?.trim() || null,
    email: emailKey(body.email),
    phone: body.phoneE164,
    gstNumber: body.gstNumber?.replace(/\s/g, "").toUpperCase() || null,
    qstNumber: body.qstNumber?.replace(/\s/g, "").toUpperCase() || null,
  };
  const row = await deps.repo.affiliates.createApplication({
    piiEnc: deps.cipher.encrypt(JSON.stringify(pii)),
    emailHash: deps.cipher.subjectHash("email", pii.email),
    phoneHash: deps.cipher.subjectHash("phone", pii.phone),
    province: body.province,
    channels: [...new Set(body.channels)],
    audienceSize: body.audienceSize,
    locale: body.locale,
    privacyNoticeVersion: body.consents.privacyNoticeVersion,
    caslConsent: body.consents.marketing,
    adultAttested: body.adult,
  });
  // No personal data in the audit log: only the row id.
  if (row) await deps.repo.audit({ actorUserId: null, action: "affiliate.applied", targetType: "affiliate", targetId: row.id });
}

// ------------------------------------------------------------------------------------------ admin workflow

async function mustGet(deps: AppDeps, id: string): Promise<AffiliateRow> {
  const row = await deps.repo.affiliates.get(id);
  if (!row) throw notFound("affiliate_not_found");
  return row;
}

const wrongStatus = (row: AffiliateRow, action: string) =>
  conflict("affiliate_wrong_status", `Impossible de ${action} : l'affilié est au statut « ${row.status} ».`);

export async function approveAffiliate(deps: AppDeps, id: string, actorUserId: string, terms?: Partial<AffiliateTermsDto>): Promise<AffiliateRow> {
  const row = await mustGet(deps, id);
  if (row.status !== "applied") throw wrongStatus(row, "approuver");
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = Array.from({ length: CODE_LENGTH }, () => AFFILIATE_CODE_ALPHABET[randomInt(AFFILIATE_CODE_ALPHABET.length)]).join("");
    const updated = await deps.repo.affiliates.update(id, ["applied"], {
      status: "approved",
      code,
      decidedAt: deps.now(),
      statusReason: null,
      commissionBps: terms?.commissionBps ?? AFFILIATE_DEFAULTS.commissionBps,
      durationMonths: terms?.durationMonths ?? AFFILIATE_DEFAULTS.durationMonths,
      payoutThresholdCents: terms?.payoutThresholdCents ?? AFFILIATE_DEFAULTS.payoutThresholdCents,
    });
    if (updated) {
      await deps.repo.audit({ actorUserId, action: "affiliate.approved", targetType: "affiliate", targetId: id, meta: { terms: termsOf(updated) } });
      return updated;
    }
    if ((await mustGet(deps, id)).status !== "applied") throw wrongStatus(await mustGet(deps, id), "approuver");
  }
  throw new Error("could not allocate an affiliate code");
}

export async function rejectAffiliate(deps: AppDeps, id: string, actorUserId: string, reason: string | null): Promise<AffiliateRow> {
  const updated = await deps.repo.affiliates.update(id, ["applied", "approved"], { status: "rejected", decidedAt: deps.now(), statusReason: reason });
  if (!updated) throw wrongStatus(await mustGet(deps, id), "refuser");
  await deps.repo.audit({ actorUserId, action: "affiliate.rejected", targetType: "affiliate", targetId: id });
  return updated;
}

/**
 * Terms are set before signature only. After a contract was sent, changing them puts the affiliate back to
 * « approved » (void the old envelope in DocuSign and send the contract again).
 */
export async function setAffiliateTerms(deps: AppDeps, id: string, actorUserId: string, terms: AffiliateTermsDto): Promise<AffiliateRow> {
  const row = await mustGet(deps, id);
  const resend = row.status === "contract_sent";
  const updated = await deps.repo.affiliates.update(id, ["applied", "approved", "contract_sent"], {
    ...terms,
    ...(resend ? { status: "approved" as const, envelopeId: null, contractMode: null, contractSentAt: null } : {}),
  });
  if (!updated) throw wrongStatus(row, "changer les conditions");
  await deps.repo.audit({ actorUserId, action: "affiliate.terms_set", targetType: "affiliate", targetId: id, meta: { terms, resetContract: resend } });
  return updated;
}

/** Montréal calendar date, YYYY-MM-DD. */
const montrealDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montreal", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function contractTabs(row: Pick<AffiliateRow, "commissionBps" | "durationMonths" | "payoutThresholdCents">, legalName: string, effective: Date, lang: "fr" | "en" = "fr"): ContractTabs {
  const threshold = (row.payoutThresholdCents / 100).toFixed(2);
  return {
    affiliate_legal_name: legalName,
    commission_pct: formatCommissionPct(row.commissionBps, lang),
    duration_months: String(row.durationMonths),
    payout_threshold: lang === "fr" ? threshold.replace(".", ",") : threshold,
    effective_date: montrealDate(effective),
  };
}

/** Replaces every {{placeholder}}. Throws when one is left (a template/tab mismatch must never be sent). */
export function fillContract(template: string, tabs: ContractTabs): string {
  const out = template.replace(/\{\{([a-z_]+)\}\}/g, (m, key: string) => (key in tabs ? tabs[key as keyof ContractTabs] : m));
  if (/\{\{[a-z_]+\}\}/.test(out)) throw new Error("contract template has an unknown placeholder");
  return out;
}

/** French first; the English translation follows only for an affiliate who chose English (Charter, s. 55). */
export function filledContractText(row: AffiliateRow, legalName: string, effective: Date): string {
  const fr = fillContract(CONTRACT_FR, contractTabs(row, legalName, effective, "fr"));
  return row.locale === "en-CA" ? `${fr}\n\n---\n\n${fillContract(CONTRACT_EN, contractTabs(row, legalName, effective, "en"))}` : fr;
}

export async function sendAffiliateContract(deps: AppDeps, id: string, actorUserId: string): Promise<SendContractResponse> {
  const row = await mustGet(deps, id);
  if (row.status !== "approved" && row.status !== "contract_sent") throw wrongStatus(row, "envoyer le contrat");
  const pii = readPii(deps, row);
  const now = deps.now();
  if (deps.contracts) {
    const { envelopeId } = await deps.contracts.sendContract({
      affiliateId: row.id,
      signerName: pii.legalName,
      signerEmail: pii.email,
      locale: row.locale,
      tabs: contractTabs(row, pii.legalName, now, "fr"),
    });
    const updated = await deps.repo.affiliates.update(id, ["approved", "contract_sent"], { status: "contract_sent", contractMode: "docusign", envelopeId, contractSentAt: now });
    if (!updated) throw wrongStatus(await mustGet(deps, id), "envoyer le contrat");
    await deps.repo.audit({ actorUserId, action: "affiliate.contract_sent", targetType: "affiliate", targetId: id, meta: { mode: "docusign", envelopeId } });
    return { mode: "docusign", envelopeId, affiliate: adminAffiliateDto(deps, updated) };
  }
  const contractText = filledContractText(row, pii.legalName, now);
  const updated = await deps.repo.affiliates.update(id, ["approved", "contract_sent"], { status: "contract_sent", contractMode: "manual", envelopeId: null, contractSentAt: now });
  if (!updated) throw wrongStatus(await mustGet(deps, id), "envoyer le contrat");
  await deps.repo.audit({ actorUserId, action: "affiliate.contract_sent", targetType: "affiliate", targetId: id, meta: { mode: "manual" } });
  return { mode: "manual", contractText, affiliate: adminAffiliateDto(deps, updated) };
}

/** contract_sent → active. `via` = docusign (Connect webhook) or manual (admin, after a signature outside DocuSign). */
export async function markAffiliateSigned(deps: AppDeps, id: string, input: { actorUserId: string | null; signedAt: Date; via: "docusign" | "manual" }): Promise<AffiliateRow> {
  const updated = await deps.repo.affiliates.update(id, ["contract_sent"], { status: "active", signedAt: input.signedAt, statusReason: null });
  if (!updated) throw wrongStatus(await mustGet(deps, id), "marquer le contrat signé");
  await deps.repo.audit({ actorUserId: input.actorUserId, action: "affiliate.signed", targetType: "affiliate", targetId: id, meta: { via: input.via } });
  return updated;
}

const STATUS_FROM: Record<"active" | "suspended" | "terminated", AffiliateStatus[]> = {
  active: ["suspended"],
  suspended: ["active"],
  terminated: ["active", "suspended", "contract_sent", "approved"],
};

export async function setAffiliateStatus(deps: AppDeps, id: string, actorUserId: string, status: "active" | "suspended" | "terminated", reason: string | null) {
  const updated = await deps.repo.affiliates.update(id, STATUS_FROM[status], { status, statusReason: reason, decidedAt: deps.now() });
  if (!updated) throw wrongStatus(await mustGet(deps, id), `passer au statut « ${status} »`);
  await deps.repo.audit({ actorUserId, action: `affiliate.${status}`, targetType: "affiliate", targetId: id });
  return updated;
}

/** DocuSign Connect: completed → active; declined/voided → back to approved (send again). Unknown envelopes ignored. */
export async function handleContractEvent(deps: AppDeps, event: { envelopeId: string; status: string }, log?: Log): Promise<"activated" | "reset" | "ignored"> {
  const row = await deps.repo.affiliates.findByEnvelope(event.envelopeId);
  if (!row || row.status !== "contract_sent") return "ignored";
  if (event.status === "completed") {
    await markAffiliateSigned(deps, row.id, { actorUserId: null, signedAt: deps.now(), via: "docusign" });
    log?.info({ affiliate: row.id }, "affiliate contract signed");
    return "activated";
  }
  if (event.status === "declined" || event.status === "voided") {
    await deps.repo.affiliates.update(row.id, ["contract_sent"], { status: "approved", statusReason: `contract_${event.status}`, envelopeId: null, contractMode: null });
    await deps.repo.audit({ actorUserId: null, action: `affiliate.contract_${event.status}`, targetType: "affiliate", targetId: row.id });
    return "reset";
  }
  return "ignored";
}

// ------------------------------------------------------------------------------------------ attribution

/** The affiliate's own user, phone or email on the referred side. */
function isSelf(deps: AppDeps, affiliate: AffiliateRow, user: User): boolean {
  if (affiliate.userId === user.id) return true;
  if (user.phoneE164 && deps.cipher.subjectHash("phone", user.phoneE164) === affiliate.phoneHash) return true;
  if (user.email && deps.cipher.subjectHash("email", emailKey(user.email)) === affiliate.emailHash) return true;
  return false;
}

/**
 * Records which affiliate brought this account (first touch wins). Never throws for a bad or late code: the caller
 * (sign-up, checkout) must not fail because of it. False when nothing was recorded.
 */
export async function attributeAccount(
  deps: AppDeps,
  input: { user: User; account: TelecomAccount; code: string; touchedAt?: Date | null; source: "signup" | "checkout" | "hold"; affiliateId?: string },
): Promise<boolean> {
  const { repo } = deps;
  const now = deps.now();
  if (await repo.affiliates.getReferral(input.account.id)) return false;
  const affiliate = input.affiliateId ? await repo.affiliates.get(input.affiliateId) : await findActiveByCode(deps, input.code);
  if (!affiliate || affiliate.status !== "active") return false;
  const touchedAt = !input.touchedAt || Number.isNaN(input.touchedAt.getTime()) || input.touchedAt > now ? now : input.touchedAt;
  if (now.getTime() - touchedAt.getTime() > AFFILIATE_ATTRIBUTION_DAYS * DAY_MS) return false;
  // Existing customers are not new customers.
  if ((await repo.listSubscriptions(input.account.id)).some((s) => s.kind === "plan" && PAID_SOURCES.has(s.source))) return false;
  if (isSelf(deps, affiliate, input.user)) {
    await repo.addFraudEvent({ telecomAccountId: input.account.id, rule: "affiliate_self_referral", score: 50, action: "block", details: { affiliateId: affiliate.id } });
    return false;
  }
  const { created } = await repo.affiliates.recordReferral({
    telecomAccountId: input.account.id,
    affiliateId: affiliate.id,
    source: input.source,
    touchedAt,
    expiresAt: addDays(touchedAt, AFFILIATE_ATTRIBUTION_DAYS),
  });
  if (created) await repo.audit({ actorUserId: input.user.id, action: "affiliate.attributed", targetType: "affiliate", targetId: affiliate.id, meta: { source: input.source } });
  return created;
}

async function findActiveByCode(deps: AppDeps, raw: string): Promise<AffiliateRow | null> {
  const code = normalizeAffiliateCode(raw);
  if (!code) return null;
  const row = await deps.repo.affiliates.findByCode(code);
  return row?.status === "active" ? row : null;
}

/** mimt.ca live picker: the code the visitor arrived with is kept with the hold until it is paid for. */
export async function recordHoldTouch(deps: AppDeps, holdId: string, code: string, touchedAt: Date | null): Promise<void> {
  const affiliate = await findActiveByCode(deps, code);
  if (!affiliate) return;
  const now = deps.now();
  const at = !touchedAt || Number.isNaN(touchedAt.getTime()) || touchedAt > now ? now : touchedAt;
  if (now.getTime() - at.getTime() > AFFILIATE_ATTRIBUTION_DAYS * DAY_MS) return;
  await deps.repo.affiliates.addHoldTouch(holdId, affiliate.id, at);
}

export async function attributeFromHold(deps: AppDeps, input: { user: User; account: TelecomAccount; holdId: string }): Promise<boolean> {
  const touch = await deps.repo.affiliates.getHoldTouch(input.holdId);
  if (!touch) return false;
  return attributeAccount(deps, { user: input.user, account: input.account, code: "", touchedAt: touch.touchedAt, source: "hold", affiliateId: touch.affiliateId });
}

// ------------------------------------------------------------------------------------------ ledger

const TAX_LINE = /\b(TPS|GST|TVQ|QST)\b|9-1-1/;

/**
 * Net revenue of a paid Stripe invoice: what was paid, less the GST/QST/9-1-1 tax lines (MIMT bills taxes as their
 * own invoice lines while Stripe Tax is off), in proportion when a balance credit or discount paid part of it.
 * Without line details, taxes are taken out at the Québec rate (GST + QST), which never overstates the base.
 */
export function invoiceNetRevenueCents(inv: { amount_paid?: number | null; lines?: { data?: Array<{ amount?: number | null; description?: string | null }> } | null }): number {
  const paid = inv.amount_paid ?? 0;
  if (paid <= 0) return 0;
  const lines = inv.lines?.data ?? [];
  if (lines.length === 0) return Math.floor(paid / 1.14975);
  let base = 0;
  let tax = 0;
  for (const l of lines) {
    const amount = l.amount ?? 0;
    if (TAX_LINE.test(l.description ?? "")) tax += amount;
    else base += amount;
  }
  if (base <= 0) return 0;
  return Math.min(base, Math.floor((paid * base) / (base + tax)));
}

const addMonths = (d: Date, months: number) => {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
};

/**
 * Stripe invoice.paid of any account: adds the commission when the account was brought by an earning affiliate,
 * inside the attribution window (first invoice) and the commission duration. Idempotent on the invoice id.
 */
export async function recordAffiliateCommission(
  deps: AppDeps,
  input: { account: TelecomAccount; invoiceId: string; netRevenueCents: number; paidAt: Date; fingerprint: string | null },
  log?: Log,
): Promise<AffiliateCommissionRow | null> {
  const { repo } = deps;
  const referral = await repo.affiliates.getReferral(input.account.id);
  if (!referral || input.netRevenueCents <= 0) return null;
  const affiliate = await repo.affiliates.get(referral.affiliateId);
  if (!affiliate || !EARNING.has(affiliate.status)) return null;

  if (!referral.commissionStartAt) {
    if (input.paidAt > referral.expiresAt) return null; // first payment after the 60-day window: not attributed
  } else if (input.paidAt >= addMonths(referral.commissionStartAt, affiliate.durationMonths)) {
    return null; // commission duration over
  }

  // No self-referral, checked again at payment time: the owner's verified phone or the card of the affiliate's account.
  const owner = await repo.getUser(input.account.ownerUserId);
  let self = owner ? isSelf(deps, affiliate, owner) : false;
  if (!self && input.fingerprint && affiliate.userId) {
    const own = await repo.getAccountByOwner(affiliate.userId);
    if (own && own.id !== input.account.id && (await repo.referrals.listPaymentFingerprints(own.id)).includes(input.fingerprint)) self = true;
    if (own?.id === input.account.id) self = true;
  }
  if (self) {
    await repo.addFraudEvent({ telecomAccountId: input.account.id, rule: "affiliate_self_referral", score: 50, action: "block", details: { affiliateId: affiliate.id, invoiceId: input.invoiceId } });
    log?.warn({ affiliate: affiliate.id }, "affiliate self-referral refused");
    return null;
  }

  await repo.affiliates.startCommission(input.account.id, input.paidAt);
  const row = await repo.affiliates.addCommission({
    affiliateId: affiliate.id,
    telecomAccountId: input.account.id,
    stripeInvoiceId: input.invoiceId,
    netRevenueCents: input.netRevenueCents,
    commissionBps: affiliate.commissionBps,
    commissionCents: affiliateCommissionCents(input.netRevenueCents, affiliate.commissionBps),
    earnedAt: input.paidAt,
    payableAt: addDays(input.paidAt, AFFILIATE_HOLD_DAYS),
  });
  if (row) log?.info({ affiliate: affiliate.id, commission: row.id }, "affiliate commission recorded");
  return row;
}

/** Refund (in proportion of the refunded amount) or chargeback (whole commission) of an invoice. */
export async function reverseAffiliateCommission(
  deps: AppDeps,
  input: { invoiceId: string; reason: "refund" | "chargeback" | "fraud"; refundedCents?: number; amountCents?: number },
): Promise<boolean> {
  const existing = await deps.repo.affiliates.getInvoiceCommission(input.invoiceId);
  if (!existing) return false;
  const target =
    input.reason === "refund" && input.amountCents && input.amountCents > 0 && input.refundedCents !== undefined
      ? Math.floor((existing.commissionCents * Math.min(input.refundedCents, input.amountCents)) / input.amountCents)
      : existing.commissionCents;
  const res = await deps.repo.affiliates.applyReversal(input.invoiceId, target, input.reason, deps.now());
  if (res) {
    await deps.repo.audit({
      actorUserId: null,
      action: "affiliate.commission_reversed",
      targetType: "affiliate",
      targetId: existing.affiliateId,
      meta: { commission: existing.id, reason: input.reason, reversedCents: res.commission.reversedCents, clawback: res.clawback?.id ?? null },
    });
  }
  return Boolean(res);
}

function commissionDto(r: AffiliateCommissionRow): AffiliateCommissionDto {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    netRevenueCents: r.netRevenueCents,
    commissionBps: r.commissionBps,
    amountCents: commissionAmount(r),
    earnedAt: r.earnedAt.toISOString(),
    payableAt: r.payableAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
  };
}

/**
 * GET /v1/affiliates/me. The affiliate is found by the bound user, else bound now when the signed-in user's
 * verified phone is the one on the application. Null: not an affiliate (or not active yet).
 */
export async function affiliateDashboard(deps: AppDeps, user: User): Promise<AffiliateDashboardResponse | null> {
  const { repo } = deps;
  let row = await repo.affiliates.findByUser(user.id);
  if (!row && user.phoneE164 && user.phoneVerifiedAt) {
    const candidates = await repo.affiliates.findUnboundByPhoneHash(deps.cipher.subjectHash("phone", user.phoneE164));
    for (const c of candidates) {
      if (await repo.affiliates.bindUser(c.id, user.id)) {
        row = await repo.affiliates.get(c.id);
        await repo.audit({ actorUserId: user.id, action: "affiliate.bound", targetType: "affiliate", targetId: c.id });
        break;
      }
    }
  }
  if (!row || !EARNING.has(row.status) || !row.code) return null;
  await repo.affiliates.releaseDue(deps.now());
  const [ledger, counts] = await Promise.all([repo.affiliates.listCommissions(row.id), repo.affiliates.countReferrals(row.id)]);
  const sum = (status: AffiliateCommissionRow["status"]) => ledger.filter((r) => r.status === status).reduce((s, r) => s + commissionAmount(r), 0);
  return {
    status: row.status,
    code: row.code,
    link: affiliateLink(deps.config.APP_BASE_URL, row.code),
    terms: termsOf(row),
    holdDays: AFFILIATE_HOLD_DAYS,
    attributionDays: AFFILIATE_ATTRIBUTION_DAYS,
    signups: counts.signups,
    payingCustomers: counts.paying,
    totals: { pendingCents: sum("pending"), payableCents: sum("payable"), paidCents: sum("paid") },
    commissions: ledger.slice(-200).reverse().map(commissionDto),
  };
}

// ------------------------------------------------------------------------------------------ payouts

/** Spreadsheet formula injection guard for text cells. */
const csvCell = (v: string | number | null) => {
  if (v === null) return "";
  if (typeof v === "number") return String(v);
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const PAYABLE_CSV_HEADER = [
  "affiliate_id",
  "affiliate_code",
  "legal_name",
  "business_name",
  "email",
  "province",
  "gst_number",
  "qst_number",
  "affiliate_status",
  "affiliate_total_cents",
  "commission_id",
  "kind",
  "stripe_invoice_id",
  "earned_at",
  "net_revenue_cents",
  "commission_bps",
  "amount_cents",
] as const;

/**
 * Payable commissions to pay now, one line per ledger row. An affiliate is included when active with a payable total
 * at or above their threshold, or terminated with a positive total (paid even below the threshold, contract 11.4).
 * Suspended affiliates are withheld.
 */
export async function payableCommissionsCsv(deps: AppDeps): Promise<{ csv: string; affiliates: number; totalCents: number }> {
  const { repo } = deps;
  await repo.affiliates.releaseDue(deps.now());
  const byAffiliate = new Map<string, AffiliateCommissionRow[]>();
  for (const r of await repo.affiliates.listPayable()) byAffiliate.set(r.affiliateId, [...(byAffiliate.get(r.affiliateId) ?? []), r]);
  const lines: string[] = [PAYABLE_CSV_HEADER.join(",")];
  let affiliates = 0;
  let totalCents = 0;
  for (const [affiliateId, rows] of byAffiliate) {
    const a = await repo.affiliates.get(affiliateId);
    if (!a) continue;
    const total = rows.reduce((s, r) => s + commissionAmount(r), 0);
    const due = (a.status === "active" && total >= a.payoutThresholdCents && total > 0) || (a.status === "terminated" && total > 0);
    if (!due) continue;
    affiliates++;
    totalCents += total;
    const pii = readPii(deps, a);
    for (const r of rows) {
      lines.push(
        [
          a.id,
          a.code,
          pii.legalName,
          pii.businessName,
          pii.email,
          a.province,
          pii.gstNumber,
          pii.qstNumber,
          a.status,
          total,
          r.id,
          r.kind,
          r.stripeInvoiceId,
          r.earnedAt.toISOString(),
          r.netRevenueCents,
          r.commissionBps,
          commissionAmount(r),
        ]
          .map((v) => csvCell(v))
          .join(","),
      );
    }
  }
  return { csv: lines.join("\r\n") + "\r\n", affiliates, totalCents };
}

export async function markAffiliatePaid(deps: AppDeps, input: { affiliateId: string; payoutRef: string; ids?: string[]; actorUserId: string }) {
  await mustGet(deps, input.affiliateId);
  const rows = await deps.repo.affiliates.markPaid(input.affiliateId, { payoutRef: input.payoutRef, at: deps.now(), ...(input.ids ? { ids: input.ids } : {}) });
  if (rows.length === 0) throw new HttpError(409, "nothing_payable", "Aucune commission payable pour cet affilié.");
  const totalCents = rows.reduce((s, r) => s + commissionAmount(r), 0);
  await deps.repo.audit({ actorUserId: input.actorUserId, action: "affiliate.paid", targetType: "affiliate", targetId: input.affiliateId, meta: { rows: rows.length, totalCents, payoutRef: input.payoutRef } });
  return { paid: rows.length, totalCents };
}

/** Daily: pending → payable after the hold, and rejected applications deleted after REJECTED_RETENTION_DAYS. */
export async function runAffiliateMaintenance(deps: Pick<AppDeps, "repo" | "now">): Promise<{ released: number; purged: number }> {
  const now = deps.now();
  const released = await deps.repo.affiliates.releaseDue(now);
  const purged = await deps.repo.affiliates.purgeRejected(addDays(now, -REJECTED_RETENTION_DAYS));
  return { released, purged };
}
