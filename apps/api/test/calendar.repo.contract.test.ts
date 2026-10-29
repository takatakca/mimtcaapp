import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from the memory and Postgres « Google Agenda » repositories (supabase/migrations/0024_calendar.sql).
const pgUrl = process.env.TEST_DATABASE_URL;
const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 4 }), Boolean(pgUrl)],
];

const at = new Date("2026-10-29T12:00:00Z");
const later = (s: number) => new Date(at.getTime() + s * 1000);

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`calendar repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) {
        await repo.sql.unsafe("truncate calendar_sync_jobs, calendar_connections, telecom_accounts, users cascade");
      } else repo = make();
    });

    const user = async () => (await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "U" })).id;
    const connect = (userId: string, token = "v1.enc-1") =>
      repo.calendar.upsertConnection({ userId, googleEmail: "a@example.com", refreshTokenEncrypted: token, scope: "openid email https://www.googleapis.com/auth/calendar.events", at });

    it("connect, update settings, reconnect keeps settings and clears the reconnect state", async () => {
      const u = await user();
      expect(await connect(u)).toMatchObject({ userId: u, status: "active", calendarId: "primary", syncCalls: true, includeContent: false, reconnectNotifiedAt: null });
      expect(await repo.calendar.updateConnection(u, { syncCalls: false, includeContent: true })).toMatchObject({ syncCalls: false, includeContent: true });
      expect(await repo.calendar.markNeedsReconnect(u, at)).toBe(true);
      expect(await repo.calendar.markNeedsReconnect(u, later(60))).toBe(false);
      expect(await repo.calendar.getConnection(u)).toMatchObject({ status: "needs_reconnect" });
      const again = await connect(u, "v1.enc-2");
      expect(again).toMatchObject({ status: "active", reconnectNotifiedAt: null, refreshTokenEncrypted: "v1.enc-2", syncCalls: false, includeContent: true });
      expect(await repo.calendar.markNeedsReconnect(u, later(120))).toBe(true);
      expect(await repo.calendar.updateConnection("00000000-0000-4000-8000-000000000000", { syncCalls: true })).toBeNull();
    });

    it("one job per (user, source type, source id)", async () => {
      const u = await user();
      const v = await user();
      const a = await repo.calendar.enqueueJob({ userId: u, sourceType: "call", sourceId: "CA1", notBefore: at });
      expect(a).toMatchObject({ status: "pending", attempts: 0 });
      expect(await repo.calendar.enqueueJob({ userId: u, sourceType: "call", sourceId: "CA1", notBefore: later(5) })).toBeNull();
      expect(await repo.calendar.enqueueJob({ userId: u, sourceType: "voicemail", sourceId: "CA1", notBefore: at })).not.toBeNull();
      expect(await repo.calendar.enqueueJob({ userId: v, sourceType: "call", sourceId: "CA1", notBefore: at })).not.toBeNull();
      // Still a duplicate once sent.
      await repo.calendar.finishJob(a!.id, { status: "sent", at, googleEventId: "abcdefghij0123456789abcdefghijkl" });
      expect(await repo.calendar.enqueueJob({ userId: u, sourceType: "call", sourceId: "CA1", notBefore: at })).toBeNull();
    });

    it("due jobs, retry, finish, purge; disconnect drops pending jobs only", async () => {
      const u = await user();
      await connect(u);
      const a = (await repo.calendar.enqueueJob({ userId: u, sourceType: "call", sourceId: "CA1", notBefore: at }))!;
      const b = (await repo.calendar.enqueueJob({ userId: u, sourceType: "call", sourceId: "CA2", notBefore: later(120) }))!;
      expect((await repo.calendar.listDueJobs(at, 10)).map((j) => j.id)).toEqual([a.id]);
      await repo.calendar.finishJob(a.id, { status: "pending", at, nextAttemptAt: later(60), error: "rate_limited" });
      expect(await repo.calendar.getJob(a.id)).toMatchObject({ status: "pending", attempts: 1, lastError: "rate_limited" });
      await repo.calendar.finishJob(a.id, { status: "pending", at, nextAttemptAt: later(60), error: "needs_reconnect", countAttempt: false });
      expect((await repo.calendar.getJob(a.id))!.attempts).toBe(1);
      expect((await repo.calendar.listDueJobs(later(130), 10)).map((j) => j.id)).toEqual([a.id, b.id]);
      await repo.calendar.finishJob(a.id, { status: "sent", at: later(130), googleEventId: "abcdefghij0123456789abcdefghijkl" });
      expect(await repo.calendar.getJob(a.id)).toMatchObject({ status: "sent", attempts: 2, nextAttemptAt: null, lastError: null, googleEventId: "abcdefghij0123456789abcdefghijkl" });
      expect(await repo.calendar.purgeFinishedJobs(later(100))).toBe(0);
      expect(await repo.calendar.deleteConnection(u)).toBe(true);
      expect(await repo.calendar.getJob(b.id)).toBeNull();
      expect(await repo.calendar.getJob(a.id)).not.toBeNull();
      expect(await repo.calendar.purgeFinishedJobs(later(200))).toBe(1);
      expect(await repo.calendar.deleteConnection(u)).toBe(false);
    });
  });
}
