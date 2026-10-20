import { randomUUID } from "node:crypto";
import { LIVE_HOLD_STATES, type NumberHoldRepository, type NumberHoldRow } from "./numberHolds.js";

const live = (h: NumberHoldRow, now: Date) => LIVE_HOLD_STATES.has(h.status) && h.expiresAt > now;

export class MemoryNumberHoldRepository implements NumberHoldRepository {
  readonly rows = new Map<string, NumberHoldRow>();

  async create(h: Parameters<NumberHoldRepository["create"]>[0]) {
    for (const r of this.rows.values()) {
      if (r.e164 !== h.e164 || !LIVE_HOLD_STATES.has(r.status)) continue;
      if (r.expiresAt > h.now) return null;
      r.status = "expired";
    }
    const row: NumberHoldRow = {
      id: randomUUID(),
      e164: h.e164,
      tokenHash: h.tokenHash,
      ipHash: h.ipHash,
      status: "held",
      telecomAccountId: null,
      checkoutSessionId: null,
      expiresAt: h.expiresAt,
      createdAt: h.now,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }
  async get(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async liveHeld(e164s: readonly string[], now: Date) {
    const want = new Set(e164s);
    return new Set([...this.rows.values()].filter((r) => want.has(r.e164) && live(r, now)).map((r) => r.e164));
  }
  async liveByIp(ipHash: string, now: Date) {
    return [...this.rows.values()].filter((r) => r.ipHash === ipHash && live(r, now)).map((r) => ({ ...r }));
  }
  async countByIpSince(ipHash: string, since: Date) {
    return [...this.rows.values()].filter((r) => r.ipHash === ipHash && r.createdAt >= since).length;
  }
  async startCheckout(id: string, p: Parameters<NumberHoldRepository["startCheckout"]>[1]) {
    const r = this.rows.get(id);
    if (!r || !live(r, p.now)) return false;
    Object.assign(r, { status: "checkout", telecomAccountId: p.telecomAccountId, checkoutSessionId: p.checkoutSessionId, expiresAt: p.expiresAt });
    return true;
  }
  async finish(id: string, status: Parameters<NumberHoldRepository["finish"]>[1]) {
    const r = this.rows.get(id);
    if (!r || !LIVE_HOLD_STATES.has(r.status)) return false;
    r.status = status;
    return true;
  }
}
