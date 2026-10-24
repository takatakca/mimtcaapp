import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/repo/memory.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same purge from the memory and Postgres repositories (jobs/accountDeletion.ts): personal data deleted, legal
// records kept, other users untouched.
const pgUrl = process.env.TEST_DATABASE_URL;
const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 1 }), Boolean(pgUrl)],
];

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`account purge repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) {
        await repo.sql.unsafe(
          "truncate users, telecom_accounts, subscriptions, phone_numbers, calls, messages, voicemails, media_objects, push_tokens, consents, e911_addresses, e911_acknowledgements, user_handles, audit_log cascade",
        );
      } else repo = make();
    });

    async function seed(phone: string, handle: string) {
      const u = await repo.createUser({ globalUserId: `g-${handle}`, locale: "fr-CA", displayName: "Nom", phoneE164: phone, email: `${handle}@example.com` });
      const a = await repo.createAccount({ ownerUserId: u.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
      const n = await repo.createNumber({
        e164: phone.replace("0100", "0142"), twilioSid: `PN-${handle}`, telecomAccountId: a.id, kind: "local", state: "active",
        lastActivityAt: new Date(), stateChangedAt: new Date(),
      });
      await repo.upsertSubscription({
        telecomAccountId: a.id, kind: "plan", code: "lock", quantity: 1, stripeSubscriptionId: `sub_${handle}`, status: "canceled",
        source: "stripe", currentPeriodEnd: null,
      });
      const msg = await repo.createMessage({
        twilioSid: `SM-${handle}`, telecomAccountId: a.id, direction: "inbound", ourNumber: n.e164, peer: "+15145550111",
        bodyEncrypted: "x", bodyFingerprint: "f", status: "received", segments: 1, numMedia: 1,
      });
      await repo.media.createMedia({
        telecomAccountId: a.id, kind: "mms_in", status: "ready", path: `mms/${a.id}/x.jpg`, twilioUrl: null, contentType: "image/jpeg",
        sizeBytes: 1, messageId: msg.id, expiresAt: null,
      });
      await repo.createVoicemail({
        telecomAccountId: a.id, phoneNumberId: n.id, callSid: `CA-${handle}`, recordingSid: `RE-${handle}`, fromNumber: null, audioUrl: null, durationS: 3,
      });
      await repo.upsertCall({
        twilioCallSid: `CA-${handle}`, telecomAccountId: a.id, userId: u.id, direction: "inbound", kind: "pstn", fromNumber: "+15145550111",
        toNumber: n.e164, status: "completed", startedAt: new Date(),
      });
      await repo.upsertPushToken({ userId: u.id, platform: "ios", kind: "messages", token: `tok-${handle}` });
      await repo.addConsent({ userId: u.id, kind: "ai_processing", granted: true, version: "1", source: "app", ip: null, at: new Date() });
      await repo.handles.create({ handle: `@${handle}`, userId: u.id, telecomAccountId: a.id });
      await repo.upsertE911Address({
        telecomAccountId: a.id, phoneNumberId: null, customerName: "Nom", street: "1 rue X", unit: null, city: "Montréal", province: "QC",
        postalCode: "H2X 1Y4", country: "CA", validatedAt: new Date(), providerRef: null,
      });
      await repo.addE911Ack({ userId: u.id, noticeVersion: "v1", acceptedAt: new Date(), ip: null, appVersion: null, userAgent: null });
      await repo.updateUser(u.id, { status: "pending_deletion", deletionScheduledAt: new Date(Date.now() - 1000) });
      return { userId: u.id, accountId: a.id };
    }

    it("lists due users, purges one user's personal data and keeps the legal records", async () => {
      const gone = await seed("+15145550100", "gone");
      const kept = await seed("+15145559100", "kept");
      await repo.updateUser(kept.userId, { status: "active", deletionScheduledAt: null });

      expect((await repo.listUsersDueForDeletion(new Date(), 10)).map((u) => u.id)).toEqual([gone.userId]);
      const files = await repo.purgeUserData(gone.userId, gone.accountId);
      expect(files.mediaPaths).toEqual([`mms/${gone.accountId}/x.jpg`]);
      expect(files.recordingSids).toEqual(["RE-gone"]);

      expect(await repo.getUser(gone.userId)).toMatchObject({ status: "deleted", email: null, phoneE164: null, displayName: null, globalUserId: null });
      expect((await repo.listConversations(gone.accountId)).length).toBe(0);
      expect(await repo.listVoicemails(gone.accountId)).toEqual([]);
      expect(await repo.listPushTokens(gone.userId)).toEqual([]);
      expect(await repo.handles.forUser(gone.userId)).toBeNull();
      expect(await repo.getE911Address(gone.accountId)).toBeNull();
      // Kept.
      expect(await repo.listSubscriptions(gone.accountId)).toHaveLength(1);
      expect(await repo.getLatestE911Ack(gone.userId)).not.toBeNull();
      expect(await repo.listNumbersByAccount(gone.accountId)).toHaveLength(1);
      // Someone else's data is untouched.
      expect((await repo.getUser(kept.userId))?.email).toBe("kept@example.com");
      expect(await repo.listVoicemails(kept.accountId)).toHaveLength(1);
      expect(await repo.listPushTokens(kept.userId)).toHaveLength(1);
      expect(await repo.handles.forUser(kept.userId)).not.toBeNull();
      expect(await repo.listUsersDueForDeletion(new Date(), 10)).toEqual([]);
    });
  });
}
