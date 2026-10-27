import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import type { NewMissionReward } from "../src/repo/missions.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from the memory and Postgres mission ledgers (supabase/migrations/0017_missions.sql).
const pgUrl = process.env.TEST_DATABASE_URL;
const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 1 }), Boolean(pgUrl)],
];

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`missions repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) await repo.sql.unsafe("truncate mission_rewards, usage_ledger, telecom_accounts, users cascade");
      else repo = make();
    });
    async function account() {
      const u = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "A" });
      return (await repo.createAccount({ ownerUserId: u.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" })).id;
    }
    const at = new Date("2026-10-27T12:00:00Z");
    const reward = (accountId: string, over: Partial<NewMissionReward> = {}): NewMissionReward & { usagePeriods: string[] } => ({
      telecomAccountId: accountId,
      missionId: "choose_handle",
      minutes: 30,
      bucket: "on_net",
      status: "granted",
      period: "2026-10",
      ownerHash: null,
      deviceHash: null,
      sourceRef: "handle",
      grantedAt: at,
      usagePeriods: ["2026-10", "2026-10-27"],
      ...over,
    });

    it("records a reward once per account and mission, with its minutes in the same write", async () => {
      const a = await account();
      const row = await repo.missions.grant(reward(a));
      expect(row).toMatchObject({ telecomAccountId: a, missionId: "choose_handle", minutes: 30, bucket: "on_net", status: "granted", period: "2026-10" });
      expect(row!.creditedAt).toEqual(at);
      expect(await repo.missions.grant(reward(a))).toBeNull();
      const usage = await repo.getUsage(a, "2026-10");
      expect(usage.bonusMinutesOnNet).toBe(30);
      expect(usage.bonusMinutesOut).toBe(0);
      expect((await repo.getUsage(a, "2026-10-27")).bonusMinutesOnNet).toBe(30);
      expect(await repo.missions.listForAccount(a)).toHaveLength(1);
    });

    it("outbound minutes go to bonus_minutes_out", async () => {
      const a = await account();
      await repo.missions.grant(reward(a, { missionId: "first_number", minutes: 60, bucket: "outbound" }));
      expect((await repo.getUsage(a, "2026-10")).bonusMinutesOut).toBe(60);
    });

    it("refuses a second reward for the same owner hash or device hash on another account", async () => {
      const a = await account();
      const b = await account();
      expect(await repo.missions.grant(reward(a, { missionId: "verify_phone", minutes: 15, ownerHash: "owner-hash-aaaaaaaaaaaa" }))).not.toBeNull();
      expect(await repo.missions.grant(reward(b, { missionId: "verify_phone", minutes: 15, ownerHash: "owner-hash-aaaaaaaaaaaa" }))).toBeNull();
      expect((await repo.getUsage(b, "2026-10")).bonusMinutesOnNet).toBe(0);
      // The same owner can still earn another mission, once.
      expect(await repo.missions.grant(reward(b, { ownerHash: "owner-hash-aaaaaaaaaaaa" }))).not.toBeNull();
      expect(await repo.missions.grant(reward(a, { ownerHash: "owner-hash-aaaaaaaaaaaa" }))).toBeNull();
    });

    it("install_app once per device", async () => {
      const a = await account();
      const b = await account();
      expect(await repo.missions.grant(reward(a, { missionId: "install_app", deviceHash: "device-hash-bbbbbbbbbbbb" }))).not.toBeNull();
      expect(await repo.missions.grant(reward(b, { missionId: "install_app", deviceHash: "device-hash-bbbbbbbbbbbb" }))).toBeNull();
      expect((await repo.getUsage(b, "2026-10")).bonusMinutesOnNet).toBe(0);
    });

    it("a pending reward is credited once, into the bucket given at credit time", async () => {
      const a = await account();
      const row = await repo.missions.grant(reward(a, { status: "pending", period: null }));
      expect(row).toMatchObject({ status: "pending", period: null, creditedAt: null });
      expect((await repo.getUsage(a, "2026-10")).bonusMinutesOnNet).toBe(0);
      const later = new Date("2026-11-02T08:00:00Z");
      const credited = await repo.missions.creditPending(row!.id, "outbound", ["2026-11", "2026-11-02"], later);
      expect(credited).toMatchObject({ status: "granted", period: "2026-11", bucket: "outbound" });
      expect(credited!.creditedAt).toEqual(later);
      expect(await repo.missions.creditPending(row!.id, "outbound", ["2026-11"], later)).toBeNull();
      expect((await repo.getUsage(a, "2026-11")).bonusMinutesOut).toBe(30);
    });

    it("a reward without minutes has no bucket and credits nothing", async () => {
      const a = await account();
      const row = await repo.missions.grant(reward(a, { missionId: "go_yearly", minutes: 0, bucket: null, period: null, sourceRef: "stripe:sub_1" }));
      expect(row).toMatchObject({ minutes: 0, bucket: null, creditedAt: null });
      expect((await repo.getUsage(a, "2026-10")).bonusMinutesOnNet + (await repo.getUsage(a, "2026-10")).bonusMinutesOut).toBe(0);
    });

    it("the ledger survives the account purge (anti-abuse record)", async () => {
      const u = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "A", phoneE164: "+15145550111" });
      const a = (await repo.createAccount({ ownerUserId: u.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" })).id;
      await repo.missions.grant(reward(a, { ownerHash: "owner-hash-cccccccccccc" }));
      await repo.purgeUserData(u.id, a);
      expect(await repo.missions.listForAccount(a)).toHaveLength(1);
    });
  });
}
