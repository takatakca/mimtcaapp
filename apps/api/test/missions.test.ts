import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { MISSION_MINUTES_CAP, PLANS, type MissionsResponse } from "@mimt/shared";
import type { BillingGateway } from "../src/gateways/billing.js";
import { monthPeriod } from "../src/lib/time.js";
import { makeUser, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
afterEach(() => ctx?.app.close());

const FCM = "https://fcm.googleapis.com/fcm/send/abc123";
const pushKeys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

async function missions(auth: Record<string, string>): Promise<MissionsResponse> {
  const res = await ctx.app.inject({ url: "/v1/missions", headers: auth });
  expect(res.statusCode).toBe(200);
  return res.json();
}
const statusOf = (m: MissionsResponse, id: string) => m.missions.find((x) => x.id === id)?.status;

function withBilling() {
  const billing = {
    createCustomer: vi.fn(async () => "cus_1"),
    createCheckout: vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })),
    createPortal: vi.fn(async () => "https://billing.stripe.test/p"),
    constructEvent: vi.fn((raw: Buffer, sig: string) => {
      if (sig !== "good") throw new Error("bad signature");
      return JSON.parse(raw.toString("utf8")) as Stripe.Event;
    }),
    retrieveSubscription: vi.fn(),
  } as unknown as BillingGateway & { createCheckout: ReturnType<typeof vi.fn> };
  ctx.deps.billing = billing;
  return billing;
}

const stripeWebhook = (event: object) =>
  ctx.app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": "good" }, payload: JSON.stringify(event) });

const planEvent = (accountId: string, code: string, interval: "month" | "year", id = "evt_1", sub = "sub_1") => ({
  id,
  type: "customer.subscription.updated",
  data: {
    object: {
      id: sub,
      customer: "cus_1",
      status: "active",
      metadata: { telecom_account_id: accountId, kind: "plan", code },
      items: { data: [{ quantity: 1, current_period_end: 1_900_000_000, price: { recurring: { interval } } }] },
    },
  },
});

describe("Missions MIMT: server-verified, once, logged", () => {
  it("lists the 7 missions, all to do, with the 150-minute cap and the current month", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    const m = await missions(u.auth);
    expect(m.enabled).toBe(true);
    expect(m.missions.map((x) => [x.id, x.status, x.minutes])).toEqual([
      ["verify_phone", "todo", 15],
      ["choose_handle", "todo", 30],
      ["enable_push", "todo", 15],
      ["install_app", "todo", 30],
      ["first_number", "todo", 60],
      ["invite_friend", "todo", 0],
      ["go_yearly", "todo", 0],
    ]);
    expect(m).toMatchObject({ totalMinutes: 0, capMinutes: 150, bucket: "on_net", period: monthPeriod(new Date()) });
    expect(MISSION_MINUTES_CAP).toBe(150);
  });

  it("has no route to claim or complete a mission: the client can never say it is done", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    for (const url of ["/v1/missions", "/v1/missions/choose_handle", "/v1/missions/choose_handle/claim"]) {
      expect((await ctx.app.inject({ method: "POST", url, headers: u.auth, payload: {} })).statusCode).toBe(404);
    }
  });

  it("choose_handle: free plan gets 30 app-to-app minutes in the current month, once; a second handle is refused anyway", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: u.auth, payload: { handle: "@camille" } });
    expect(res.json()).toEqual({
      handle: "@camille",
      missionGranted: { id: "choose_handle", minutes: 30, bucket: "on_net", status: "granted", period: monthPeriod(new Date()) },
    });
    const usage = await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()));
    expect(usage.bonusMinutesOnNet).toBe(30);
    expect(usage.bonusMinutesOut).toBe(0);
    // Same handle again: nothing new.
    const again = await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: u.auth, payload: { handle: "@camille" } });
    expect(again.json()).toEqual({ handle: "@camille" });
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).bonusMinutesOnNet).toBe(30);
    const m = await missions(u.auth);
    expect(statusOf(m, "choose_handle")).toBe("done");
    expect(m.totalMinutes).toBe(30);
    // Audited, without personal data.
    const audit = ctx.repo.auditLog.filter((e) => e.action === "mission.granted");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: null, targetType: "telecom_account", targetId: u.account.id, meta: { mission: "choose_handle", minutes: 30, bucket: "on_net" } });
    expect(JSON.stringify(audit[0]!.meta)).not.toMatch(/camille/);
  });

  it("free plan: the extra app-to-app minutes really extend the on-net pool", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    const { checkOnNetCaps } = await import("../src/fraud/caps.js");
    await ctx.repo.addUsage(u.account.id, [monthPeriod(new Date())], { minutesOnNet: PLANS.free.caps.onNetMinutes! });
    const caps = PLANS.free.caps;
    expect(checkOnNetCaps({ caps, usage: await ctx.repo.getUsage(u.account.id, monthPeriod(new Date())) }).ok).toBe(false);
    await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: u.auth, payload: { handle: "@pool" } });
    expect(checkOnNetCaps({ caps, usage: await ctx.repo.getUsage(u.account.id, monthPeriod(new Date())) })).toEqual({ ok: true, remaining: 30 });
  });

  it("paid plans get outbound minutes instead", async () => {
    ctx = await setup();
    withBilling();
    const u = await makeUser(ctx);
    await stripeWebhook(planEvent(u.account.id, "premium", "month"));
    await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: u.auth, payload: { handle: "@payant" } });
    const usage = await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()));
    expect(usage.bonusMinutesOut).toBe(30);
    expect(usage.bonusMinutesOnNet).toBe(0);
    expect((await missions(u.auth)).bucket).toBe("outbound");
  });

  it("verify_phone: once per account AND once per phone number, even after the account is deleted", async () => {
    ctx = await setup();
    const phone = "+15145550123";
    const first = await ctx.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone, code: "123456" } });
    expect(first.json().missionGranted).toMatchObject({ id: "verify_phone", minutes: 15, bucket: "on_net", status: "granted" });
    const second = await ctx.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone, code: "123456" } });
    expect(second.statusCode).toBe(200);
    expect(second.json().missionGranted).toBeUndefined();

    // Delete the account (purge), then sign up again with the same phone: a new user and account, no new reward.
    const user = (await ctx.repo.findUserByPhone(phone))!;
    const account = (await ctx.repo.getAccountByOwner(user.id))!;
    await ctx.repo.purgeUserData(user.id, account.id);
    const again = await ctx.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone, code: "123456" } });
    expect(again.statusCode).toBe(200);
    const newUser = (await ctx.repo.findUserByPhone(phone))!;
    expect(newUser.id).not.toBe(user.id);
    expect(again.json().missionGranted).toBeUndefined();

    // The ledger never holds the phone number, only a keyed hash.
    const rows = ctx.repo.missions.rows;
    expect(JSON.stringify(rows)).not.toContain("5145550123");
    expect(rows[0]!.ownerHash).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(JSON.stringify(ctx.repo.auditLog.filter((e) => e.action.startsWith("mission.")))).not.toContain("5145550123");
  });

  it("the same person's other missions are not re-earned by a new account either (owner hash)", async () => {
    ctx = await setup();
    const phone = "+15145550188";
    const tokens = (await ctx.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone, code: "123456" } })).json();
    const auth = { authorization: `Bearer ${tokens.accessToken}` };
    expect((await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: auth, payload: { handle: "@premier" } })).json().missionGranted).toBeDefined();
    const user = (await ctx.repo.findUserByPhone(phone))!;
    await ctx.repo.purgeUserData(user.id, (await ctx.repo.getAccountByOwner(user.id))!.id);
    const tokens2 = (await ctx.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone, code: "123456" } })).json();
    const auth2 = { authorization: `Bearer ${tokens2.accessToken}` };
    const res = await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: auth2, payload: { handle: "@deuxieme" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().missionGranted).toBeUndefined();
  });

  it("enable_push: only a subscription to a real browser push service counts", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    const fake = await ctx.app.inject({ method: "POST", url: "/v1/push/web/subscribe", headers: u.auth, payload: { endpoint: "https://evil.example/push/1", keys: pushKeys } });
    expect(fake.statusCode).toBe(204);
    expect(statusOf(await missions(u.auth), "enable_push")).toBe("todo");
    const real = await ctx.app.inject({ method: "POST", url: "/v1/push/web/subscribe", headers: u.auth, payload: { endpoint: FCM, keys: pushKeys } });
    expect(real.statusCode).toBe(204);
    expect(statusOf(await missions(u.auth), "enable_push")).toBe("done");
    await ctx.app.inject({ method: "POST", url: "/v1/push/web/subscribe", headers: u.auth, payload: { endpoint: `${FCM}-2`, keys: pushKeys } });
    expect((await missions(u.auth)).totalMinutes).toBe(15);
  });

  it("install_app: on a successful attestation, once per device across accounts", async () => {
    ctx = await setup();
    const a = await makeUser(ctx);
    const attest = async (auth: Record<string, string>, deviceKey: string) => {
      const { challenge, challengeToken } = (await ctx.app.inject({ method: "POST", url: "/v1/devices/challenge", headers: auth })).json();
      return ctx.app.inject({ method: "POST", url: "/v1/devices/attest", headers: auth, payload: { platform: "ios", deviceKey, challenge, challengeToken, assertion: `dev:${challenge}` } });
    };
    const ok = await attest(a.auth, "device-key-mission-1");
    expect(ok.json()).toMatchObject({ verified: true, missionGranted: { id: "install_app", minutes: 30 } });
    const again = await attest(a.auth, "device-key-mission-1");
    expect(again.json()).toEqual({ verified: true });
    expect(JSON.stringify(ctx.repo.missions.rows)).not.toContain("device-key-mission-1");
  });

  it("first_number: a number claimed on a paid plan", async () => {
    ctx = await setup();
    withBilling();
    const u = await makeUser(ctx, { e911: true, ack: true });
    await stripeWebhook(planEvent(u.account.id, "lock", "month"));
    const res = await ctx.app.inject({ method: "POST", url: "/v1/numbers/claim", headers: u.auth, payload: { e164: "+15145550199" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().missionGranted).toMatchObject({ id: "first_number", minutes: 60, bucket: "outbound" });
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).bonusMinutesOut).toBe(60);
  });

  it("go_yearly: a yearly plan paid through Stripe completes it, with no extra minutes (the free month is the reward)", async () => {
    ctx = await setup();
    withBilling();
    const u = await makeUser(ctx);
    await stripeWebhook(planEvent(u.account.id, "premium", "month", "evt_m", "sub_m"));
    expect(statusOf(await missions(u.auth), "go_yearly")).toBe("todo");
    await stripeWebhook(planEvent(u.account.id, "premium", "year", "evt_y", "sub_y"));
    const m = await missions(u.auth);
    expect(statusOf(m, "go_yearly")).toBe("done");
    expect(m.totalMinutes).toBe(0);
    expect(ctx.repo.missions.rows.find((r) => r.missionId === "go_yearly")).toMatchObject({ minutes: 0, bucket: null, sourceRef: "stripe:sub_y" });
  });

  it("yearly checkout: 12 months for the price of 11, 9-1-1 tax for 12 months", async () => {
    ctx = await setup();
    const billing = withBilling();
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: u.auth, payload: { plan: "lock", interval: "year" } });
    expect(res.statusCode).toBe(200);
    const arg = billing.createCheckout.mock.calls[0]![0];
    expect(arg).toMatchObject({ mode: "subscription", line: { unitAmountCents: 1299 * 11, recurring: "year" }, metadata: { code: "lock", interval: "year" } });
    expect(arg.taxLines.find((l: { name: string }) => /9-1-1/.test(l.name))).toMatchObject({ unitAmountCents: 55 * 12, recurring: "year" });
    for (const plan of ["premium", "business", "business_pro"] as const) {
      await ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: u.auth, payload: { plan, interval: "year" } });
      expect(billing.createCheckout.mock.lastCall![0].line.unitAmountCents).toBe(PLANS[plan].monthlyPriceCents * 11);
    }
  });

  it("free-tier budget reached: the reward is recorded as pending, then credited once the budget allows it", async () => {
    ctx = await setup({ config: { FREE_TIER_MONTHLY_BUDGET_CAD: "0" } });
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: u.auth, payload: { handle: "@attente" } });
    expect(res.json().missionGranted).toMatchObject({ status: "pending", period: null, minutes: 30 });
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).bonusMinutesOnNet).toBe(0);
    let m = await missions(u.auth);
    expect(statusOf(m, "choose_handle")).toBe("pending");
    expect(m.totalMinutes).toBe(0);

    ctx.deps.config.FREE_TIER_MONTHLY_BUDGET_CAD = 150;
    m = await missions(u.auth);
    expect(statusOf(m, "choose_handle")).toBe("done");
    expect(m.totalMinutes).toBe(30);
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).bonusMinutesOnNet).toBe(30);
    // Credited once, not on every read.
    await missions(u.auth);
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).bonusMinutesOnNet).toBe(30);
  });

  it("MISSIONS=off grants nothing (kill switch)", async () => {
    ctx = await setup({ config: { MISSIONS: "off" } });
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: u.auth, payload: { handle: "@eteint" } });
    expect(res.json()).toEqual({ handle: "@eteint" });
    const m = await missions(u.auth);
    expect(m.enabled).toBe(false);
    expect(statusOf(m, "choose_handle")).toBe("todo");
    expect(ctx.repo.missions.rows).toHaveLength(0);
  });

  it("never more than 150 minutes per account, whatever happens", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    const { grantMission } = await import("../src/services/missions.js");
    for (const mission of ["verify_phone", "choose_handle", "enable_push", "install_app", "first_number", "invite_friend", "go_yearly"] as const) {
      await grantMission(ctx.deps, { account: u.account, mission, sourceRef: "test" });
      await grantMission(ctx.deps, { account: u.account, mission, sourceRef: "test" });
    }
    const m = await missions(u.auth);
    expect(m.totalMinutes).toBe(150);
    expect(m.missions.every((x) => x.status === "done")).toBe(true);
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).bonusMinutesOnNet).toBe(150);
  });
});
