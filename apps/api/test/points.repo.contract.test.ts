import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import type { PointsEarnInput } from "../src/repo/points.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from the memory and Postgres points ledgers (supabase/migrations/0018_points.sql).
const pgUrl = process.env.TEST_DATABASE_URL;
const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 2 }), Boolean(pgUrl)],
];

const at = new Date("2026-10-28T12:00:00Z");
const caps = { daily: 5000, monthly: 20000, dayStart: new Date("2026-10-28T00:00:00Z"), monthStart: new Date("2026-10-01T00:00:00Z") };

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`points repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) {
        await repo.sql.unsafe("truncate points_ledger, points_redemptions, points_accounts, points_campaigns, usage_ledger, telecom_accounts, users cascade");
      } else repo = make();
    });
    async function account() {
      const u = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "A" });
      return (await repo.createAccount({ ownerUserId: u.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" })).id;
    }
    const earn = (accountId: string, over: Partial<PointsEarnInput> = {}): PointsEarnInput => ({
      telecomAccountId: accountId,
      at,
      entries: [{ reason: "purchase", points: 129, idempotencyKey: `invoice:in_${accountId.slice(0, 8)}`, reference: "invoice" }],
      caps,
      ...over,
    });

    it("credits once per idempotency key and keeps the balance in step with the ledger", async () => {
      const a = await account();
      const first = await repo.points.earn(earn(a));
      expect(first).toMatchObject({ duplicates: 0, balance: 129 });
      expect(first.written[0]).toMatchObject({ delta: 129, reason: "purchase", balanceAfter: 129, reference: "invoice" });
      const again = await repo.points.earn(earn(a));
      expect(again).toMatchObject({ duplicates: 1, balance: 129, written: [] });
      expect(await repo.points.getAccount(a)).toMatchObject({ balance: 129, lifetimeEarned: 129 });
      expect(await repo.points.usedKeys([`invoice:in_${a.slice(0, 8)}`, "nope"])).toEqual(new Set([`invoice:in_${a.slice(0, 8)}`]));
      const ledger = await repo.points.listLedger(a, 10);
      expect(ledger).toHaveLength(1);
    });

    it("concurrent credits with the same key pay once; different keys all land", async () => {
      const a = await account();
      const results = await Promise.all([1, 2, 3, 4].map(() => repo.points.earn(earn(a))));
      expect(results.filter((r) => r.written.length === 1)).toHaveLength(1);
      await Promise.all([1, 2, 3].map((i) => repo.points.earn(earn(a, { entries: [{ reason: "purchase", points: 10, idempotencyKey: `k:${a}:${i}`, reference: "invoice" }] }))));
      expect((await repo.points.getAccount(a))?.balance).toBe(159);
    });

    it("clips at the daily and monthly caps and records the clipped event (delta 0) so a retry earns nothing later", async () => {
      const a = await account();
      const r = await repo.points.earn(earn(a, { entries: [{ reason: "purchase", points: 7000, idempotencyKey: "big", reference: "invoice" }] }));
      expect(r.written[0]).toMatchObject({ delta: 5000, meta: { requested: 7000 } });
      const zero = await repo.points.earn(earn(a, { entries: [{ reason: "referral", points: 1000, idempotencyKey: "ref", reference: "referral" }] }));
      expect(zero.written[0]).toMatchObject({ delta: 0, meta: { requested: 1000 } });
      const nextDay = { ...caps, dayStart: new Date("2026-10-29T00:00:00Z") };
      expect((await repo.points.earn(earn(a, { at: new Date("2026-10-29T08:00:00Z"), caps: nextDay, entries: [{ reason: "referral", points: 1000, idempotencyKey: "ref", reference: "referral" }] }))).duplicates).toBe(1);
      // A refund does not count toward the caps.
      expect((await repo.points.getAccount(a))?.balance).toBe(5000);
    });

    it("a campaign never spends past its budget, and only inside its window", async () => {
      const a = await account();
      const c = await repo.points.createCampaign({
        name: "Double points annuel",
        kind: "multiplier",
        target: "purchase_yearly",
        multiplier: 2,
        bonusPoints: null,
        startsAt: new Date("2026-10-27T00:00:00Z"),
        endsAt: new Date("2026-11-03T00:00:00Z"),
        budgetPoints: 1500,
        createdBy: null,
      });
      expect(c).toMatchObject({ multiplier: 2, spentPoints: 0, active: true });
      expect((await repo.points.activeCampaigns(at)).map((x) => x.id)).toEqual([c.id]);
      const r = await repo.points.earn(earn(a, { entries: [
        { reason: "purchase", points: 1428, idempotencyKey: "inv-y", reference: "invoice" },
        { reason: "campaign", points: 1428, idempotencyKey: `inv-y:c:${c.id}`, reference: "invoice", campaignId: c.id },
      ] }));
      expect(r.written.map((w) => w.delta)).toEqual([1428, 1428]);
      const r2 = await repo.points.earn(earn(a, { entries: [{ reason: "campaign", points: 500, idempotencyKey: `inv-y2:c:${c.id}`, reference: "invoice", campaignId: c.id }] }));
      expect(r2.written[0]!.delta).toBe(72);
      expect((await repo.points.getCampaign(c.id))?.spentPoints).toBe(1500);
      expect(await repo.points.activeCampaigns(at)).toEqual([]);
      // Outside its window: nothing.
      const late = await repo.points.earn(earn(a, { at: new Date("2026-11-05T00:00:00Z"), entries: [{ reason: "campaign", points: 10, idempotencyKey: "late", reference: "invoice", campaignId: c.id }] }));
      expect(late.written[0]!.delta).toBe(0);
      expect((await repo.points.listLedger(a, 10)).find((l) => l.campaignId)?.campaignName).toBe("Double points annuel");
      // Budget can be raised, never set below what was spent.
      expect((await repo.points.updateCampaign(c.id, { budgetPoints: 3000, active: false }))).toMatchObject({ budgetPoints: 3000, active: false });
      await expect(repo.points.updateCampaign(c.id, { budgetPoints: 10 })).rejects.toThrow();
      expect((await repo.points.listCampaigns()).map((x) => x.id)).toEqual([c.id]);
    });

    it("redeems atomically: debit + pending redemption, replay by key, monthly limit, never below zero", async () => {
      const a = await account();
      await repo.points.earn(earn(a, { entries: [{ reason: "mission", points: 600, idempotencyKey: "m-1", reference: "mission:first_number" }] }));
      const input = { telecomAccountId: a, at, clientKey: "key-00000001", rewardId: "minutes_out_30", points: 300, monthlyLimit: 1, monthStart: caps.monthStart };
      const r = await repo.points.redeem(input);
      expect(r).toMatchObject({ status: "created", balance: 300, redemption: { status: "pending", points: 300, rewardId: "minutes_out_30" } });
      expect(await repo.points.redeem(input)).toMatchObject({ status: "replay", balance: 300 });
      expect(await repo.points.redeem({ ...input, clientKey: "key-00000002" })).toMatchObject({ status: "monthly_limit", used: 1 });
      expect(await repo.points.redeem({ ...input, clientKey: "key-00000003", rewardId: "minutes_out_100", points: 1000, monthlyLimit: 2 })).toEqual({ status: "insufficient", balance: 300 });
      if (r.status !== "created") throw new Error("expected created");
      expect(await repo.points.finishRedemption(r.redemption.id, "usage:2026-10", at)).toMatchObject({ status: "fulfilled", fulfilmentRef: "usage:2026-10" });
      expect(await repo.points.finishRedemption(r.redemption.id, "again", at)).toBeNull();
      expect(await repo.points.countRedemptions(a, caps.monthStart)).toEqual({ minutes_out_30: 1 });
      const ledger = await repo.points.listLedger(a, 10);
      expect(ledger[0]).toMatchObject({ delta: -300, reason: "redeem", balanceAfter: 300, reference: "reward:minutes_out_30" });
    });

    it("concurrent redemptions never overdraw the balance", async () => {
      const a = await account();
      await repo.points.earn(earn(a, { entries: [{ reason: "mission", points: 600, idempotencyKey: "m-c", reference: "mission:first_number" }] }));
      const results = await Promise.all(
        [1, 2, 3, 4].map((i) => repo.points.redeem({ telecomAccountId: a, at, clientKey: `parallel-${i}-xxxx`, rewardId: "texts_50", points: 250, monthlyLimit: 4, monthStart: caps.monthStart })),
      );
      expect(results.filter((r) => r.status === "created")).toHaveLength(2);
      expect(results.filter((r) => r.status === "insufficient")).toHaveLength(2);
      expect((await repo.points.getAccount(a))?.balance).toBe(100);
    });

    it("a failed fulfilment is refunded once, with a compensating credit", async () => {
      const a = await account();
      await repo.points.earn(earn(a, { entries: [{ reason: "mission", points: 300, idempotencyKey: "m-r", reference: "mission:choose_handle" }] }));
      const r = await repo.points.redeem({ telecomAccountId: a, at, clientKey: "refund-0001", rewardId: "ad_free_week", points: 200, monthlyLimit: 4, monthStart: caps.monthStart });
      if (r.status !== "created") throw new Error("expected created");
      const refunded = await repo.points.refundRedemption(r.redemption.id, "boom", at);
      expect(refunded).toMatchObject({ balance: 300, redemption: { status: "refunded", error: "boom" } });
      expect(await repo.points.refundRedemption(r.redemption.id, "boom", at)).toBeNull();
      expect(await repo.points.countRedemptions(a, caps.monthStart)).toEqual({});
      expect((await repo.points.getAccount(a))).toMatchObject({ balance: 300, lifetimeEarned: 300 });
    });

    it("expires a balance after inactivity, once, and not when there was activity", async () => {
      const a = await account();
      const b = await account();
      const old = new Date("2025-09-01T00:00:00Z");
      await repo.points.earn(earn(a, { at: old, caps: { ...caps, dayStart: old, monthStart: old }, entries: [{ reason: "mission", points: 450, idempotencyKey: "old-a", reference: "mission:verify_phone" }] }));
      await repo.points.earn(earn(b, { entries: [{ reason: "mission", points: 150, idempotencyKey: "new-b", reference: "mission:verify_phone" }] }));
      const before = new Date("2025-10-28T12:00:00Z");
      const due = await repo.points.listExpirable(before, 10);
      expect(due.map((d) => d.telecomAccountId)).toEqual([a]);
      expect(await repo.points.expire(a, before, at)).toMatchObject({ delta: -450, reason: "expiry", balanceAfter: 0 });
      expect(await repo.points.expire(a, before, at)).toBeNull();
      expect(await repo.points.expire(b, before, at)).toBeNull();
      expect((await repo.points.getAccount(a))?.balance).toBe(0);
    });

    if (name === "postgres") {
      it("the database itself refuses a negative balance, a ledger rewrite and a duplicate key", async () => {
        const pg = repo as PostgresRepository;
        const a = await account();
        await repo.points.earn(earn(a));
        await expect(pg.sql`update points_accounts set balance = -1 where telecom_account_id = ${a}`).rejects.toThrow();
        await expect(pg.sql`update points_ledger set delta = 999 where telecom_account_id = ${a}`).rejects.toThrow(/append-only/);
        await expect(pg.sql`delete from points_ledger where telecom_account_id = ${a}`).rejects.toThrow(/append-only/);
        await expect(
          pg.sql`insert into points_ledger (telecom_account_id, delta, reason, reference, idempotency_key, balance_after) values (${a}, 1, 'purchase', 'x', ${`invoice:in_${a.slice(0, 8)}`}, 1)`,
        ).rejects.toThrow();
        await expect(pg.sql`insert into points_ledger (telecom_account_id, delta, reason, reference, idempotency_key, balance_after) values (${a}, 5, 'redeem', 'x', 'neg', 1)`).rejects.toThrow();
      });
    }

    it("the ledger survives the account purge (accounting and anti-abuse record)", async () => {
      const u = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "A", phoneE164: "+15145550177" });
      const a = (await repo.createAccount({ ownerUserId: u.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" })).id;
      await repo.points.earn(earn(a));
      await repo.purgeUserData(u.id, a);
      expect(await repo.points.listLedger(a, 10)).toHaveLength(1);
      expect((await repo.points.getAccount(a))?.balance).toBe(129);
    });
  });
}
