import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from the memory and Postgres security stores (supabase/migrations/0022_security_sessions.sql).
const pgUrl = process.env.TEST_DATABASE_URL;
const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 1 }), Boolean(pgUrl)],
];

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`security repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) await repo.sql.unsafe("truncate auth_sessions, passkeys, business_security_policies, businesses, telecom_accounts, users cascade");
      else repo = make();
    });
    const user = async () => (await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "A" })).id;
    const t0 = new Date("2026-10-29T12:00:00Z");
    const session = (userId: string, ua = "Chrome · Windows", id = randomUUID()) =>
      repo.security.createSession({ id, userId, method: "sms", userAgent: ua, ipPrefix: "203.0.113.0/24", at: t0, recentAuthAt: t0, strongAuthAt: null });

    it("creates sessions idempotently, lists active ones, revokes and prunes", async () => {
      const u = await user();
      const a = await session(u);
      expect(await repo.security.createSession({ id: a.id, userId: u, method: "passkey", userAgent: "x", ipPrefix: null, at: t0, recentAuthAt: null, strongAuthAt: null })).toMatchObject({ method: "sms", userAgent: "Chrome · Windows" });
      const b = await session(u, "Safari · iOS");
      const c = await session(u, "Safari · iOS");
      expect(await repo.security.deviceHistory(u, "Safari · iOS")).toEqual({ anySession: true, sameDevice: true });
      expect(await repo.security.deviceHistory(u, "Firefox · Linux")).toEqual({ anySession: true, sameDevice: false });
      expect(await repo.security.deviceHistory(await user(), "Firefox · Linux")).toEqual({ anySession: false, sameDevice: false });

      await repo.security.touchSession(b.id, new Date(t0.getTime() + 60_000));
      expect((await repo.security.listActiveSessions(u))[0]!.id).toBe(b.id);
      await repo.security.markAuth(a.id, new Date(t0.getTime() + 1000), true);
      expect((await repo.security.getSession(a.id))!.strongAuthAt).toEqual(new Date(t0.getTime() + 1000));

      expect(await repo.security.revokeSession(c.id, t0)).toBe(true);
      expect(await repo.security.revokeSession(c.id, t0)).toBe(false);
      expect((await repo.security.revokeOtherSessions(u, a.id, t0)).sort()).toEqual([b.id]);
      expect((await repo.security.listActiveSessions(u)).map((s) => s.id)).toEqual([a.id]);
      expect(await repo.security.revokeOtherSessions(u, null, t0)).toEqual([a.id]);

      expect(await repo.security.pruneSessions(new Date(t0.getTime() + 1))).toBe(3);
      expect(await repo.security.getSession(a.id)).toBeNull();
    });

    it("stores passkeys with their counter, one owner per credential", async () => {
      const u = await user();
      const other = await user();
      const k = await repo.security.addPasskey({ userId: u, credentialId: "Y3JlZGVudGlhbC1pZC0x", publicKey: "cHVi", counter: 0, transports: ["internal", "hybrid"], deviceType: "multiDevice", backedUp: true, name: "iPhone", createdAt: t0 });
      await expect(repo.security.addPasskey({ userId: other, credentialId: "Y3JlZGVudGlhbC1pZC0x", publicKey: "cHVi", counter: 0, transports: [], deviceType: "singleDevice", backedUp: false, name: "x", createdAt: t0 })).rejects.toThrow();
      await repo.security.updatePasskeyUse(k.id, 4_000_000_000, t0);
      expect(await repo.security.findPasskeyByCredentialId("Y3JlZGVudGlhbC1pZC0x")).toMatchObject({ userId: u, counter: 4_000_000_000, transports: ["internal", "hybrid"], lastUsedAt: t0 });
      expect(await repo.security.deletePasskey(k.id, other)).toBe(false);
      expect(await repo.security.listPasskeys(u)).toHaveLength(1);
      expect(await repo.security.deletePasskey(k.id, u)).toBe(true);
      expect(await repo.security.listPasskeys(u)).toHaveLength(0);
    });

    it("keeps the business policy off by default", async () => {
      const u = await user();
      const account = await repo.createAccount({ ownerUserId: u, kind: "business", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
      const biz = await repo.pbx.createBusiness({ name: "Atelier", takatakBusinessId: null, telecomAccountId: account.id, mainNumber: null, locale: "fr-CA" } as never);
      expect(await repo.security.getBusinessPolicy(biz.id)).toEqual({ requireStrongAuth: false });
      await repo.security.setBusinessPolicy(biz.id, true, u, t0);
      expect(await repo.security.getBusinessPolicy(biz.id)).toEqual({ requireStrongAuth: true });
      await repo.security.setBusinessPolicy(biz.id, false, u, t0);
      expect(await repo.security.getBusinessPolicy(biz.id)).toEqual({ requireStrongAuth: false });
    });

    it("account purge deletes sessions and passkeys", async () => {
      const u = await user();
      await session(u);
      await repo.security.addPasskey({ userId: u, credentialId: "Y3JlZGVudGlhbC1pZC0y", publicKey: "cHVi", counter: 0, transports: [], deviceType: "singleDevice", backedUp: false, name: "x", createdAt: t0 });
      await repo.purgeUserData(u, null);
      expect(await repo.security.listActiveSessions(u)).toEqual([]);
      expect(await repo.security.listPasskeys(u)).toEqual([]);
    });
  });
}
