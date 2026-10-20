// Parity P1 (docs/MIMT-PARITY.md §3): "Sans pub" add-on (item 1), referral program (item 3),
// international credit on the free plan + rates before dialling (item 9).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { purchaseFromApplePayload } from "../src/billing/iap.js";
import type { BillingGateway } from "../src/gateways/billing.js";
import { monthPeriod } from "../src/lib/time.js";
import { makeUser, setup, twilioPost, type Ctx } from "./helpers.js";

let ctx: Ctx;
let billing: BillingGateway & { [K in keyof BillingGateway]-?: ReturnType<typeof vi.fn> };
/** Card fingerprint the fake Stripe returns, per invoice or payment intent id. */
let fingerprints: Record<string, string>;

beforeEach(async () => {
  ctx = await setup();
  fingerprints = {};
  billing = {
    createCustomer: vi.fn(async () => "cus_1"),
    createCheckout: vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })),
    createPortal: vi.fn(async () => "https://billing.stripe.test/p"),
    constructEvent: vi.fn((raw: Buffer, sig: string) => {
      if (!Buffer.isBuffer(raw) || sig !== "good") throw new Error("bad signature");
      return JSON.parse(raw.toString("utf8")) as Stripe.Event;
    }),
    retrieveSubscription: vi.fn(),
    paymentFingerprint: vi.fn(async (ref: { invoiceId?: string; paymentIntentId?: string }) => fingerprints[ref.invoiceId ?? ref.paymentIntentId ?? ""] ?? null),
    creditBalance: vi.fn(async () => {}),
  } as never;
  ctx.deps.billing = billing;
});
afterEach(() => ctx.app.close());

let evt = 0;
const webhook = (type: string, object: object) =>
  ctx.app.inject({
    method: "POST",
    url: "/webhooks/stripe",
    headers: { "content-type": "application/json", "stripe-signature": "good" },
    payload: JSON.stringify({ id: `evt_p1_${++evt}`, type, data: { object } }),
  });

const subscriptionUpdated = (accountId: string, kind: "plan" | "addon", code: string, status: string, id: string) =>
  webhook("customer.subscription.updated", {
    id,
    customer: "cus_1",
    status,
    metadata: { telecom_account_id: accountId, kind, code },
    items: { data: [{ quantity: 1, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400 }] },
  });

const invoicePaid = (accountId: string, invoiceId: string, code = "premium", amountPaid = 2999) =>
  webhook("invoice.paid", {
    id: invoiceId,
    customer: "cus_1",
    amount_paid: amountPaid,
    billing_reason: "subscription_create",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_x", metadata: { telecom_account_id: accountId, kind: "plan", code } } },
  });

const me = async (auth: Record<string, string>) => (await ctx.app.inject({ url: "/v1/me", headers: auth })).json();
const checkout = (auth: Record<string, string>, payload: object) => ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: auth, payload });

describe("Sans pub add-on (P1 item 1)", () => {
  it("sells 3,99 $/mo through Stripe with GST/QST lines and no 9-1-1 tax", async () => {
    const u = await makeUser(ctx);
    const res = await checkout(u.auth, { addon: "no_ads" });
    expect(res.statusCode).toBe(200);
    const arg = billing.createCheckout.mock.calls[0]![0];
    expect(arg).toMatchObject({ mode: "subscription", line: { unitAmountCents: 399, recurring: "month", quantity: 1 }, metadata: { kind: "addon", code: "no_ads" } });
    expect(arg.line.name).toBe("MIMT Sans pub");
    expect(arg.taxLines.map((l: { name: string; unitAmountCents: number }) => [l.name, l.unitAmountCents])).toEqual([
      ["TPS (5 %)", 20],
      ["TVQ (9,975 %)", 40],
    ]);
  });

  it("sells 29,99 $/yr", async () => {
    const u = await makeUser(ctx);
    await checkout(u.auth, { addon: "no_ads", interval: "year" });
    const arg = billing.createCheckout.mock.calls[0]![0];
    expect(arg.line).toMatchObject({ unitAmountCents: 2999, recurring: "year" });
    expect(arg.taxLines.map((l: { unitAmountCents: number }) => l.unitAmountCents)).toEqual([150, 299]);
  });

  it("refuses the add-on when the plan already has no ads", async () => {
    const u = await makeUser(ctx);
    await subscriptionUpdated(u.account.id, "plan", "premium", "active", "sub_prem");
    const res = await checkout(u.auth, { addon: "no_ads" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("already_ad_free");
  });

  it("turns ads off on the free plan once paid, and back on when cancelled", async () => {
    const u = await makeUser(ctx);
    expect((await me(u.auth)).account).toMatchObject({ plan: "free", addOns: [] });
    await subscriptionUpdated(u.account.id, "addon", "no_ads", "active", "sub_noads");
    const after = await me(u.auth);
    expect(after.account).toMatchObject({ plan: "free", addOns: ["no_ads"] });
    expect((await ctx.repo.listEntitlements(u.account.id)).filter((e) => e.source === "addon").map((e) => e.feature)).toEqual(["no_ads"]);
    expect(ctx.repo.outbox.at(-1)?.payload).toMatchObject({ plan: "free", features: ["no_ads"] });

    await subscriptionUpdated(u.account.id, "addon", "no_ads", "canceled", "sub_noads");
    expect((await me(u.auth)).account.addOns).toEqual([]);
    expect((await ctx.repo.listEntitlements(u.account.id)).some((e) => e.feature === "no_ads")).toBe(false);
  });

  it("maps the App Store add-on SKU (IAP) onto the add-on, not a plan", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const purchase = purchaseFromApplePayload(
      { productId: "ca.mimt.app.noads.monthly", bundleId: "ca.mimt.app", originalTransactionId: "200", expiresDate: now.getTime() + 86_400_000 },
      now,
      "ca.mimt.app",
    );
    expect(purchase).toEqual({ addon: "no_ads", transactionId: "200", status: "active", currentPeriodEnd: new Date(now.getTime() + 86_400_000) });
    expect(purchase?.plan).toBeUndefined();
  });
});

describe("referral program (P1 item 3)", () => {
  async function referrerAndReferee() {
    const referrer = await makeUser(ctx);
    const referee = await makeUser(ctx, { ageDays: 1 });
    const code = (await ctx.app.inject({ url: "/v1/referrals", headers: referrer.auth })).json().code as string;
    return { referrer, referee, code };
  }
  const redeem = (auth: Record<string, string>, payload: object) => ctx.app.inject({ method: "POST", url: "/v1/referrals/redeem", headers: auth, payload });

  it("gives every user one stable code with a share link", async () => {
    const u = await makeUser(ctx);
    const first = (await ctx.app.inject({ url: "/v1/referrals", headers: u.auth })).json();
    expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(first).toMatchObject({ shareUrl: `https://mimt.ca/invitation/${first.code}`, reward: { months: 1, plan: "premium" }, referrals: [], referredBy: null });
    expect((await ctx.app.inject({ url: "/v1/referrals", headers: u.auth })).json().code).toBe(first.code);
    expect((await ctx.app.inject({ url: "/v1/referrals" })).statusCode).toBe(401);
  });

  it("refuses self-referral, unknown codes, a second code and late redemption", async () => {
    const { referrer, referee, code } = await referrerAndReferee();
    expect((await redeem(referrer.auth, { code })).json().error).toBe("self_referral");
    expect((await redeem(referee.auth, { code: "ZZZZZZZZ" })).statusCode).toBe(404);
    expect((await redeem(referee.auth, { code: "!!" })).statusCode).toBe(400);
    const ok = await redeem(referee.auth, { code: code.toLowerCase() });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: "pending", rejectReason: null, rewardedAt: null });
    expect((await redeem(referee.auth, { code })).json().error).toBe("already_referred");

    const old = await makeUser(ctx, { ageDays: 60 });
    expect((await redeem(old.auth, { code })).json().error).toBe("referral_window_closed");
    const payer = await makeUser(ctx, { ageDays: 1 });
    await subscriptionUpdated(payer.account.id, "plan", "lock", "active", "sub_lock_payer");
    expect((await redeem(payer.auth, { code })).json().error).toBe("referral_after_purchase");
  });

  it("rewards both with a Premium month after the referee's first paid month, once", async () => {
    const { referrer, referee, code } = await referrerAndReferee();
    expect((await redeem(referee.auth, { code })).statusCode).toBe(201);
    await ctx.repo.updateAccount(referee.account.id, { stripeCustomerId: "cus_1" });
    await subscriptionUpdated(referee.account.id, "plan", "premium", "active", "sub_referee");
    // A one-time payment is not a paid month: nothing happens yet.
    await webhook("checkout.session.completed", { id: "cs_m", mode: "payment", payment_status: "paid", customer: "cus_1", amount_subtotal: 799, metadata: { telecom_account_id: referee.account.id, code: "minutes_250" } });
    expect((await ctx.repo.referrals.getReferralForReferee(referee.user.id))!.status).toBe("pending");

    fingerprints.in_1 = "fp_referee";
    expect((await invoicePaid(referee.account.id, "in_1")).statusCode).toBe(200);

    const mine = (await ctx.app.inject({ url: "/v1/referrals", headers: referrer.auth })).json();
    expect(mine.referrals).toHaveLength(1);
    expect(mine.referrals[0]).toMatchObject({ status: "rewarded", rejectReason: null });
    expect((await ctx.app.inject({ url: "/v1/referrals", headers: referee.auth })).json().referredBy.status).toBe("rewarded");

    // Referrer (free) gets 30 days of Premium; the referee already pays Premium, so its month is a Stripe credit.
    expect((await me(referrer.auth)).account.plan).toBe("premium");
    expect(billing.creditBalance).toHaveBeenCalledTimes(1);
    expect(billing.creditBalance.mock.calls[0]![0]).toMatchObject({ customerId: "cus_1", amountCents: 2999 });
    expect(ctx.notifier.sent).toEqual(expect.arrayContaining([[referrer.user.id, "referral_reward", { months: 1, plan: "premium" }]]));
    expect(await ctx.repo.referrals.listPaymentFingerprints(referee.account.id)).toEqual(["fp_referee"]);

    // Renewals and webhook retries never reward twice.
    await invoicePaid(referee.account.id, "in_2");
    expect(billing.creditBalance).toHaveBeenCalledTimes(1);
    expect((await ctx.repo.listSubscriptions(referrer.account.id)).filter((s) => s.source === "manual")).toHaveLength(1);

    // The free month ends on its own.
    const grant = [...ctx.repo.subscriptions.values()].find((s) => s.telecomAccountId === referrer.account.id && s.source === "manual")!;
    expect(grant.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    grant.currentPeriodEnd = new Date(Date.now() - 1000);
    expect((await me(referrer.auth)).account.plan).toBe("free");
  });

  it("gives a free referee on a cheaper plan a Premium grant instead of a credit", async () => {
    const { referee, code } = await referrerAndReferee();
    await redeem(referee.auth, { code });
    await subscriptionUpdated(referee.account.id, "plan", "lock", "active", "sub_lock");
    await invoicePaid(referee.account.id, "in_lock", "lock", 499);
    expect((await me(referee.auth)).account.plan).toBe("premium");
    expect(billing.creditBalance).not.toHaveBeenCalled();
  });

  it("redeems the code passed on the first checkout", async () => {
    const { referee, code } = await referrerAndReferee();
    const res = await checkout(referee.auth, { plan: "premium", referralCode: code });
    expect(res.statusCode).toBe(200);
    expect((await ctx.repo.referrals.getReferralForReferee(referee.user.id))?.status).toBe("pending");
    const bad = await checkout((await makeUser(ctx, { ageDays: 1 })).auth, { plan: "premium", referralCode: "NOPE2345" });
    expect(bad.statusCode).toBe(404);
  });

  it("refuses a referee on the referrer's device", async () => {
    const { referrer, referee, code } = await referrerAndReferee();
    await ctx.repo.bindDevice({ platform: "ios", deviceKey: "device-key-shared-1", userId: referrer.user.id, verifiedAt: new Date() });
    const res = await redeem(referee.auth, { code, deviceKey: "device-key-shared-1" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("same_device");
    expect((await ctx.repo.listFraudEvents(referee.account.id)).map((e) => e.rule)).toContain("referral_same_device");
    expect(await ctx.repo.referrals.getReferralForReferee(referee.user.id)).toBeNull();
  });

  it("refuses two referees redeeming from the same device", async () => {
    const { referee, code } = await referrerAndReferee();
    expect((await redeem(referee.auth, { code, deviceKey: "device-key-farm-01" })).statusCode).toBe(201);
    const second = await makeUser(ctx, { ageDays: 1 });
    expect((await redeem(second.auth, { code, deviceKey: "device-key-farm-01" })).json().error).toBe("same_device");
  });

  it("settles as rejected (no reward) when the device turns out to be the referrer's", async () => {
    const { referrer, referee, code } = await referrerAndReferee();
    await redeem(referee.auth, { code, deviceKey: "device-key-later-01" });
    await ctx.repo.bindDevice({ platform: "android", deviceKey: "device-key-later-01", userId: referrer.user.id, verifiedAt: new Date() });
    await invoicePaid(referee.account.id, "in_dev");
    const row = (await ctx.repo.referrals.getReferralForReferee(referee.user.id))!;
    expect(row).toMatchObject({ status: "rejected", rejectReason: "same_device", rewardedAt: null });
    expect((await me(referrer.auth)).account.plan).toBe("free");
  });

  it("settles as rejected (no reward) when both pay with the same card", async () => {
    const { referrer, referee, code } = await referrerAndReferee();
    await redeem(referee.auth, { code });
    // The referrer once bought international credit with that card.
    fingerprints.pi_ref = "fp_same_card";
    await webhook("checkout.session.completed", {
      id: "cs_ref", mode: "payment", payment_status: "paid", payment_intent: "pi_ref", customer: "cus_r", amount_subtotal: 500,
      metadata: { telecom_account_id: referrer.account.id, code: "intl_credit" },
    });
    expect(await ctx.repo.referrals.listPaymentFingerprints(referrer.account.id)).toEqual(["fp_same_card"]);

    fingerprints.in_card = "fp_same_card";
    await invoicePaid(referee.account.id, "in_card");
    expect(await ctx.repo.referrals.getReferralForReferee(referee.user.id)).toMatchObject({ status: "rejected", rejectReason: "same_payment" });
    expect((await me(referrer.auth)).account.plan).toBe("free");
    expect((await me(referee.auth)).account.plan).toBe("free");
    expect((await ctx.repo.listFraudEvents(referee.account.id)).map((e) => e.rule)).toContain("referral_same_payment");
  });

  it("rejects a second referee paying with a card another referee already used", async () => {
    const { referee, code } = await referrerAndReferee();
    await redeem(referee.auth, { code });
    fingerprints.in_a = "fp_farm";
    await invoicePaid(referee.account.id, "in_a");
    const second = await makeUser(ctx, { ageDays: 1 });
    await redeem(second.auth, { code });
    fingerprints.in_b = "fp_farm";
    await invoicePaid(second.account.id, "in_b");
    expect(await ctx.repo.referrals.getReferralForReferee(second.user.id)).toMatchObject({ status: "rejected", rejectReason: "same_payment" });
  });
});

describe("international credit on the free plan (P1 item 9)", () => {
  it("allows small top-ups only, for verified clean accounts, a few times a day", async () => {
    const u = await makeUser(ctx);
    expect((await checkout(u.auth, { addon: "intl_credit", amountCents: 1000 })).statusCode).toBe(200);
    expect(billing.createCheckout.mock.calls[0]![0]).toMatchObject({ mode: "payment", line: { unitAmountCents: 1000 }, metadata: { code: "intl_credit" } });
    expect((await checkout(u.auth, { addon: "intl_credit", amountCents: 1500 })).json().error).toBe("intl_topup_too_large");

    await ctx.repo.addIntlCredit(u.account.id, 1500);
    expect((await checkout(u.auth, { addon: "intl_credit", amountCents: 1000 })).json().error).toBe("intl_balance_limit");

    const busy = await makeUser(ctx);
    for (let i = 0; i < 3; i++) expect((await checkout(busy.auth, { addon: "intl_credit", amountCents: 500 })).statusCode).toBe(200);
    const limited = await checkout(busy.auth, { addon: "intl_credit", amountCents: 500 });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("intl_topup_rate_limited");

    const unverified = await makeUser(ctx, { verified: false });
    expect((await checkout(unverified.auth, { addon: "intl_credit", amountCents: 500 })).json().error).toBe("phone_verification_required");
    const risky = await makeUser(ctx);
    await ctx.repo.updateAccount(risky.account.id, { riskTier: "high" });
    expect((await checkout(risky.auth, { addon: "intl_credit", amountCents: 500 })).json().error).toBe("account_restricted");
  });

  it("keeps paid plans at up to 100 $ per top-up", async () => {
    const u = await makeUser(ctx);
    await subscriptionUpdated(u.account.id, "plan", "premium", "active", "sub_paid_intl");
    expect((await checkout(u.auth, { addon: "intl_credit", amountCents: 5000 })).statusCode).toBe(200);
  });

  describe("outbound calls", () => {
    const OUT = "/webhooks/twilio/voice/outbound";
    const outbound = (userId: string, to: string) => twilioPost(ctx, OUT, { CallSid: "CA" + Math.random().toString(16).slice(2), From: `client:${userId}`, To: to });

    async function freeWithCredit(cents: number) {
      const u = await makeUser(ctx, { number: "+15145550100", e911: true, ack: true });
      await webhook("checkout.session.completed", {
        id: "cs_free_" + cents, mode: "payment", payment_status: "paid", customer: "cus_1", amount_subtotal: cents,
        metadata: { telecom_account_id: u.account.id, code: "intl_credit" },
      });
      return u;
    }

    it("dials the short free-plan list with credit, capped at 30 minutes per call", async () => {
      const u = await freeWithCredit(1000);
      const res = await outbound(u.user.id, "+33142685300");
      expect(res.body).toContain("<Number>+33142685300</Number>");
      expect(res.body).toContain('timeLimit="1800"');
    });

    it("blocks destinations outside the free list, premium ranges, the Caribbean and Cuba", async () => {
      const u = await freeWithCredit(1000);
      for (const to of ["+18765551234", "+5355550100", "+2348012345678", "+449012345678", "+33899123456"]) {
        const res = await outbound(u.user.id, to);
        expect(res.body, to).toContain("n'est pas permise");
        expect(res.body, to).not.toContain("<Dial");
      }
    });

    it("never blocks 9-1-1 on the free plan, credit or not", async () => {
      const u = await freeWithCredit(500);
      await ctx.repo.addUsage(u.account.id, [monthPeriod(new Date())], { minutesOut: 10_000 });
      const res = await outbound(u.user.id, "911");
      expect(res.body).toContain("<Number>911</Number>");
    });

    it("debits the retail rate shown before dialling", async () => {
      const u = await freeWithCredit(1000);
      const sid = "CArate1";
      await twilioPost(ctx, OUT, { CallSid: sid, From: `client:${u.user.id}`, To: "+33142685300" });
      await twilioPost(ctx, "/webhooks/twilio/voice/status", { CallSid: sid, CallStatus: "completed", CallDuration: "125" });
      const rate = (await ctx.app.inject({ url: "/v1/rates?to=%2B33142685300", headers: u.auth })).json().centsPerMinute as number;
      // 125 s = 3 started minutes at the retail rate (the carrier cost is lower).
      expect((await ctx.repo.getAccount(u.account.id))!.intlCreditCents).toBe(1000 - 3 * rate);
    });
  });
});

describe("GET /v1/rates (P1 item 9)", () => {
  const rates = (auth: Record<string, string>, to: string) => ctx.app.inject({ url: `/v1/rates?to=${encodeURIComponent(to)}`, headers: auth });

  it("needs a signed-in user and a valid number", async () => {
    expect((await ctx.app.inject({ url: "/v1/rates?to=%2B33142685300" })).statusCode).toBe(401);
    const u = await makeUser(ctx);
    expect((await rates(u.auth, "abc")).json().error).toBe("invalid_number");
    expect((await rates(u.auth, "+11234567890")).statusCode).toBe(400);
  });

  it("shows the rate and offers a top-up to a free user without credit", async () => {
    const u = await makeUser(ctx);
    const body = (await rates(u.auth, "011 33 1 42 68 53 00")).json();
    expect(body).toMatchObject({
      to: "+33142685300",
      kind: "international",
      country: { fr: "France", en: "France" },
      currency: "CAD",
      allowed: false,
      reason: "intl_no_credit",
      intlCreditCents: 0,
      minutesAvailable: 0,
      placeholder: true,
    });
    expect(body.centsPerMinute).toBeGreaterThan(0);
    expect((await rates(u.auth, "+18765551234")).json()).toMatchObject({ allowed: false, reason: "destination_blocked", country: { en: "Jamaica" } });
  });

  it("says how many minutes the credit buys", async () => {
    const u = await makeUser(ctx);
    await ctx.repo.addIntlCredit(u.account.id, 1000);
    await ctx.repo.replaceEntitlements(u.account.id, "intl_credit", [{ feature: "intl_calling", limit: null }]);
    const body = (await rates(u.auth, "+33142685300")).json();
    expect(body).toMatchObject({ allowed: true, reason: null, intlCreditCents: 1000 });
    expect(body.minutesAvailable).toBe(Math.floor(1000 / body.centsPerMinute));
  });

  it("uses the default rate for destinations missing from the table (paid plan)", async () => {
    const u = await makeUser(ctx);
    await subscriptionUpdated(u.account.id, "plan", "premium", "active", "sub_rate");
    await ctx.repo.addIntlCredit(u.account.id, 1000);
    await ctx.repo.replaceEntitlements(u.account.id, "intl_credit", [{ feature: "intl_calling", limit: null }]);
    const body = (await rates(u.auth, "+81312345678")).json();
    expect(body).toMatchObject({ country: null, centsPerMinute: ctx.deps.config.INTL_ASSUMED_RATE_CENTS_PER_MIN, allowed: true, minutesAvailable: 20 });
  });

  it("treats Canada/US as plan minutes and 9-1-1 as always free", async () => {
    const u = await makeUser(ctx);
    expect((await rates(u.auth, "514-555-0123")).json()).toMatchObject({ to: "+15145550123", kind: "domestic", centsPerMinute: 0, allowed: true });
    await ctx.repo.updateAccount(u.account.id, { status: "OUTBOUND_SUSPENDED" });
    for (const dialed of ["911", "9-1-1"]) {
      expect((await rates(u.auth, dialed)).json()).toMatchObject({ to: "911", kind: "emergency", centsPerMinute: 0, allowed: true, reason: null });
    }
  });
});
