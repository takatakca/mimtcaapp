// Account deletion: DELETE /v1/me closes the account at once; jobs/accountDeletion.ts purges the personal data 30 days
// later and keeps only the records the law requires.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingGateway } from "../src/gateways/billing.js";
import type { MediaStore } from "../src/gateways/media.js";
import { DELETION_DELAY_DAYS, runAccountDeletion } from "../src/jobs/accountDeletion.js";
import { makeUser, setup, type Ctx } from "./helpers.js";

const DAY = 86_400_000;
let ctx: Ctx;
let cancelSubscription: ReturnType<typeof vi.fn>;
let mediaFiles: MediaStore & { delete: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  ctx = await setup();
  cancelSubscription = vi.fn(async () => {});
  ctx.deps.billing = { cancelSubscription } as unknown as BillingGateway;
  mediaFiles = { put: vi.fn(), get: vi.fn(async () => null), delete: vi.fn(async () => {}) };
  ctx.deps.mediaFiles = mediaFiles;
});
afterEach(() => ctx.app.close());

/** A paying user with a number and some of everything the purge must delete or keep. */
async function richUser() {
  const u = await makeUser(ctx, { e911: true, ack: true, number: "+15145550142" });
  const { repo } = ctx;
  const accountId = u.account.id;
  await repo.updateUser(u.user.id, { email: "client@example.com", phoneE164: "+15145550100", displayName: "Client" });
  await repo.upsertSubscription({
    telecomAccountId: accountId, kind: "plan", code: "premium", quantity: 1, stripeSubscriptionId: "sub_web_9",
    status: "active", source: "stripe", currentPeriodEnd: new Date(Date.now() + 20 * DAY),
  });
  await repo.upsertSubscription({
    telecomAccountId: accountId, kind: "addon", code: "no_ads", quantity: 1, stripeSubscriptionId: "ios:777",
    status: "active", source: "iap_apple", currentPeriodEnd: new Date(Date.now() + 20 * DAY),
  });
  const message = await repo.createMessage({
    twilioSid: "SM1", telecomAccountId: accountId, direction: "outbound", ourNumber: "+15145550142", peer: "+15145550111",
    bodyEncrypted: "x", bodyFingerprint: "f", status: "sent", segments: 1, numMedia: 1,
  });
  await repo.media.createMedia({
    telecomAccountId: accountId, kind: "mms_out", status: "ready", path: `mms/${accountId}/a.jpg`, twilioUrl: null,
    contentType: "image/jpeg", sizeBytes: 10, messageId: message.id, expiresAt: null,
  });
  await repo.createVoicemail({
    telecomAccountId: accountId, phoneNumberId: u.number!.id, callSid: "CA1", recordingSid: "RE1", fromNumber: "+15145550111",
    audioUrl: null, durationS: 12,
  });
  await repo.upsertCall({
    twilioCallSid: "CA1", telecomAccountId: accountId, userId: u.user.id, direction: "inbound", kind: "pstn",
    fromNumber: "+15145550111", toNumber: "+15145550142", status: "completed", startedAt: new Date(),
  });
  await repo.upsertPushToken({ userId: u.user.id, platform: "ios", kind: "messages", token: "apns-token" });
  await repo.addConsent({ userId: u.user.id, kind: "ai_processing", granted: true, version: "1", source: "app", ip: null, at: new Date() });
  await repo.handles.create({ handle: "client", userId: u.user.id, telecomAccountId: accountId });
  return u;
}

describe("DELETE /v1/me", () => {
  it("closes the account now, cancels web subscriptions, flags a live store subscription, schedules the purge", async () => {
    const u = await richUser();
    const res = await ctx.app.inject({ method: "DELETE", url: "/v1/me", headers: u.auth });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("pending_deletion");
    expect(body.storeSubscriptionActive).toBe(true);
    expect(new Date(body.deletionScheduledAt).getTime()).toBeGreaterThan(Date.now() + (DELETION_DELAY_DAYS - 1) * DAY);
    expect(cancelSubscription).toHaveBeenCalledWith("sub_web_9");
    const subs = await ctx.repo.listSubscriptions(u.account.id);
    expect(subs.find((s) => s.stripeSubscriptionId === "sub_web_9")?.status).toBe("canceled");
    expect((await ctx.repo.getAccount(u.account.id))?.status).toBe("CLOSED");
    expect((await ctx.app.inject({ url: "/v1/me", headers: u.auth })).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("account deletion job", () => {
  it("waits for the delay, then deletes personal data and keeps the legal records", async () => {
    const u = await richUser();
    await ctx.app.inject({ method: "DELETE", url: "/v1/me", headers: u.auth });
    const { repo } = ctx;

    expect((await runAccountDeletion(ctx.deps, { now: new Date(Date.now() + (DELETION_DELAY_DAYS - 1) * DAY) })).deleted).toBe(0);
    expect(repo.messages).toHaveLength(1);

    const res = await runAccountDeletion(ctx.deps, { now: new Date(Date.now() + (DELETION_DELAY_DAYS + 1) * DAY) });
    expect(res).toEqual({ deleted: 1, errors: 0 });

    const user = (await repo.getUser(u.user.id))!;
    expect(user).toMatchObject({ status: "deleted", email: null, phoneE164: null, displayName: null, globalUserId: null });
    expect(repo.messages).toHaveLength(0);
    expect(repo.voicemails).toHaveLength(0);
    expect(repo.media.media.size).toBe(0);
    expect(repo.pushTokens).toHaveLength(0);
    expect(repo.consents).toHaveLength(0);
    expect(await repo.handles.forUser(u.user.id)).toBeNull();
    expect(await repo.getE911Address(u.account.id)).toBeNull();
    // Files outside the database.
    expect(mediaFiles.delete).toHaveBeenCalledWith(`mms/${u.account.id}/a.jpg`);
    expect(ctx.twilio!.deleteRecording).toHaveBeenCalledWith({ recordingSid: "RE1" });
    // Kept: billing, call records, 9-1-1 notice acceptance, audit, the number (quarantine → lifecycle).
    expect(await repo.listSubscriptions(u.account.id)).toHaveLength(2);
    expect([...repo.calls.values()]).toHaveLength(1);
    expect(repo.e911Acks.filter((a) => a.userId === u.user.id)).toHaveLength(1);
    expect(repo.auditLog.some((a) => a.action === "user.deleted" && a.targetId === u.user.id)).toBe(true);
    expect((await repo.listNumbersByAccount(u.account.id))[0]?.state).toBe("quarantine");

    // Runs once: the user is no longer pending.
    expect((await runAccountDeletion(ctx.deps, { now: new Date(Date.now() + 60 * DAY) })).deleted).toBe(0);
  });

  it("leaves other users' data alone", async () => {
    const leaving = await richUser();
    const staying = await makeUser(ctx, { e911: true, ack: true });
    await ctx.repo.upsertPushToken({ userId: staying.user.id, platform: "android", kind: "messages", token: "fcm-token" });
    await ctx.app.inject({ method: "DELETE", url: "/v1/me", headers: leaving.auth });
    await runAccountDeletion(ctx.deps, { now: new Date(Date.now() + 40 * DAY) });
    expect(ctx.repo.pushTokens.map((t) => t.userId)).toEqual([staying.user.id]);
    expect(await ctx.repo.getE911Address(staying.account.id)).not.toBeNull();
    expect((await ctx.repo.getUser(staying.user.id))?.status).toBe("active");
  });

  it("a failed storage delete does not stop the purge", async () => {
    const u = await richUser();
    mediaFiles.delete.mockRejectedValue(new Error("storage down"));
    await ctx.app.inject({ method: "DELETE", url: "/v1/me", headers: u.auth });
    const warn = vi.fn();
    const res = await runAccountDeletion(ctx.deps, { now: new Date(Date.now() + 40 * DAY), log: { warn, error: vi.fn() } });
    expect(res.deleted).toBe(1);
    expect(warn).toHaveBeenCalled();
  });
});
