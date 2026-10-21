import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from the memory and Postgres handle stores (supabase/migrations/0013_user_handles.sql).
const pgUrl = process.env.TEST_DATABASE_URL;
const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 1 }), Boolean(pgUrl)],
];

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`handles repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) await repo.sql.unsafe("truncate user_handles, telecom_accounts, users cascade");
      else repo = make();
    });
    async function user() {
      const u = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "A" });
      const account = await repo.createAccount({ ownerUserId: u.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
      return { userId: u.id, accountId: account.id };
    }

    it("one handle per user, one user per handle", async () => {
      const a = await user();
      const b = await user();
      expect(await repo.handles.create({ handle: "@camille", userId: a.userId, telecomAccountId: a.accountId })).toMatchObject({ handle: "@camille", userId: a.userId });
      expect(await repo.handles.create({ handle: "@camille", userId: b.userId, telecomAccountId: b.accountId })).toBeNull();
      expect(await repo.handles.create({ handle: "@autre", userId: a.userId, telecomAccountId: a.accountId })).toBeNull();
      expect((await repo.handles.find("@camille"))?.telecomAccountId).toBe(a.accountId);
      expect((await repo.handles.forUser(a.userId))?.handle).toBe("@camille");
      expect(await repo.handles.forUser(b.userId)).toBeNull();
      expect(await repo.handles.find("@personne")).toBeNull();
    });
  });
}
