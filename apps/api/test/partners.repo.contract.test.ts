import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from the memory and Postgres « MIMT Connect » repositories (supabase/migrations/0023_partners.sql).
const pgUrl = process.env.TEST_DATABASE_URL;
const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 4 }), Boolean(pgUrl)],
];

const at = new Date("2026-10-29T12:00:00Z");

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`partners repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) {
        await repo.sql.unsafe(
          "truncate partner_member_availability, partner_member_links, partner_link_requests, partner_webhook_events, partner_calls, partner_credit_ledger, partner_hunt_groups, partner_members, partner_api_keys, partners, businesses, telecom_accounts, users cascade",
        );
      } else repo = make();
    });

    async function partner() {
      const u = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "Owner" });
      const a = await repo.createAccount({ ownerUserId: u.id, kind: "business", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
      const b = await repo.pbx.createBusiness({ name: "Besoin Avocat", takatakBusinessId: null, telecomAccountId: a.id, mainNumber: null, locale: "fr-CA" });
      return repo.partners.createPartner({ businessId: b.id, name: "besoinavocat.ca", creditPerMinute: null, createdBy: u.id });
    }
    const credit = (partnerId: string, reason: "topup" | "call" | "adjustment", credits: number, key: string) =>
      repo.partners.applyCredit({ partnerId, reason, credits, idempotencyKey: key, reference: reason, at });

    it("one partner per business; patch keeps unspecified fields", async () => {
      const p = await partner();
      expect(p).toMatchObject({ status: "active", creditBalance: 0, creditPerMinute: null, webhookUrl: null });
      await expect(repo.partners.createPartner({ businessId: p.businessId, name: "dup", creditPerMinute: null, createdBy: null })).rejects.toThrow();
      const u = await repo.partners.updatePartner(p.id, { webhookUrl: "https://hooks.example.com/x", creditPerMinute: 3 });
      expect(u).toMatchObject({ name: "besoinavocat.ca", webhookUrl: "https://hooks.example.com/x", creditPerMinute: 3 });
      expect((await repo.partners.getPartnerByBusiness(p.businessId))?.id).toBe(p.id);
    });

    it("credits: idempotent, a call debit stops at zero, an adjustment below zero is refused", async () => {
      const p = await partner();
      expect(await credit(p.id, "topup", 5, "topup:a")).toMatchObject({ status: "applied", balance: 5, row: { delta: 5, balanceAfter: 5 } });
      expect(await credit(p.id, "topup", 5, "topup:a")).toMatchObject({ status: "duplicate", balance: 5 });
      expect(await credit(p.id, "call", 8, "call:CA1")).toMatchObject({ status: "applied", balance: 0, row: { delta: -5, balanceAfter: 0 } });
      expect(await credit(p.id, "call", 4, "call:CA2")).toMatchObject({ status: "applied", balance: 0, row: { delta: 0, balanceAfter: 0 } });
      expect(await credit(p.id, "call", 4, "call:CA2")).toMatchObject({ status: "duplicate" });
      expect(await credit(p.id, "adjustment", -1, "adj:1")).toEqual({ status: "insufficient", balance: 0 });
      expect((await repo.partners.getPartner(p.id))!.creditBalance).toBe(0);
      const ledger = await repo.partners.listLedger(p.id, 10);
      expect(ledger.map((l) => l.delta)).toEqual([0, -5, 5]);
      expect(ledger.every((l) => l.balanceAfter >= 0)).toBe(true);
    });

    it("concurrent debits never overdraw and pay once per key", async () => {
      const p = await partner();
      await credit(p.id, "topup", 10, "topup:b");
      const results = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => credit(p.id, "call", 3, `call:C${i % 3}`)));
      expect(results.filter((r) => r.status === "applied")).toHaveLength(3);
      expect((await repo.partners.getPartner(p.id))!.creditBalance).toBe(1);
    });

    it("api keys by hash; revoke once", async () => {
      const p = await partner();
      const k = await repo.partners.createApiKey({ partnerId: p.id, prefix: "mimt_pk_abcdef", keySha256: "a".repeat(64), label: null, createdBy: null });
      expect((await repo.partners.findApiKeyByHash("a".repeat(64)))?.id).toBe(k.id);
      expect(await repo.partners.revokeApiKey(p.id, k.id, at)).toMatchObject({ revokedAt: at });
      expect(await repo.partners.revokeApiKey(p.id, k.id, at)).toBeNull();
    });

    it("members upsert on externalId; hunt groups on key", async () => {
      const p = await partner();
      const fields = { name: "Me Roy", email: null, phone: "+15145550107", handle: null, language: "fr" as const, active: true, extensionId: null };
      const a = await repo.partners.upsertMember(p.id, "avocat-7", fields);
      const b = await repo.partners.upsertMember(p.id, "avocat-7", { ...fields, active: false });
      expect([a.created, b.created]).toEqual([true, false]);
      expect(b.member).toMatchObject({ id: a.member.id, active: false });
      await repo.partners.upsertMember(p.id, "avocat-10", fields);
      expect((await repo.partners.listMembers(p.id)).map((m) => m.externalId)).toEqual(["avocat-10", "avocat-7"]);

      const g1 = await repo.pbx.createRingGroup({ businessId: p.businessId, name: "A", number: null, strategy: "simultaneous", memberExtensionIds: [], timeoutS: 20, overflow: null });
      const h = await repo.partners.upsertHuntGroup({ partnerId: p.id, key: "trouver-un-avocat", ringGroupId: g1.id });
      expect((await repo.partners.upsertHuntGroup({ partnerId: p.id, key: "trouver-un-avocat", ringGroupId: g1.id })).id).toBe(h.id);
      expect((await repo.partners.getHuntGroupByRingGroup(g1.id))?.key).toBe("trouver-un-avocat");
    });

    it("calls: once per CallSid, first answer wins, finalized once, listed after `since`", async () => {
      const p = await partner();
      const m = (await repo.partners.upsertMember(p.id, "avocat-7", { name: "Me Roy", email: null, phone: null, handle: null, language: "fr", active: true, extensionId: null })).member;
      const base = { partnerId: p.id, direction: "inbound" as const, fromNumber: "+14385550199", toNumber: "+15145550100", huntGroupKey: "g" };
      const c1 = await repo.partners.createCall({ ...base, callSid: "CA1", startedAt: at });
      expect((await repo.partners.createCall({ ...base, callSid: "CA1", startedAt: at })).id).toBe(c1.id);
      const later = new Date(at.getTime() + 60_000);
      await repo.partners.createCall({ ...base, callSid: "CA2", startedAt: later });

      expect(await repo.partners.markAnswered(c1.id, { memberId: m.id, externalId: "avocat-7", legSid: "L1", at })).toMatchObject({ externalId: "avocat-7", answeredLegSid: "L1" });
      expect(await repo.partners.markAnswered(c1.id, { memberId: m.id, externalId: "avocat-7", legSid: "L2", at })).toBeNull();
      const [x, y] = await Promise.all([repo.partners.claimFinalize(c1.id, at), repo.partners.claimFinalize(c1.id, at)]);
      expect([x, y].filter(Boolean)).toHaveLength(1);
      expect(await repo.partners.updateCall(c1.id, { talkS: 61, creditsCharged: 4, billing: "billed", endedAt: later })).toMatchObject({ talkS: 61, billing: "billed" });

      expect((await repo.partners.listCalls(p.id, { limit: 10 })).map((c) => c.callSid)).toEqual(["CA1", "CA2"]);
      expect((await repo.partners.listCalls(p.id, { since: at, limit: 10 })).map((c) => c.callSid)).toEqual(["CA2"]);
      expect((await repo.partners.listCalls(p.id, { externalId: "avocat-7", limit: 10 })).map((c) => c.callSid)).toEqual(["CA1"]);
      expect((await repo.partners.listRecentCalls(p.id, 1)).map((c) => c.callSid)).toEqual(["CA2"]);
    });

    it("lot A: slug unique; link requests single use, invalidated by a newer one or 5 wrong attempts", async () => {
      const p = await partner();
      expect(p.slug).toBeNull();
      expect(await repo.partners.updatePartner(p.id, { slug: "besoinavocat" })).toMatchObject({ slug: "besoinavocat" });
      expect((await repo.partners.getPartnerBySlug("besoinavocat"))?.id).toBe(p.id);
      const m = (await repo.partners.upsertMember(p.id, "avocat-7", { name: "Me Roy", email: null, phone: null, handle: null, language: "fr", active: true, extensionId: null })).member;
      const exp = new Date(at.getTime() + 15 * 60_000);
      const r1 = await repo.partners.createLinkRequest({ partnerId: p.id, memberId: m.id, codeSha256: "1".repeat(64), expiresAt: exp, at });
      const r2 = await repo.partners.createLinkRequest({ partnerId: p.id, memberId: m.id, codeSha256: "2".repeat(64), expiresAt: exp, at });
      expect((await repo.partners.getLinkRequest(r1.id))?.invalidatedAt).toEqual(at);
      expect(await repo.partners.consumeLinkRequest(r1.id, at)).toBe(false);
      expect((await repo.partners.findLinkRequestByHash("2".repeat(64)))?.id).toBe(r2.id);
      expect(await repo.partners.consumeLinkRequest(r2.id, exp)).toBe(false); // expired at expiresAt
      const [a, b] = await Promise.all([repo.partners.consumeLinkRequest(r2.id, at), repo.partners.consumeLinkRequest(r2.id, at)]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      const r3 = await repo.partners.createLinkRequest({ partnerId: p.id, memberId: m.id, codeSha256: "3".repeat(64), expiresAt: exp, at });
      for (let i = 1; i <= 4; i++) expect((await repo.partners.recordLinkRequestFailure(r3.id, 5, at))?.invalidatedAt).toBeNull();
      expect(await repo.partners.recordLinkRequestFailure(r3.id, 5, at)).toMatchObject({ attempts: 5, invalidatedAt: at });
      await expect(repo.partners.createLinkRequest({ partnerId: p.id, memberId: m.id, codeSha256: "3".repeat(64), expiresAt: exp, at })).rejects.toThrow();
    });

    it("lot A: one active link per member and per user per partner; revoke once; number on active links only", async () => {
      const p = await partner();
      const mk = async (id: string) =>
        (await repo.partners.upsertMember(p.id, id, { name: id, email: null, phone: null, handle: null, language: "fr", active: true, extensionId: null })).member;
      const [m1, m2] = [await mk("avocat-1"), await mk("avocat-2")];
      const u1 = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "Me Un" });
      const u2 = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "Me Deux" });
      const l1 = await repo.partners.createLink({ partnerId: p.id, memberId: m1.id, userId: u1.id, requestId: null, at });
      expect(l1.status).toBe("created");
      const link = l1.status === "created" ? l1.link : null;
      expect(await repo.partners.createLink({ partnerId: p.id, memberId: m1.id, userId: u2.id, requestId: null, at })).toEqual({ status: "member_taken" });
      expect(await repo.partners.createLink({ partnerId: p.id, memberId: m2.id, userId: u1.id, requestId: null, at })).toEqual({ status: "user_taken" });
      expect((await repo.partners.getActiveLinkByMember(m1.id))?.id).toBe(link!.id);
      expect((await repo.partners.getActiveLinkByUser(p.id, u1.id))?.id).toBe(link!.id);
      expect((await repo.partners.listActiveLinksByUser(u1.id)).map((l) => l.id)).toEqual([link!.id]);
      const acct = await repo.createAccount({ ownerUserId: u1.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
      const n = await repo.createNumber({ e164: "+15145550177", twilioSid: "PNlink", telecomAccountId: acct.id, kind: "local", state: "active", lastActivityAt: at, stateChangedAt: at });
      expect(await repo.partners.setLinkNumber(link!.id, n.id)).toMatchObject({ numberId: n.id });
      expect(await repo.partners.revokeLink(link!.id, "user", at)).toMatchObject({ revokedBy: "user", revokedAt: at });
      expect(await repo.partners.revokeLink(link!.id, "partner", at)).toBeNull();
      expect(await repo.partners.setLinkNumber(link!.id, null)).toBeNull();
      expect(await repo.partners.getActiveLinkByMember(m1.id)).toBeNull();
      expect((await repo.partners.createLink({ partnerId: p.id, memberId: m1.id, userId: u2.id, requestId: null, at })).status).toBe("created");
    });

    it("lot A: outbound calls carry their member and reference; open ones are counted", async () => {
      const p = await partner();
      const m = (await repo.partners.upsertMember(p.id, "avocat-7", { name: "Me Roy", email: null, phone: null, handle: null, language: "fr", active: true, extensionId: null })).member;
      const c = await repo.partners.createCall({
        partnerId: p.id, callSid: "CAout1", direction: "outbound", fromNumber: "+15145550177", toNumber: "+15145550199", huntGroupKey: null, startedAt: at,
        memberId: m.id, externalId: "avocat-7", reference: "dossier-1",
      });
      expect(c).toMatchObject({ memberId: m.id, externalId: "avocat-7", reference: "dossier-1", direction: "outbound" });
      expect(await repo.partners.countOpenOutboundCalls(m.id, new Date(at.getTime() - 1000))).toBe(1);
      await repo.partners.claimFinalize(c.id, at);
      expect(await repo.partners.countOpenOutboundCalls(m.id, new Date(at.getTime() - 1000))).toBe(0);
      const ev = await repo.partners.enqueueEvent({ partnerId: p.id, eventType: "member.number_changed", payload: { member_external_id: "avocat-7" }, at });
      expect((await repo.partners.getEvent(ev.id))?.payload).toEqual({ member_external_id: "avocat-7" });
    });

    it("lot B: availability defaults, patches only the given fields, null clears, weekly round-trips", async () => {
      const p = await partner();
      const mk = async (id: string) =>
        (await repo.partners.upsertMember(p.id, id, { name: id, email: null, phone: null, handle: null, language: "fr", active: true, extensionId: null })).member;
      const [m1, m2] = [await mk("avocat-1"), await mk("avocat-2")];
      expect(await repo.partners.getAvailability(m1.id)).toBeNull();
      expect(await repo.partners.listAvailability(p.id)).toEqual([]);

      const created = await repo.partners.upsertAvailability(p.id, m1.id, { userStatus: "busy" });
      expect(created).toMatchObject({ memberId: m1.id, partnerId: p.id, status: "available", weekly: null, until: null, userStatus: "busy" });
      const weekly = { mon: [{ open: "09:00", close: "12:00" }, { open: "13:00", close: "17:00" }], tue: [], wed: [], thu: [], fri: [{ open: "09:00", close: "17:00" }], sat: [], sun: [] };
      const until = new Date(at.getTime() + 3600_000);
      const set = await repo.partners.upsertAvailability(p.id, m1.id, { status: "offline", weekly, until });
      // userStatus left as it was (not in the patch).
      expect(set).toMatchObject({ status: "offline", weekly, until, userStatus: "busy" });
      const cleared = await repo.partners.upsertAvailability(p.id, m1.id, { weekly: null, until: null, userStatus: null });
      expect(cleared).toMatchObject({ status: "offline", weekly: null, until: null, userStatus: null });
      await repo.partners.upsertAvailability(p.id, m2.id, { status: "busy" });
      expect((await repo.partners.listAvailability(p.id)).map((a) => a.status).sort()).toEqual(["busy", "offline"]);
      expect((await repo.partners.getAvailability(m2.id))?.status).toBe("busy");
    });

    it("lot B: the subscription view sent is swapped only when it changes, on active links only", async () => {
      const p = await partner();
      const m = (await repo.partners.upsertMember(p.id, "avocat-9", { name: "Me Neuf", email: null, phone: null, handle: null, language: "fr", active: true, extensionId: null })).member;
      const u = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "Me Neuf" });
      const res = await repo.partners.createLink({ partnerId: p.id, memberId: m.id, userId: u.id, requestId: null, at });
      const link = res.status === "created" ? res.link : null;
      expect(await repo.partners.swapLinkSubscriptionState(link!.id, "free|none|1")).toBe(true);
      expect(await repo.partners.swapLinkSubscriptionState(link!.id, "free|none|1")).toBe(false);
      expect(await repo.partners.swapLinkSubscriptionState(link!.id, "premium|active|1")).toBe(true);
      await repo.partners.revokeLink(link!.id, "user", at);
      expect(await repo.partners.swapLinkSubscriptionState(link!.id, "premium|canceled|1")).toBe(false);
      const ev = await repo.partners.enqueueEvent({ partnerId: p.id, eventType: "member.availability_changed", payload: { member_external_id: "avocat-9", effective_status: "busy" }, at });
      expect((await repo.partners.getEvent(ev.id))?.eventType).toBe("member.availability_changed");
      for (const type of ["member.subscription_changed", "member.port_in_updated"] as const) {
        expect((await repo.partners.enqueueEvent({ partnerId: p.id, eventType: type, payload: {}, at })).eventType).toBe(type);
      }
    });

    it("webhook outbox: due, failed with backoff, dead, delivered", async () => {
      const p = await partner();
      const e = await repo.partners.enqueueEvent({ partnerId: p.id, eventType: "call.ringing", payload: { call_id: "x" }, at });
      expect((await repo.partners.listDueEvents(at, 10)).map((r) => r.id)).toEqual([e.id]);
      await repo.partners.markEventFailed(e.id, "HTTP 500", new Date(at.getTime() + 30_000));
      expect(await repo.partners.listDueEvents(at, 10)).toEqual([]);
      expect(await repo.partners.getEvent(e.id)).toMatchObject({ attempts: 1, lastError: "HTTP 500", payload: { call_id: "x" } });
      await repo.partners.markEventDelivered(e.id, at);
      expect(await repo.partners.listDueEvents(new Date(at.getTime() + 3600_000), 10)).toEqual([]);
      const dead = await repo.partners.enqueueEvent({ partnerId: p.id, eventType: "call.completed", payload: {}, at });
      await repo.partners.markEventFailed(dead.id, "HTTP 410", null);
      expect(await repo.partners.listDueEvents(new Date(at.getTime() + 86_400_000), 10)).toEqual([]);
    });
  });
}
