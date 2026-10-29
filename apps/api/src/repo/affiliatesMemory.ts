import { randomUUID } from "node:crypto";
import type { AffiliateStatus } from "@mimt/shared";
import type {
  AffiliateCommissionRow,
  AffiliatePatch,
  AffiliateReferralRow,
  AffiliateRepository,
  AffiliateRow,
  NewAffiliate,
  NewAffiliateCommission,
} from "./affiliates.js";

const clone = <T>(v: T): T => structuredClone(v);
const DASHBOARD = new Set<AffiliateStatus>(["active", "suspended"]);

/** Same rules as the Postgres constraints of 0019_affiliates.sql. */
export class MemoryAffiliateRepository implements AffiliateRepository {
  readonly affiliates = new Map<string, AffiliateRow>();
  readonly referrals = new Map<string, AffiliateReferralRow>();
  readonly holdTouches = new Map<string, { affiliateId: string; touchedAt: Date }>();
  readonly commissions: AffiliateCommissionRow[] = [];

  async createApplication(a: NewAffiliate) {
    if ([...this.affiliates.values()].some((r) => r.emailHash === a.emailHash && r.status !== "rejected")) return null;
    const now = new Date();
    const row: AffiliateRow = {
      ...a,
      channels: [...a.channels],
      id: randomUUID(),
      status: "applied",
      code: null,
      commissionBps: 2000,
      durationMonths: 12,
      payoutThresholdCents: 5000,
      userId: null,
      contractMode: null,
      envelopeId: null,
      contractSentAt: null,
      signedAt: null,
      decidedAt: null,
      statusReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.affiliates.set(row.id, row);
    return clone(row);
  }

  async get(id: string) {
    const r = this.affiliates.get(id);
    return r ? clone(r) : null;
  }
  private find(pred: (r: AffiliateRow) => boolean) {
    const r = [...this.affiliates.values()].find(pred);
    return r ? clone(r) : null;
  }
  async findByCode(code: string) {
    return this.find((r) => r.code === code);
  }
  async findByEnvelope(envelopeId: string) {
    return this.find((r) => r.envelopeId === envelopeId);
  }
  async findByUser(userId: string) {
    return this.find((r) => r.userId === userId);
  }
  async findUnboundByPhoneHash(phoneHash: string) {
    return [...this.affiliates.values()].filter((r) => r.phoneHash === phoneHash && r.userId === null && DASHBOARD.has(r.status)).map(clone);
  }
  async list(filter: { status?: AffiliateStatus; limit: number }) {
    return [...this.affiliates.values()]
      .filter((r) => !filter.status || r.status === filter.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filter.limit)
      .map(clone);
  }

  async update(id: string, from: readonly AffiliateStatus[], patch: AffiliatePatch) {
    const r = this.affiliates.get(id);
    if (!r || !from.includes(r.status)) return null;
    if (patch.code && [...this.affiliates.values()].some((o) => o.id !== id && o.code === patch.code)) return null;
    if (patch.envelopeId && [...this.affiliates.values()].some((o) => o.id !== id && o.envelopeId === patch.envelopeId)) return null;
    Object.assign(r, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), { updatedAt: new Date() });
    return clone(r);
  }

  async bindUser(id: string, userId: string) {
    const r = this.affiliates.get(id);
    if (!r || r.userId !== null) return false;
    if ([...this.affiliates.values()].some((o) => o.userId === userId)) return false;
    r.userId = userId;
    return true;
  }

  async purgeRejected(before: Date) {
    let n = 0;
    for (const [id, r] of this.affiliates) {
      if (r.status === "rejected" && (r.decidedAt ?? r.updatedAt) < before && !this.commissions.some((c) => c.affiliateId === id)) {
        this.affiliates.delete(id);
        n++;
      }
    }
    return n;
  }

  async recordReferral(r: Omit<AffiliateReferralRow, "commissionStartAt" | "createdAt">) {
    const existing = this.referrals.get(r.telecomAccountId);
    if (existing) return { row: clone(existing), created: false };
    const row: AffiliateReferralRow = { ...r, commissionStartAt: null, createdAt: new Date() };
    this.referrals.set(r.telecomAccountId, row);
    return { row: clone(row), created: true };
  }
  async getReferral(telecomAccountId: string) {
    const r = this.referrals.get(telecomAccountId);
    return r ? clone(r) : null;
  }
  async startCommission(telecomAccountId: string, at: Date) {
    const r = this.referrals.get(telecomAccountId);
    if (!r) return null;
    r.commissionStartAt ??= at;
    return clone(r);
  }
  async countReferrals(affiliateId: string) {
    const rows = [...this.referrals.values()].filter((r) => r.affiliateId === affiliateId);
    return { signups: rows.length, paying: rows.filter((r) => r.commissionStartAt !== null).length };
  }
  async addHoldTouch(numberHoldId: string, affiliateId: string, touchedAt: Date) {
    if (!this.holdTouches.has(numberHoldId)) this.holdTouches.set(numberHoldId, { affiliateId, touchedAt });
  }
  async getHoldTouch(numberHoldId: string) {
    const t = this.holdTouches.get(numberHoldId);
    return t ? clone(t) : null;
  }

  async addCommission(c: NewAffiliateCommission) {
    const sourceRef = `invoice:${c.stripeInvoiceId}`;
    if (this.commissions.some((r) => r.sourceRef === sourceRef)) return null;
    const row: AffiliateCommissionRow = {
      ...c,
      id: randomUUID(),
      kind: "invoice",
      sourceRef,
      reversedCents: 0,
      status: "pending",
      reversalReason: null,
      paidAt: null,
      payoutRef: null,
      createdAt: new Date(),
    };
    this.commissions.push(row);
    return clone(row);
  }

  async getInvoiceCommission(stripeInvoiceId: string) {
    const r = this.commissions.find((c) => c.kind === "invoice" && c.stripeInvoiceId === stripeInvoiceId);
    return r ? clone(r) : null;
  }

  async applyReversal(stripeInvoiceId: string, targetReversedCents: number, reason: "refund" | "chargeback" | "fraud", at: Date) {
    const row = this.commissions.find((r) => r.kind === "invoice" && r.stripeInvoiceId === stripeInvoiceId);
    if (!row) return null;
    const target = Math.min(Math.max(0, Math.floor(targetReversedCents)), row.commissionCents);
    if (target <= row.reversedCents || row.status === "reversed") return null;
    const delta = target - row.reversedCents;
    row.reversedCents = target;
    row.reversalReason = reason;
    let clawback: AffiliateCommissionRow | null = null;
    if (row.status === "paid") {
      const sourceRef = `clawback:${stripeInvoiceId}:${target}`;
      if (!this.commissions.some((r) => r.sourceRef === sourceRef)) {
        clawback = {
          id: randomUUID(),
          affiliateId: row.affiliateId,
          telecomAccountId: row.telecomAccountId,
          kind: "clawback",
          sourceRef,
          stripeInvoiceId,
          netRevenueCents: 0,
          commissionBps: row.commissionBps,
          commissionCents: -delta,
          reversedCents: 0,
          status: "payable",
          reversalReason: reason,
          earnedAt: at,
          payableAt: at,
          paidAt: null,
          payoutRef: null,
          createdAt: new Date(),
        };
        this.commissions.push(clawback);
      }
    } else if (target >= row.commissionCents) {
      row.status = "reversed";
    }
    return { commission: clone(row), clawback: clawback ? clone(clawback) : null };
  }

  async releaseDue(now: Date) {
    let n = 0;
    for (const r of this.commissions) {
      if (r.status === "pending" && r.payableAt <= now) {
        r.status = "payable";
        n++;
      }
    }
    return n;
  }
  async listCommissions(affiliateId: string) {
    return this.commissions
      .filter((r) => r.affiliateId === affiliateId)
      .sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime())
      .map(clone);
  }
  async listPayable() {
    return this.commissions
      .filter((r) => r.status === "payable")
      .sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime())
      .map(clone);
  }
  async markPaid(affiliateId: string, input: { ids?: string[]; payoutRef: string; at: Date }) {
    const out: AffiliateCommissionRow[] = [];
    for (const r of this.commissions) {
      if (r.affiliateId !== affiliateId || r.status !== "payable") continue;
      if (input.ids && !input.ids.includes(r.id)) continue;
      r.status = "paid";
      r.paidAt = input.at;
      r.payoutRef = input.payoutRef;
      out.push(clone(r));
    }
    return out;
  }
}
