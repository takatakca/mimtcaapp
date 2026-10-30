import { randomUUID } from "node:crypto";
import type {
  NewPartnerCall,
  PartnerApiKeyRow,
  PartnerCallPatch,
  PartnerCallRow,
  PartnerCreditInput,
  PartnerCreditResult,
  PartnerHuntGroupRow,
  PartnerLedgerRow,
  PartnerLinkCreateResult,
  PartnerLinkRequestRow,
  PartnerMemberLinkRow,
  PartnerMemberFields,
  PartnerMemberRow,
  PartnerPatch,
  PartnerRepository,
  PartnerRow,
  PartnerWebhookEventRow,
} from "./partners.js";

const copy = <T>(v: T): T => structuredClone(v);

/** Same rules as 0023_partners.sql and PostgresPartnerRepository (single-threaded: every call is atomic). */
export class MemoryPartnerRepository implements PartnerRepository {
  readonly partners: PartnerRow[] = [];
  readonly keys: PartnerApiKeyRow[] = [];
  readonly members: PartnerMemberRow[] = [];
  readonly huntGroups: PartnerHuntGroupRow[] = [];
  readonly ledger: PartnerLedgerRow[] = [];
  readonly calls: PartnerCallRow[] = [];
  readonly events: PartnerWebhookEventRow[] = [];
  readonly linkRequests: PartnerLinkRequestRow[] = [];
  readonly links: PartnerMemberLinkRow[] = [];

  async createPartner(p: { businessId: string; name: string; slug?: string | null; creditPerMinute: number | null; createdBy: string | null }) {
    if (this.partners.some((x) => x.businessId === p.businessId)) throw new Error("partner exists for this business");
    if (p.slug && this.partners.some((x) => x.slug === p.slug)) throw new Error("partner slug taken");
    const now = new Date();
    const row: PartnerRow = {
      ...p,
      slug: p.slug ?? null,
      id: randomUUID(),
      status: "active",
      creditBalance: 0,
      webhookUrl: null,
      webhookSecretEncrypted: null,
      creditsExhaustedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.partners.push(row);
    return copy(row);
  }

  async getPartner(id: string) {
    const p = this.partners.find((x) => x.id === id);
    return p ? copy(p) : null;
  }

  async getPartnerByBusiness(businessId: string) {
    const p = this.partners.find((x) => x.businessId === businessId);
    return p ? copy(p) : null;
  }

  async getPartnerBySlug(slug: string) {
    const p = this.partners.find((x) => x.slug === slug);
    return p ? copy(p) : null;
  }

  async listPartners() {
    return this.partners.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(copy);
  }

  async updatePartner(id: string, patch: PartnerPatch) {
    const p = this.partners.find((x) => x.id === id);
    if (!p) return null;
    if (patch.slug && this.partners.some((x) => x.id !== id && x.slug === patch.slug)) throw new Error("partner slug taken");
    Object.assign(p, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), { updatedAt: new Date() });
    return copy(p);
  }

  async createApiKey(k: Pick<PartnerApiKeyRow, "partnerId" | "prefix" | "keySha256" | "label" | "createdBy">) {
    if (this.keys.some((x) => x.keySha256 === k.keySha256)) throw new Error("duplicate key hash");
    const row: PartnerApiKeyRow = { ...k, id: randomUUID(), createdAt: new Date(), lastUsedAt: null, revokedAt: null };
    this.keys.push(row);
    return copy(row);
  }

  async findApiKeyByHash(keySha256: string) {
    const k = this.keys.find((x) => x.keySha256 === keySha256);
    return k ? copy(k) : null;
  }

  async listApiKeys(partnerId: string) {
    return this.keys
      .filter((k) => k.partnerId === partnerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(copy);
  }

  async revokeApiKey(partnerId: string, id: string, at: Date) {
    const k = this.keys.find((x) => x.id === id && x.partnerId === partnerId && !x.revokedAt);
    if (!k) return null;
    k.revokedAt = at;
    return copy(k);
  }

  async touchApiKey(id: string, at: Date) {
    const k = this.keys.find((x) => x.id === id);
    if (k) k.lastUsedAt = at;
  }

  async upsertMember(partnerId: string, externalId: string, fields: PartnerMemberFields) {
    const now = new Date();
    const existing = this.members.find((m) => m.partnerId === partnerId && m.externalId === externalId);
    if (existing) {
      Object.assign(existing, fields, { updatedAt: now });
      return { member: copy(existing), created: false };
    }
    const row: PartnerMemberRow = { ...fields, id: randomUUID(), partnerId, externalId, createdAt: now, updatedAt: now };
    this.members.push(row);
    return { member: copy(row), created: true };
  }

  async getMember(partnerId: string, externalId: string) {
    const m = this.members.find((x) => x.partnerId === partnerId && x.externalId === externalId);
    return m ? copy(m) : null;
  }

  async getMemberById(id: string) {
    const m = this.members.find((x) => x.id === id);
    return m ? copy(m) : null;
  }

  async getMemberByExtension(extensionId: string) {
    const m = this.members.find((x) => x.extensionId === extensionId);
    return m ? copy(m) : null;
  }

  async listMembers(partnerId: string) {
    return this.members
      .filter((m) => m.partnerId === partnerId)
      .sort((a, b) => (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0))
      .map(copy);
  }

  async upsertHuntGroup(h: { partnerId: string; key: string; ringGroupId: string }) {
    const now = new Date();
    const existing = this.huntGroups.find((g) => g.partnerId === h.partnerId && g.key === h.key);
    if (existing) {
      Object.assign(existing, { ringGroupId: h.ringGroupId, updatedAt: now });
      return copy(existing);
    }
    const row: PartnerHuntGroupRow = { ...h, id: randomUUID(), createdAt: now, updatedAt: now };
    this.huntGroups.push(row);
    return copy(row);
  }

  async getHuntGroup(partnerId: string, key: string) {
    const g = this.huntGroups.find((x) => x.partnerId === partnerId && x.key === key);
    return g ? copy(g) : null;
  }

  async getHuntGroupByRingGroup(ringGroupId: string) {
    const g = this.huntGroups.find((x) => x.ringGroupId === ringGroupId);
    return g ? copy(g) : null;
  }

  async listHuntGroups(partnerId: string) {
    return this.huntGroups
      .filter((g) => g.partnerId === partnerId)
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map(copy);
  }

  async applyCredit(input: PartnerCreditInput): Promise<PartnerCreditResult> {
    const p = this.partners.find((x) => x.id === input.partnerId);
    if (!p) throw new Error("unknown partner");
    const seen = this.ledger.find((l) => l.idempotencyKey === input.idempotencyKey);
    if (seen) return { status: "duplicate", row: copy(seen), balance: p.creditBalance };
    if (input.idempotencyKey.length < 3 || input.idempotencyKey.length > 300) throw new Error("idempotency key length");
    let delta: number;
    if (input.reason === "topup") {
      if (!(input.credits > 0)) throw new Error("top-up must be positive");
      delta = input.credits;
    } else if (input.reason === "call") {
      if (input.credits < 0) throw new Error("call cost must be >= 0");
      delta = 0 - Math.min(input.credits, p.creditBalance);
    } else {
      if (p.creditBalance + input.credits < 0) return { status: "insufficient", balance: p.creditBalance };
      delta = input.credits;
    }
    const balance = p.creditBalance + delta;
    if (balance < 0) throw new Error("balance would be negative");
    p.creditBalance = balance;
    const row: PartnerLedgerRow = {
      id: randomUUID(),
      partnerId: p.id,
      delta,
      reason: input.reason,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      balanceAfter: balance,
      meta: { ...(input.meta ?? {}) },
      createdBy: input.createdBy ?? null,
      createdAt: input.at,
    };
    this.ledger.push(row);
    return { status: "applied", row: copy(row), balance };
  }

  async listLedger(partnerId: string, limit: number) {
    return this.ledger
      .filter((l) => l.partnerId === partnerId)
      .slice()
      .reverse()
      .slice(0, limit)
      .map(copy);
  }

  async createCall(c: NewPartnerCall) {
    const existing = this.calls.find((x) => x.callSid === c.callSid);
    if (existing) return copy(existing);
    const row: PartnerCallRow = {
      ...c,
      id: randomUUID(),
      memberId: c.memberId ?? null,
      externalId: c.externalId ?? null,
      reference: c.reference ?? null,
      answeredLegSid: null,
      answeredAt: null,
      endedAt: null,
      talkS: null,
      creditsCharged: 0,
      billing: "pending",
      recordingId: null,
      finalizedAt: null,
      createdAt: new Date(),
    };
    this.calls.push(row);
    return copy(row);
  }

  async getCallBySid(callSid: string) {
    const c = this.calls.find((x) => x.callSid === callSid);
    return c ? copy(c) : null;
  }

  async updateCall(id: string, patch: PartnerCallPatch) {
    const c = this.calls.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return copy(c);
  }

  async markAnswered(id: string, a: { memberId: string; externalId: string; legSid: string; at: Date }) {
    const c = this.calls.find((x) => x.id === id);
    if (!c || c.answeredAt) return null;
    Object.assign(c, { memberId: a.memberId, externalId: a.externalId, answeredLegSid: a.legSid, answeredAt: a.at });
    return copy(c);
  }

  async claimFinalize(id: string, at: Date) {
    const c = this.calls.find((x) => x.id === id);
    if (!c || c.finalizedAt) return false;
    c.finalizedAt = at;
    return true;
  }

  async listCalls(partnerId: string, opts: { since?: Date; externalId?: string; limit: number }) {
    return this.calls
      .filter(
        (c) =>
          c.partnerId === partnerId &&
          (!opts.since || c.startedAt.getTime() > opts.since.getTime()) &&
          (!opts.externalId || c.externalId === opts.externalId),
      )
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .slice(0, opts.limit)
      .map(copy);
  }

  async listRecentCalls(partnerId: string, limit: number) {
    return this.calls
      .filter((c) => c.partnerId === partnerId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit)
      .map(copy);
  }

  async countOpenOutboundCalls(memberId: string, since: Date) {
    return this.calls.filter((c) => c.memberId === memberId && c.direction === "outbound" && !c.finalizedAt && c.startedAt.getTime() > since.getTime()).length;
  }

  async createLinkRequest(r: { partnerId: string; memberId: string; codeSha256: string; expiresAt: Date; at: Date }) {
    if (this.linkRequests.some((x) => x.codeSha256 === r.codeSha256)) throw new Error("duplicate link code hash");
    for (const old of this.linkRequests) if (old.memberId === r.memberId && !old.usedAt && !old.invalidatedAt) old.invalidatedAt = r.at;
    const row: PartnerLinkRequestRow = {
      id: randomUUID(),
      partnerId: r.partnerId,
      memberId: r.memberId,
      codeSha256: r.codeSha256,
      expiresAt: r.expiresAt,
      attempts: 0,
      usedAt: null,
      invalidatedAt: null,
      createdAt: r.at,
    };
    this.linkRequests.push(row);
    return copy(row);
  }

  async getLinkRequest(id: string) {
    const r = this.linkRequests.find((x) => x.id === id);
    return r ? copy(r) : null;
  }

  async findLinkRequestByHash(codeSha256: string) {
    const r = this.linkRequests.find((x) => x.codeSha256 === codeSha256);
    return r ? copy(r) : null;
  }

  async recordLinkRequestFailure(id: string, maxAttempts: number, at: Date) {
    const r = this.linkRequests.find((x) => x.id === id);
    if (!r) return null;
    r.attempts += 1;
    if (r.attempts >= maxAttempts && !r.invalidatedAt) r.invalidatedAt = at;
    return copy(r);
  }

  async consumeLinkRequest(id: string, at: Date) {
    const r = this.linkRequests.find((x) => x.id === id);
    if (!r || r.usedAt || r.invalidatedAt || r.expiresAt.getTime() <= at.getTime()) return false;
    r.usedAt = at;
    return true;
  }

  async createLink(l: { partnerId: string; memberId: string; userId: string; requestId: string | null; at: Date }): Promise<PartnerLinkCreateResult> {
    const active = this.links.filter((x) => !x.revokedAt);
    if (active.some((x) => x.memberId === l.memberId)) return { status: "member_taken" };
    if (active.some((x) => x.partnerId === l.partnerId && x.userId === l.userId)) return { status: "user_taken" };
    const { at, ...ids } = l;
    const row: PartnerMemberLinkRow = { ...ids, id: randomUUID(), numberId: null, createdAt: at, updatedAt: at, revokedAt: null, revokedBy: null };
    this.links.push(row);
    return { status: "created", link: copy(row) };
  }

  async getLink(id: string) {
    const l = this.links.find((x) => x.id === id);
    return l ? copy(l) : null;
  }

  async getActiveLinkByMember(memberId: string) {
    const l = this.links.find((x) => x.memberId === memberId && !x.revokedAt);
    return l ? copy(l) : null;
  }

  async getActiveLinkByUser(partnerId: string, userId: string) {
    const l = this.links.find((x) => x.partnerId === partnerId && x.userId === userId && !x.revokedAt);
    return l ? copy(l) : null;
  }

  async listActiveLinksByUser(userId: string) {
    return this.links
      .filter((x) => x.userId === userId && !x.revokedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(copy);
  }

  async revokeLink(id: string, by: "user" | "partner" | "system", at: Date) {
    const l = this.links.find((x) => x.id === id && !x.revokedAt);
    if (!l) return null;
    Object.assign(l, { revokedAt: at, revokedBy: by, updatedAt: at });
    return copy(l);
  }

  async setLinkNumber(id: string, numberId: string | null) {
    const l = this.links.find((x) => x.id === id && !x.revokedAt);
    if (!l) return null;
    Object.assign(l, { numberId, updatedAt: new Date() });
    return copy(l);
  }

  async enqueueEvent(e: { partnerId: string; eventType: PartnerWebhookEventRow["eventType"]; payload: Record<string, unknown>; at: Date }) {
    const row: PartnerWebhookEventRow = {
      id: randomUUID(),
      partnerId: e.partnerId,
      eventType: e.eventType,
      payload: copy(e.payload),
      attempts: 0,
      nextAttemptAt: e.at,
      deliveredAt: null,
      lastError: null,
      createdAt: e.at,
    };
    this.events.push(row);
    return copy(row);
  }

  async listDueEvents(now: Date, limit: number) {
    return this.events
      .filter((e) => !e.deliveredAt && e.nextAttemptAt && e.nextAttemptAt.getTime() <= now.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map(copy);
  }

  async markEventDelivered(id: string, at: Date) {
    const e = this.events.find((x) => x.id === id);
    if (e) Object.assign(e, { deliveredAt: at, nextAttemptAt: null, attempts: e.attempts + 1 });
  }

  async markEventFailed(id: string, error: string, nextAttemptAt: Date | null) {
    const e = this.events.find((x) => x.id === id);
    if (e) Object.assign(e, { lastError: error.slice(0, 300), nextAttemptAt, attempts: e.attempts + 1 });
  }

  async getEvent(id: string) {
    const e = this.events.find((x) => x.id === id);
    return e ? copy(e) : null;
  }
}
