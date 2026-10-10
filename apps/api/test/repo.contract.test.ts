import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from both implementations. Postgres runs only with TEST_DATABASE_URL
// (a scratch database with supabase/migrations applied; tables are truncated).
const pgUrl = process.env.TEST_DATABASE_URL;

const TABLES =
  "users, refresh_tokens, telecom_accounts, subscriptions, entitlements, phone_numbers, e911_addresses, e911_acknowledgements, calls, messages, voicemails, consents, usage_ledger, fraud_events, handoffs, used_once_keys, sms_opt_outs, takatak_outbox, audit_log, push_tokens, attested_devices, ad_rewards, blocked_numbers, call_settings";

const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 2 }), Boolean(pgUrl)],
];

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) await repo.sql.unsafe(`truncate ${TABLES} cascade`);
      else repo = make();
    });

    async function seed() {
      const user = await repo.createUser({ globalUserId: "gu_1", locale: "fr-CA", displayName: "A", phoneE164: "+15145550000" });
      const account = await repo.createAccount({ ownerUserId: user.id, kind: "consumer", status: "ACTIVE_MANAGED", riskTier: "new" });
      return { user, account };
    }

    it("users and accounts", async () => {
      const { user, account } = await seed();
      expect(user).toMatchObject({ globalUserId: "gu_1", status: "active", phoneVerifiedAt: null });
      expect(user.createdAt).toBeInstanceOf(Date);
      expect((await repo.findUserByGlobalId("gu_1"))?.id).toBe(user.id);
      expect((await repo.findUserByPhone("+15145550000"))?.id).toBe(user.id);
      expect((await repo.updateUser(user.id, { locale: "en-CA" })).locale).toBe("en-CA");
      expect(account).toMatchObject({ intlCreditCents: 0, workspaceId: null, stripeCustomerId: null });
      await repo.updateAccount(account.id, { stripeCustomerId: "cus_1" });
      expect((await repo.findAccountByStripeCustomer("cus_1"))?.id).toBe(account.id);
      expect(await repo.addIntlCredit(account.id, 500)).toBe(500);
      expect(await repo.addIntlCredit(account.id, -200)).toBe(300);
      expect((await repo.getAccountByOwner(user.id))?.id).toBe(account.id);
    });

    it("refresh tokens", async () => {
      const { user } = await seed();
      const fam = crypto.randomUUID();
      const t = await repo.createRefreshToken({ userId: user.id, familyId: fam, tokenHash: "h1", expiresAt: new Date(Date.now() + 1000) });
      expect((await repo.findRefreshToken("h1"))?.id).toBe(t.id);
      expect(await repo.revokeRefreshToken(t.id)).toBe(true);
      expect(await repo.revokeRefreshToken(t.id)).toBe(false);
      await repo.createRefreshToken({ userId: user.id, familyId: fam, tokenHash: "h2", expiresAt: new Date(Date.now() + 1000) });
      await repo.revokeRefreshFamily(fam);
      expect((await repo.findRefreshToken("h2"))?.revokedAt).toBeInstanceOf(Date);
    });

    it("subscriptions and entitlements", async () => {
      const { account } = await seed();
      const base = { telecomAccountId: account.id, kind: "plan" as const, code: "premium", quantity: 1, source: "stripe" as const, currentPeriodEnd: null };
      await repo.upsertSubscription({ ...base, stripeSubscriptionId: "sub_1", status: "active" });
      await repo.upsertSubscription({ ...base, stripeSubscriptionId: "sub_1", status: "canceled" });
      const subs = await repo.listSubscriptions(account.id);
      expect(subs).toHaveLength(1);
      expect(subs[0]?.status).toBe("canceled");
      await repo.replaceEntitlements(account.id, "plan", [{ feature: "mms", limit: null }, { feature: "no_ads", limit: null }]);
      await repo.replaceEntitlements(account.id, "addon", [{ feature: "extra_number", limit: 2 }]);
      await repo.replaceEntitlements(account.id, "plan", [{ feature: "mms", limit: null }]);
      const ents = await repo.listEntitlements(account.id);
      expect(ents.map((e) => e.feature).sort()).toEqual(["extra_number", "mms"]);
      expect(ents.find((e) => e.feature === "extra_number")?.limit).toBe(2);
    });

    it("numbers and e911", async () => {
      const { user, account } = await seed();
      const now = new Date();
      const n = await repo.createNumber({ e164: "+15145550100", twilioSid: "PN1", telecomAccountId: account.id, kind: "local", state: "active", lastActivityAt: now, stateChangedAt: now });
      expect(n.warningsSent).toEqual([]);
      await repo.updateNumber(n.id, { warningsSent: [20, 27] });
      expect((await repo.getNumberByE164("+15145550100"))?.warningsSent).toEqual([20, 27]);
      expect(await repo.listNumbersInStates(["active"])).toHaveLength(1);
      expect(await repo.listNumbersInStates(["quarantine"])).toHaveLength(0);

      const addr = { telecomAccountId: account.id, phoneNumberId: n.id, customerName: "A", street: "1 rue X", unit: null, city: "Montréal", province: "QC", postalCode: "H2X 1Y4", country: "CA" as const, validatedAt: null, providerRef: null };
      const a1 = await repo.upsertE911Address(addr);
      const a2 = await repo.upsertE911Address({ ...addr, street: "2 rue Y" });
      expect(a2.id).toBe(a1.id);
      expect((await repo.getE911Address(account.id))?.street).toBe("2 rue Y");
      await repo.addE911Ack({ userId: user.id, noticeVersion: "v1", acceptedAt: new Date(Date.now() - 1000), ip: "1.2.3.4", appVersion: null, userAgent: null });
      await repo.addE911Ack({ userId: user.id, noticeVersion: "v2", acceptedAt: new Date(), ip: null, appVersion: "1.0", userAgent: null });
      expect((await repo.getLatestE911Ack(user.id))?.noticeVersion).toBe("v2");
    });

    it("calls and usage", async () => {
      const { user, account } = await seed();
      const c = { twilioCallSid: "CA1", telecomAccountId: account.id, userId: user.id, direction: "outbound" as const, kind: "pstn" as const, fromNumber: "+15145550100", toNumber: "+14165550123", status: "initiated", startedAt: new Date() };
      const call = await repo.upsertCall(c);
      expect((await repo.upsertCall(c)).id).toBe(call.id);
      expect(await repo.countActiveCalls(account.id, new Date(Date.now() - 60_000))).toBe(1);
      await repo.updateCall(call.id, { status: "completed", durationS: 61, price: 0.028, ratedCad: 0.0392, usageApplied: true });
      expect(await repo.countActiveCalls(account.id, new Date(Date.now() - 60_000))).toBe(0);
      expect((await repo.getCallBySid("CA1"))?.price).toBeCloseTo(0.028);

      await repo.addUsage(account.id, ["2026-10", "2026-10-09"], { minutesOut: 2, spendCad: 0.04 });
      await repo.addUsage(account.id, ["2026-10"], { minutesOut: 1, smsOut: 3 });
      expect(await repo.getUsage(account.id, "2026-10")).toMatchObject({ minutesOut: 3, smsOut: 3, spendCad: 0.04 });
      expect((await repo.getUsage(account.id, "2026-10-09")).minutesOut).toBe(2);
      expect((await repo.getUsage(account.id, "2026-11")).minutesOut).toBe(0);
    });

    it("calls page (keyset pagination, own account only)", async () => {
      const { user, account } = await seed();
      const other = await repo.createAccount({ ownerUserId: user.id, kind: "business", status: "ACTIVE_MANAGED", riskTier: "new" });
      const t0 = Date.UTC(2026, 9, 1, 12);
      for (let i = 0; i < 3; i++) {
        await repo.upsertCall({ twilioCallSid: `CAp${i}`, telecomAccountId: account.id, userId: user.id, direction: "inbound", kind: "pstn", fromNumber: "+14165550123", toNumber: "+15145550100", status: "completed", startedAt: new Date(t0 + i * 1000) });
      }
      await repo.upsertCall({ twilioCallSid: "CAother", telecomAccountId: other.id, userId: user.id, direction: "inbound", kind: "pstn", fromNumber: "+1", toNumber: "+1", status: "completed", startedAt: new Date(t0 + 5000) });
      const first = await repo.listCallsPage(account.id, { limit: 2 });
      expect(first.map((c) => c.twilioCallSid)).toEqual(["CAp2", "CAp1"]);
      const last = first[1]!;
      const rest = await repo.listCallsPage(account.id, { limit: 2, before: { startedAt: last.startedAt, id: last.id } });
      expect(rest.map((c) => c.twilioCallSid)).toEqual(["CAp0"]);
    });

    it("messages, conversations and anti-spam counters", async () => {
      const { account } = await seed();
      const mk = (peer: string, direction: "inbound" | "outbound", fp = "f") =>
        repo.createMessage({ twilioSid: null, telecomAccountId: account.id, direction, ourNumber: "+15145550100", peer, bodyEncrypted: "v1.x", bodyFingerprint: fp, status: "sent", segments: 1, numMedia: 0 });
      await mk("+15145550001", "outbound", "same");
      await mk("+15145550002", "outbound", "same");
      await mk("+15145550002", "inbound");
      const since = new Date(Date.now() - 60_000);
      expect(await repo.countOutboundSince(account.id, since)).toBe(2);
      expect(await repo.countFingerprintRecipientsSince(account.id, "same", since)).toBe(2);
      expect(await repo.countNewRecipientsSince(account.id, since)).toBe(2);
      expect(await repo.hasOutboundTo(account.id, "+15145550001", new Date(Date.now() + 1000))).toBe(true);
      expect(await repo.hasOutboundTo(account.id, "+15145559999", new Date(Date.now() + 1000))).toBe(false);

      const convs = await repo.listConversations(account.id);
      expect(convs.map((c) => c.peer).sort()).toEqual(["+15145550001", "+15145550002"]);
      expect(convs.find((c) => c.peer === "+15145550002")?.lastDirection).toBe("inbound");

      const all = await repo.listMessages(account.id, "+15145550002", { limit: 10 });
      expect(all).toHaveLength(2);
      const next = await repo.listMessages(account.id, "+15145550002", { limit: 10, before: { createdAt: all[0]!.createdAt, id: all[0]!.id } });
      expect(next.map((m) => m.id)).toEqual([all[1]!.id]);

      await repo.purgeNumberContent(crypto.randomUUID(), "+15145550100");
      expect(await repo.listConversations(account.id)).toEqual([]);
    });

    it("voicemail, consents, fraud events", async () => {
      const { user, account } = await seed();
      const now = new Date();
      const n = await repo.createNumber({ e164: "+15145550100", twilioSid: null, telecomAccountId: account.id, kind: "local", state: "active", lastActivityAt: now, stateChangedAt: now });
      const vm = { telecomAccountId: account.id, phoneNumberId: n.id, callSid: "CA1", recordingSid: "RE1", fromNumber: "+14165550123", audioUrl: "https://x", durationS: 5 };
      const v1 = await repo.createVoicemail(vm);
      expect((await repo.createVoicemail(vm)).id).toBe(v1.id);
      await repo.updateVoicemailByRecordingSid("RE1", { transcript: "allo" });
      expect((await repo.listVoicemails(account.id))[0]?.transcript).toBe("allo");
      expect((await repo.getVoicemail(v1.id))?.listenedAt).toBeNull();
      await repo.markVoicemailListened(v1.id, now);
      expect((await repo.getVoicemail(v1.id))?.listenedAt).toBeInstanceOf(Date);
      expect(await repo.deleteVoicemail(v1.id)).toBe(true);
      expect(await repo.deleteVoicemail(v1.id)).toBe(false);
      expect(await repo.getVoicemail(v1.id)).toBeNull();

      await repo.addConsent({ userId: user.id, kind: "terms", granted: true, version: "1", source: "app", ip: null, at: now });
      expect(await repo.listConsents(user.id)).toHaveLength(1);
      await repo.addFraudEvent({ telecomAccountId: account.id, rule: "r", score: 10, action: "block", details: { to: "+1" } });
      expect((await repo.listFraudEvents(account.id))[0]).toMatchObject({ rule: "r", details: { to: "+1" } });
    });

    it("push tokens (unique per token, moved on re-register)", async () => {
      const { user } = await seed();
      const other = await repo.createUser({ globalUserId: "gu_2", locale: "en-CA", displayName: "B" });
      const t = await repo.upsertPushToken({ userId: user.id, platform: "ios", kind: "messages", token: "apns-1" });
      expect(t).toMatchObject({ userId: user.id, platform: "ios", kind: "messages", token: "apns-1" });
      expect((await repo.upsertPushToken({ userId: user.id, platform: "ios", kind: "messages", token: "apns-1" })).id).toBe(t.id);
      await repo.upsertPushToken({ userId: other.id, platform: "ios", kind: "messages", token: "apns-1" });
      expect(await repo.listPushTokens(user.id)).toEqual([]);
      expect((await repo.listPushTokens(other.id)).map((x) => x.token)).toEqual(["apns-1"]);
      await repo.deletePushTokensForUser(other.id);
      expect(await repo.listPushTokens(other.id)).toEqual([]);
    });

    it("handoffs, single-use keys, opt-outs, outbox, audit", async () => {
      const { user } = await seed();
      const h = await repo.createHandoff({ tokenHash: "th", globalUserId: "gu_1", workspaceId: "ws", businessId: null, planHint: null, locale: "fr-CA", jti: "j1", expiresAt: new Date(Date.now() + 60_000) });
      expect((await repo.findHandoffByTokenHash("th"))?.id).toBe(h.id);
      expect(await repo.claimHandoff(h.id, user.id, new Date())).toBe(true);
      expect(await repo.claimHandoff(h.id, user.id, new Date())).toBe(false);

      expect(await repo.useOnce("k1", new Date(Date.now() + 1000))).toBe(true);
      expect(await repo.useOnce("k1", new Date(Date.now() + 1000))).toBe(false);

      await repo.setOptOut("+15145550100", "+15145550199", true);
      expect(await repo.isOptedOut("+15145550100", "+15145550199")).toBe(true);
      await repo.setOptOut("+15145550100", "+15145550199", false);
      expect(await repo.isOptedOut("+15145550100", "+15145550199")).toBe(false);

      const ev = await repo.enqueueOutbox("entitlement.updated", { plan: "premium" });
      expect(await repo.listDueOutbox(new Date(Date.now() + 1000), 10)).toHaveLength(1);
      await repo.markOutboxFailed(ev.id, "HTTP 500", null);
      expect(await repo.listDueOutbox(new Date(Date.now() + 1000), 10)).toHaveLength(0);
      const ev2 = await repo.enqueueOutbox("phone_number.assigned", { e164: "+1" });
      await repo.markOutboxDelivered(ev2.id, new Date());
      expect(await repo.listDueOutbox(new Date(Date.now() + 1000), 10)).toHaveLength(0);

      await repo.audit({ actorUserId: user.id, action: "test", meta: { a: 1 } });
      await repo.ping();
    });

    it("call controls: blocks and call settings", async () => {
      const { account } = await seed();
      const cc = repo.callControls;
      const a = await cc.addBlock({ telecomAccountId: account.id, e164: "+14165550123", label: "spam" });
      expect(a.created).toBe(true);
      expect(a.block).toMatchObject({ e164: "+14165550123", label: "spam", telecomAccountId: account.id });
      expect(a.block.createdAt).toBeInstanceOf(Date);
      const again = await cc.addBlock({ telecomAccountId: account.id, e164: "+14165550123", label: null });
      expect(again).toMatchObject({ created: false, block: { id: a.block.id } });
      await cc.addBlock({ telecomAccountId: account.id, e164: "+15145550111", label: null });
      expect(await cc.listBlocks(account.id)).toHaveLength(2);
      expect(await cc.isBlocked(account.id, "+14165550123")).toBe(true);
      expect(await cc.isBlocked(account.id, "+14165550999")).toBe(false);
      expect(await cc.removeBlock(account.id, a.block.id)).toBe(true);
      expect(await cc.removeBlock(account.id, a.block.id)).toBe(false);
      expect(await cc.isBlocked(account.id, "+14165550123")).toBe(false);

      expect(await cc.getCallSettings(account.id)).toEqual({
        forwarding: { mode: "off", target: null, timeoutS: 20 },
        dnd: { enabled: false, schedule: null },
        blockedCallAction: "reject",
      });
      const schedule = { mon: [{ open: "22:00", close: "07:00" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
      const next = {
        forwarding: { mode: "no_answer" as const, target: "+14385550147", timeoutS: 15 },
        dnd: { enabled: true, schedule },
        blockedCallAction: "voicemail" as const,
      };
      expect(await cc.saveCallSettings(account.id, next)).toEqual(next);
      expect(await cc.getCallSettings(account.id)).toEqual(next);
      const off = { ...next, forwarding: { ...next.forwarding, mode: "off" as const }, dnd: { enabled: false, schedule: null } };
      await cc.saveCallSettings(account.id, off);
      expect(await cc.getCallSettings(account.id)).toEqual(off);
    });
  });
}
