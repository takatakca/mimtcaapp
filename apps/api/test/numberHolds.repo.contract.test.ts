import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from the memory and Postgres number-hold stores (supabase/migrations/0012_number_holds.sql).
// Postgres runs only with TEST_DATABASE_URL (a scratch database with every migration applied).
const pgUrl = process.env.TEST_DATABASE_URL;

const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 1 }), Boolean(pgUrl)],
];

const T0 = new Date("2026-10-20T12:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const h = (c: string) => c.repeat(64);

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`number holds repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) await repo.sql.unsafe("truncate number_holds, telecom_accounts, users cascade");
      else repo = make();
    });

    it("one live hold per number; an expired one gives way", async () => {
      const a = await repo.numberHolds.create({ e164: "+15145550101", tokenHash: h("a"), ipHash: "ip1", expiresAt: at(10), now: T0 });
      expect(a).toMatchObject({ e164: "+15145550101", status: "held", telecomAccountId: null });
      expect(await repo.numberHolds.create({ e164: "+15145550101", tokenHash: h("b"), ipHash: "ip2", expiresAt: at(15), now: at(5) })).toBeNull();
      const b = await repo.numberHolds.create({ e164: "+15145550101", tokenHash: h("b"), ipHash: "ip2", expiresAt: at(21), now: at(11) });
      expect(b?.id).not.toBe(a!.id);
      expect((await repo.numberHolds.get(a!.id))?.status).toBe("expired");
    });

    it("lists live holds by number and by IP, counts by IP", async () => {
      const a = await repo.numberHolds.create({ e164: "+15145550101", tokenHash: h("a"), ipHash: "ip1", expiresAt: at(10), now: T0 });
      await repo.numberHolds.create({ e164: "+15145550102", tokenHash: h("b"), ipHash: "ip1", expiresAt: at(10), now: T0 });
      expect(await repo.numberHolds.liveHeld(["+15145550101", "+15145550102", "+15145550103"], at(1))).toEqual(new Set(["+15145550101", "+15145550102"]));
      expect(await repo.numberHolds.liveHeld([], at(1))).toEqual(new Set());
      expect((await repo.numberHolds.liveByIp("ip1", at(1))).length).toBe(2);
      expect(await repo.numberHolds.countByIpSince("ip1", at(-1))).toBe(2);
      await repo.numberHolds.finish(a!.id, "released");
      expect(await repo.numberHolds.liveHeld(["+15145550101"], at(1))).toEqual(new Set());
      expect((await repo.numberHolds.liveByIp("ip1", at(11))).length).toBe(0);
    });

    it("binds a live hold to an account and a checkout, then converts it once", async () => {
      const u = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "A" });
      const account = await repo.createAccount({ ownerUserId: u.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
      const a = await repo.numberHolds.create({ e164: "+15145550101", tokenHash: h("a"), ipHash: "ip1", expiresAt: at(10), now: T0 });
      expect(await repo.numberHolds.startCheckout(a!.id, { telecomAccountId: account.id, checkoutSessionId: "cs_1", expiresAt: at(41), now: at(2) })).toBe(true);
      expect(await repo.numberHolds.get(a!.id)).toMatchObject({ status: "checkout", telecomAccountId: account.id, checkoutSessionId: "cs_1", expiresAt: at(41) });
      expect(await repo.numberHolds.finish(a!.id, "converted")).toBe(true);
      expect(await repo.numberHolds.finish(a!.id, "converted")).toBe(false);
      expect(await repo.numberHolds.startCheckout(a!.id, { telecomAccountId: account.id, checkoutSessionId: "cs_2", expiresAt: at(41), now: at(3) })).toBe(false);
    });

    it("cannot start checkout on an expired hold", async () => {
      const u = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "A" });
      const account = await repo.createAccount({ ownerUserId: u.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
      const a = await repo.numberHolds.create({ e164: "+15145550101", tokenHash: h("a"), ipHash: "ip1", expiresAt: at(10), now: T0 });
      expect(await repo.numberHolds.startCheckout(a!.id, { telecomAccountId: account.id, checkoutSessionId: "cs_1", expiresAt: at(41), now: at(11) })).toBe(false);
    });
  });
}
