import { randomUUID } from "node:crypto";
import { EARN_REASONS } from "@mimt/shared";
import type {
  NewPointsCampaign,
  PointsAccountRow,
  PointsCampaignPatch,
  PointsCampaignRow,
  PointsEarnInput,
  PointsEarnResult,
  PointsLedgerRow,
  PointsRedeemInput,
  PointsRedeemResult,
  PointsRedemptionRow,
  PointsRepository,
} from "./points.js";

const copy = <T>(v: T): T => structuredClone(v);

/** Same rules as 0018_points.sql and PostgresPointsRepository (single-threaded: every call is atomic). */
export class MemoryPointsRepository implements PointsRepository {
  readonly accounts = new Map<string, PointsAccountRow>();
  readonly ledger: PointsLedgerRow[] = [];
  readonly redemptions: PointsRedemptionRow[] = [];
  readonly campaigns: PointsCampaignRow[] = [];

  private account(id: string, at: Date): PointsAccountRow {
    let a = this.accounts.get(id);
    if (!a) {
      a = { telecomAccountId: id, balance: 0, lifetimeEarned: 0, lastActivityAt: at };
      this.accounts.set(id, a);
    }
    return a;
  }

  private write(a: PointsAccountRow, row: Omit<PointsLedgerRow, "id" | "balanceAfter" | "telecomAccountId">): PointsLedgerRow {
    if (row.idempotencyKey.length < 3 || row.idempotencyKey.length > 300) throw new Error("idempotency key length");
    if (this.ledger.some((l) => l.idempotencyKey === row.idempotencyKey)) throw new Error("duplicate idempotency key");
    const balance = a.balance + row.delta;
    if (balance < 0) throw new Error("balance would be negative");
    a.balance = balance;
    if (row.delta > 0 && row.reason !== "refund") a.lifetimeEarned += row.delta;
    a.lastActivityAt = row.createdAt;
    const full: PointsLedgerRow = { ...row, id: randomUUID(), telecomAccountId: a.telecomAccountId, balanceAfter: balance };
    this.ledger.push(full);
    return copy(full);
  }

  async getAccount(accountId: string) {
    const a = this.accounts.get(accountId);
    return a ? copy(a) : null;
  }

  async listLedger(accountId: string, limit: number) {
    return this.ledger
      .filter((l) => l.telecomAccountId === accountId)
      .slice()
      .reverse()
      .slice(0, limit)
      .map((l) => ({ ...copy(l), campaignName: l.campaignId ? (this.campaigns.find((c) => c.id === l.campaignId)?.name ?? null) : null }));
  }

  async usedKeys(keys: string[]) {
    const set = new Set(keys);
    return new Set(this.ledger.filter((l) => set.has(l.idempotencyKey)).map((l) => l.idempotencyKey));
  }

  private earnedSince(accountId: string, since: Date) {
    return this.ledger
      .filter((l) => l.telecomAccountId === accountId && EARN_REASONS.includes(l.reason) && l.createdAt.getTime() >= since.getTime())
      .reduce((s, l) => s + l.delta, 0);
  }

  async earn(input: PointsEarnInput): Promise<PointsEarnResult> {
    const a = this.account(input.telecomAccountId, input.at);
    const written: PointsLedgerRow[] = [];
    let duplicates = 0;
    for (const e of input.entries) {
      if (this.ledger.some((l) => l.idempotencyKey === e.idempotencyKey)) {
        duplicates++;
        continue;
      }
      const day = Math.max(0, input.caps.daily - this.earnedSince(a.telecomAccountId, input.caps.dayStart));
      const month = Math.max(0, input.caps.monthly - this.earnedSince(a.telecomAccountId, input.caps.monthStart));
      let grant = Math.max(0, Math.min(Math.floor(e.points), day, month));
      const meta: Record<string, unknown> = { ...(e.meta ?? {}) };
      if (e.campaignId) {
        const c = this.campaigns.find((x) => x.id === e.campaignId);
        const live = c && c.active && c.startsAt.getTime() <= input.at.getTime() && input.at.getTime() < c.endsAt.getTime();
        grant = live ? Math.min(grant, c.budgetPoints - c.spentPoints) : 0;
        if (c && grant > 0) c.spentPoints += grant;
      }
      if (grant < e.points) meta.requested = e.points;
      written.push(this.write(a, { delta: grant, reason: e.reason, reference: e.reference, campaignId: e.campaignId ?? null, idempotencyKey: e.idempotencyKey, meta, createdAt: input.at }));
    }
    return { written, duplicates, balance: a.balance };
  }

  async redeem(input: PointsRedeemInput): Promise<PointsRedeemResult> {
    const a = this.account(input.telecomAccountId, input.at);
    const existing = this.redemptions.find((r) => r.telecomAccountId === input.telecomAccountId && r.clientKey === input.clientKey);
    if (existing) return { status: "replay", redemption: copy(existing), balance: a.balance };
    const used = this.redemptions.filter(
      (r) => r.telecomAccountId === input.telecomAccountId && r.rewardId === input.rewardId && r.status !== "refunded" && r.createdAt.getTime() >= input.monthStart.getTime(),
    ).length;
    if (used >= input.monthlyLimit) return { status: "monthly_limit", used };
    if (a.balance < input.points) return { status: "insufficient", balance: a.balance };
    const redemption: PointsRedemptionRow = {
      id: randomUUID(),
      telecomAccountId: input.telecomAccountId,
      rewardId: input.rewardId,
      points: input.points,
      status: "pending",
      clientKey: input.clientKey,
      fulfilmentRef: null,
      error: null,
      createdAt: input.at,
      updatedAt: input.at,
    };
    this.write(a, { delta: -input.points, reason: "redeem", reference: `reward:${input.rewardId}`, campaignId: null, idempotencyKey: `redeem:${redemption.id}`, meta: { redemptionId: redemption.id, ...(input.meta ?? {}) }, createdAt: input.at });
    this.redemptions.push(redemption);
    return { status: "created", redemption: copy(redemption), balance: a.balance };
  }

  async finishRedemption(id: string, fulfilmentRef: string | null, at: Date) {
    const r = this.redemptions.find((x) => x.id === id && x.status === "pending");
    if (!r) return null;
    Object.assign(r, { status: "fulfilled", fulfilmentRef, updatedAt: at });
    return copy(r);
  }

  async refundRedemption(id: string, error: string, at: Date) {
    const r = this.redemptions.find((x) => x.id === id && x.status === "pending");
    if (!r) return null;
    const a = this.account(r.telecomAccountId, at);
    this.write(a, { delta: r.points, reason: "refund", reference: `reward:${r.rewardId}`, campaignId: null, idempotencyKey: `refund:${r.id}`, meta: { redemptionId: r.id }, createdAt: at });
    Object.assign(r, { status: "refunded", error: error.slice(0, 200), updatedAt: at });
    return { redemption: copy(r), balance: a.balance };
  }

  async countRedemptions(accountId: string, since: Date) {
    const out: Record<string, number> = {};
    for (const r of this.redemptions) {
      if (r.telecomAccountId !== accountId || r.status === "refunded" || r.createdAt.getTime() < since.getTime()) continue;
      out[r.rewardId] = (out[r.rewardId] ?? 0) + 1;
    }
    return out;
  }

  async createCampaign(c: NewPointsCampaign) {
    const row: PointsCampaignRow = { ...c, id: randomUUID(), spentPoints: 0, active: true, createdAt: new Date(), updatedAt: new Date() };
    this.campaigns.push(row);
    return copy(row);
  }

  async updateCampaign(id: string, patch: PointsCampaignPatch) {
    const c = this.campaigns.find((x) => x.id === id);
    if (!c) return null;
    if (patch.budgetPoints !== undefined && patch.budgetPoints < c.spentPoints) throw new Error("budget below spent points");
    if (patch.endsAt && patch.endsAt.getTime() <= c.startsAt.getTime()) throw new Error("ends before it starts");
    Object.assign(c, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), { updatedAt: new Date() });
    return copy(c);
  }

  async getCampaign(id: string) {
    const c = this.campaigns.find((x) => x.id === id);
    return c ? copy(c) : null;
  }

  async listCampaigns() {
    return this.campaigns
      .slice()
      .sort((x, y) => y.startsAt.getTime() - x.startsAt.getTime())
      .map(copy);
  }

  async activeCampaigns(at: Date) {
    return this.campaigns
      .filter((c) => c.active && c.startsAt.getTime() <= at.getTime() && at.getTime() < c.endsAt.getTime() && c.spentPoints < c.budgetPoints)
      .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())
      .map(copy);
  }

  async listExpirable(before: Date, limit: number) {
    return [...this.accounts.values()]
      .filter((a) => a.balance > 0 && a.lastActivityAt.getTime() < before.getTime())
      .sort((x, y) => x.lastActivityAt.getTime() - y.lastActivityAt.getTime())
      .slice(0, limit)
      .map(copy);
  }

  async expire(accountId: string, before: Date, at: Date) {
    const a = this.accounts.get(accountId);
    if (!a || a.balance <= 0 || a.lastActivityAt.getTime() >= before.getTime()) return null;
    const key = `expiry:${accountId}:${a.lastActivityAt.toISOString()}`;
    return this.write(a, { delta: -a.balance, reason: "expiry", reference: "inactivity", campaignId: null, idempotencyKey: key, meta: { inactiveSince: a.lastActivityAt.toISOString() }, createdAt: at });
  }
}
