// PBX-01: MIMT Affaires lines ↔ Stripe subscription quantity (Stripe is the source of truth).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { StripeGateway, type BillingGateway } from "../src/gateways/billing.js";
import { makeUser, setup, twilioPost, type Ctx } from "./helpers.js";
import { makeBusiness } from "./pbxFixtures.js";

let ctx: Ctx;
let billing: { [K in keyof BillingGateway]-?: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  ctx = await setup({ now: () => new Date("2026-10-14T14:00:00Z") });
  billing = {
    createCustomer: vi.fn(async () => "cus_biz"),
    createCheckout: vi.fn(async () => ({ id: "cs_biz", url: "https://checkout.stripe.test/cs_biz" })),
    createPortal: vi.fn(),
    constructEvent: vi.fn((raw: Buffer, sig: string) => {
      if (!Buffer.isBuffer(raw) || sig !== "good") throw new Error("bad signature");
      return JSON.parse(raw.toString("utf8")) as Stripe.Event;
    }),
    retrieveSubscription: vi.fn(),
    updateSeatQuantity: vi.fn(async () => undefined),
  } as never;
  ctx.deps.billing = billing as unknown as BillingGateway;
});
afterEach(() => ctx.app.close());

const seats = (businessId: string, auth: Record<string, string>, body: object, key?: string) =>
  ctx.app.inject({ method: "POST", url: `/v1/business/${businessId}/seats`, headers: { ...auth, ...(key ? { "idempotency-key": key } : {}) }, payload: body });

const subId = (accountId: string) => `sub_${accountId.slice(0, 8)}`;

const webhook = (event: object) =>
  ctx.app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": "good" }, payload: JSON.stringify(event) });

const subEvent = (o: { evt: string; type?: string; accountId: string; sub?: string; status: string; quantity: number }) => ({
  id: o.evt,
  type: o.type ?? "customer.subscription.updated",
  data: {
    object: {
      id: o.sub ?? subId(o.accountId),
      customer: "cus_biz",
      status: o.status,
      metadata: { telecom_account_id: o.accountId, kind: "plan", code: "business" },
      items: { data: [{ quantity: o.quantity, current_period_end: 1_800_000_000 }] },
    },
  },
});

async function withAdmin(businessId: string) {
  const admin = await makeUser(ctx, { ack: true });
  await ctx.repo.pbx.addMember({ businessId, userId: admin.user.id, email: "admin@test.ca", role: "admin", status: "active", invitedBy: null });
  return admin;
}

describe("PBX-01: seats change the Stripe quantity", () => {
  it("owner adds lines: prorated, idempotent Stripe update, then mirrored seats and pooled caps", async () => {
    const { business, owner } = await makeBusiness(ctx); // Stripe quantity 5
    const res = await seats(business.id, owner.auth, { count: 7 }, "click-0001");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ seats: 7, billingStatus: "active" });
    expect(billing.updateSeatQuantity).toHaveBeenCalledTimes(1);
    expect(billing.updateSeatQuantity).toHaveBeenCalledWith({
      subscriptionId: subId(business.telecomAccountId),
      quantity: 7,
      prorationBehavior: "create_prorations",
      idempotencyKey: `seats:${business.id}:${subId(business.telecomAccountId)}:5-7:click-0001`,
      locale: "fr-CA",
    });
    const sub = (await ctx.repo.listSubscriptions(business.telecomAccountId))[0]!;
    expect(sub.quantity).toBe(7);
    expect((await ctx.repo.pbx.getSeats(business.id)).seats).toBe(7);
    const usage = (await ctx.app.inject({ url: `/v1/business/${business.id}/usage`, headers: owner.auth })).json();
    expect(usage).toMatchObject({ seats: 7, pooled: { outboundMinutes: { cap: 7000 } } });
  });

  it("an admin removes lines; without a client key each request still gets its own idempotency key", async () => {
    const { business } = await makeBusiness(ctx);
    const admin = await withAdmin(business.id);
    expect((await seats(business.id, admin.auth, { count: 2 })).json()).toEqual({ seats: 2, billingStatus: "active" });
    const arg = billing.updateSeatQuantity.mock.calls[0]![0];
    expect(arg).toMatchObject({ quantity: 2, prorationBehavior: "create_prorations" });
    expect(arg.idempotencyKey).toMatch(new RegExp(`^seats:${business.id}:sub_[0-9a-f]{8}:5-2:[0-9a-f-]{36}$`));
    // Same count again: nothing to change in Stripe.
    expect((await seats(business.id, admin.auth, { count: 2 })).json().seats).toBe(2);
    expect(billing.updateSeatQuantity).toHaveBeenCalledTimes(1);
  });

  it("refuses fewer lines than extensions in use (409, French message), and a malformed idempotency key", async () => {
    const { business, owner } = await makeBusiness(ctx);
    await ctx.repo.pbx.createExtension({
      businessId: business.id,
      number: "102",
      userId: owner.user.id,
      displayName: "Direction",
      voicemail: { enabled: true, greeting: null },
      forwardToMobile: null,
      did: null,
      ringTimeoutS: 20,
    });
    const res = await seats(business.id, owner.auth, { count: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "seats_below_members", message: expect.stringContaining("2 postes utilisent une ligne") });
    expect((await seats(business.id, owner.auth, { count: 2 }, "bad key!")).statusCode).toBe(400);
    expect(billing.updateSeatQuantity).not.toHaveBeenCalled();
    expect((await seats(business.id, owner.auth, { count: 2 }, "click-0002")).json().seats).toBe(2);
  });

  it("a plain member cannot change lines", async () => {
    const { business, staff } = await makeBusiness(ctx);
    const res = await seats(business.id, staff.auth, { count: 9 });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("business_role_required");
    expect(billing.updateSeatQuantity).not.toHaveBeenCalled();
  });

  it("no live subscription yet: returns a Stripe Checkout URL with quantity = seats", async () => {
    const { business, owner } = await makeBusiness(ctx);
    const sub = (await ctx.repo.listSubscriptions(business.telecomAccountId))[0]!;
    await ctx.repo.upsertSubscription({ ...sub, status: "canceled" });
    const res = await seats(business.id, owner.auth, { count: 3, plan: "business_pro" });
    expect(res.json()).toEqual({ seats: 1, checkoutUrl: "https://checkout.stripe.test/cs_biz", billingStatus: "canceled" });
    expect(billing.updateSeatQuantity).not.toHaveBeenCalled();
    const arg = billing.createCheckout.mock.calls[0]![0];
    expect(arg).toMatchObject({ mode: "subscription", customerId: "cus_biz", line: { quantity: 3, recurring: "month" }, metadata: { telecom_account_id: business.telecomAccountId, kind: "plan", code: "business_pro" } });
    expect((await ctx.repo.getAccount(business.telecomAccountId))!.stripeCustomerId).toBe("cus_biz");
  });

  it("a Stripe failure changes nothing locally (502)", async () => {
    const { business, owner } = await makeBusiness(ctx);
    billing.updateSeatQuantity.mockRejectedValueOnce(new Error("stripe down"));
    const res = await seats(business.id, owner.auth, { count: 8 });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("billing_unavailable");
    expect((await ctx.repo.listSubscriptions(business.telecomAccountId))[0]!.quantity).toBe(5);
  });
});

describe("PBX-01: Stripe webhook is the source of truth", () => {
  it("customer.subscription.updated syncs the seat count and the pooled caps", async () => {
    const { business, owner } = await makeBusiness(ctx);
    const accountId = business.telecomAccountId;
    expect((await webhook(subEvent({ evt: "evt_s1", accountId, status: "active", quantity: 8 }))).statusCode).toBe(200);
    expect((await ctx.repo.pbx.getSeats(business.id)).seats).toBe(8);
    const usage = (await ctx.app.inject({ url: `/v1/business/${business.id}/usage`, headers: owner.auth })).json();
    expect(usage).toMatchObject({ seats: 8, pooled: { outboundMinutes: { cap: 8000 }, concurrentCalls: { cap: 16 } } });

    // A late event of an older, canceled subscription never overwrites the live one.
    await webhook(subEvent({ evt: "evt_s2", type: "customer.subscription.deleted", accountId, sub: "sub_old", status: "canceled", quantity: 2 }));
    expect((await ctx.repo.pbx.getSeats(business.id)).seats).toBe(8);
  });

  it("past_due = payment attention, calls continue; canceled = business outbound refused, inbound and 9-1-1 kept", async () => {
    const { business, owner, staff, ext, didNumber } = await makeBusiness(ctx);
    const accountId = business.telecomAccountId;
    await ctx.repo.pbx.upsertDidRoute({ businessId: business.id, phoneNumberId: didNumber.id, e164: didNumber.e164, target: { type: "extension", extensionId: ext.id } });
    const outbound = (sid: string, to: string) => twilioPost(ctx, "/webhooks/twilio/voice/outbound", { CallSid: sid, From: `client:${staff.user.id}`, To: to });
    const getBiz = async () => (await ctx.app.inject({ url: `/v1/business/${business.id}`, headers: owner.auth })).json();

    const before = await outbound("CA-out-1", "+14185550123");
    expect(before.body).toContain('callerId="+15145550100"');
    expect(before.body).toContain("<Number>+14185550123</Number>");

    await webhook(subEvent({ evt: "evt_p1", accountId, status: "past_due", quantity: 5 }));
    expect(await getBiz()).toMatchObject({ billingStatus: "past_due", seats: 5 });
    expect((await outbound("CA-out-2", "+14185550124")).body).toContain("<Number>+14185550124</Number>");

    await webhook(subEvent({ evt: "evt_c1", type: "customer.subscription.deleted", accountId, status: "canceled", quantity: 5 }));
    expect(await getBiz()).toMatchObject({ billingStatus: "canceled" });
    const refused = await outbound("CA-out-3", "+14185550125");
    expect(refused.body).toContain("abonnement MIMT Affaires est annulé");
    expect(refused.body).not.toContain("<Dial");

    // 9-1-1 always dials.
    const e = await outbound("CA-911", "911");
    expect(e.body).toContain("<Number>911</Number>");
    expect(e.body).not.toContain("<Say");
    // Inbound calls to the business number still ring the extension.
    const inbound = await twilioPost(ctx, "/webhooks/twilio/voice/inbound", { CallSid: "CA-in-1", From: "+14185550199", To: didNumber.e164 });
    expect(inbound.body).toContain(`<Client>${staff.user.id}</Client>`);
    expect(ctx.repo.auditLog.some((a) => a.action === "business.billing_synced" && (a.meta as { status?: string })?.status === "canceled")).toBe(true);
  });
});

describe("PBX-01: StripeGateway.updateSeatQuantity", () => {
  it("sets the plan item quantity and resizes the TPS/TVQ/9-1-1 items, prorated with the idempotency key", async () => {
    const gw = new StripeGateway("sk_test_placeholder", "whsec_placeholder");
    const item = (id: string, name: string, unit: number, quantity = 1) => ({
      id,
      quantity,
      price: { unit_amount: unit, recurring: { interval: "month" }, product: { id: `prod_${id}`, name } },
    });
    const stripe = {
      subscriptions: {
        retrieve: vi.fn(async () => ({
          id: "sub_9",
          items: { data: [item("si_plan", "MIMT Affaires", 2999, 5), item("si_tps", "TPS (5 %)", 750), item("si_tvq", "TVQ (9,975 %)", 1496), item("si_911", "Taxe municipale 9-1-1 du Québec", 275)] },
        })),
        update: vi.fn(async () => ({})),
      },
    };
    (gw as unknown as { stripe: typeof stripe }).stripe = stripe;
    await gw.updateSeatQuantity({ subscriptionId: "sub_9", quantity: 7, prorationBehavior: "create_prorations", idempotencyKey: "seats:k", locale: "fr-CA" });
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_9", { expand: ["items.data.price.product"] });
    const [id, params, opts] = stripe.subscriptions.update.mock.calls[0] as unknown as [string, { items: unknown[]; proration_behavior: string }, object];
    expect(id).toBe("sub_9");
    expect(opts).toEqual({ idempotencyKey: "seats:k" });
    expect(params.proration_behavior).toBe("create_prorations");
    const priced = (unit: number, product: string) => ({ quantity: 1, price_data: { currency: "cad", product, unit_amount: unit, recurring: { interval: "month" } } });
    expect(params.items).toEqual([
      { id: "si_plan", quantity: 7 },
      { id: "si_tps", ...priced(1050, "prod_si_tps") },
      { id: "si_tvq", ...priced(2094, "prod_si_tvq") },
      { id: "si_911", ...priced(385, "prod_si_911") },
    ]);
  });
});
