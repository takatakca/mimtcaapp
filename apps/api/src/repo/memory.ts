import { randomUUID } from "node:crypto";
import type { NumberState } from "@mimt/shared";
import { MemoryPbxRepository } from "./pbxMemory.js";
import { MemoryCatalogRepository } from "./catalogMemory.js";
import { MemoryCallControlsRepository } from "./callControlsMemory.js";
import { MemoryMediaRepository } from "./mediaMemory.js";
import { MemoryReferralRepository } from "./referralsMemory.js";
import { MemoryPortInRepository } from "./portInMemory.js";
import { MemoryMeetingRepository } from "./meetingsMemory.js";
import { planFromSubscriptions } from "../services/accounts.js";
import { emptyUsage } from "./types.js";
import type {
  AuditEntry,
  Call,
  Consent,
  Conversation,
  E911Acknowledgement,
  E911Address,
  Entitlement,
  FraudEvent,
  Handoff,
  Message,
  OutboxEvent,
  PhoneNumber,
  PushToken,
  RefreshToken,
  Repository,
  Subscription,
  TelecomAccount,
  Usage,
  User,
  Voicemail,
} from "./types.js";

const clone = <T>(v: T): T => structuredClone(v);
const ACTIVE_CALL_STATUSES = new Set(["queued", "initiated", "ringing", "in-progress"]);

/** In-memory repository for tests and for booting the API locally without a database. */
export class MemoryRepository implements Repository {
  users = new Map<string, User>();
  refreshTokens = new Map<string, RefreshToken>();
  accounts = new Map<string, TelecomAccount>();
  subscriptions = new Map<string, Subscription>();
  entitlements: Entitlement[] = [];
  numbers = new Map<string, PhoneNumber>();
  e911Addresses = new Map<string, E911Address>();
  e911Acks: E911Acknowledgement[] = [];
  calls = new Map<string, Call>();
  messages: Message[] = [];
  voicemails: Voicemail[] = [];
  pushTokens: PushToken[] = [];
  consents: Consent[] = [];
  usage = new Map<string, Usage>();
  fraudEvents: FraudEvent[] = [];
  handoffs = new Map<string, Handoff>();
  usedKeys = new Map<string, Date>();
  optOuts = new Map<string, boolean>();
  outbox: OutboxEvent[] = [];
  auditLog: Array<AuditEntry & { at: Date }> = [];
  readonly pbx = new MemoryPbxRepository(() => this.calls.values());
  readonly catalog = new MemoryCatalogRepository();
  readonly callControls = new MemoryCallControlsRepository();
  readonly media = new MemoryMediaRepository();
  readonly portIns = new MemoryPortInRepository();
  readonly meetings = new MemoryMeetingRepository();
  devices: Array<{ platform: "ios" | "android"; deviceKey: string; userId: string; verifiedAt: Date }> = [];
  adRewards: Array<{ userId: string; transactionId: string; minutes: number; createdAt: Date; claimedAt: Date | null }> = [];
  readonly referrals = new MemoryReferralRepository(() => this.devices);

  async ping() {}
  async close() {}

  // users
  async createUser(u: Parameters<Repository["createUser"]>[0]) {
    const user: User = {
      authUserId: null,
      email: null,
      phoneE164: null,
      phoneVerifiedAt: null,
      deviceVerifiedAt: null,
      deletionScheduledAt: null,
      status: "active",
      ...u,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return clone(user);
  }
  async getUser(id: string) {
    const u = this.users.get(id);
    return u ? clone(u) : null;
  }
  async findUserByGlobalId(globalUserId: string) {
    const u = [...this.users.values()].find((x) => x.globalUserId === globalUserId);
    return u ? clone(u) : null;
  }
  async findUserByPhone(e164: string) {
    const u = [...this.users.values()].find((x) => x.phoneE164 === e164);
    return u ? clone(u) : null;
  }
  async updateUser(id: string, patch: Partial<User>) {
    const u = this.users.get(id);
    if (!u) throw new Error(`user ${id} not found`);
    Object.assign(u, patch);
    return clone(u);
  }

  // refresh tokens
  async createRefreshToken(t: Parameters<Repository["createRefreshToken"]>[0]) {
    const row: RefreshToken = { revokedAt: null, ...t, id: randomUUID(), createdAt: new Date() };
    this.refreshTokens.set(row.id, row);
    return clone(row);
  }
  async findRefreshToken(tokenHash: string) {
    const t = [...this.refreshTokens.values()].find((x) => x.tokenHash === tokenHash);
    return t ? clone(t) : null;
  }
  async revokeRefreshToken(id: string) {
    const t = this.refreshTokens.get(id);
    if (!t || t.revokedAt) return false;
    t.revokedAt = new Date();
    return true;
  }
  async revokeRefreshFamily(familyId: string) {
    for (const t of this.refreshTokens.values()) if (t.familyId === familyId && !t.revokedAt) t.revokedAt = new Date();
  }
  async revokeUserRefreshTokens(userId: string) {
    for (const t of this.refreshTokens.values()) if (t.userId === userId && !t.revokedAt) t.revokedAt = new Date();
  }

  // accounts
  async createAccount(a: Parameters<Repository["createAccount"]>[0]) {
    const row: TelecomAccount = {
      workspaceId: null,
      businessId: null,
      twilioSubaccountSid: null,
      stripeCustomerId: null,
      intlCreditCents: 0,
      ...a,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.accounts.set(row.id, row);
    return clone(row);
  }
  async getAccount(id: string) {
    const a = this.accounts.get(id);
    return a ? clone(a) : null;
  }
  async getAccountByOwner(userId: string) {
    const a = [...this.accounts.values()].find((x) => x.ownerUserId === userId);
    return a ? clone(a) : null;
  }
  async findAccountByStripeCustomer(customerId: string) {
    const a = [...this.accounts.values()].find((x) => x.stripeCustomerId === customerId);
    return a ? clone(a) : null;
  }
  async updateAccount(id: string, patch: Partial<TelecomAccount>) {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`account ${id} not found`);
    Object.assign(a, patch);
    return clone(a);
  }
  async addIntlCredit(id: string, cents: number) {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`account ${id} not found`);
    a.intlCreditCents += cents;
    return a.intlCreditCents;
  }

  // subscriptions & entitlements
  async listSubscriptions(accountId: string) {
    return [...this.subscriptions.values()].filter((s) => s.telecomAccountId === accountId).map(clone);
  }
  async upsertSubscription(s: Parameters<Repository["upsertSubscription"]>[0]) {
    const existing = s.stripeSubscriptionId
      ? [...this.subscriptions.values()].find((x) => x.stripeSubscriptionId === s.stripeSubscriptionId)
      : undefined;
    if (existing) {
      Object.assign(existing, s);
      return clone(existing);
    }
    const row: Subscription = { ...s, id: randomUUID(), createdAt: new Date() };
    this.subscriptions.set(row.id, row);
    return clone(row);
  }
  async listEntitlements(accountId: string) {
    return this.entitlements.filter((e) => e.telecomAccountId === accountId).map(clone);
  }
  async replaceEntitlements(accountId: string, source: string, items: Array<Pick<Entitlement, "feature" | "limit">>) {
    this.entitlements = this.entitlements.filter((e) => !(e.telecomAccountId === accountId && e.source === source));
    for (const i of items) this.entitlements.push({ telecomAccountId: accountId, source, ...i });
  }

  // numbers
  async createNumber(n: Parameters<Repository["createNumber"]>[0]) {
    const row: PhoneNumber = { quarantineUntil: null, warningsSent: [], ...n, id: randomUUID(), createdAt: new Date() };
    this.numbers.set(row.id, row);
    return clone(row);
  }
  async getNumber(id: string) {
    const n = this.numbers.get(id);
    return n ? clone(n) : null;
  }
  async getNumberByE164(e164: string) {
    const n = [...this.numbers.values()].find((x) => x.e164 === e164);
    return n ? clone(n) : null;
  }
  async listNumbersByAccount(accountId: string) {
    return [...this.numbers.values()].filter((n) => n.telecomAccountId === accountId).map(clone);
  }
  async listNumbersInStates(states: NumberState[]) {
    return [...this.numbers.values()].filter((n) => states.includes(n.state)).map(clone);
  }
  async updateNumber(id: string, patch: Partial<PhoneNumber>) {
    const n = this.numbers.get(id);
    if (!n) throw new Error(`number ${id} not found`);
    Object.assign(n, patch);
    return clone(n);
  }
  async purgeNumberContent(numberId: string, e164: string) {
    this.messages = this.messages.filter((m) => m.ourNumber !== e164);
    this.voicemails = this.voicemails.filter((v) => v.phoneNumberId !== numberId);
  }

  // e911
  async upsertE911Address(a: Parameters<Repository["upsertE911Address"]>[0]) {
    const existing = this.e911Addresses.get(a.telecomAccountId);
    const now = new Date();
    const row: E911Address = { ...a, id: existing?.id ?? randomUUID(), createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.e911Addresses.set(a.telecomAccountId, row);
    return clone(row);
  }
  async getE911Address(accountId: string) {
    const a = this.e911Addresses.get(accountId);
    return a ? clone(a) : null;
  }
  async addE911Ack(a: Omit<E911Acknowledgement, "id">) {
    const row = { ...a, id: randomUUID() };
    this.e911Acks.push(row);
    return clone(row);
  }
  async getLatestE911Ack(userId: string) {
    const acks = this.e911Acks.filter((a) => a.userId === userId).sort((x, y) => y.acceptedAt.getTime() - x.acceptedAt.getTime());
    return acks[0] ? clone(acks[0]) : null;
  }
  async listE911Acks(userId: string) {
    return this.e911Acks.filter((a) => a.userId === userId).map(clone);
  }

  // calls
  async upsertCall(c: Parameters<Repository["upsertCall"]>[0]) {
    const existing = [...this.calls.values()].find((x) => x.twilioCallSid === c.twilioCallSid);
    if (existing) return clone(existing);
    const row: Call = {
      endedAt: null,
      durationS: null,
      price: null,
      priceUnit: null,
      ratedCad: null,
      usageApplied: false,
      ...c,
      id: randomUUID(),
    };
    this.calls.set(row.id, row);
    return clone(row);
  }
  async getCallBySid(sid: string) {
    const c = [...this.calls.values()].find((x) => x.twilioCallSid === sid);
    return c ? clone(c) : null;
  }
  async updateCall(id: string, patch: Partial<Call>) {
    const c = this.calls.get(id);
    if (!c) throw new Error(`call ${id} not found`);
    Object.assign(c, patch);
    return clone(c);
  }
  async countActiveCalls(accountId: string, since: Date) {
    return [...this.calls.values()].filter(
      (c) => c.telecomAccountId === accountId && c.kind !== "emergency" && ACTIVE_CALL_STATUSES.has(c.status) && c.startedAt >= since,
    ).length;
  }
  async listCalls(accountId: string, limit: number) {
    return [...this.calls.values()]
      .filter((c) => c.telecomAccountId === accountId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async listCallsPage(accountId: string, opts: { limit: number; before?: { startedAt: Date; id: string } }) {
    const { before } = opts;
    return [...this.calls.values()]
      .filter((c) => c.telecomAccountId === accountId)
      .filter(
        (c) =>
          !before || c.startedAt < before.startedAt || (c.startedAt.getTime() === before.startedAt.getTime() && c.id < before.id),
      )
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || (b.id < a.id ? -1 : 1))
      .slice(0, opts.limit)
      .map(clone);
  }

  // messages
  async createMessage(m: Parameters<Repository["createMessage"]>[0]) {
    const row: Message = { price: null, priceUnit: null, errorCode: null, ...m, id: randomUUID(), createdAt: new Date() };
    this.messages.push(row);
    return clone(row);
  }
  async updateMessageBySid(sid: string, patch: Partial<Message>) {
    const m = this.messages.find((x) => x.twilioSid === sid);
    if (!m) return null;
    Object.assign(m, patch);
    return clone(m);
  }
  async listConversations(accountId: string) {
    const latest = new Map<string, Message>();
    for (const m of this.messages) {
      if (m.telecomAccountId !== accountId) continue;
      const key = `${m.ourNumber}|${m.peer}`;
      const cur = latest.get(key);
      if (!cur || m.createdAt >= cur.createdAt) latest.set(key, m);
    }
    return [...latest.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map<Conversation>((m) => ({
        peer: m.peer,
        ourNumber: m.ourNumber,
        lastMessageId: m.id,
        lastMessageAt: m.createdAt,
        lastBodyEncrypted: m.bodyEncrypted,
        lastDirection: m.direction,
      }));
  }
  async listMessages(accountId: string, peer: string, opts: { limit: number; before?: { createdAt: Date; id: string } }) {
    const { before } = opts;
    return this.messages
      .filter((m) => m.telecomAccountId === accountId && m.peer === peer)
      .filter(
        (m) =>
          !before || m.createdAt < before.createdAt || (m.createdAt.getTime() === before.createdAt.getTime() && m.id < before.id),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (b.id < a.id ? -1 : 1))
      .slice(0, opts.limit)
      .map(clone);
  }
  private outbound(accountId: string) {
    return this.messages.filter((m) => m.telecomAccountId === accountId && m.direction === "outbound");
  }
  async countOutboundSince(accountId: string, since: Date) {
    return this.outbound(accountId).filter((m) => m.createdAt >= since).length;
  }
  async countFingerprintRecipientsSince(accountId: string, fingerprint: string, since: Date) {
    return new Set(this.outbound(accountId).filter((m) => m.bodyFingerprint === fingerprint && m.createdAt >= since).map((m) => m.peer)).size;
  }
  async hasOutboundTo(accountId: string, peer: string, before: Date) {
    return this.messages.some((m) => m.telecomAccountId === accountId && m.peer === peer && m.createdAt < before);
  }
  async countNewRecipientsSince(accountId: string, since: Date) {
    const out = this.outbound(accountId);
    const recent = new Set(out.filter((m) => m.createdAt >= since).map((m) => m.peer));
    let n = 0;
    for (const peer of recent) {
      const known = this.messages.some((m) => m.telecomAccountId === accountId && m.peer === peer && m.createdAt < since);
      if (!known) n++;
    }
    return n;
  }

  // voicemail
  async createVoicemail(v: Parameters<Repository["createVoicemail"]>[0]) {
    const existing = this.voicemails.find((x) => x.recordingSid === v.recordingSid);
    if (existing) return clone(existing);
    const row: Voicemail = {
      audioPath: null,
      transcript: null,
      transcriptLang: null,
      listenedAt: null,
      ...v,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.voicemails.push(row);
    return clone(row);
  }
  async updateVoicemailByRecordingSid(sid: string, patch: Partial<Voicemail>) {
    const v = this.voicemails.find((x) => x.recordingSid === sid);
    if (!v) return null;
    Object.assign(v, patch);
    return clone(v);
  }
  async listVoicemails(accountId: string) {
    return this.voicemails
      .filter((v) => v.telecomAccountId === accountId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(clone);
  }
  async getVoicemail(id: string) {
    const v = this.voicemails.find((x) => x.id === id);
    return v ? clone(v) : null;
  }
  async markVoicemailListened(id: string, at: Date) {
    const v = this.voicemails.find((x) => x.id === id);
    if (v && !v.listenedAt) v.listenedAt = at;
  }
  async deleteVoicemail(id: string) {
    const before = this.voicemails.length;
    this.voicemails = this.voicemails.filter((v) => v.id !== id);
    return this.voicemails.length < before;
  }

  // push tokens
  async upsertPushToken(t: Parameters<Repository["upsertPushToken"]>[0]) {
    const now = new Date();
    const existing = this.pushTokens.find((x) => x.token === t.token);
    if (existing) {
      Object.assign(existing, t, { updatedAt: now });
      return clone(existing);
    }
    const row: PushToken = { ...t, id: randomUUID(), createdAt: now, updatedAt: now };
    this.pushTokens.push(row);
    return clone(row);
  }
  async listPushTokens(userId: string) {
    return this.pushTokens.filter((t) => t.userId === userId).map(clone);
  }
  async deletePushTokensForUser(userId: string) {
    this.pushTokens = this.pushTokens.filter((t) => t.userId !== userId);
  }

  // consents
  async addConsent(c: Omit<Consent, "id">) {
    const row = { ...c, id: randomUUID() };
    this.consents.push(row);
    return clone(row);
  }
  async listConsents(userId: string) {
    return this.consents.filter((c) => c.userId === userId).map(clone);
  }

  // usage
  async addUsage(accountId: string, periods: string[], delta: Partial<Usage>) {
    for (const period of periods) {
      const u = this.usage.get(`${accountId}|${period}`) ?? (await this.getUsage(accountId, period));
      for (const k of ["minutesOut", "minutesIn", "smsOut", "smsIn", "mmsOut", "minutesOnNet", "bonusMinutesOut", "spendCad", "intlSpendCad"] as const) {
        u[k] += delta[k] ?? 0;
      }
      this.usage.set(`${accountId}|${period}`, u);
    }
  }
  async getUsage(accountId: string, period: string): Promise<Usage> {
    const u = this.usage.get(`${accountId}|${period}`);
    return u ? clone(u) : emptyUsage(accountId, period);
  }

  async freePlanUsage(period: string, now: Date) {
    let spendCad = 0;
    let smsOut = 0;
    for (const u of this.usage.values()) {
      if (u.period !== period) continue;
      const subs = [...this.subscriptions.values()].filter((s) => s.telecomAccountId === u.telecomAccountId);
      if (planFromSubscriptions(subs, now) !== "free") continue;
      spendCad += u.spendCad;
      smsOut += u.smsOut;
    }
    return { spendCad, smsOut };
  }
  async countActiveFreeNumbers(now: Date) {
    let n = 0;
    for (const num of this.numbers.values()) {
      if (!num.telecomAccountId || !["active", "locked", "grace"].includes(num.state)) continue;
      const subs = [...this.subscriptions.values()].filter((s) => s.telecomAccountId === num.telecomAccountId);
      if (planFromSubscriptions(subs, now) === "free") n++;
    }
    return n;
  }
  async countFreeNumberClaimsSince(since: Date) {
    return this.auditLog.filter((e) => e.action === "number.claimed" && e.meta?.plan === "free" && e.at >= since).length;
  }

  // fraud
  async addFraudEvent(e: Omit<FraudEvent, "id" | "at">) {
    const row = { ...e, id: randomUUID(), at: new Date() };
    this.fraudEvents.push(row);
    return clone(row);
  }
  async listFraudEvents(accountId: string) {
    return this.fraudEvents.filter((e) => e.telecomAccountId === accountId).map(clone);
  }

  // handoffs & single-use keys
  async createHandoff(h: Parameters<Repository["createHandoff"]>[0]) {
    const row: Handoff = { claimedAt: null, claimedByUserId: null, ...h, id: randomUUID(), createdAt: new Date() };
    this.handoffs.set(row.id, row);
    return clone(row);
  }
  async findHandoffByTokenHash(tokenHash: string) {
    const h = [...this.handoffs.values()].find((x) => x.tokenHash === tokenHash);
    return h ? clone(h) : null;
  }
  async claimHandoff(id: string, userId: string, at: Date) {
    const h = this.handoffs.get(id);
    if (!h || h.claimedAt) return false;
    h.claimedAt = at;
    h.claimedByUserId = userId;
    return true;
  }
  async useOnce(key: string, expiresAt: Date) {
    if (this.usedKeys.has(key)) return false;
    this.usedKeys.set(key, expiresAt);
    return true;
  }

  // opt-outs
  async setOptOut(ourNumber: string, peer: string, optedOut: boolean) {
    this.optOuts.set(`${ourNumber}|${peer}`, optedOut);
  }
  async isOptedOut(ourNumber: string, peer: string) {
    return this.optOuts.get(`${ourNumber}|${peer}`) ?? false;
  }

  // outbox
  async enqueueOutbox(eventType: OutboxEvent["eventType"], payload: Record<string, unknown>) {
    const row: OutboxEvent = {
      id: randomUUID(),
      eventType,
      payload,
      attempts: 0,
      nextAttemptAt: new Date(),
      deliveredAt: null,
      lastError: null,
      createdAt: new Date(),
    };
    this.outbox.push(row);
    return clone(row);
  }
  async listDueOutbox(now: Date, limit: number) {
    return this.outbox
      .filter((e) => !e.deliveredAt && e.nextAttemptAt && e.nextAttemptAt <= now)
      .slice(0, limit)
      .map(clone);
  }
  async markOutboxDelivered(id: string, at: Date) {
    const e = this.outbox.find((x) => x.id === id);
    if (e) {
      e.deliveredAt = at;
      e.attempts++;
    }
  }
  async markOutboxFailed(id: string, error: string, nextAttemptAt: Date | null) {
    const e = this.outbox.find((x) => x.id === id);
    if (e) {
      e.attempts++;
      e.lastError = error;
      e.nextAttemptAt = nextAttemptAt;
    }
  }

  async audit(entry: AuditEntry) {
    this.auditLog.push({ ...entry, at: entry.at ?? new Date() });
  }

  async bindDevice(input: { platform: "ios" | "android"; deviceKey: string; userId: string; verifiedAt: Date }) {
    const existing = this.devices.find((d) => d.platform === input.platform && d.deviceKey === input.deviceKey);
    if (existing && existing.userId !== input.userId) return "taken" as const;
    if (existing) {
      existing.verifiedAt = input.verifiedAt;
      return "ok" as const;
    }
    this.devices.push({ ...input });
    return "ok" as const;
  }

  async grantAdReward(input: { userId: string; transactionId: string; minutes: number; createdAt: Date }) {
    if (this.adRewards.some((r) => r.transactionId === input.transactionId)) return false;
    this.adRewards.push({ ...input, claimedAt: null });
    return true;
  }

  async countAdRewardsSince(userId: string, since: Date) {
    return this.adRewards.filter((r) => r.userId === userId && r.createdAt >= since).length;
  }

  async claimAdReward(userId: string, at: Date) {
    const reward = this.adRewards.find((r) => r.userId === userId && !r.claimedAt);
    if (!reward) return null;
    reward.claimedAt = at;
    return { transactionId: reward.transactionId, minutes: reward.minutes };
  }
}
