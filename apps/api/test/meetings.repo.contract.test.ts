import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from the memory and Postgres meeting stores (supabase/migrations/0010_meetings.sql).
// Postgres runs only with TEST_DATABASE_URL (a scratch database with every migration applied).
const pgUrl = process.env.TEST_DATABASE_URL;

const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 1 }), Boolean(pgUrl)],
];

const room = () => `mimt-${crypto.randomUUID().replace(/-/g, "")}`;
const hash = (c: string) => c.repeat(64);

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`meetings repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) {
        await repo.sql.unsafe("truncate meeting_events, meeting_invites, meetings, business_members, businesses, telecom_accounts, users cascade");
      } else repo = make();
    });

    async function user(displayName = "A") {
      const u = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName });
      const account = await repo.createAccount({ ownerUserId: u.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
      return { user: u, account };
    }

    it("creates, reads by id and room, updates and lists meetings for host, business members and invitees", async () => {
      const host = await user("Hôte");
      const other = await user("Autre");
      const business = await repo.pbx.createBusiness({ name: "Café", takatakBusinessId: null, telecomAccountId: host.account.id, mainNumber: null, locale: "fr-CA" });
      const r1 = room();
      const start = new Date("2026-10-20T14:00:00Z");
      const personal = await repo.meetings.create({ businessId: null, hostUserId: host.user.id, title: "Perso", roomName: r1, scheduledStart: start, scheduledEnd: null, lobbyEnabled: true });
      expect(personal).toMatchObject({ status: "scheduled", lobbyEnabled: true, startedAt: null, endedAt: null, scheduledStart: start, businessId: null });
      const team = await repo.meetings.create({ businessId: business.id, hostUserId: host.user.id, title: "Équipe", roomName: room(), scheduledStart: null, scheduledEnd: null, lobbyEnabled: false });

      expect((await repo.meetings.get(personal.id))!.title).toBe("Perso");
      expect((await repo.meetings.getByRoomName(r1))!.id).toBe(personal.id);
      expect(await repo.meetings.getByRoomName("mimt-nope-nope-nope-nope")).toBeNull();

      const startedAt = new Date("2026-10-20T14:01:00Z");
      const live = await repo.meetings.update(personal.id, { status: "live", startedAt, title: "Perso 2" });
      expect(live).toMatchObject({ status: "live", startedAt, title: "Perso 2", lobbyEnabled: true });

      expect((await repo.meetings.listForUser(host.user.id, [])).map((m) => m.id).sort()).toEqual([personal.id, team.id].sort());
      expect(await repo.meetings.listForUser(other.user.id, [])).toEqual([]);
      expect((await repo.meetings.listForUser(other.user.id, [business.id])).map((m) => m.id)).toEqual([team.id]);
      await repo.meetings.createInvite({ meetingId: personal.id, email: null, userId: other.user.id, role: "participant", guestTokenHash: null, expiresAt: new Date("2026-10-27T00:00:00Z") });
      expect(await repo.meetings.isInvited(personal.id, other.user.id)).toBe(true);
      expect(await repo.meetings.isInvited(team.id, other.user.id)).toBe(false);
      expect((await repo.meetings.listForUser(other.user.id, [])).map((m) => m.id)).toEqual([personal.id]);
    });

    it("keeps room names unique", async () => {
      const host = await user();
      const r = room();
      const base = { businessId: null, hostUserId: host.user.id, title: "x", scheduledStart: null, scheduledEnd: null, lobbyEnabled: true };
      await repo.meetings.create({ ...base, roomName: r });
      await expect(repo.meetings.create({ ...base, roomName: r })).rejects.toThrow();
    });

    it("stores guest invites by token hash, marks first use once, and appends events in order", async () => {
      const host = await user();
      const m = await repo.meetings.create({ businessId: null, hostUserId: host.user.id, title: "x", roomName: room(), scheduledStart: null, scheduledEnd: null, lobbyEnabled: true });
      const expiresAt = new Date("2026-10-23T14:00:00Z");
      const i1 = await repo.meetings.createInvite({ meetingId: m.id, email: "a@exemple.ca", userId: null, role: "guest", guestTokenHash: hash("a"), expiresAt });
      await repo.meetings.createInvite({ meetingId: m.id, email: null, userId: null, role: "guest", guestTokenHash: hash("b"), expiresAt });
      await expect(repo.meetings.createInvite({ meetingId: m.id, email: null, userId: null, role: "guest", guestTokenHash: hash("a"), expiresAt })).rejects.toThrow();
      expect(i1).toMatchObject({ email: "a@exemple.ca", role: "guest", usedAt: null, expiresAt });
      expect((await repo.meetings.getInviteByTokenHash(hash("a")))!.id).toBe(i1.id);
      expect(await repo.meetings.getInviteByTokenHash(hash("c"))).toBeNull();
      expect((await repo.meetings.listInvites(m.id)).map((i) => i.guestTokenHash).sort()).toEqual([hash("a"), hash("b")]);

      const first = new Date("2026-10-16T14:00:00Z");
      await repo.meetings.markInviteUsed(i1.id, first);
      await repo.meetings.markInviteUsed(i1.id, new Date("2026-10-17T14:00:00Z"));
      expect((await repo.meetings.getInviteByTokenHash(hash("a")))!.usedAt).toEqual(first);

      await repo.meetings.addEvent({ meetingId: m.id, type: "started", at: first });
      const joined = await repo.meetings.addEvent({ meetingId: m.id, type: "joined", identity: host.user.id, userId: host.user.id });
      await repo.meetings.addEvent({ meetingId: m.id, type: "admitted", identity: "guest-1234abcd-0011aabb", userId: host.user.id });
      expect(typeof joined.id).toBe("number");
      const events = await repo.meetings.listEvents(m.id);
      expect(events.map((e) => [e.type, e.identity])).toEqual([
        ["started", null],
        ["joined", host.user.id],
        ["admitted", "guest-1234abcd-0011aabb"],
      ]);
      expect(events[0]!.at).toEqual(first);
    });
  });
}
