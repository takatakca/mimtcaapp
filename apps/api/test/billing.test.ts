import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { BillingGateway } from "../src/gateways/billing.js";
import { makeUser, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
let billing: BillingGateway & { [K in keyof BillingGateway]: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  ctx = await setup();
  billing = {
    createCustomer: vi.fn(async () => "cus_1"),
    createCheckout: vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })),
    createPortal: vi.fn(async () => "https://billing.stripe.test/p"),
    // Stand-in for Stripe's HMAC check: the body must arrive raw and the signature must match.
    constructEvent: vi.fn((raw: Buffer, sig: string) => {
      if (!Buffer.isBuffer(raw) || sig !== "good") throw new Error("bad signature");
      return JSON.parse(raw.toString("utf8")) as Stripe.Event;
    }),
    retrieveSubscription: vi.fn(),
  } as never;
  ctx.deps.billing = billing;
});
afterEach(() => ctx.app.close());

const webhook = (event: object, sig = "good") =>
  ctx.app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": sig }, payload: JSON.stringify(event) });

const subscriptionEvent = (accountId: string, status: string, id = "evt_1") => ({
  id,
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_1",
      customer: "cus_1",
      status,
      metadata: { telecom_account_id: accountId, kind: "plan", code: "premium" },
      items: { data: [{ quantity: 1, current_period_end: 1_800_000_000 }] },
    },
  },
});

describe("billing", () => {
  it("creates a CAD checkout session for a plan with a tax note", async () => {
    const u = await makeUser(ctx);
    const res = await ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: u.auth, payload: { plan: "premium" } });
    expect(res.json()).toEqual({ checkoutUrl: "https://checkout.stripe.test/cs_1", sessionId: "cs_1" });
    const arg = billing.createCheckout.mock.calls[0]![0];
    expect(arg).toMatchObject({ mode: "subscription", customerId: "cus_1", line: { unitAmountCents: 1999, recurring: "month" }, metadata: { code: "premium" } });
    expect(arg.line.description).toMatch(/avant taxes/);
    expect(arg.taxLines?.map((line: { name: string; unitAmountCents: number }) => [line.name, line.unitAmountCents])).toEqual([
      ["TPS (5 %)", 100],
      ["TVQ (9,975 %)", 199],
      ["Taxe municipale 9-1-1 du Québec", 55],
    ]);
  });

  it("limits international credit on the free plan (parity P1: small top-ups only)", async () => {
    const u = await makeUser(ctx);
    const big = await ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: u.auth, payload: { addon: "intl_credit", amountCents: 5000 } });
    expect(big.json().error).toBe("intl_topup_too_large");
    expect(billing.createCheckout).not.toHaveBeenCalled();
  });

  it("verifies the Stripe signature on the raw body", async () => {
    const u = await makeUser(ctx);
    expect((await webhook(subscriptionEvent(u.account.id, "active"), "bad")).statusCode).toBe(400);
  });

  it("applies subscription events to entitlements, once, and tells TAKATAK", async () => {
    const u = await makeUser(ctx);
    expect((await webhook(subscriptionEvent(u.account.id, "active"))).statusCode).toBe(200);
    const me = await ctx.app.inject({ url: "/v1/me", headers: u.auth });
    expect(me.json().account.plan).toBe("premium");
    expect((await ctx.repo.listEntitlements(u.account.id)).map((e) => e.feature)).toContain("vm_transcription");
    expect(ctx.repo.outbox.find((e) => e.eventType === "entitlement.updated")?.payload).toMatchObject({ plan: "premium" });

    expect((await webhook(subscriptionEvent(u.account.id, "active"))).json()).toMatchObject({ duplicate: true });

    await webhook(subscriptionEvent(u.account.id, "canceled", "evt_2"));
    expect((await ctx.app.inject({ url: "/v1/me", headers: u.auth })).json().account.plan).toBe("free");
  });

  it("credits prepaid international balance and grants the entitlement", async () => {
    const u = await makeUser(ctx);
    await webhook({
      id: "evt_3",
      type: "checkout.session.completed",
      data: { object: { id: "cs_9", mode: "payment", payment_status: "paid", customer: "cus_1", amount_subtotal: 1000, metadata: { telecom_account_id: u.account.id, code: "intl_credit" } } },
    });
    expect((await ctx.repo.getAccount(u.account.id))!.intlCreditCents).toBe(1000);
    expect((await ctx.repo.listEntitlements(u.account.id)).some((e) => e.feature === "intl_calling")).toBe(true);
  });
});
