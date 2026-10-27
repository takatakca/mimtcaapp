import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS } from "@mimt/shared";
import { loadConfig } from "../src/config.js";
import type { BillingGateway } from "../src/gateways/billing.js";
import { monthPeriod } from "../src/lib/time.js";
import { planOf, plansFromEnv } from "../src/plansConfig.js";
import { makeUser, setup, twilioPost, type Ctx } from "./helpers.js";

// Launch pricing (docs/MIMT-UNIT-ECONOMICS.md): no phone-network number on Gratuit, prices and quotas from the
// environment but never past the rule, messages counted both ways, app-to-app fair use, optional card-on-file trial.

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => ctx.app.close());

const subscribe = (accountId: string, code: string, status: "active" | "trialing" = "active") =>
  ctx.repo.upsertSubscription({
    telecomAccountId: accountId, kind: "plan", code, quantity: 1, stripeSubscriptionId: `sub_${code}_${accountId}`, status, source: "stripe", currentPeriodEnd: null,
  });
const outbound = (userId: string, to: string, sid = "CA" + Math.random().toString(16).slice(2)) =>
  twilioPost(ctx, "/webhooks/twilio/voice/outbound", { CallSid: sid, From: `client:${userId}`, To: to });
const usage = (accountId: string) => ctx.repo.getUsage(accountId, monthPeriod(new Date()));

describe("plan configuration", () => {
  it("defaults to the shared launch line-up", () => {
    const plans = plansFromEnv({});
    expect(plans.lock.monthlyPriceCents).toBe(1299);
    expect(plans.premium.caps).toEqual(PLANS.premium.caps);
    expect(plans.free.caps.hasNumber).toBe(false);
  });

  it("takes prices and quotas from the environment when they keep the rule", () => {
    const plans = plansFromEnv({ PLAN_PREMIUM_PRICE_CENTS: "3499", PLAN_PREMIUM_OUT_MIN: "250", PLAN_PREMIUM_IN_MIN: "400", FREE_ON_NET_MINUTES: "60" });
    expect(plans.premium).toMatchObject({ monthlyPriceCents: 3499, caps: { outboundMinutes: 250, inboundMinutes: 400 } });
    expect(plans.free.caps.onNetMinutes).toBe(60);
  });

  it("yearly prices stay 12 months for the price of 11, also after a monthly price override", () => {
    const plans = plansFromEnv({ PLAN_PREMIUM_PRICE_CENTS: "3499", PLAN_PREMIUM_OUT_MIN: "250", PLAN_PREMIUM_IN_MIN: "400" });
    expect(plans.premium.yearlyPriceCents).toBe(3499 * 11);
    expect(plans.lock.yearlyPriceCents).toBe(1299 * 11);
    expect(plans.business.yearlyPriceCents).toBe(3499 * 11);
    expect(plans.business_pro.yearlyPriceCents).toBe(4499 * 11);
    expect(plans.free.yearlyPriceCents).toBeUndefined();
  });

  it("refuses to start when a paid plan would lose money at worst case, and says which and by how much", () => {
    expect(() => loadConfig({ PLAN_PREMIUM_OUT_MIN: "250", PLAN_PREMIUM_IN_MIN: "400" })).toThrow(/premium: worst-case cost .* > 70 %/);
    expect(() => loadConfig({ PLAN_LOCK_PRICE_CENTS: "499" })).toThrow(/lock: worst-case cost/);
    expect(() => loadConfig({ USD_TO_CAD: "1.6" })).toThrow(/premium/);
    expect(() => loadConfig({ TWILIO_USD_PSTN_OUT_PER_MIN: "0.05" })).toThrow(/plan loses money/);
    expect(() => loadConfig({ PLAN_PREMIUM_MESSAGES: "lots" })).toThrow(/PLAN_PREMIUM_MESSAGES/);
  });

  it("serves the configured table to the cap checks", async () => {
    await ctx.app.close();
    ctx = await setup({ config: { PLAN_LOCK_OUT_MIN: "40" } });
    expect(planOf("lock").caps.outboundMinutes).toBe(40);
  });
});

describe("Gratuit has no phone-network number", () => {
  it("refuses a number claim with 402 and a French message pointing to Essentiel", async () => {
    const u = await makeUser(ctx, { e911: true, ack: true });
    const res = await ctx.app.inject({ method: "POST", url: "/v1/numbers/claim", headers: u.auth, payload: { e164: "+15145550199" } });
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toBe("number_requires_paid_plan");
    expect(res.json().message).toMatch(/^Le forfait Gratuit ne comprend pas de numéro.*Essentiel \(12,99 \$\/mois\)/);
  });

  it("lets Essentiel claim its number", async () => {
    const u = await makeUser(ctx, { e911: true, ack: true });
    await subscribe(u.account.id, "lock");
    const res = await ctx.app.inject({ method: "POST", url: "/v1/numbers/claim", headers: u.auth, payload: { e164: "+15145550199" } });
    expect(res.statusCode).toBe(201);
  });

  it("still always dials 9-1-1 for a free user with no number", async () => {
    const u = await makeUser(ctx);
    const res = await outbound(u.user.id, "911");
    expect(res.body).toContain("<Number>911</Number>");
  });
});

describe("app-to-app calls are fair use", () => {
  it("free: rings the other app with a time limit from the 120-minute pool, then refuses in French first", async () => {
    const caller = await makeUser(ctx);
    const callee = await makeUser(ctx, { number: "+15145550101" });
    await subscribe(callee.account.id, "lock");
    const ok = await outbound(caller.user.id, "5145550101");
    expect(ok.body).toContain(`<Client>${callee.user.id}</Client>`);
    expect(ok.body).toContain('timeLimit="7200"');

    await ctx.repo.addUsage(caller.account.id, [monthPeriod(new Date())], { minutesOnNet: 120 });
    const refused = await outbound(caller.user.id, "5145550101");
    expect(refused.body).not.toContain("<Dial");
    expect(refused.body).toContain("entre applications MIMT");
    expect(refused.body.indexOf('language="fr-CA"')).toBeLessThan(refused.body.indexOf('language="en-CA"'));
  });

  it("counts completed app-to-app minutes: the free pool, or paid outbound minutes", async () => {
    const free = await makeUser(ctx);
    const paid = await makeUser(ctx, { number: "+15145550100" });
    await subscribe(paid.account.id, "lock");
    const callee = await makeUser(ctx, { number: "+15145550101" });
    await subscribe(callee.account.id, "lock");

    await outbound(free.user.id, "5145550101", "CAfree");
    await outbound(paid.user.id, "5145550101", "CApaid");
    for (const sid of ["CAfree", "CApaid"]) {
      await twilioPost(ctx, "/webhooks/twilio/voice/status", { CallSid: sid, CallStatus: "completed", CallDuration: "125" });
    }
    expect(await usage(free.account.id)).toMatchObject({ minutesOnNet: 3, minutesOut: 0 });
    expect(await usage(paid.account.id)).toMatchObject({ minutesOnNet: 0, minutesOut: 3 });
  });
});

describe("messages count both ways", () => {
  it("adds received texts to the account's usage", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await subscribe(u.account.id, "lock");
    await twilioPost(ctx, "/webhooks/twilio/sms/inbound", { MessageSid: "SM1", From: "+15145550199", To: "+15145550100", Body: "Allo", NumSegments: "2" });
    expect((await usage(u.account.id)).smsIn).toBe(2);
  });

  it("refuses to send once sent + received reach the plan's messages", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await subscribe(u.account.id, "lock");
    await ctx.repo.addUsage(u.account.id, [monthPeriod(new Date())], { smsOut: 100, smsIn: 50 });
    const res = await ctx.app.inject({ method: "POST", url: "/v1/messages", headers: u.auth, payload: { from: "+15145550100", to: "+15145550199", body: "Salut" } });
    expect(res.json().error).toBe("sms_quota_exhausted");
  });

  it("caps MMS separately on Premium", async () => {
    const u = await makeUser(ctx, { number: "+15145550100" });
    await subscribe(u.account.id, "premium");
    await ctx.repo.addUsage(u.account.id, [monthPeriod(new Date())], { mmsOut: 50, smsOut: 50 });
    const payload = { from: "+15145550100", to: "+15145550199", body: "Photo", mediaUrls: ["https://example.com/a.jpg"] };
    const res = await ctx.app.inject({ method: "POST", url: "/v1/messages", headers: u.auth, payload });
    expect(res.json().error).toBe("mms_quota_exhausted");
  });
});

describe("7-day trial (TRIAL_ENABLED)", () => {
  let billing: BillingGateway & { [K in keyof BillingGateway]: ReturnType<typeof vi.fn> };
  const start = async (config: Record<string, string>) => {
    await ctx.app.close();
    ctx = await setup({ config });
    billing = {
      createCustomer: vi.fn(async () => "cus_1"),
      createCheckout: vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })),
    } as never;
    ctx.deps.billing = billing;
  };
  const checkout = (auth: Record<string, string>, payload: object) => ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload });

  it("is off by default", async () => {
    await start({});
    const u = await makeUser(ctx);
    expect((await checkout(u.auth, { plan: "lock", trial: true })).json().error).toBe("trial_unavailable");
    expect(billing.createCheckout).not.toHaveBeenCalled();
  });

  it("when on: Essentiel only, 7 days with the card collected, once per account", async () => {
    await start({ TRIAL_ENABLED: "true" });
    const u = await makeUser(ctx);
    expect((await checkout(u.auth, { plan: "premium", trial: true })).json().error).toBe("trial_unavailable");
    expect((await checkout(u.auth, { plan: "lock", trial: true })).statusCode).toBe(200);
    expect(billing.createCheckout.mock.calls[0]![0]).toMatchObject({ mode: "subscription", trialDays: 7, metadata: { code: "lock" } });

    await subscribe(u.account.id, "lock", "trialing");
    expect((await checkout(u.auth, { plan: "lock", trial: true })).json().error).toBe("trial_already_used");
  });

  it("gives a trialing account 20 minutes, not Essentiel's 60", async () => {
    await start({ TRIAL_ENABLED: "true" });
    const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
    await subscribe(u.account.id, "lock", "trialing");
    const res = await outbound(u.user.id, "5145550199");
    expect(res.body).toContain('timeLimit="1200"');
  });
});
