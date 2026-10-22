import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { BillingGateway } from "../src/gateways/billing.js";
import { fakeTwilio, makeUser, setup, type Ctx } from "./helpers.js";

let ctx: Ctx;
let twilio: ReturnType<typeof fakeTwilio>;
let billing: BillingGateway & { [K in keyof BillingGateway]: ReturnType<typeof vi.fn> };
let clock = new Date("2026-10-20T12:00:00Z");

const NUMBERS = [
  { e164: "+15145550101", locality: "Montréal", region: "QC" },
  { e164: "+15145550102", locality: "Montréal", region: "QC" },
  { e164: "+15145550103", locality: "Montréal", region: "QC" },
];

beforeEach(async () => {
  clock = new Date("2026-10-20T12:00:00Z");
  twilio = fakeTwilio();
  twilio.searchLocalNumbers.mockImplementation((async ({ areaCode }: { areaCode?: string }) => (areaCode === "514" ? NUMBERS : [])) as never);
  ctx = await setup({ twilio, now: () => clock });
  billing = {
    createCustomer: vi.fn(async () => "cus_1"),
    createCheckout: vi.fn(async () => ({ id: "cs_hold", url: "https://checkout.stripe.test/cs_hold" })),
    createPortal: vi.fn(),
    constructEvent: vi.fn((raw: Buffer) => JSON.parse(raw.toString("utf8")) as Stripe.Event),
    retrieveSubscription: vi.fn(async () => ({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      metadata: { telecom_account_id: holdAccount, kind: "plan", code: "premium" },
      items: { data: [{ quantity: 1, current_period_end: 1_900_000_000 }] },
    })),
  } as never;
  ctx.deps.billing = billing;
});
afterEach(() => ctx.app.close());

let holdAccount = "";
const search = (q: string, ip = "203.0.113.5") => ctx.app.inject({ url: `/v1/public/numbers/search?q=${encodeURIComponent(q)}`, remoteAddress: ip });
const hold = (e164: string, ip = "203.0.113.5") => ctx.app.inject({ method: "POST", url: "/v1/public/numbers/holds", payload: { e164 }, remoteAddress: ip });
const webhook = (event: object) =>
  ctx.app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": "good" }, payload: JSON.stringify(event) });

describe("live number picker: public search", () => {
  it("finds real numbers by area code or city without sign-in", async () => {
    const byCode = await search("514");
    expect(byCode.statusCode).toBe(200);
    expect(byCode.json()).toMatchObject({ areaCodes: ["514"], numbers: NUMBERS });
    const byCity = await search("Montréal");
    expect(byCity.json().label.fr).toBe("Montréal");
    expect(byCity.json().numbers.map((n: { e164: string }) => n.e164)).toEqual(NUMBERS.map((n) => n.e164));
  });

  it("caches the carrier search for 60 seconds per area code", async () => {
    await search("514");
    await search("514");
    expect(twilio.searchLocalNumbers).toHaveBeenCalledTimes(1);
    clock = new Date(clock.getTime() + 61_000);
    await search("514");
    expect(twilio.searchLocalNumbers).toHaveBeenCalledTimes(2);
  });

  it("one failing area code does not hide the others; all failing answers 503", async () => {
    twilio.searchLocalNumbers.mockImplementation((async ({ areaCode }: { areaCode?: string }) => {
      if (areaCode === "514") throw new Error("carrier down");
      return areaCode === "438" ? [{ e164: "+14385550101", locality: "Montréal", region: "QC" }] : [];
    }) as never);
    const res = await search("Montréal");
    expect(res.statusCode).toBe(200);
    expect(res.json().numbers.map((n: { e164: string }) => n.e164)).toEqual(["+14385550101"]);
    twilio.searchLocalNumbers.mockImplementation((async () => {
      throw new Error("carrier down");
    }) as never);
    expect((await search("418")).json().error).toBe("carrier_unavailable");
  });

  it("offers 438 de Montréal when 514 is sold out, and says so", async () => {
    twilio.searchLocalNumbers.mockImplementation((async ({ areaCode }: { areaCode?: string }) =>
      areaCode === "438" ? [{ e164: "+14385550123", locality: "Montréal", region: "QC" }] : []) as never);
    const res = (await search("514", "198.51.100.70")).json();
    expect(res.numbers.map((n: { e164: string }) => n.e164)).toEqual(["+14385550123"]);
    expect(res.fallback).toEqual({
      from: "514",
      to: "438",
      message: { fr: "Indicatif 514 épuisé — voici des 438 de Montréal.", en: "Area code 514 is sold out — here are 438 numbers from Montréal." },
    });
  });

  it("walks the neighbours in order: 418 sold out → 581", async () => {
    twilio.searchLocalNumbers.mockImplementation((async ({ areaCode }: { areaCode?: string }) =>
      areaCode === "581" ? [{ e164: "+15815550123", locality: "Québec", region: "QC" }] : []) as never);
    const res = (await search("418", "198.51.100.71")).json();
    expect(res.fallback).toMatchObject({ from: "418", to: "581" });
    expect(res.fallback.message.fr).toBe("Indicatif 418 épuisé — voici des 581 de Québec.");
  });

  it("no fallback when the asked code has numbers", async () => {
    const res = (await search("514", "198.51.100.72")).json();
    expect(res.fallback).toBeUndefined();
    expect(res.numbers.length).toBeGreaterThan(0);
  });

  it("a carrier error on the asked code still falls back, and an all-failed search tells the carrier code", async () => {
    twilio.searchLocalNumbers.mockImplementation((async ({ areaCode }: { areaCode?: string }) => {
      if (areaCode === "416") throw Object.assign(new Error("boom"), { code: 20404 });
      return areaCode === "437" ? [{ e164: "+14375550123", locality: "Toronto", region: "ON" }] : [];
    }) as never);
    expect((await search("416", "198.51.100.73")).json().fallback).toMatchObject({ from: "416", to: "437" });
    twilio.searchLocalNumbers.mockImplementation((async () => {
      throw Object.assign(new Error("auth"), { code: 20003 });
    }) as never);
    const down = (await search("613", "198.51.100.74")).json();
    expect(down.error).toBe("carrier_unavailable");
    expect(down.message).toContain("code 20003");
  });

  it("rejects places that are not Canadian", async () => {
    expect((await search("212")).json().error).toBe("unknown_place");
    expect((await search("Paris")).json().error).toBe("unknown_place");
  });

  it("is rate limited per visitor", async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await search("514", "198.51.100.9")).statusCode;
    expect(last).toBe(429);
    expect((await search("514", "198.51.100.10")).statusCode).toBe(200);
  });

  it("hides numbers MIMT already assigns or someone holds", async () => {
    await makeUser(ctx, { number: "+15145550101" });
    await hold("+15145550102", "198.51.100.20");
    const res = await search("514", "198.51.100.21");
    expect(res.json().numbers.map((n: { e164: string }) => n.e164)).toEqual(["+15145550103"]);
  });
});

describe("live number picker: holds", () => {
  it("holds a number for 10 minutes and gives the token once", async () => {
    const res = await hold("+15145550101");
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ e164: "+15145550101", status: "held", expiresAt: "2026-10-20T12:10:00.000Z" });
    expect(body.token).toMatch(/^[\w-]{30,}$/);

    const peek = await ctx.app.inject({ url: `/v1/public/numbers/holds/${body.id}`, headers: { "x-hold-token": body.token } });
    expect(peek.json()).toMatchObject({ status: "held" });
    expect(peek.json().token).toBeUndefined();
    expect((await ctx.app.inject({ url: `/v1/public/numbers/holds/${body.id}`, headers: { "x-hold-token": "wrong-token-wrong-token" } })).statusCode).toBe(404);

    // Stored as a hash only.
    const row = [...(ctx.repo.numberHolds as unknown as { rows: Map<string, { tokenHash: string }> }).rows.values()][0]!;
    expect(row.tokenHash).not.toContain(body.token);
  });

  it("refuses a number someone else holds, frees it after 10 minutes", async () => {
    await hold("+15145550101", "198.51.100.30");
    expect((await hold("+15145550101", "198.51.100.31")).json().error).toBe("number_held");
    clock = new Date(clock.getTime() + 10 * 60_000 + 1);
    expect((await hold("+15145550101", "198.51.100.31")).statusCode).toBe(201);
  });

  it("keeps one live hold per visitor: picking another number lets the first go", async () => {
    await hold("+15145550101");
    await hold("+15145550102");
    expect((await hold("+15145550101", "198.51.100.40")).statusCode).toBe(201);
  });

  it("releases a hold on request", async () => {
    const h = (await hold("+15145550101")).json();
    const del = await ctx.app.inject({ method: "DELETE", url: `/v1/public/numbers/holds/${h.id}`, headers: { "x-hold-token": h.token } });
    expect(del.statusCode).toBe(204);
    expect((await hold("+15145550101", "198.51.100.50")).statusCode).toBe(201);
  });

  it("refuses non-Canadian numbers and numbers already assigned", async () => {
    expect((await hold("+12125550101")).json().error).toBe("canadian_numbers_only");
    await makeUser(ctx, { number: "+15145550103" });
    expect((await hold("+15145550103")).json().error).toBe("number_unavailable");
  });
});

describe("live number picker: pay, then the number is provisioned", () => {
  it("checkout carries the hold; the paid webhook buys the number once", async () => {
    const u = await makeUser(ctx, { e911: true, ack: true });
    holdAccount = u.account.id;
    const h = (await hold("+15145550102")).json();

    const co = await ctx.app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: u.auth,
      payload: { plan: "premium", numberHold: { id: h.id, token: h.token } },
    });
    expect(co.statusCode).toBe(200);
    const arg = billing.createCheckout.mock.calls[0]![0];
    expect(arg.metadata).toMatchObject({ number_hold_id: h.id, code: "premium" });
    // The hold follows the Stripe session (30 min minimum).
    expect(arg.expiresAt.getTime() - clock.getTime()).toBeGreaterThanOrEqual(30 * 60_000);
    const status = await ctx.app.inject({ url: `/v1/public/numbers/holds/${h.id}`, headers: { "x-hold-token": h.token } });
    expect(status.json().status).toBe("checkout");

    const completed = {
      id: "evt_hold_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_hold", mode: "subscription", subscription: "sub_1", customer: "cus_1", metadata: { telecom_account_id: u.account.id, code: "premium", number_hold_id: h.id } } },
    };
    expect((await webhook(completed)).statusCode).toBe(200);
    expect(twilio.purchaseNumber).toHaveBeenCalledTimes(1);
    expect(twilio.purchaseNumber).toHaveBeenCalledWith(expect.objectContaining({ e164: "+15145550102", emergencyAddressSid: "ADtest" }));
    expect((await ctx.repo.getNumberByE164("+15145550102"))?.telecomAccountId).toBe(u.account.id);
    expect((await ctx.repo.numberHolds.get(h.id))?.status).toBe("converted");

    await webhook({ ...completed, id: "evt_hold_2" });
    expect(twilio.purchaseNumber).toHaveBeenCalledTimes(1);
  });

  it("needs the 9-1-1 address before paying for a number", async () => {
    const u = await makeUser(ctx);
    const h = (await hold("+15145550101")).json();
    const co = await ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: u.auth, payload: { plan: "premium", numberHold: { id: h.id, token: h.token } } });
    expect(co.json().error).toBe("e911_address_required");
    expect(billing.createCheckout).not.toHaveBeenCalled();
  });

  it("refuses an expired hold or a wrong token", async () => {
    const u = await makeUser(ctx, { e911: true, ack: true });
    const h = (await hold("+15145550101")).json();
    const wrong = await ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: u.auth, payload: { plan: "premium", numberHold: { id: h.id, token: "x".repeat(32) } } });
    expect(wrong.json().error).toBe("hold_not_found");
    clock = new Date(clock.getTime() + 11 * 60_000);
    const late = await ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: u.auth, payload: { plan: "premium", numberHold: { id: h.id, token: h.token } } });
    expect(late.json().error).toBe("hold_expired");
  });

  it("an abandoned checkout gives the number back", async () => {
    const u = await makeUser(ctx, { e911: true, ack: true });
    const h = (await hold("+15145550101")).json();
    await ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: u.auth, payload: { plan: "premium", numberHold: { id: h.id, token: h.token } } });
    await webhook({ id: "evt_exp", type: "checkout.session.expired", data: { object: { id: "cs_hold", metadata: { number_hold_id: h.id } } } });
    expect((await ctx.repo.numberHolds.get(h.id))?.status).toBe("released");
    expect((await hold("+15145550101", "198.51.100.60")).statusCode).toBe(201);
  });

  it("if the number was taken meanwhile, the plan stays and the hold is marked failed", async () => {
    const u = await makeUser(ctx, { e911: true, ack: true });
    holdAccount = u.account.id;
    const h = (await hold("+15145550101")).json();
    await ctx.app.inject({ method: "POST", url: "/v1/billing/checkout", headers: u.auth, payload: { plan: "premium", numberHold: { id: h.id, token: h.token } } });
    twilio.purchaseNumber.mockRejectedValueOnce(Object.assign(new Error("not available"), { status: 400 }));
    await webhook({
      id: "evt_taken",
      type: "checkout.session.completed",
      data: { object: { id: "cs_hold", mode: "subscription", subscription: "sub_1", customer: "cus_1", metadata: { telecom_account_id: u.account.id, code: "premium", number_hold_id: h.id } } },
    });
    expect((await ctx.repo.numberHolds.get(h.id))?.status).toBe("failed");
    expect((await ctx.app.inject({ url: "/v1/me", headers: u.auth })).json().account.plan).toBe("premium");
  });
});
