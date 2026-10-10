import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";
import { hashDeviceKey } from "../src/services/referrals.js";

// Same behaviour from both referral stores. Postgres runs only with TEST_DATABASE_URL (migrations applied).
const pgUrl = process.env.TEST_DATABASE_URL;
const TABLES = "users, telecom_accounts, attested_devices, referral_codes, referrals, payment_fingerprints";

const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 2 }), Boolean(pgUrl)],
];

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`referral repository: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) await repo.sql.unsafe(`truncate ${TABLES} cascade`);
      else repo = make();
    });

    const user = () => repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: null });

    it("stores one unique code per user", async () => {
      const [a, b] = [await user(), await user()];
      expect(await repo.referrals.createCode(a.id, "ABCD2345")).toMatchObject({ code: "ABCD2345", userId: a.id });
      expect(await repo.referrals.createCode(b.id, "ABCD2345")).toBeNull();
      expect(await repo.referrals.createCode(a.id, "WXYZ6789")).toBeNull();
      expect((await repo.referrals.findCode("ABCD2345"))?.userId).toBe(a.id);
      expect((await repo.referrals.getCodeForUser(a.id))?.code).toBe("ABCD2345");
      expect(await repo.referrals.getCodeForUser(b.id)).toBeNull();
    });

    it("keeps one referral per referee and settles it once", async () => {
      const [a, b, c] = [await user(), await user(), await user()];
      await repo.referrals.createCode(a.id, "ABCD2345");
      const hash = hashDeviceKey("device-key-1");
      const r = await repo.referrals.createReferral({ code: "ABCD2345", referrerUserId: a.id, refereeUserId: b.id, deviceKeyHash: hash });
      expect(r).toMatchObject({ status: "pending", rejectReason: null, deviceKeyHash: hash, rewardedAt: null });
      expect(await repo.referrals.createReferral({ code: "ABCD2345", referrerUserId: a.id, refereeUserId: b.id, deviceKeyHash: null })).toBeNull();
      await repo.referrals.createReferral({ code: "ABCD2345", referrerUserId: a.id, refereeUserId: c.id, deviceKeyHash: null });
      expect((await repo.referrals.listReferralsByReferrer(a.id)).map((x) => x.refereeUserId).sort()).toEqual([b.id, c.id].sort());

      const at = new Date("2026-10-10T12:00:00Z");
      expect(await repo.referrals.settleReferral(r!.id, { status: "rewarded", rejectReason: null, refereePaymentFingerprint: "fp1", at })).toBe(true);
      expect(await repo.referrals.settleReferral(r!.id, { status: "rejected", rejectReason: "same_payment", refereePaymentFingerprint: "fp1", at })).toBe(false);
      expect(await repo.referrals.getReferralForReferee(b.id)).toMatchObject({ status: "rewarded", refereePaymentFingerprint: "fp1", rewardedAt: at });
    });

    it("reads attested devices and payment fingerprints", async () => {
      const [a, b] = [await user(), await user()];
      await repo.bindDevice({ platform: "ios", deviceKey: "device-key-1", userId: a.id, verifiedAt: new Date() });
      expect(await repo.referrals.listDeviceKeys(a.id)).toEqual(["device-key-1"]);
      expect(await repo.referrals.findDeviceUsers("device-key-1")).toEqual([a.id]);
      expect(await repo.referrals.findDeviceUsers("device-key-2")).toEqual([]);

      const acct = await repo.createAccount({ ownerUserId: b.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "new" });
      await repo.referrals.addPaymentFingerprint(acct.id, "fp_a", new Date());
      await repo.referrals.addPaymentFingerprint(acct.id, "fp_a", new Date());
      await repo.referrals.addPaymentFingerprint(acct.id, "fp_b", new Date());
      expect((await repo.referrals.listPaymentFingerprints(acct.id)).sort()).toEqual(["fp_a", "fp_b"]);
    });
  });
}
