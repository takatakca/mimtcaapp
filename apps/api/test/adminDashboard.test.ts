import { beforeEach, describe, expect, it } from "vitest";
import { makeUser, setup, type Ctx } from "./helpers.js";

/** A MIMT user listed in CATALOG_ADMIN_USER_IDS (the config list is read at request time). */
async function makeAdmin(ctx: Ctx) {
  const admin = await makeUser(ctx);
  ctx.deps.config.CATALOG_ADMIN_USER_IDS.push(admin.user.id);
  return admin;
}

const ROUTES = [
  "/v1/admin/overview",
  "/v1/admin/users",
  "/v1/admin/usage",
  "/v1/admin/revenue",
  "/v1/admin/fraud",
  "/v1/admin/support-queue",
];

describe("admin dashboard", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await setup();
  });

  it("rejects unauthenticated and non-admin users on every dashboard route", async () => {
    const user = await makeUser(ctx);
    for (const url of ROUTES) {
      const anon = await ctx.app.inject({ method: "GET", url });
      expect(anon.statusCode).toBe(401);
      const denied = await ctx.app.inject({ method: "GET", url, headers: user.auth });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error).toBe("admin_only");
    }
  });

  it("overview returns the KPI set", async () => {
    const admin = await makeAdmin(ctx);
    // A second user created 10 days ago (counts in 30d signups, not 7d).
    const old = await ctx.repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "Old", phoneE164: "+15145550001" });
    ctx.repo.users.get(old.id)!.createdAt = new Date(Date.now() - 10 * 86400000);
    // Telecom activity 10 days ago on the admin's account.
    await ctx.repo.upsertCall({
      twilioCallSid: "CA_dash1",
      telecomAccountId: admin.account.id,
      userId: admin.user.id,
      direction: "outbound",
      kind: "pstn",
      fromNumber: "+15145550100",
      toNumber: "+15145550200",
      status: "completed",
      startedAt: new Date(Date.now() - 10 * 86400000),
    });
    const msg = await ctx.repo.createMessage({
      telecomAccountId: admin.account.id,
      direction: "outbound",
      ourNumber: "+15145550100",
      peer: "+15145550200",
      bodyEncrypted: "x",
      bodyFingerprint: "f",
      status: "sent",
      segments: 1,
      numMedia: 0,
    });
    ctx.repo.messages.find((m) => m.id === msg.id)!.createdAt = new Date(Date.now() - 10 * 86400000);

    const res = await ctx.app.inject({ method: "GET", url: "/v1/admin/overview", headers: admin.auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.signups7d).toBe(1); // the admin user only
    expect(body.signups30d).toBe(2);
    expect(body.activeUsers).toBe(2);
    expect(body.calls30d).toBe(1);
    expect(body.messages30d).toBe(1);
    expect(body.voicemails30d).toBe(0);
    expect(body.mrrCents).toBe(0);
  });

  it("overview counts MRR from live plan subscriptions", async () => {
    const admin = await makeAdmin(ctx);
    await ctx.repo.upsertSubscription({
      telecomAccountId: admin.account.id,
      kind: "plan",
      code: "premium",
      quantity: 1,
      source: "stripe",
      status: "active",
      stripeSubscriptionId: "sub_dash_mrr",
      currentPeriodEnd: null,
    });
    const res = await ctx.app.inject({ method: "GET", url: "/v1/admin/overview", headers: admin.auth });
    expect(res.json().mrrCents).toBe(2999);
  });

  it("users searches by name and enriches with account, plan and numbers", async () => {
    const admin = await makeAdmin(ctx);
    await ctx.repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "ChercheMoi", phoneE164: "+15145550002" });
    await ctx.repo.createNumber({
      e164: "+15145550199",
      twilioSid: "PN-dash",
      telecomAccountId: admin.account.id,
      kind: "local",
      state: "active",
      lastActivityAt: new Date(),
      stateChangedAt: new Date(),
    });

    const res = await ctx.app.inject({ method: "GET", url: "/v1/admin/users?q=cherche", headers: admin.auth });
    expect(res.statusCode).toBe(200);
    const users = res.json().users;
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ displayName: "ChercheMoi", phoneE164: "+15145550002" });

    const all = await ctx.app.inject({ method: "GET", url: "/v1/admin/users?limit=10", headers: admin.auth });
    const me = all.json().users.find((u: { id: string }) => u.id === admin.user.id);
    expect(me.account).toMatchObject({ plan: "free", planSource: null, numbers: ["+15145550199"] });
  });

  it("usage returns per-account usage, top talkers, e911 gaps and number inventory", async () => {
    const admin = await makeAdmin(ctx);
    const period = new Date().toISOString().slice(0, 7);
    await ctx.repo.addUsage(admin.account.id, [period], { minutesOut: 12, smsOut: 3 });
    await ctx.repo.createNumber({
      e164: "+15145550199",
      twilioSid: "PN-dash2",
      telecomAccountId: admin.account.id,
      kind: "local",
      state: "active",
      lastActivityAt: new Date(),
      stateChangedAt: new Date(),
    });

    const res = await ctx.app.inject({ method: "GET", url: "/v1/admin/usage?limit=10", headers: admin.auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period).toBe(period);
    const mine = body.accounts.find((a: { accountId: string }) => a.accountId === admin.account.id);
    expect(mine).toMatchObject({ plan: "free" });
    expect(mine.usage.minutesOut).toBe(12);
    expect(mine.caps.messages).toBe(0); // free plan caps
    expect(body.topTalkers[0]).toMatchObject({ accountId: admin.account.id, minutes: 12 });
    // No e911 address and no ack on this account: it shows up in the gaps.
    expect(body.e911Gaps).toContainEqual(
      expect.objectContaining({ accountId: admin.account.id, missingAddress: true, missingAck: true }),
    );
    expect(body.numberInventory).toContainEqual({ areaCode: "514", count: 1 });
  });

  it("revenue groups subscriptions, lists trials/dunning and affiliate payouts", async () => {
    const admin = await makeAdmin(ctx);
    await ctx.repo.upsertSubscription({
      telecomAccountId: admin.account.id,
      kind: "plan",
      code: "premium",
      quantity: 1,
      source: "stripe",
      status: "trialing",
      stripeSubscriptionId: "sub_dash_trial",
      currentPeriodEnd: null,
    });
    await ctx.repo.upsertSubscription({
      telecomAccountId: admin.account.id,
      kind: "plan",
      code: "lock",
      quantity: 1,
      source: "iap_apple",
      status: "past_due",
      stripeSubscriptionId: "sub_dash_pastdue",
      currentPeriodEnd: null,
    });

    const res = await ctx.app.inject({ method: "GET", url: "/v1/admin/revenue", headers: admin.auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.byPlanSource).toContainEqual({ kind: "plan", plan: "premium", source: "stripe", count: 1 });
    expect(body.byPlanSource).toContainEqual({ kind: "plan", plan: "lock", source: "iap_apple", count: 1 });
    expect(body.trials).toHaveLength(1);
    expect(body.trials[0]).toMatchObject({ code: "premium", status: "trialing" });
    expect(body.dunning).toHaveLength(1);
    expect(body.dunning[0]).toMatchObject({ code: "lock", status: "past_due" });
    expect(body.mrrCents).toBe(2999 + 1299);
    expect(body.affiliatePayoutsPending).toEqual([]);
    expect(body.pointsLiability).toBe(0);
  });

  it("fraud returns recent events with rule/action breakdown", async () => {
    const admin = await makeAdmin(ctx);
    await ctx.repo.addFraudEvent({ telecomAccountId: admin.account.id, rule: "velocity", score: 80, action: "hold", details: {} });
    await ctx.repo.addFraudEvent({ telecomAccountId: null, rule: "velocity", score: 95, action: "block", details: {} });

    const res = await ctx.app.inject({ method: "GET", url: "/v1/admin/fraud?limit=10", headers: admin.auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(2);
    expect(body.byRule).toEqual({ velocity: 2 });
    expect(body.byAction).toEqual({ hold: 1, block: 1 });
    expect(body.otpFailureRate).toBeNull();
  });

  it("support-queue surfaces unverified users, e911 gaps and audit trail", async () => {
    const admin = await makeAdmin(ctx);
    const unverified = await ctx.repo.createUser({
      globalUserId: null,
      locale: "fr-CA",
      displayName: "NoPhone",
      phoneE164: "+15145550003",
      phoneVerifiedAt: null,
    });
    await ctx.repo.audit({ actorUserId: unverified.id, action: "user.created", targetType: "user", targetId: unverified.id });

    const res = await ctx.app.inject({ method: "GET", url: "/v1/admin/support-queue", headers: admin.auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.unverifiedUsers.map((u: { id: string }) => u.id)).toContain(unverified.id);
    expect(body.e911Gaps.map((g: { accountId: string }) => g.accountId)).toContain(admin.account.id);
    expect(body.recentAudit.some((e: { action: string }) => e.action === "user.created")).toBe(true);

    const filtered = await ctx.app.inject({
      method: "GET",
      url: `/v1/admin/support-queue?userId=${unverified.id}`,
      headers: admin.auth,
    });
    expect(filtered.json().userAudit.every((e: { actorUserId: string }) => e.actorUserId === unverified.id)).toBe(true);
  });

  it("rejects invalid query parameters with 400", async () => {
    const admin = await makeAdmin(ctx);
    const res = await ctx.app.inject({ method: "GET", url: "/v1/admin/users?limit=9999", headers: admin.auth });
    expect(res.statusCode).toBe(400);
  });
});
