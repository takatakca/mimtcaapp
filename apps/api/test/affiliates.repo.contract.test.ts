import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NewAffiliate } from "../src/repo/affiliates.js";
import { MemoryRepository } from "../src/repo/memory.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from the memory and Postgres affiliate repositories (supabase/migrations/0019_affiliates.sql).
const pgUrl = process.env.TEST_DATABASE_URL;
const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 1 }), Boolean(pgUrl)],
];

const DAY = 86_400_000;

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`affiliates repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) {
        await repo.sql.unsafe("truncate affiliate_commissions, affiliate_hold_touches, affiliate_referrals, affiliates, number_holds, telecom_accounts, users cascade");
      } else repo = make();
    });

    const app = (over: Partial<NewAffiliate> = {}): NewAffiliate => ({
      piiEnc: "v1.encrypted-blob-xxxxxxxx",
      emailHash: `email-hash-${randomUUID()}`,
      phoneHash: "phone-hash-aaaaaaaaaaaa",
      province: "QC",
      channels: ["social", "website"],
      audienceSize: "1k_10k",
      locale: "fr-CA",
      privacyNoticeVersion: "2026-10-affilies-v1",
      caslConsent: false,
      adultAttested: true,
      ...over,
    });
    async function account() {
      const u = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "A" });
      return { user: u, account: await repo.createAccount({ ownerUserId: u.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" }) };
    }
    async function active(code = "ABCD2345") {
      const a = (await repo.affiliates.createApplication(app()))!;
      await repo.affiliates.update(a.id, ["applied"], { status: "approved", code, decidedAt: new Date() });
      await repo.affiliates.update(a.id, ["approved"], { status: "contract_sent", contractMode: "manual", contractSentAt: new Date() });
      return (await repo.affiliates.update(a.id, ["contract_sent"], { status: "active", signedAt: new Date() }))!;
    }
    const at = new Date("2026-11-01T12:00:00Z");

    it("creates an application with the default terms; one open application per email hash", async () => {
      const a = await repo.affiliates.createApplication(app({ emailHash: "email-hash-same-aaaaaa" }));
      expect(a).toMatchObject({ status: "applied", code: null, commissionBps: 2000, durationMonths: 12, payoutThresholdCents: 5000, channels: ["social", "website"], userId: null });
      expect(await repo.affiliates.createApplication(app({ emailHash: "email-hash-same-aaaaaa" }))).toBeNull();
      await repo.affiliates.update(a!.id, ["applied"], { status: "rejected", decidedAt: at });
      expect(await repo.affiliates.createApplication(app({ emailHash: "email-hash-same-aaaaaa" }))).not.toBeNull();
    });

    it("status transitions are compare-and-set; codes and envelopes are unique", async () => {
      const a = (await repo.affiliates.createApplication(app()))!;
      const b = (await repo.affiliates.createApplication(app()))!;
      expect(await repo.affiliates.update(a.id, ["approved"], { status: "contract_sent" })).toBeNull();
      const approved = await repo.affiliates.update(a.id, ["applied"], { status: "approved", code: "CODE2345", commissionBps: 1500, decidedAt: at });
      expect(approved).toMatchObject({ status: "approved", code: "CODE2345", commissionBps: 1500 });
      expect(await repo.affiliates.update(b.id, ["applied"], { status: "approved", code: "CODE2345" })).toBeNull();
      expect((await repo.affiliates.get(b.id))!.status).toBe("applied");
      await repo.affiliates.update(a.id, ["approved"], { status: "contract_sent", envelopeId: "env-1", contractMode: "docusign", contractSentAt: at });
      expect((await repo.affiliates.findByEnvelope("env-1"))!.id).toBe(a.id);
      expect((await repo.affiliates.findByCode("CODE2345"))!.id).toBe(a.id);
      expect(await repo.affiliates.list({ status: "applied", limit: 10 })).toHaveLength(1);
      expect(await repo.affiliates.list({ limit: 10 })).toHaveLength(2);
    });

    it("binds one dashboard user per affiliate, found by phone hash only when active", async () => {
      const a = await active();
      const { user } = await account();
      expect((await repo.affiliates.findUnboundByPhoneHash("phone-hash-aaaaaaaaaaaa")).map((r) => r.id)).toEqual([a.id]);
      expect(await repo.affiliates.bindUser(a.id, user.id)).toBe(true);
      expect(await repo.affiliates.bindUser(a.id, user.id)).toBe(false);
      expect((await repo.affiliates.findByUser(user.id))!.id).toBe(a.id);
      expect(await repo.affiliates.findUnboundByPhoneHash("phone-hash-aaaaaaaaaaaa")).toHaveLength(0);
    });

    it("first touch wins; commission start is set once; counts signups and paying customers", async () => {
      const a = await active("AAAA2345");
      const b = await active("BBBB2345");
      const { account: c } = await account();
      const first = await repo.affiliates.recordReferral({ telecomAccountId: c.id, affiliateId: a.id, source: "signup", touchedAt: at, expiresAt: new Date(at.getTime() + 60 * DAY) });
      expect(first.created).toBe(true);
      const second = await repo.affiliates.recordReferral({ telecomAccountId: c.id, affiliateId: b.id, source: "checkout", touchedAt: at, expiresAt: new Date(at.getTime() + DAY) });
      expect(second).toMatchObject({ created: false, row: { affiliateId: a.id, source: "signup" } });
      expect(await repo.affiliates.countReferrals(a.id)).toEqual({ signups: 1, paying: 0 });
      await repo.affiliates.startCommission(c.id, at);
      const again = await repo.affiliates.startCommission(c.id, new Date(at.getTime() + DAY));
      expect(again!.commissionStartAt).toEqual(at);
      expect(await repo.affiliates.countReferrals(a.id)).toEqual({ signups: 1, paying: 1 });
    });

    it("keeps a hold touch once per hold", async () => {
      const a = await active();
      const hold = (await repo.numberHolds.create({ e164: "+15145550199", tokenHash: "t".repeat(64), ipHash: "i".repeat(64), expiresAt: new Date(Date.now() + 600_000), now: new Date() }))!;
      await repo.affiliates.addHoldTouch(hold.id, a.id, at);
      await repo.affiliates.addHoldTouch(hold.id, a.id, new Date(at.getTime() + DAY));
      expect(await repo.affiliates.getHoldTouch(hold.id)).toEqual({ affiliateId: a.id, touchedAt: at });
    });

    it("one commission per invoice; pending → payable after the hold → paid", async () => {
      const a = await active();
      const { account: c } = await account();
      const row = await repo.affiliates.addCommission({
        affiliateId: a.id,
        telecomAccountId: c.id,
        stripeInvoiceId: "in_1",
        netRevenueCents: 2999,
        commissionBps: 2000,
        commissionCents: 599,
        earnedAt: at,
        payableAt: new Date(at.getTime() + 30 * DAY),
      });
      expect(row).toMatchObject({ kind: "invoice", sourceRef: "invoice:in_1", status: "pending", reversedCents: 0, commissionCents: 599 });
      expect(await repo.affiliates.addCommission({ ...row!, stripeInvoiceId: "in_1" })).toBeNull();
      expect((await repo.affiliates.getInvoiceCommission("in_1"))!.id).toBe(row!.id);
      expect(await repo.affiliates.releaseDue(new Date(at.getTime() + 29 * DAY))).toBe(0);
      expect(await repo.affiliates.releaseDue(new Date(at.getTime() + 30 * DAY))).toBe(1);
      expect((await repo.affiliates.listPayable()).map((r) => r.id)).toEqual([row!.id]);
      const paid = await repo.affiliates.markPaid(a.id, { payoutRef: "interac-1", at });
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({ status: "paid", payoutRef: "interac-1", paidAt: at });
      expect(await repo.affiliates.markPaid(a.id, { payoutRef: "again", at })).toHaveLength(0);
    });

    it("reversals reduce an unpaid commission and add one clawback per target for a paid one", async () => {
      const a = await active();
      const { account: c } = await account();
      const base = { affiliateId: a.id, telecomAccountId: c.id, netRevenueCents: 2999, commissionBps: 2000, commissionCents: 599, earnedAt: at, payableAt: at };
      await repo.affiliates.addCommission({ ...base, stripeInvoiceId: "in_a" });
      const partial = await repo.affiliates.applyReversal("in_a", 299, "refund", at);
      expect(partial!.commission).toMatchObject({ reversedCents: 299, status: "pending", reversalReason: "refund" });
      expect(partial!.clawback).toBeNull();
      expect(await repo.affiliates.applyReversal("in_a", 299, "refund", at)).toBeNull(); // nothing more
      expect((await repo.affiliates.applyReversal("in_a", 10_000, "chargeback", at))!.commission).toMatchObject({ reversedCents: 599, status: "reversed" });

      await repo.affiliates.addCommission({ ...base, stripeInvoiceId: "in_b" });
      await repo.affiliates.releaseDue(at);
      await repo.affiliates.markPaid(a.id, { payoutRef: "p1", at });
      const claw = await repo.affiliates.applyReversal("in_b", 599, "chargeback", at);
      expect(claw!.commission).toMatchObject({ status: "paid", reversedCents: 599 });
      expect(claw!.clawback).toMatchObject({ kind: "clawback", commissionCents: -599, status: "payable", sourceRef: "clawback:in_b:599" });
      expect(await repo.affiliates.applyReversal("in_b", 599, "chargeback", at)).toBeNull();
      expect((await repo.affiliates.listCommissions(a.id)).filter((r) => r.kind === "clawback")).toHaveLength(1);
      expect(await repo.affiliates.applyReversal("in_unknown", 100, "refund", at)).toBeNull();
    });

    it("purges rejected applications after the retention period only", async () => {
      const a = (await repo.affiliates.createApplication(app()))!;
      const b = (await repo.affiliates.createApplication(app()))!;
      await repo.affiliates.update(a.id, ["applied"], { status: "rejected", decidedAt: new Date(at.getTime() - 100 * DAY) });
      await repo.affiliates.update(b.id, ["applied"], { status: "rejected", decidedAt: at });
      expect(await repo.affiliates.purgeRejected(new Date(at.getTime() - 90 * DAY))).toBe(1);
      expect(await repo.affiliates.get(a.id)).toBeNull();
      expect(await repo.affiliates.get(b.id)).not.toBeNull();
    });
  });
}
