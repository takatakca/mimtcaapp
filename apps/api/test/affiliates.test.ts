// « Programme d'agents affiliés » (docs/MIMT-AFFILIATES.md): public application, admin workflow, DocuSign (mocked),
// attribution, commission ledger from Stripe webhooks, dashboard, payouts.
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { CONTRACT_EN, CONTRACT_FR } from "../src/affiliates/contractTemplate.js";
import { CONTRACT_TABS, connectSignature, DocuSignGateway, docusignAuthHost, parseConnectEvent, type ContractGateway } from "../src/gateways/docusign.js";
import type { BillingGateway } from "../src/gateways/billing.js";
import type { MemoryRepository } from "../src/repo/memory.js";
import { contractTabs, fillContract, invoiceNetRevenueCents, normalizeNanpPhone, runAffiliateMaintenance } from "../src/services/affiliates.js";
import { makeUser, setup, type Ctx } from "./helpers.js";

const DAY = 86_400_000;
let ctx: Ctx;
let repo: MemoryRepository;
let clock: Date;
let billing: BillingGateway & { [K in keyof BillingGateway]-?: ReturnType<typeof vi.fn> };
let contracts: ContractGateway & { sendContract: ReturnType<typeof vi.fn> };
let adminAuth: Record<string, string>;
const HMAC_KEY = "test-connect-hmac-key";

beforeEach(async () => {
  clock = new Date("2026-11-01T15:00:00Z");
  ctx = await setup({ now: () => clock, config: { DOCUSIGN_CONNECT_HMAC_KEY: HMAC_KEY } });
  repo = ctx.repo;
  billing = {
    createCustomer: vi.fn(async () => "cus_1"),
    createCheckout: vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })),
    createPortal: vi.fn(),
    constructEvent: vi.fn((raw: Buffer) => JSON.parse(raw.toString("utf8")) as Stripe.Event),
    retrieveSubscription: vi.fn(),
    paymentFingerprint: vi.fn(async () => null),
    invoiceIdForPayment: vi.fn(async (pi: string) => pi.replace("pi_", "in_")),
  } as never;
  ctx.deps.billing = billing;
  contracts = { sendContract: vi.fn(async () => ({ envelopeId: "env-123" })) };
  const admin = await makeUser(ctx);
  ctx.deps.config.CATALOG_ADMIN_USER_IDS.push(admin.user.id);
  adminAuth = admin.auth;
});
afterEach(() => ctx.app.close());

const application = (over: Record<string, unknown> = {}) => ({
  legalName: "Julie Tremblay",
  businessName: "Studio JT",
  email: "Julie@Example.ca",
  phone: "514 555-0142",
  province: "QC",
  channels: ["social", "video"],
  audienceSize: "1k_10k",
  gstNumber: "123456789RT0001",
  qstNumber: "1234567890TQ0001",
  locale: "fr-CA",
  consents: { privacyNotice: true, privacyNoticeVersion: "2026-10-affilies-v1", marketing: false },
  adult: true,
  website: "",
  elapsedMs: 45_000,
  ...over,
});
const apply = (body: object, ip = "203.0.113.7") =>
  ctx.app.inject({ method: "POST", url: "/v1/public/affiliates/applications", payload: body, remoteAddress: ip });
const post = (url: string, payload: object = {}, headers = adminAuth) => ctx.app.inject({ method: "POST", url, payload, headers });

let evt = 0;
const stripe = (type: string, object: object) =>
  ctx.app.inject({
    method: "POST",
    url: "/webhooks/stripe",
    headers: { "content-type": "application/json", "stripe-signature": "sig" },
    payload: JSON.stringify({ id: `evt_aff_${++evt}`, type, data: { object } }),
  });
/** Premium 29,99 $ + TPS 1,50 $ + TVQ 2,99 $ + 9-1-1 0,55 $. */
const invoicePaid = (accountId: string, id: string, paidAt: Date, amountPaid = 3503) =>
  stripe("invoice.paid", {
    id,
    customer: "cus_1",
    amount_paid: amountPaid,
    status_transitions: { paid_at: Math.floor(paidAt.getTime() / 1000) },
    lines: {
      data: [
        { amount: 2999, description: "1 × MIMT Premium (at $29.99 / month)" },
        { amount: 150, description: "1 × TPS (5 %) (at $1.50 / month)" },
        { amount: 299, description: "1 × TVQ (9,975 %) (at $2.99 / month)" },
        { amount: 55, description: "1 × Taxe municipale 9-1-1 (at $0.55 / month)" },
      ],
    },
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_x", metadata: { telecom_account_id: accountId, kind: "plan", code: "premium" } } },
  });

/** Applies, approves, sends the contract (manual) and marks it signed. Returns the affiliate id and code. */
async function activeAffiliate(over: Record<string, unknown> = {}) {
  expect((await apply(application(over))).statusCode).toBe(202);
  const [row] = await repo.affiliates.list({ status: "applied", limit: 1 });
  const id = row!.id;
  const approved = await post(`/v1/admin/affiliates/${id}/approve`, {});
  expect(approved.statusCode).toBe(200);
  expect((await post(`/v1/admin/affiliates/${id}/contract`)).json().mode).toBe("manual");
  expect((await post(`/v1/admin/affiliates/${id}/signed`)).json().status).toBe("active");
  return { id, code: approved.json().code as string };
}

describe("public application form", () => {
  it("stores an application with personal fields encrypted, and answers the same for a duplicate email", async () => {
    const res = await apply(application());
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ received: true });
    const rows = await repo.affiliates.list({ limit: 10 });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ status: "applied", province: "QC", channels: ["social", "video"], caslConsent: false, adultAttested: true, code: null });
    expect(row.piiEnc).not.toMatch(/julie|Tremblay|555/i);
    expect(JSON.parse(ctx.deps.cipher.decrypt(row.piiEnc))).toMatchObject({ email: "julie@example.ca", phone: "+15145550142", gstNumber: "123456789RT0001" });
    const again = await apply(application({ legalName: "Autre" }), "203.0.113.8");
    expect(again.statusCode).toBe(202);
    expect(await repo.affiliates.list({ limit: 10 })).toHaveLength(1);
    expect(repo.auditLog.filter((a) => a.action === "affiliate.applied")).toHaveLength(1);
    expect(JSON.stringify(repo.auditLog)).not.toMatch(/julie/i);
  });

  it("honeypot and instant posts look accepted but store nothing", async () => {
    expect((await apply(application({ website: "http://spam.example" }))).statusCode).toBe(202);
    expect((await apply(application({ elapsedMs: 200 }), "203.0.113.9")).statusCode).toBe(202);
    expect(await repo.affiliates.list({ limit: 10 })).toHaveLength(0);
  });

  it("requires the privacy notice and the 18+ attestation; CASL consent is optional", async () => {
    expect((await apply(application({ consents: { privacyNotice: false, marketing: true } }))).statusCode).toBe(400);
    expect((await apply(application({ adult: false }), "198.51.100.2")).statusCode).toBe(400);
    expect((await apply(application({ phone: "12" }), "198.51.100.3")).statusCode).toBe(400);
    expect((await apply(application({ phone: "+33 1 23 45 67 89" }), "198.51.100.4")).statusCode).toBe(400);
    expect((await apply(application({ gstNumber: "nope" }), "198.51.100.5")).statusCode).toBe(400);
    const ok = await apply(application({ consents: { privacyNotice: true, marketing: true }, gstNumber: "", qstNumber: undefined }), "198.51.100.6");
    expect(ok.statusCode).toBe(202);
    expect((await repo.affiliates.list({ limit: 1 }))[0]!.caslConsent).toBe(true);
  });

  it("limits each IP to 5 applications per hour", async () => {
    for (let i = 0; i < 5; i++) expect((await apply(application({ email: `a${i}@example.ca` }), "192.0.2.50")).statusCode).toBe(202);
    expect((await apply(application({ email: "a6@example.ca" }), "192.0.2.50")).statusCode).toBe(429);
  });
});

describe("admin workflow", () => {
  it("is for MIMT admins only", async () => {
    const u = await makeUser(ctx);
    expect((await ctx.app.inject({ url: "/v1/admin/affiliates", headers: u.auth })).statusCode).toBe(403);
    expect((await ctx.app.inject({ url: "/v1/admin/affiliates" })).statusCode).toBe(401);
    expect((await ctx.app.inject({ url: "/v1/admin/affiliates", headers: adminAuth })).statusCode).toBe(200);
  });

  it("approve gives a code and the default terms; terms can change before signature; reject closes it", async () => {
    await apply(application());
    const id = (await repo.affiliates.list({ limit: 1 }))[0]!.id;
    const list = (await ctx.app.inject({ url: "/v1/admin/affiliates?status=applied", headers: adminAuth })).json();
    expect(list.affiliates[0]).toMatchObject({ id, legalName: "Julie Tremblay", email: "julie@example.ca", phone: "+15145550142" });
    const approved = (await post(`/v1/admin/affiliates/${id}/approve`, { commissionBps: 1500 })).json();
    expect(approved.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(approved.terms).toEqual({ commissionBps: 1500, durationMonths: 12, payoutThresholdCents: 5000 });
    const terms = await ctx.app.inject({ method: "PUT", url: `/v1/admin/affiliates/${id}/terms`, headers: adminAuth, payload: { commissionBps: 2500, durationMonths: 6, payoutThresholdCents: 2500 } });
    expect(terms.json().terms).toEqual({ commissionBps: 2500, durationMonths: 6, payoutThresholdCents: 2500 });
    const badTerms = await ctx.app.inject({ method: "PUT", url: `/v1/admin/affiliates/${id}/terms`, headers: adminAuth, payload: { commissionBps: 9000, durationMonths: 6, payoutThresholdCents: 2500 } });
    expect(badTerms.statusCode).toBe(400);
    expect((await post(`/v1/admin/affiliates/${id}/approve`)).statusCode).toBe(409);
    expect((await post(`/v1/admin/affiliates/${id}/signed`)).statusCode).toBe(409); // no contract sent yet
    expect((await post(`/v1/admin/affiliates/${id}/reject`, { reason: "audience" })).json().status).toBe("rejected");
  });

  it("without DocuSign, « send contract » returns the filled French contract (manual mode), then « mark signed » activates", async () => {
    await apply(application());
    const id = (await repo.affiliates.list({ limit: 1 }))[0]!.id;
    await post(`/v1/admin/affiliates/${id}/approve`, { commissionBps: 1250, durationMonths: 18, payoutThresholdCents: 7500 });
    const sent = (await post(`/v1/admin/affiliates/${id}/contract`)).json();
    expect(sent.mode).toBe("manual");
    expect(sent.affiliate.status).toBe("contract_sent");
    expect(sent.contractText).toMatch(/^CONTRAT D'AGENT AFFILIÉ MIMT/);
    expect(sent.contractText).toContain("ET : Julie Tremblay");
    expect(sent.contractText).toContain("4.1 Taux : 12,5 % des revenus nets");
    expect(sent.contractText).toContain("pendant 18 mois");
    expect(sent.contractText).toContain("au moins 75,00 $");
    expect(sent.contractText).toContain("Date d'entrée en vigueur : 2026-11-01.");
    expect(sent.contractText).toContain("Brouillon — à faire réviser par un avocat avant usage.");
    expect(sent.contractText).not.toContain("{{");
    expect(sent.contractText).not.toContain("AGREEMENT"); // French only for a French-speaking affiliate
    const signed = (await post(`/v1/admin/affiliates/${id}/signed`, { signedAt: "2026-11-01T14:00:00Z" })).json();
    expect(signed).toMatchObject({ status: "active", signedAt: "2026-11-01T14:00:00.000Z" });
  });

  it("an English-speaking affiliate gets the French version first, then the translation", async () => {
    await apply(application({ locale: "en-CA" }));
    const id = (await repo.affiliates.list({ limit: 1 }))[0]!.id;
    await post(`/v1/admin/affiliates/${id}/approve`);
    const text = (await post(`/v1/admin/affiliates/${id}/contract`)).json().contractText as string;
    expect(text.indexOf("CONTRAT D'AGENT AFFILIÉ MIMT")).toBe(0);
    expect(text.indexOf("MIMT AFFILIATE AGENT AGREEMENT")).toBeGreaterThan(100);
    expect(text).toContain("at least $50.00");
  });

  it("with DocuSign, sends an envelope with the terms as tabs; a signed Connect message activates the affiliate", async () => {
    ctx.deps.contracts = contracts;
    await apply(application());
    const id = (await repo.affiliates.list({ limit: 1 }))[0]!.id;
    await post(`/v1/admin/affiliates/${id}/approve`);
    const sent = (await post(`/v1/admin/affiliates/${id}/contract`)).json();
    expect(sent).toMatchObject({ mode: "docusign", envelopeId: "env-123", affiliate: { status: "contract_sent", contractMode: "docusign" } });
    expect(contracts.sendContract).toHaveBeenCalledWith({
      affiliateId: id,
      signerName: "Julie Tremblay",
      signerEmail: "julie@example.ca",
      locale: "fr-CA",
      tabs: { affiliate_legal_name: "Julie Tremblay", commission_pct: "20", duration_months: "12", payout_threshold: "50,00", effective_date: "2026-11-01" },
    });

    const body = JSON.stringify({ event: "envelope-completed", data: { envelopeId: "env-123", envelopeSummary: { status: "completed" } } });
    const connect = (sig: string) =>
      ctx.app.inject({ method: "POST", url: "/webhooks/docusign", headers: { "content-type": "application/json", "x-docusign-signature-1": sig }, payload: body });
    expect((await connect("forged")).statusCode).toBe(401);
    expect((await repo.affiliates.get(id))!.status).toBe("contract_sent");
    const ok = await connect(connectSignature(HMAC_KEY, body));
    expect(ok.json()).toEqual({ received: true, outcome: "activated" });
    expect((await repo.affiliates.get(id))!.status).toBe("active");
    expect((await connect(connectSignature(HMAC_KEY, body))).json().outcome).toBe("ignored"); // retry: no change
  });

  it("a declined envelope puts the affiliate back to approved", async () => {
    ctx.deps.contracts = contracts;
    await apply(application());
    const id = (await repo.affiliates.list({ limit: 1 }))[0]!.id;
    await post(`/v1/admin/affiliates/${id}/approve`);
    await post(`/v1/admin/affiliates/${id}/contract`);
    const body = JSON.stringify({ envelopeId: "env-123", status: "Declined" });
    const res = await ctx.app.inject({ method: "POST", url: "/webhooks/docusign", headers: { "content-type": "application/json", "x-docusign-signature-1": connectSignature(HMAC_KEY, body) }, payload: body });
    expect(res.json().outcome).toBe("reset");
    expect((await repo.affiliates.get(id))!).toMatchObject({ status: "approved", envelopeId: null, statusReason: "contract_declined" });
  });

  it("the Connect webhook answers 503 without its HMAC key", async () => {
    ctx.deps.config.DOCUSIGN_CONNECT_HMAC_KEY = undefined;
    const res = await ctx.app.inject({ method: "POST", url: "/webhooks/docusign", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(res.statusCode).toBe(503);
  });
});

describe("attribution and commissions", () => {
  async function referredCustomer(code: string, touchedAt?: Date) {
    const u = await makeUser(ctx);
    const res = await post("/v1/affiliates/attribution", { code, ...(touchedAt ? { touchedAt: touchedAt.toISOString() } : {}) }, u.auth);
    expect(res.statusCode).toBe(200);
    return { ...u, attributed: res.json().attributed as boolean };
  }

  it("first touch wins, and a code older than 60 days or of an inactive affiliate is not recorded", async () => {
    const a = await activeAffiliate();
    const b = await activeAffiliate({ email: "b@example.ca", phone: "438 555-0100" });
    const c = await referredCustomer(a.code.toLowerCase(), new Date(clock.getTime() - 2 * DAY));
    expect(c.attributed).toBe(true);
    expect((await post("/v1/affiliates/attribution", { code: b.code }, c.auth)).json().attributed).toBe(false);
    expect((await repo.affiliates.getReferral(c.account.id))!).toMatchObject({ affiliateId: a.id, source: "signup" });
    expect((await referredCustomer(a.code, new Date(clock.getTime() - 61 * DAY))).attributed).toBe(false);
    expect((await referredCustomer("ZZZZZZZZ")).attributed).toBe(false);
    await post(`/v1/admin/affiliates/${b.id}/status`, { status: "suspended" });
    expect((await referredCustomer(b.code)).attributed).toBe(false);
  });

  it("no self-referral: the affiliate's own phone is refused and logged as fraud", async () => {
    const a = await activeAffiliate();
    const self = await makeUser(ctx);
    await repo.updateUser(self.user.id, { phoneE164: "+15145550142" });
    expect((await post("/v1/affiliates/attribution", { code: a.code }, self.auth)).json().attributed).toBe(false);
    expect(repo.fraudEvents.some((f) => f.rule === "affiliate_self_referral")).toBe(true);
  });

  it("an existing paying customer cannot be attributed", async () => {
    const a = await activeAffiliate();
    const u = await makeUser(ctx);
    await repo.upsertSubscription({ telecomAccountId: u.account.id, kind: "plan", code: "lock", quantity: 1, stripeSubscriptionId: "sub_old", status: "active", source: "stripe", currentPeriodEnd: null });
    expect((await post("/v1/affiliates/attribution", { code: a.code }, u.auth)).json().attributed).toBe(false);
  });

  it("the code sent with Stripe Checkout is recorded before the payment", async () => {
    const a = await activeAffiliate();
    const u = await makeUser(ctx);
    const res = await post("/v1/billing/checkout", { plan: "premium", affiliate: { code: a.code, touchedAt: new Date(clock.getTime() - DAY).toISOString() } }, u.auth);
    expect(res.statusCode).toBe(200);
    expect((await repo.affiliates.getReferral(u.account.id))!).toMatchObject({ affiliateId: a.id, source: "checkout" });
    // A bad code never blocks the checkout.
    const v = await makeUser(ctx);
    expect((await post("/v1/billing/checkout", { plan: "premium", affiliate: { code: "NOPE1234" } }, v.auth)).statusCode).toBe(200);
  });

  it("a paid invoice earns the percentage of net revenue (taxes out), once per invoice, pending for 30 days", async () => {
    const a = await activeAffiliate();
    const c = await referredCustomer(a.code);
    expect((await invoicePaid(c.account.id, "in_1", clock)).statusCode).toBe(200);
    expect((await invoicePaid(c.account.id, "in_1", clock)).statusCode).toBe(200); // another event, same invoice
    const ledger = await repo.affiliates.listCommissions(a.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ netRevenueCents: 2999, commissionBps: 2000, commissionCents: 599, status: "pending", telecomAccountId: c.account.id });
    expect(ledger[0]!.payableAt.toISOString()).toBe(new Date(clock.getTime() + 30 * DAY).toISOString());
    expect(await repo.affiliates.countReferrals(a.id)).toEqual({ signups: 1, paying: 1 });
  });

  it("no commission when the first payment comes after the 60-day window, or after the duration", async () => {
    const a = await activeAffiliate();
    const late = await referredCustomer(a.code, new Date(clock.getTime() - 50 * DAY));
    await invoicePaid(late.account.id, "in_late", new Date(clock.getTime() + 11 * DAY));
    expect(await repo.affiliates.listCommissions(a.id)).toHaveLength(0);

    const c = await referredCustomer(a.code);
    await invoicePaid(c.account.id, "in_m1", clock);
    await invoicePaid(c.account.id, "in_m12", new Date("2027-10-15T15:00:00Z"));
    await invoicePaid(c.account.id, "in_m13", new Date("2027-11-01T15:00:00Z"));
    expect((await repo.affiliates.listCommissions(a.id)).map((r) => r.stripeInvoiceId)).toEqual(["in_m1", "in_m12"]);
  });

  it("refunds reverse in proportion, chargebacks reverse all; once paid, a clawback is taken from the next payout", async () => {
    const a = await activeAffiliate();
    const c = await referredCustomer(a.code);
    await invoicePaid(c.account.id, "in_r1", clock);
    await stripe("charge.refunded", { id: "ch_1", payment_intent: "pi_r1", amount: 3503, amount_refunded: 1751 });
    let row = (await repo.affiliates.listCommissions(a.id))[0]!;
    expect(row).toMatchObject({ reversedCents: 299, status: "pending", reversalReason: "refund" });
    await stripe("charge.dispute.created", { id: "dp_1", charge: "ch_1", payment_intent: "pi_r1" });
    row = (await repo.affiliates.listCommissions(a.id))[0]!;
    expect(row).toMatchObject({ reversedCents: 599, status: "reversed", reversalReason: "chargeback" });

    await invoicePaid(c.account.id, "in_r2", clock);
    clock = new Date(clock.getTime() + 31 * DAY);
    await runAffiliateMaintenance(ctx.deps);
    await repo.affiliates.markPaid(a.id, { payoutRef: "virement-1", at: clock });
    await stripe("charge.dispute.created", { id: "dp_2", payment_intent: "pi_r2" });
    const ledger = await repo.affiliates.listCommissions(a.id);
    const clawback = ledger.find((r) => r.kind === "clawback")!;
    expect(clawback).toMatchObject({ commissionCents: -599, status: "payable", stripeInvoiceId: "in_r2", reversalReason: "chargeback" });
    expect(ledger.find((r) => r.stripeInvoiceId === "in_r2" && r.kind === "invoice")).toMatchObject({ status: "paid", reversedCents: 599 });
  });

  it("the referred customer's card on the affiliate's own account is refused at payment time", async () => {
    const a = await activeAffiliate();
    const me = await makeUser(ctx);
    await repo.updateUser(me.user.id, { phoneE164: "+15145550142" });
    await ctx.app.inject({ url: "/v1/affiliates/me", headers: me.auth }); // binds the dashboard user
    await repo.referrals.addPaymentFingerprint(me.account.id, "fp_same", clock);
    const c = await referredCustomer(a.code);
    billing.paymentFingerprint.mockResolvedValue("fp_same");
    await invoicePaid(c.account.id, "in_self", clock);
    expect(await repo.affiliates.listCommissions(a.id)).toHaveLength(0);
    expect(repo.fraudEvents.some((f) => f.rule === "affiliate_self_referral")).toBe(true);
  });

  it("the live-picker hold carries the mimt.ca code to the checkout", async () => {
    const a = await activeAffiliate();
    const hold = await ctx.app.inject({
      method: "POST",
      url: "/v1/public/numbers/holds",
      payload: { e164: "+15145550199", affiliateCode: a.code, affiliateTouchedAt: new Date(clock.getTime() - DAY).toISOString() },
    });
    expect(hold.statusCode).toBe(201);
    expect(await repo.affiliates.getHoldTouch(hold.json().id)).toMatchObject({ affiliateId: a.id });
  });
});

describe("affiliate dashboard and payouts", () => {
  it("binds the affiliate's verified phone, then shows code, link, counts, ledger and totals", async () => {
    const a = await activeAffiliate();
    const me = await makeUser(ctx);
    expect((await ctx.app.inject({ url: "/v1/affiliates/me", headers: me.auth })).statusCode).toBe(404);
    await repo.updateUser(me.user.id, { phoneE164: "+15145550142" });
    const c = await post("/v1/affiliates/attribution", { code: a.code }, (await makeUser(ctx)).auth);
    expect(c.json().attributed).toBe(true);
    const customer = (await makeUser(ctx));
    await post("/v1/affiliates/attribution", { code: a.code }, customer.auth);
    await invoicePaid(customer.account.id, "in_d1", clock);
    const res = await ctx.app.inject({ url: "/v1/affiliates/me", headers: me.auth });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d).toMatchObject({
      status: "active",
      code: a.code,
      link: `https://app.mimt.ca/?aff=${a.code}`,
      terms: { commissionBps: 2000, durationMonths: 12, payoutThresholdCents: 5000 },
      signups: 2,
      payingCustomers: 1,
      totals: { pendingCents: 599, payableCents: 0, paidCents: 0 },
      holdDays: 30,
      attributionDays: 60,
    });
    expect(d.commissions).toHaveLength(1);
    expect(JSON.stringify(d)).not.toMatch(/julie|Tremblay|example\.ca/i);
  });

  it("exports payable commissions at or above the threshold as CSV, then marks them paid", async () => {
    const a = await activeAffiliate({ legalName: "=HYPERLINK(\"x\")" });
    for (let i = 0; i < 9; i++) {
      const c = await post("/v1/affiliates/attribution", { code: a.code }, (await makeUser(ctx)).auth);
      expect(c.statusCode).toBe(200);
    }
    const referred = [...repo.affiliates.referrals.values()].map((r) => r.telecomAccountId);
    await invoicePaid(referred[0]!, "in_p1", clock);
    let csv = (await ctx.app.inject({ url: "/v1/admin/affiliate-commissions/payable.csv", headers: adminAuth })).body;
    expect(csv.trim().split("\r\n")).toHaveLength(1); // still pending

    for (let i = 1; i < 9; i++) await invoicePaid(referred[i]!, `in_p${i + 1}`, clock);
    clock = new Date(clock.getTime() + 31 * DAY);
    const res = await ctx.app.inject({ url: "/v1/admin/affiliate-commissions/payable.csv", headers: adminAuth });
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    csv = res.body;
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^affiliate_id,affiliate_code,legal_name/);
    expect(lines).toHaveLength(10);
    expect(lines[1]).toContain(`,${9 * 599},`);
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`); // formula injection neutralised

    const paid = await post("/v1/admin/affiliate-commissions/mark-paid", { affiliateId: a.id, payoutRef: "interac-2026-12" });
    expect(paid.json()).toEqual({ paid: 9, totalCents: 9 * 599 });
    expect((await post("/v1/admin/affiliate-commissions/mark-paid", { affiliateId: a.id, payoutRef: "again" })).statusCode).toBe(409);
    expect((await ctx.app.inject({ url: "/v1/admin/affiliate-commissions/payable.csv", headers: adminAuth })).body.trim().split("\r\n")).toHaveLength(1);
  });

  it("below the threshold nothing is exported; suspended affiliates are withheld", async () => {
    const a = await activeAffiliate();
    const u = await makeUser(ctx);
    await post("/v1/affiliates/attribution", { code: a.code }, u.auth);
    await invoicePaid(u.account.id, "in_small", clock);
    clock = new Date(clock.getTime() + 31 * DAY);
    expect((await ctx.app.inject({ url: "/v1/admin/affiliate-commissions/payable.csv", headers: adminAuth })).body.trim().split("\r\n")).toHaveLength(1);
    await post(`/v1/admin/affiliates/${a.id}/status`, { status: "terminated", reason: "fin" });
    // Terminated: paid even below the threshold (contract 11.4).
    expect((await ctx.app.inject({ url: "/v1/admin/affiliate-commissions/payable.csv", headers: adminAuth })).body.trim().split("\r\n")).toHaveLength(2);
  });
});

describe("contract, DocuSign gateway and net revenue", () => {
  it("the API contract text is the one in docs/legal/contrat-affilie.md, with exactly the DocuSign tab placeholders", () => {
    const md = readFileSync(join(__dirname, "../../../docs/legal/contrat-affilie.md"), "utf8");
    const block = (l: string) => md.match(new RegExp(`<!-- contract:${l}:start -->\\n([\\s\\S]*?)\\n<!-- contract:${l}:end -->`))![1];
    expect(CONTRACT_FR).toBe(block("fr"));
    expect(CONTRACT_EN).toBe(block("en"));
    for (const text of [CONTRACT_FR, CONTRACT_EN]) {
      expect(new Set([...text.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]))).toEqual(new Set(CONTRACT_TABS));
    }
    expect(md).toContain("Brouillon — à faire réviser par un avocat avant usage.");
    const filled = fillContract(CONTRACT_FR, contractTabs({ commissionBps: 2000, durationMonths: 12, payoutThresholdCents: 5000 }, "X", new Date("2026-11-01T12:00:00Z")));
    expect(filled).not.toContain("{{");
    expect(() => fillContract("{{unknown_tab}}", contractTabs({ commissionBps: 2000, durationMonths: 12, payoutThresholdCents: 5000 }, "X", new Date()))).toThrow();
  });

  it("net revenue takes out the tax lines, in proportion of what was paid", () => {
    const lines = { data: [{ amount: 2999, description: "1 × MIMT Premium" }, { amount: 150, description: "1 × TPS (5 %)" }, { amount: 299, description: "1 × TVQ (9,975 %)" }] };
    expect(invoiceNetRevenueCents({ amount_paid: 3448, lines })).toBe(2999);
    expect(invoiceNetRevenueCents({ amount_paid: 1724, lines })).toBe(1499); // half paid by a balance credit
    expect(invoiceNetRevenueCents({ amount_paid: 0, lines })).toBe(0);
    expect(invoiceNetRevenueCents({ amount_paid: 1150, lines: { data: [] } })).toBe(1000);
  });

  it("normalizes Canadian phone numbers only", () => {
    expect(normalizeNanpPhone("(514) 555-0142")).toBe("+15145550142");
    expect(normalizeNanpPhone("+1 438 555 0100")).toBe("+14385550100");
    expect(normalizeNanpPhone("011 33 1 23 45 67 89")).toBeNull();
    expect(normalizeNanpPhone("123-555-0100")).toBeNull();
  });

  it("DocuSign: JWT grant then an envelope from the template with locked text tabs (fetch mocked)", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      if (String(url).endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "at-1", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ envelopeId: "env-9", status: "sent" }), { status: 201 });
    });
    const gw = new DocuSignGateway(
      { accountId: "acc-1", integrationKey: "ik-1", userId: "user-1", privateKeyPem: pem, baseUrl: "https://demo.docusign.net/restapi", templateId: "tpl-1", templateRole: "Affilie" },
      http as typeof fetch,
    );
    const tabs = { affiliate_legal_name: "Julie", commission_pct: "20", duration_months: "12", payout_threshold: "50,00", effective_date: "2026-11-01" };
    expect(await gw.sendContract({ affiliateId: "aff-1", signerName: "Julie", signerEmail: "j@example.ca", locale: "fr-CA", tabs })).toEqual({ envelopeId: "env-9" });
    await gw.sendContract({ affiliateId: "aff-1", signerName: "Julie", signerEmail: "j@example.ca", locale: "fr-CA", tabs });
    expect(calls.filter((c) => c.url.endsWith("/oauth/token"))).toHaveLength(1); // token cached
    expect(calls[0]!.url).toBe("https://account-d.docusign.com/oauth/token");
    expect(String(calls[0]!.init.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(calls[1]!.url).toBe("https://demo.docusign.net/restapi/v2.1/accounts/acc-1/envelopes");
    const env = JSON.parse(String(calls[1]!.init.body));
    expect(env).toMatchObject({ templateId: "tpl-1", status: "sent", templateRoles: [{ roleName: "Affilie", name: "Julie", email: "j@example.ca" }] });
    expect(env.templateRoles[0].tabs.textTabs.map((t: { tabLabel: string }) => t.tabLabel)).toEqual([...CONTRACT_TABS]);
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe("Bearer at-1");
    expect(docusignAuthHost("https://ca.docusign.net/restapi")).toBe("account.docusign.com");
  });

  it("parses Connect messages in both formats", () => {
    expect(parseConnectEvent({ event: "envelope-completed", data: { envelopeId: "e1" } })).toEqual({ envelopeId: "e1", status: "completed" });
    expect(parseConnectEvent({ envelopeId: "e2", status: "Voided" })).toEqual({ envelopeId: "e2", status: "voided" });
    expect(parseConnectEvent({ nothing: true })).toBeNull();
  });
});
