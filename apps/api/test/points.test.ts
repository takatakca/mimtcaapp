// « MIMT Points » end to end on the in-memory repository: earning only from server-verified events (missions,
// paid invoices, store renewals, referrals, campaigns), redeeming with atomic debit + fulfilment (or refund), caps,
// kill switch, admin campaigns with audit, expiry job. The Postgres behaviour is in points.repo.contract.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { PointsCatalogResponse, PointsResponse } from "@mimt/shared";
import type { StoreVerifier } from "../src/billing/iap.js";
import { loadConfig } from "../src/config.js";
import { checkSmsCaps } from "../src/fraud/caps.js";
import type { BillingGateway } from "../src/gateways/billing.js";
import { runPointsExpiry } from "../src/jobs/pointsExpiry.js";
import { monthPeriod } from "../src/lib/time.js";
import { earnReferralPoints, invoicePreTaxCents } from "../src/services/points.js";
import { makeUser, setup, testConfig, type Ctx } from "./helpers.js";

let ctx: Ctx;
afterEach(() => ctx?.app.close());

type Billing = BillingGateway & { creditBalance: ReturnType<typeof vi.fn> };

function withBilling(): Billing {
  const billing = {
    createCustomer: vi.fn(async () => "cus_1"),
    createCheckout: vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })),
    createPortal: vi.fn(async () => "https://billing.stripe.test/p"),
    constructEvent: vi.fn((raw: Buffer, sig: string) => {
      if (sig !== "good") throw new Error("bad signature");
      return JSON.parse(raw.toString("utf8")) as Stripe.Event;
    }),
    retrieveSubscription: vi.fn(),
    creditBalance: vi.fn(async () => {}),
    invoiceIdForPayment: vi.fn(async (pi: string) => pi.replace("pi_", "in_")),
  } as unknown as Billing;
  ctx.deps.billing = billing;
  return billing;
}

let evt = 0;
const stripeWebhook = (type: string, object: object) =>
  ctx.app.inject({
    method: "POST",
    url: "/webhooks/stripe",
    headers: { "content-type": "application/json", "stripe-signature": "good" },
    payload: JSON.stringify({ id: `evt_pts_${++evt}`, type, data: { object } }),
  });

/** A paid plan invoice as MIMT bills it: the plan line, then TPS and TVQ lines. */
const invoice = (accountId: string, id: string, planCents: number, interval: "month" | "year" = "month", code = "lock") => {
  const gst = Math.round(planCents * 0.05);
  const qst = Math.round(planCents * 0.09975);
  return {
    id,
    customer: "cus_1",
    amount_paid: planCents + gst + qst,
    total: planCents + gst + qst,
    lines: { data: [{ amount: planCents, description: "1 × MIMT Essentiel" }, { amount: gst, description: "1 × TPS (5 %)" }, { amount: qst, description: "1 × TVQ (9,975 %)" }] },
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_x", metadata: { telecom_account_id: accountId, kind: "plan", code, interval } } },
  };
};

const get = async <T>(auth: Record<string, string>, url: string): Promise<T> => {
  const res = await ctx.app.inject({ url, headers: auth });
  expect(res.statusCode).toBe(200);
  return res.json() as T;
};
const redeem = (auth: Record<string, string>, rewardId: string, idempotencyKey: string) =>
  ctx.app.inject({ method: "POST", url: "/v1/points/redeem", headers: auth, payload: { rewardId, idempotencyKey } });

async function givePoints(accountId: string, points: number, key = `seed:${accountId}`) {
  await ctx.repo.points.earn({
    telecomAccountId: accountId,
    at: new Date(),
    entries: [{ reason: "mission", points, idempotencyKey: key, reference: "mission:test" }],
    caps: { daily: 1e9, monthly: 1e9, dayStart: new Date(0), monthStart: new Date(0) },
  });
}

async function payingAccount(code: "lock" | "premium" = "lock") {
  const u = await makeUser(ctx);
  await ctx.repo.updateAccount(u.account.id, { stripeCustomerId: "cus_1" });
  await ctx.repo.upsertSubscription({
    telecomAccountId: u.account.id,
    kind: "plan",
    code,
    quantity: 1,
    stripeSubscriptionId: `sub_${u.account.id.slice(0, 6)}`,
    status: "active",
    source: "stripe",
    currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
  });
  return { ...u, account: (await ctx.repo.getAccount(u.account.id))! };
}

describe("MIMT Points: earning (server-verified only)", () => {
  it("starts empty, with the rules, and has no route to claim points", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    const p = await get<PointsResponse>(u.auth, "/v1/points");
    expect(p).toMatchObject({ enabled: true, balance: 0, lifetimeEarned: 0, history: [], campaigns: [] });
    expect(p.rules).toEqual({ pointsPerDollar: 10, referralPoints: 1000, missionPointsCap: 1500, dailyEarnCap: 5000, monthlyEarnCap: 20000, expiryMonths: null });
    for (const url of ["/v1/points", "/v1/points/earn", "/v1/points/claim"]) {
      expect((await ctx.app.inject({ method: "POST", url, headers: u.auth, payload: { points: 100 } })).statusCode).toBe(404);
    }
  });

  it("missions credit points, shown in the history", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: u.auth, payload: { handle: "@points" } });
    const p = await get<PointsResponse>(u.auth, "/v1/points");
    expect(p.balance).toBe(300);
    expect(p.history[0]).toMatchObject({ delta: 300, reason: "mission", label: "mission:choose_handle", balanceAfter: 300 });
  });

  it("a paid invoice earns 10 points per dollar before taxes, once per invoice", async () => {
    ctx = await setup();
    withBilling();
    const u = await payingAccount();
    expect((await stripeWebhook("invoice.paid", invoice(u.account.id, "in_1", 1299))).statusCode).toBe(200);
    expect((await ctx.repo.points.getAccount(u.account.id))?.balance).toBe(129);
    // Stripe sends the same invoice again under another event id: still once.
    await stripeWebhook("invoice.paid", invoice(u.account.id, "in_1", 1299));
    expect((await ctx.repo.points.getAccount(u.account.id))?.balance).toBe(129);
    const audit = ctx.repo.auditLog.filter((e) => e.action === "points.earned");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ targetId: u.account.id, meta: { event: "purchase:invoice", points: 129 } });
  });

  it("pre-tax amount: taxes excluded, a balance credit lowers it, no lines falls back to GST+QST", () => {
    expect(invoicePreTaxCents({ amount_paid: 1494, total: 1494, lines: { data: [{ amount: 1299, description: "MIMT Essentiel" }, { amount: 65, description: "TPS (5 %)" }, { amount: 130, description: "TVQ (9,975 %)" }] } })).toBe(1299);
    expect(invoicePreTaxCents({ amount_paid: 747, total: 1494, lines: { data: [{ amount: 1299, description: "MIMT Essentiel" }, { amount: 195, description: "GST + QST" }] } })).toBe(649);
    expect(invoicePreTaxCents({ amount_paid: 1149, total: 1149, lines: null })).toBe(999);
    expect(invoicePreTaxCents({ amount_paid: 0, total: 0 })).toBe(0);
    expect(invoicePreTaxCents({ amount_paid: 1200, total: 1200, lines: { data: [{ amount: 1000, description: "Plan" }, { amount: 55, description: "Taxe municipale 9-1-1 du Québec" }, { amount: 145, description: "QST" }] } })).toBe(1000);
  });

  it("a verified App Store purchase and its renewal earn points; a re-verification does not pay twice", async () => {
    const store: StoreVerifier = {
      appleJws: async (token: string) => JSON.parse(Buffer.from(token.slice(5), "base64url").toString("utf8")) as Record<string, unknown>,
      google: async () => null,
      googleAcknowledge: async () => {},
    };
    ctx = await setup({ config: { APPLE_ROOT_CA_PEM: "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----", APPLE_BUNDLE_ID: "ca.mimt.app" }, store });
    const u = await makeUser(ctx);
    const jws = (p: object) => `fake.${Buffer.from(JSON.stringify(p)).toString("base64url")}`;
    const tx = { bundleId: "ca.mimt.app", productId: "ca.mimt.app.premium.monthly", originalTransactionId: "2000", transactionId: "2000", expiresDate: Date.now() + 30 * 86_400_000, appAccountToken: u.account.id };
    const verify = () => ctx.app.inject({ method: "POST", url: "/v1/billing/iap/verify", headers: u.auth, payload: { platform: "ios", productId: tx.productId, transaction: jws(tx) } });
    expect((await verify()).statusCode).toBe(200);
    expect((await ctx.repo.points.getAccount(u.account.id))?.balance).toBe(299);
    await verify();
    expect((await ctx.repo.points.getAccount(u.account.id))?.balance).toBe(299);
    // Renewal notification: a new transactionId, a new paid period.
    const renewal = { notificationType: "DID_RENEW", notificationUUID: "n-1", data: { bundleId: "ca.mimt.app", signedTransactionInfo: jws({ ...tx, transactionId: "2001" }) } };
    expect((await ctx.app.inject({ method: "POST", url: "/webhooks/appstore", payload: { signedPayload: jws(renewal) } })).statusCode).toBe(200);
    expect((await ctx.repo.points.getAccount(u.account.id))?.balance).toBe(598);
    // A grace period is not a payment: no points.
    const grace = { notificationType: "DID_FAIL_TO_RENEW", subtype: "GRACE_PERIOD", notificationUUID: "n-2", data: { bundleId: "ca.mimt.app", signedTransactionInfo: jws({ ...tx, transactionId: "2002" }) } };
    await ctx.app.inject({ method: "POST", url: "/webhooks/appstore", payload: { signedPayload: jws(grace) } });
    expect((await ctx.repo.points.getAccount(u.account.id))?.balance).toBe(598);
  });

  it("a converted referral pays the referrer 1 000 points, once", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    expect(await earnReferralPoints(ctx.deps, u.account, "11111111-1111-1111-1111-111111111111")).toEqual({ points: 1000, balance: 1000 });
    expect(await earnReferralPoints(ctx.deps, u.account, "11111111-1111-1111-1111-111111111111")).toBeNull();
  });

  it("daily cap: points past it are recorded at 0, never paid later", async () => {
    ctx = await setup({ config: { POINTS_DAILY_EARN_CAP: "200", POINTS_MONTHLY_EARN_CAP: "1000" } });
    withBilling();
    const u = await payingAccount();
    await stripeWebhook("invoice.paid", invoice(u.account.id, "in_cap", 4499));
    const p = await get<PointsResponse>(u.auth, "/v1/points");
    expect(p.balance).toBe(200);
    expect(p.history[0]).toMatchObject({ delta: 200 });
  });

  it("POINTS=off: nothing earned, nothing redeemed; mission points are credited when it comes back on", async () => {
    ctx = await setup({ config: { POINTS: "off" } });
    const u = await makeUser(ctx);
    await ctx.app.inject({ method: "PUT", url: "/v1/me/handle", headers: u.auth, payload: { handle: "@pause" } });
    expect((await get<PointsResponse>(u.auth, "/v1/points"))).toMatchObject({ enabled: false, balance: 0 });
    expect((await redeem(u.auth, "minutes_on_net_60", "off-key-0001")).json()).toMatchObject({ error: "points_paused" });
    ctx.deps.config.points.enabled = true;
    expect((await get<PointsResponse>(u.auth, "/v1/points")).balance).toBe(300);
    expect((await get<PointsResponse>(u.auth, "/v1/points")).balance).toBe(300);
  });
});

describe("MIMT Points: refunds and chargebacks (clawback)", () => {
  // The invoice in_<x> was paid by the payment intent pi_<x> (withBilling's invoiceIdForPayment).
  const refund = (x: string, amount: number, refunded: number) => stripeWebhook("charge.refunded", { id: `ch_${x}`, payment_intent: `pi_${x}`, amount, amount_refunded: refunded });
  const dispute = (x: string) => stripeWebhook("charge.dispute.created", { id: `dp_${x}`, charge: `ch_${x}`, payment_intent: `pi_${x}` });
  const balance = async (accountId: string) => (await ctx.repo.points.getAccount(accountId))?.balance;

  it("a partial refund takes back points in proportion, then the rest; repeated webhooks change nothing", async () => {
    ctx = await setup();
    withBilling();
    const u = await payingAccount();
    await stripeWebhook("invoice.paid", invoice(u.account.id, "in_r1", 1299));
    expect(await balance(u.account.id)).toBe(129);
    // Half of the 14,94 $ charge refunded: 64 of the 129 points go back.
    expect((await refund("r1", 1494, 747)).statusCode).toBe(200);
    expect(await balance(u.account.id)).toBe(65);
    // The same refund state again (another event id): nothing more.
    await refund("r1", 1494, 747);
    expect(await balance(u.account.id)).toBe(65);
    // Then refunded in full (Stripe reports the cumulative amount): only the difference.
    await refund("r1", 1494, 1494);
    await refund("r1", 1494, 1494);
    expect(await balance(u.account.id)).toBe(0);
    const p = await get<PointsResponse>(u.auth, "/v1/points");
    expect(p).toMatchObject({ balance: 0, owed: 0, lifetimeEarned: 129 });
    expect(p.history.slice(0, 2)).toMatchObject([
      { delta: -65, reason: "clawback", label: "clawback:invoice", balanceAfter: 0 },
      { delta: -64, reason: "clawback", label: "clawback:invoice", balanceAfter: 65 },
    ]);
    // Audited with internal ids only: no Stripe id anywhere in the entry.
    const audit = ctx.repo.auditLog.filter((e) => e.action === "points.clawed_back");
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ targetType: "telecom_account", targetId: u.account.id, meta: { kind: "invoice", reason: "refund", points: 64, debited: 64, owedAdded: 0 } });
    expect(JSON.stringify(audit)).not.toMatch(/in_r1|pi_r1|ch_r1|cus_/);
    // A refund of an invoice that earned nothing (or of another customer) changes nothing.
    expect((await refund("unknown", 1000, 1000)).statusCode).toBe(200);
  });

  it("a chargeback takes back every point of the invoice, campaign extras included, once", async () => {
    ctx = await setup();
    withBilling();
    const u = await payingAccount();
    await ctx.repo.points.createCampaign({
      name: "Double points",
      kind: "multiplier",
      target: "purchase",
      multiplier: 2,
      bonusPoints: null,
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 86_400_000),
      budgetPoints: 10_000,
      createdBy: null,
    });
    await stripeWebhook("invoice.paid", invoice(u.account.id, "in_d1", 1299));
    await stripeWebhook("invoice.paid", invoice(u.account.id, "in_d2", 999));
    expect(await balance(u.account.id)).toBe(258 + 198);
    expect((await dispute("d1")).statusCode).toBe(200);
    expect(await balance(u.account.id)).toBe(198);
    await dispute("d1");
    // A refund event after the chargeback: everything was already taken back.
    await refund("d1", 1494, 1494);
    expect(await balance(u.account.id)).toBe(198);
    expect(ctx.repo.auditLog.filter((e) => e.action === "points.clawed_back")).toHaveLength(1);
    expect(ctx.repo.auditLog.find((e) => e.action === "points.clawed_back")).toMatchObject({ meta: { reason: "chargeback", points: 258 } });
  });

  it("balance too low: debits to 0, the rest is owed, redemptions refused, repaid from the next points earned", async () => {
    ctx = await setup();
    withBilling();
    const u = await payingAccount();
    await stripeWebhook("invoice.paid", invoice(u.account.id, "in_low", 4499));
    expect(await balance(u.account.id)).toBe(449);
    // The customer spends the points, then disputes the payment.
    expect((await redeem(u.auth, "minutes_out_30", "low-key-0001")).statusCode).toBe(200);
    expect(await balance(u.account.id)).toBe(149);
    await dispute("low");
    let p = await get<PointsResponse>(u.auth, "/v1/points");
    expect(p).toMatchObject({ balance: 0, owed: 300 });
    expect(p.history[0]).toMatchObject({ delta: -149, reason: "clawback", balanceAfter: 0 });
    expect(ctx.repo.auditLog.find((e) => e.action === "points.clawed_back")).toMatchObject({ meta: { points: 449, debited: 149, owedAdded: 300, owed: 300 } });
    // Never negative, and no redemption while points are owed (refused before the balance check).
    const refused = await redeem(u.auth, "minutes_out_30", "low-key-0002");
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: "points_owed" });
    // The next invoice (129 points) repays part of it; the one after clears it and the rest is the customer's.
    await stripeWebhook("invoice.paid", invoice(u.account.id, "in_next1", 1299));
    expect(await ctx.repo.points.getAccount(u.account.id)).toMatchObject({ balance: 0, owed: 171 });
    await stripeWebhook("invoice.paid", invoice(u.account.id, "in_next2", 4499));
    expect(await ctx.repo.points.getAccount(u.account.id)).toMatchObject({ balance: 278, owed: 0 });
    p = await get<PointsResponse>(u.auth, "/v1/points");
    expect(p.history[0]).toMatchObject({ delta: -171, reason: "clawback", label: "owed", balanceAfter: 278 });
    expect(p.history[1]).toMatchObject({ delta: 449, reason: "purchase", balanceAfter: 449 });
  });

  it("App Store REFUND and Google Play voided purchase take back that period's points, once", async () => {
    const jws = (p: object) => `fake.${Buffer.from(JSON.stringify(p)).toString("base64url")}`;
    let play = { expiry: Date.now() + 30 * 86_400_000 };
    const store: StoreVerifier = {
      appleJws: async (token: string) => JSON.parse(Buffer.from(token.slice(5), "base64url").toString("utf8")) as Record<string, unknown>,
      google: async (productId: string, purchaseToken: string) => ({
        plan: "premium",
        transactionId: purchaseToken.slice(0, 120),
        status: "active",
        currentPeriodEnd: new Date(play.expiry),
        accountToken: android.account.id,
        acknowledged: true,
        linkedPurchaseToken: null,
      }),
      googleAcknowledge: async () => {},
    };
    ctx = await setup({
      config: {
        APPLE_ROOT_CA_PEM: "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----",
        APPLE_BUNDLE_ID: "ca.mimt.app",
        GOOGLE_PLAY_PACKAGE_NAME: "ca.mimt.app",
        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: "{}",
        GOOGLE_PLAY_RTDN_TOKEN: "rtdn-token-000000000000000000",
      },
      store,
    });
    const ios = await makeUser(ctx);
    const android = await makeUser(ctx);
    // iOS: purchase (2000) and renewal (2001), then Apple refunds the renewal.
    const tx = { bundleId: "ca.mimt.app", productId: "ca.mimt.app.premium.monthly", originalTransactionId: "2000", transactionId: "2000", expiresDate: Date.now() + 30 * 86_400_000, appAccountToken: ios.account.id };
    await ctx.app.inject({ method: "POST", url: "/v1/billing/iap/verify", headers: ios.auth, payload: { platform: "ios", productId: tx.productId, transaction: jws(tx) } });
    const note = (type: string, uuid: string, txId: string) => ({ notificationType: type, notificationUUID: uuid, data: { bundleId: "ca.mimt.app", signedTransactionInfo: jws({ ...tx, transactionId: txId }) } });
    await ctx.app.inject({ method: "POST", url: "/webhooks/appstore", payload: { signedPayload: jws(note("DID_RENEW", "c-1", "2001")) } });
    expect(await balance(ios.account.id)).toBe(598);
    expect((await ctx.app.inject({ method: "POST", url: "/webhooks/appstore", payload: { signedPayload: jws(note("REFUND", "c-2", "2001")) } })).statusCode).toBe(200);
    expect(await balance(ios.account.id)).toBe(299);
    await ctx.app.inject({ method: "POST", url: "/webhooks/appstore", payload: { signedPayload: jws(note("REFUND", "c-3", "2001")) } });
    expect(await balance(ios.account.id)).toBe(299);
    // REVOKE (Family Sharing removed) is not a refund: nothing taken.
    await ctx.app.inject({ method: "POST", url: "/webhooks/appstore", payload: { signedPayload: jws(note("REVOKE", "c-4", "2000")) } });
    expect(await balance(ios.account.id)).toBe(299);

    // Google Play: two paid periods of one purchase token, then the purchase is voided.
    const token = "play-token-0000000000000000000001";
    const rtdn = (data: object, id: string) =>
      ctx.app.inject({ method: "POST", url: "/webhooks/google-play?token=rtdn-token-000000000000000000", payload: { message: { messageId: id, data: Buffer.from(JSON.stringify({ packageName: "ca.mimt.app", ...data })).toString("base64") } } });
    await rtdn({ subscriptionNotification: { purchaseToken: token, subscriptionId: "ca.mimt.app.premium.monthly", notificationType: 4 } }, "m-1");
    play = { expiry: play.expiry + 30 * 86_400_000 };
    await rtdn({ subscriptionNotification: { purchaseToken: token, subscriptionId: "ca.mimt.app.premium.monthly", notificationType: 2 } }, "m-2");
    expect(await balance(android.account.id)).toBe(598);
    expect((await rtdn({ voidedPurchaseNotification: { purchaseToken: token } }, "m-3")).statusCode).toBe(200);
    expect(await balance(android.account.id)).toBe(299);
    await rtdn({ voidedPurchaseNotification: { purchaseToken: token } }, "m-4");
    expect(await balance(android.account.id)).toBe(299);
    const audit = ctx.repo.auditLog.filter((e) => e.action === "points.clawed_back");
    expect(audit.map((e) => e.meta)).toMatchObject([{ kind: "store", points: 299 }, { kind: "store", points: 299 }]);
    expect(JSON.stringify(audit)).not.toMatch(/2001|play-token/);
  });
});

describe("MIMT Points: campaigns (admin only, audited, budgeted)", () => {
  it("refuses non-admins", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    expect((await ctx.app.inject({ method: "GET", url: "/v1/admin/points/campaigns", headers: u.auth })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "POST", url: "/v1/admin/points/campaigns", headers: u.auth, payload: {} })).statusCode).toBe(403);
  });

  it("« double points sur l'annuel cette semaine »: x2 on yearly invoices only, until the budget is spent", async () => {
    ctx = await setup();
    withBilling();
    const admin = await makeUser(ctx);
    ctx.deps.config.CATALOG_ADMIN_USER_IDS = [admin.user.id];
    const now = Date.now();
    const created = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/points/campaigns",
      headers: admin.auth,
      payload: { name: "Double points sur l'annuel", kind: "multiplier", target: "purchase_yearly", multiplier: 2, startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 7 * 86_400_000).toISOString(), budgetPoints: 2000 },
    });
    expect(created.statusCode).toBe(201);
    const c = created.json();
    expect(c).toMatchObject({ kind: "multiplier", multiplier: 2, budgetPoints: 2000, spentPoints: 0, active: true });

    const u = await payingAccount();
    await stripeWebhook("invoice.paid", invoice(u.account.id, "in_m", 1299, "month"));
    expect((await ctx.repo.points.getAccount(u.account.id))?.balance).toBe(129);
    await stripeWebhook("invoice.paid", invoice(u.account.id, "in_y", 14289, "year"));
    // 1 428 + 1 428 (campaign) on the yearly invoice.
    expect((await ctx.repo.points.getAccount(u.account.id))?.balance).toBe(129 + 1428 + 1428);
    const p = await get<PointsResponse>(u.auth, "/v1/points");
    expect(p.history[0]).toMatchObject({ reason: "campaign", delta: 1428, campaignName: "Double points sur l'annuel" });

    const v = await payingAccount();
    await stripeWebhook("invoice.paid", invoice(v.account.id, "in_y2", 14289, "year"));
    // Budget left: 2 000 - 1 428 = 572.
    expect((await ctx.repo.points.getAccount(v.account.id))?.balance).toBe(1428 + 572);
    const list = (await ctx.app.inject({ url: "/v1/admin/points/campaigns", headers: admin.auth })).json();
    expect(list.campaigns[0]).toMatchObject({ id: c.id, spentPoints: 2000 });
    // A user sees no campaign once its budget is spent.
    expect((await get<PointsResponse>(v.auth, "/v1/points")).campaigns).toEqual([]);

    // Budget never below what was spent; every change audited with before/after.
    const low = await ctx.app.inject({ method: "PATCH", url: `/v1/admin/points/campaigns/${c.id}`, headers: admin.auth, payload: { budgetPoints: 100 } });
    expect(low.json()).toMatchObject({ error: "budget_below_spent" });
    const up = await ctx.app.inject({ method: "PATCH", url: `/v1/admin/points/campaigns/${c.id}`, headers: admin.auth, payload: { budgetPoints: 5000 } });
    expect(up.json()).toMatchObject({ budgetPoints: 5000 });
    const stop = await ctx.app.inject({ method: "DELETE", url: `/v1/admin/points/campaigns/${c.id}`, headers: admin.auth });
    expect(stop.json()).toMatchObject({ active: false });
    const audit = ctx.repo.auditLog.filter((e) => e.action.startsWith("points.campaign_"));
    expect(audit.map((e) => e.action)).toEqual(["points.campaign_created", "points.campaign_updated", "points.campaign_stopped"]);
    expect(audit[1]).toMatchObject({ actorUserId: admin.user.id, targetType: "points_campaign", meta: { before: { budgetPoints: 2000 }, after: { budgetPoints: 5000 } } });
  });

  it("« 500 points pour le premier numéro en novembre »: a fixed bonus, once per account", async () => {
    ctx = await setup();
    withBilling();
    const admin = await makeUser(ctx);
    ctx.deps.config.CATALOG_ADMIN_USER_IDS = [admin.user.id];
    const now = Date.now();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/points/campaigns",
      headers: admin.auth,
      payload: { name: "Premier numéro en novembre", kind: "bonus", target: "mission:first_number", bonusPoints: 500, startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 86_400_000).toISOString(), budgetPoints: 50_000 },
    });
    expect(res.statusCode).toBe(201);
    const u = await makeUser(ctx, { e911: true, ack: true });
    await ctx.repo.upsertSubscription({ telecomAccountId: u.account.id, kind: "plan", code: "lock", quantity: 1, stripeSubscriptionId: "sub_n", status: "active", source: "stripe", currentPeriodEnd: new Date(now + 20 * 86_400_000) });
    expect((await ctx.app.inject({ method: "POST", url: "/v1/numbers/claim", headers: u.auth, payload: { e164: "+15145550199" } })).statusCode).toBe(201);
    expect((await ctx.repo.points.getAccount(u.account.id))?.balance).toBe(600 + 500);
  });

  it("validates campaigns: multiplier ≤ 3, bonus ≤ 2 000, a real window, a known target", async () => {
    ctx = await setup();
    const admin = await makeUser(ctx);
    ctx.deps.config.CATALOG_ADMIN_USER_IDS = [admin.user.id];
    const base = { name: "Test", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString(), budgetPoints: 100 };
    for (const payload of [
      { ...base, kind: "multiplier", target: "purchase", multiplier: 5 },
      { ...base, kind: "bonus", target: "purchase", bonusPoints: 9000 },
      { ...base, kind: "bonus", target: "leave_review", bonusPoints: 10 },
      { ...base, kind: "multiplier", target: "purchase", multiplier: 2, endsAt: base.startsAt },
      { ...base, kind: "multiplier", target: "purchase" },
    ]) {
      expect((await ctx.app.inject({ method: "POST", url: "/v1/admin/points/campaigns", headers: admin.auth, payload })).statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
});

describe("MIMT Points: redeeming", () => {
  it("free plan: catalog, insufficient points, then 60 app-to-app minutes; the same key never redeems twice", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    let cat = await get<PointsCatalogResponse>(u.auth, "/v1/points/catalog");
    const byId = (c: PointsCatalogResponse, id: string) => c.rewards.find((r) => r.id === id)!;
    expect(byId(cat, "minutes_on_net_60")).toMatchObject({ points: 150, available: false, unavailableReason: "balance" });
    expect(byId(cat, "minutes_out_30")).toMatchObject({ unavailableReason: "plan" });
    expect(byId(cat, "invoice_credit_5")).toMatchObject({ unavailableReason: "plan" });
    expect((await redeem(u.auth, "minutes_on_net_60", "key-insufficient")).json()).toMatchObject({ error: "insufficient_points" });

    await givePoints(u.account.id, 400);
    cat = await get<PointsCatalogResponse>(u.auth, "/v1/points/catalog");
    expect(byId(cat, "minutes_on_net_60").available).toBe(true);
    const ok = await redeem(u.auth, "minutes_on_net_60", "key-000000001");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ rewardId: "minutes_on_net_60", status: "fulfilled", points: 150, balance: 250, replay: false });
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).bonusMinutesOnNet).toBe(60);
    const replay = await redeem(u.auth, "minutes_on_net_60", "key-000000001");
    expect(replay.json()).toMatchObject({ replay: true, balance: 250 });
    expect((await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()))).bonusMinutesOnNet).toBe(60);
    expect((await redeem(u.auth, "ad_free_week", "key-000000001")).json()).toMatchObject({ error: "idempotency_conflict" });
    // Paid-plan rewards are refused on the free plan.
    expect((await redeem(u.auth, "texts_50", "key-000000002")).json()).toMatchObject({ error: "not_eligible" });
    const audit = ctx.repo.auditLog.filter((e) => e.action === "points.redeemed" || e.action === "points.fulfilled");
    expect(audit.map((e) => e.action)).toEqual(["points.redeemed", "points.fulfilled"]);
  });

  it("free-tier budget reached: free-plan minutes are refused and nothing is debited", async () => {
    ctx = await setup({ config: { FREE_TIER_MONTHLY_BUDGET_CAD: "0" } });
    const u = await makeUser(ctx);
    await givePoints(u.account.id, 400);
    expect((await redeem(u.auth, "minutes_on_net_60", "budget-key-01")).json()).toMatchObject({ error: "free_budget_reached" });
    expect((await ctx.repo.points.getAccount(u.account.id))?.balance).toBe(400);
  });

  it("paid plan: bonus texts raise the SMS allowance; monthly limit per reward", async () => {
    ctx = await setup();
    const u = await payingAccount();
    await givePoints(u.account.id, 5000);
    for (let i = 0; i < 4; i++) expect((await redeem(u.auth, "texts_50", `texts-key-${i}000`)).statusCode).toBe(200);
    expect((await redeem(u.auth, "texts_50", "texts-key-5000")).json()).toMatchObject({ error: "monthly_limit" });
    const usage = await ctx.repo.getUsage(u.account.id, monthPeriod(new Date()));
    expect(usage.bonusMessages).toBe(200);
    const caps = ctx.deps.config.plans.lock.caps;
    expect(checkSmsCaps({ caps, usage: { ...usage, smsOut: caps.messages }, segments: 1 }).ok).toBe(true);
    expect(checkSmsCaps({ caps, usage: { ...usage, smsOut: caps.messages + 200 }, segments: 1 }).ok).toBe(false);
    expect((await ctx.app.inject({ url: "/v1/me", headers: u.auth })).json().usage.bonusMessages).toBe(200);
  });

  it("a week without ads, stacked, then gone when it ends", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    await givePoints(u.account.id, 1000);
    const first = (await redeem(u.auth, "ad_free_week", "adfree-key-01")).json();
    const second = (await redeem(u.auth, "ad_free_week", "adfree-key-02")).json();
    expect(new Date(second.until).getTime() - new Date(first.until).getTime()).toBe(7 * 86_400_000);
    let me = (await ctx.app.inject({ url: "/v1/me", headers: u.auth })).json();
    expect(me.account.addOns).toEqual(["no_ads"]);
    // Both weeks over (the API reads add-ons against the real clock): the grants stop counting.
    for (const s of (await ctx.repo.listSubscriptions(u.account.id)).filter((x) => x.stripeSubscriptionId?.startsWith("points:"))) {
      const { id: _id, createdAt: _c, ...fields } = s;
      await ctx.repo.upsertSubscription({ ...fields, currentPeriodEnd: new Date(Date.now() - 1000) });
    }
    me = (await ctx.app.inject({ url: "/v1/me", headers: u.auth })).json();
    expect(me.account.addOns).toEqual([]);
  });

  it("$5 on the next invoice for Stripe-paying accounts, once a month; a Stripe failure refunds the points", async () => {
    ctx = await setup();
    const billing = withBilling();
    const u = await payingAccount();
    await givePoints(u.account.id, 5000);
    const ok = await redeem(u.auth, "invoice_credit_5", "credit-key-01");
    expect(ok.json()).toMatchObject({ status: "fulfilled", balance: 3000 });
    expect(billing.creditBalance).toHaveBeenCalledWith(expect.objectContaining({ customerId: "cus_1", amountCents: 500, idempotencyKey: `points:${ok.json().redemptionId}` }));
    expect((await redeem(u.auth, "invoice_credit_5", "credit-key-02")).json()).toMatchObject({ error: "monthly_limit" });

    const v = await payingAccount();
    await givePoints(v.account.id, 2500);
    billing.creditBalance.mockRejectedValueOnce(new Error("stripe down"));
    const failed = await redeem(v.auth, "invoice_credit_5", "credit-key-03");
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ error: "fulfilment_failed" });
    expect((await ctx.repo.points.getAccount(v.account.id))?.balance).toBe(2500);
    // The failed one does not count toward the monthly limit.
    expect((await redeem(v.auth, "invoice_credit_5", "credit-key-04")).json()).toMatchObject({ status: "fulfilled", balance: 500 });
    const history = (await get<PointsResponse>(v.auth, "/v1/points")).history.map((h) => [h.reason, h.delta]);
    expect(history.slice(0, 3)).toEqual([["redeem", -2000], ["refund", 2000], ["redeem", -2000]]);
    expect(ctx.repo.auditLog.some((e) => e.action === "points.refunded")).toBe(true);
  });

  it("a free account cannot buy an invoice credit", async () => {
    ctx = await setup();
    withBilling();
    const u = await makeUser(ctx);
    await givePoints(u.account.id, 5000);
    expect((await redeem(u.auth, "invoice_credit_5", "credit-free-01")).json()).toMatchObject({ error: "not_eligible" });
  });

  it("rate-limits redemptions per account", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await redeem(u.auth, "minutes_on_net_60", `rate-key-${i}0000`)).statusCode);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });

  it("validates the body", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    expect((await redeem(u.auth, "minutes_on_net_60", "short")).statusCode).toBe(400);
    expect((await redeem(u.auth, "free_iphone", "valid-key-0001")).json()).toMatchObject({ error: "unknown_reward" });
  });
});

describe("MIMT Points: configuration and expiry", () => {
  it("refuses to start with a catalog price below the rule", () => {
    expect(() => testConfig({ POINTS_CATALOG_JSON: JSON.stringify([{ id: "minutes_out_30", points: 100 }]) })).toThrow(/points reward priced below the rule/);
    expect(() => testConfig({ POINTS_CATALOG_JSON: JSON.stringify([{ id: "cash", points: 100 }]) })).toThrow(/unknown reward/);
    expect(() => testConfig({ POINTS: "maybe" })).toThrow(/POINTS must be on or off/);
    const ok = testConfig({ POINTS_CATALOG_JSON: JSON.stringify([{ id: "texts_50", points: 300, monthlyLimit: 2 }, { id: "ad_free_week", enabled: false }]) });
    expect(ok.points.catalog.find((r) => r.id === "texts_50")).toMatchObject({ points: 300, monthlyLimit: 2 });
    expect(ok.points.catalog.find((r) => r.id === "ad_free_week")?.enabled).toBe(false);
    expect(loadConfig({ NODE_ENV: "test" }).points).toMatchObject({ enabled: true, dailyEarnCap: 5000, monthlyEarnCap: 20000, expiry: { enabled: false, months: 12 } });
  });

  it("expiry is off by default; on, it takes balances inactive for 12 months, once", async () => {
    ctx = await setup();
    const u = await makeUser(ctx);
    const old = new Date(Date.now() - 400 * 86_400_000);
    await ctx.repo.points.earn({ telecomAccountId: u.account.id, at: old, entries: [{ reason: "mission", points: 300, idempotencyKey: "old-1", reference: "mission:x" }], caps: { daily: 1e6, monthly: 1e6, dayStart: old, monthStart: old } });
    expect(await runPointsExpiry(ctx.deps)).toMatchObject({ skipped: "off" });
    ctx.deps.config.points.expiry.enabled = true;
    expect(await runPointsExpiry(ctx.deps)).toEqual({ expired: 1, points: 300, errors: 0 });
    expect(await runPointsExpiry(ctx.deps)).toEqual({ expired: 0, points: 0, errors: 0 });
    expect((await get<PointsResponse>(u.auth, "/v1/points")).history[0]).toMatchObject({ reason: "expiry", delta: -300, balanceAfter: 0 });
    expect(ctx.repo.auditLog.some((e) => e.action === "points.expired")).toBe(true);
  });
});
