import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CancelOrderResponse, EsimResponse, OrderDetailResponse, ServiceOrder } from "@mimt/shared";
import { createProvisioningProvider } from "../src/catalog/providers/index.js";
import { SANDBOX_TIMINGS, SANDBOX_WEBHOOK_SECRET, SandboxProvisioningProvider } from "../src/catalog/providers/sandbox.js";
import type { OfferRow } from "../src/repo/catalog.js";
import { makeUser, setup, testConfig, type Ctx } from "./helpers.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function clock(start = "2026-10-12T14:00:00Z") {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (ms: number) => void (t += ms) };
}

async function sandboxCtx(extraConfig: Record<string, string> = {}) {
  const c = clock();
  const sandbox = new SandboxProvisioningProvider(c.now);
  const ctx = await setup({ now: c.now, provisioning: sandbox, config: extraConfig });
  return { ...ctx, clock: c, sandbox };
}

const OFFER_BASE = {
  provider: "sandbox" as const,
  providerProductCode: null,
  setupFeeCents: 0,
  termMonths: 0,
  discountCents: 0,
  availableFsas: null,
  status: "active" as const,
};

async function seedOffers(ctx: Ctx) {
  const c = ctx.repo.catalog;
  const mobile = await c.createOffer({
    ...OFFER_BASE,
    code: "mobile-20",
    productLine: "mobile",
    name: { fr: "Mobile 20 Go", en: "Mobile 20 GB" },
    description: { fr: "Appels et textos illimités au Canada", en: "Unlimited Canada-wide calls and texts" },
    monthlyPriceCents: 3500,
    attributes: { dataGb: 20, throttleKbps: 512, minutes: null, sms: null, network: "5g", esim: true },
  });
  const internet = await c.createOffer({
    ...OFFER_BASE,
    code: "internet-1g-24",
    productLine: "internet_residential",
    name: { fr: "Internet 1 Gbit/s", en: "Internet 1 Gbps" },
    description: { fr: "Fibre, utilisation illimitée", en: "Fibre, unlimited usage" },
    monthlyPriceCents: 6500,
    setupFeeCents: 5000,
    termMonths: 24,
    discountCents: 24_000,
    attributes: { downloadMbps: 1000, uploadMbps: 1000, internetDataGb: null, technology: "fibre", technicianInstall: true },
    availableFsas: ["H"],
  });
  const draft = await c.createOffer({
    ...OFFER_BASE,
    code: "draft-offer",
    productLine: "mobile",
    name: { fr: "Brouillon", en: "Draft" },
    description: { fr: "-", en: "-" },
    monthlyPriceCents: 100,
    attributes: {},
    status: "draft",
  });
  return { mobile, internet, draft };
}

/** A MIMT user listed in CATALOG_ADMIN_USER_IDS (the config list is read at request time). */
async function makeAdmin(ctx: Ctx) {
  const admin = await makeUser(ctx);
  ctx.deps.config.CATALOG_ADMIN_USER_IDS.push(admin.user.id);
  return admin;
}

const ADDRESS = { street: "1 rue Sainte-Catherine Ouest", unit: null, city: "Montréal", province: "QC", postalCode: "h2x1y4" };

async function createOrder(ctx: Ctx, auth: Record<string, string>, body: object) {
  const res = await ctx.app.inject({ method: "POST", url: "/v1/catalog/orders", headers: auth, payload: body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as ServiceOrder;
}

async function acceptAndSubmit(ctx: Ctx, auth: Record<string, string>, orderId: string, extra: object = {}) {
  const summary = (await ctx.app.inject({ method: "GET", url: `/v1/catalog/orders/${orderId}/contract-summary`, headers: auth })).json();
  return ctx.app.inject({
    method: "POST",
    url: `/v1/catalog/orders/${orderId}/submit`,
    headers: auth,
    payload: { contractSummaryVersion: summary.version, acceptContractSummary: true, acceptConsumerCode: true, ...extra },
  });
}

const detail = async (ctx: Ctx, auth: Record<string, string>, id: string) =>
  (await ctx.app.inject({ method: "GET", url: `/v1/catalog/orders/${id}`, headers: auth })).json() as OrderDetailResponse;
const sync = async (ctx: Ctx, auth: Record<string, string>, id: string) =>
  (await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${id}/sync`, headers: auth })).json() as ServiceOrder;

describe("catalog: public offers", () => {
  it("lists active offers, filtered by postal code, with a French-first contract summary", async () => {
    const ctx = await setup(); // no provisioning provider: the catalogue still answers
    const { mobile, internet } = await seedOffers(ctx);

    const all = (await ctx.app.inject({ method: "GET", url: "/v1/catalog/offers" })).json();
    expect(all.postalCode).toBeNull();
    expect(all.offers.map((o: OfferRow) => o.code)).toEqual(["mobile-20", "internet-1g-24"]);
    expect(typeof all.offers[0].createdAt).toBe("string");

    const quebecCity = (await ctx.app.inject({ method: "GET", url: "/v1/catalog/offers?postalCode=G1R%202J6" })).json();
    expect(quebecCity.postalCode).toBe("G1R 2J6");
    expect(quebecCity.offers.map((o: OfferRow) => o.id)).toEqual([mobile.id]);

    const bad = await ctx.app.inject({ method: "GET", url: "/v1/catalog/offers?postalCode=12345" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("invalid_postal_code");

    const one = (await ctx.app.inject({ method: "GET", url: `/v1/catalog/offers/${internet.id}` })).json();
    expect(one.contractSummary.fr.title).toBe("Résumé des renseignements essentiels");
    expect(one.contractSummary.code).toBe("internet");
    expect((await ctx.app.inject({ method: "GET", url: `/v1/catalog/offers/not-a-uuid` })).statusCode).toBe(400);
  });

  it("hides draft offers", async () => {
    const ctx = await setup();
    const { draft } = await seedOffers(ctx);
    expect((await ctx.app.inject({ method: "GET", url: `/v1/catalog/offers/${draft.id}` })).statusCode).toBe(404);
  });

  it("availability asks the provider and returns matching offers", async () => {
    const ctx = await sandboxCtx();
    await seedOffers(ctx);
    const res = (await ctx.app.inject({ method: "GET", url: "/v1/catalog/availability?postalCode=H2X1Y4" })).json();
    expect(res.productLines).toContain("internet_residential");
    expect(res.technology).toBe("fibre");
    expect(res.offers.map((o: OfferRow) => o.code)).toEqual(["mobile-20", "internet-1g-24"]);
    const rural = (await ctx.app.inject({ method: "GET", url: "/v1/catalog/availability?postalCode=J0K1A0" })).json();
    expect(rural.productLines).toEqual(["mobile"]);
  });
});

describe("catalog: 503 without a provisioning provider", () => {
  it("ordering, availability and webhooks answer 503 not_configured", async () => {
    const ctx = await setup();
    const { mobile } = await seedOffers(ctx);
    const { auth } = await makeUser(ctx);
    const order = await ctx.app.inject({ method: "POST", url: "/v1/catalog/orders", headers: auth, payload: { offerId: mobile.id, simKind: "esim" } });
    expect(order.statusCode).toBe(503);
    expect(order.json().error).toBe("not_configured");
    expect((await ctx.app.inject({ method: "GET", url: "/v1/catalog/availability?postalCode=H2X1Y4" })).statusCode).toBe(503);
    const hook = await ctx.app.inject({ method: "POST", url: "/webhooks/provisioning/sandbox", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(hook.statusCode).toBe(503);
    // Reading is still possible.
    expect((await ctx.app.inject({ method: "GET", url: "/v1/catalog/orders", headers: auth })).json()).toEqual({ orders: [] });
  });

  it("production without PROVISIONING_PROVIDER creates no provider; dev defaults to the sandbox", () => {
    expect(createProvisioningProvider({ ...testConfig(), NODE_ENV: "production" })).toBeNull();
    expect(createProvisioningProvider(testConfig())?.code).toBe("sandbox");
  });
});

describe("catalog: mobile order lifecycle (eSIM, month to month)", () => {
  it("draft → submitted → pending_provider → active → cancelled, with consents and audit trail", async () => {
    const ctx = await sandboxCtx();
    const { mobile } = await seedOffers(ctx);
    const { auth, user } = await makeUser(ctx);

    const noSim = await ctx.app.inject({ method: "POST", url: "/v1/catalog/orders", headers: auth, payload: { offerId: mobile.id } });
    expect(noSim.json().error).toBe("sim_kind_required");
    expect((await ctx.app.inject({ method: "POST", url: "/v1/catalog/orders", payload: { offerId: mobile.id, simKind: "esim" } })).statusCode).toBe(401);

    const order = await createOrder(ctx, auth, { offerId: mobile.id, simKind: "esim" });
    expect(order).toMatchObject({ state: "draft", provider: "sandbox", monthlyPriceCents: 3500, simKind: "esim", contractAcceptedAt: null });

    // The contract summary must be accepted before submitting.
    const summary = (await ctx.app.inject({ method: "GET", url: `/v1/catalog/orders/${order.id}/contract-summary`, headers: auth })).json();
    expect(summary.code).toBe("wireless");
    expect(summary.fr.sections.map((s: { heading: string }) => s.heading)).toContain("Plafonds de frais");
    const missing = await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/submit`, headers: auth, payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe("contract_summary_required");
    const notAccepted = await ctx.app.inject({
      method: "POST",
      url: `/v1/catalog/orders/${order.id}/submit`,
      headers: auth,
      payload: { contractSummaryVersion: summary.version, acceptContractSummary: false, acceptConsumerCode: true },
    });
    expect(notAccepted.json().error).toBe("contract_summary_required");
    const outdated = await ctx.app.inject({
      method: "POST",
      url: `/v1/catalog/orders/${order.id}/submit`,
      headers: auth,
      payload: { contractSummaryVersion: "cis-old", acceptContractSummary: true, acceptConsumerCode: true },
    });
    expect(outdated.statusCode).toBe(409);
    expect(outdated.json().error).toBe("contract_summary_outdated");
    const noCode = await acceptAndSubmit(ctx, auth, order.id, { acceptConsumerCode: false });
    expect(noCode.json().error).toBe("consumer_code_required");
    expect((await detail(ctx, auth, order.id)).order.state).toBe("draft");
    expect(await ctx.repo.listConsents(user.id)).toHaveLength(0);

    const submitted = await acceptAndSubmit(ctx, auth, order.id);
    expect(submitted.statusCode, submitted.body).toBe(200);
    const s = submitted.json() as ServiceOrder;
    expect(s.state).toBe("pending_provider");
    expect(s.providerOrderId).toMatch(/^SBX-/);
    expect(s.contractSummaryVersion).toBe(summary.version);
    expect(s.contractAcceptedAt).toBe(ctx.clock.now().toISOString());
    const consents = await ctx.repo.listConsents(user.id);
    expect(consents.map((c) => c.kind).sort()).toEqual(["contract_summary", "wireless_code"]);
    expect(consents.every((c) => c.version === summary.version && c.granted)).toBe(true);
    expect((await acceptAndSubmit(ctx, auth, order.id)).statusCode).toBe(409); // not twice

    // eSIM: the code is returned to the owner, stored encrypted, never in the order detail.
    const sim = await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/sim`, headers: auth, payload: { iccid: "8930200000000000001" } });
    expect(sim.json().error).toBe("sim_kind_mismatch");
    const esim = (await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/esim`, headers: auth, payload: {} })).json() as EsimResponse;
    expect(esim.activationCode).toMatch(/^LPA:1\$smdp\.sandbox\.mimt\.test\$/);
    expect(esim.smdpAddress).toBe("smdp.sandbox.mimt.test");
    const again = (await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/esim`, headers: auth, payload: {} })).json() as EsimResponse;
    expect(again.activationCode).toBe(esim.activationCode);
    expect(ctx.sandbox.calls.filter((c) => c.method === "activateEsim")).toHaveLength(1);
    const stored = [...ctx.repo.catalog.devices.values()][0]!;
    expect(stored.activationCodeEncrypted).not.toContain(esim.matchingId);
    const before = await detail(ctx, auth, order.id);
    expect(JSON.stringify(before)).not.toContain(esim.matchingId);
    expect(before.devices[0]).toMatchObject({ kind: "esim", status: "pending" });
    expect(before.order.state).toBe("pending_provider");

    // The wholesaler finishes processing after 5 minutes.
    ctx.clock.advance(SANDBOX_TIMINGS.processingMs + MIN);
    const active = await sync(ctx, auth, order.id);
    expect(active.state).toBe("active");
    expect(active.activatedAt).toBe(ctx.clock.now().toISOString());
    const d = await detail(ctx, auth, order.id);
    expect(d.service).toMatchObject({ status: "active", phoneE164: expect.stringMatching(/^\+1514555\d{4}$/), termEndsAt: null });
    expect(d.devices[0]?.status).toBe("active");
    expect(d.events.filter((e) => e.event !== "note").map((e) => [e.event, e.toState])).toEqual([
      ["submit", "submitted"],
      ["credit_approved", "pending_provider"],
      ["provider_accepted", "pending_provider"],
      ["activated", "active"],
    ]);

    // Month to month: no fee; the sandbox confirms at once.
    const quote = (await ctx.app.inject({ method: "GET", url: `/v1/catalog/orders/${order.id}/cancellation-quote`, headers: auth })).json();
    expect(quote).toMatchObject({ feeCents: 0, basis: "no_term" });
    const cancelled = (await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/cancel`, headers: auth })).json() as CancelOrderResponse;
    expect(cancelled.order.state).toBe("cancelled");
    expect(cancelled.order.cancelledAt).not.toBeNull();
    expect(cancelled.cancellation.feeCents).toBe(0);
    expect((await detail(ctx, auth, order.id)).service?.status).toBe("cancelled");
    expect(ctx.sandbox.calls.some((c) => c.method === "cancel")).toBe(true);
    const twice = await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/cancel`, headers: auth });
    expect(twice.statusCode).toBe(409);
  });

  it("another customer cannot see or act on the order", async () => {
    const ctx = await sandboxCtx();
    const { mobile } = await seedOffers(ctx);
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    const order = await createOrder(ctx, a.auth, { offerId: mobile.id, simKind: "sim" });
    expect((await ctx.app.inject({ method: "GET", url: `/v1/catalog/orders/${order.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/cancel`, headers: b.auth })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: "GET", url: "/v1/catalog/orders", headers: b.auth })).json().orders).toEqual([]);
    expect((await ctx.app.inject({ method: "GET", url: "/v1/catalog/orders", headers: a.auth })).json().orders).toHaveLength(1);
  });

  it("a draft is cancelled at once, without the wholesaler", async () => {
    const ctx = await sandboxCtx();
    const { mobile } = await seedOffers(ctx);
    const { auth } = await makeUser(ctx);
    const order = await createOrder(ctx, auth, { offerId: mobile.id, simKind: "sim" });
    const res = (await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/cancel`, headers: auth })).json() as CancelOrderResponse;
    expect(res.order.state).toBe("cancelled");
    expect(ctx.sandbox.calls.some((c) => c.method === "cancel" || c.method === "submitOrder")).toBe(false);
    expect((await acceptAndSubmit(ctx, auth, order.id)).statusCode).toBe(409);
  });
});

describe("catalog: number port-in and physical SIM", () => {
  it("ports the number in, activates the SIM, and goes active with the ported number", async () => {
    const ctx = await sandboxCtx();
    const { mobile } = await seedOffers(ctx);
    const { auth } = await makeUser(ctx);
    const order = await createOrder(ctx, auth, { offerId: mobile.id, simKind: "sim" });
    const early = await ctx.app.inject({
      method: "POST",
      url: `/v1/catalog/orders/${order.id}/porting`,
      headers: auth,
      payload: { phoneNumber: "514 555-0142", losingCarrier: "Fido", authorizedName: "Test", accountNumber: "123456789", pin: "4321" },
    });
    expect(early.json().error).toBe("order_not_ready");
    await acceptAndSubmit(ctx, auth, order.id);

    const noPin = await ctx.app.inject({
      method: "POST",
      url: `/v1/catalog/orders/${order.id}/porting`,
      headers: auth,
      payload: { phoneNumber: "514 555-0142", losingCarrier: "Fido", authorizedName: "Test", accountNumber: "123456789" },
    });
    expect(noPin.statusCode).toBe(400);
    const port = await ctx.app.inject({
      method: "POST",
      url: `/v1/catalog/orders/${order.id}/porting`,
      headers: auth,
      payload: { phoneNumber: "514 555-0142", losingCarrier: "Fido", authorizedName: "Test", accountNumber: "123456789", pin: "4321" },
    });
    expect(port.statusCode, port.body).toBe(201);
    expect(port.json()).toMatchObject({ phoneE164: "+15145550142", status: "submitted", providerRef: expect.stringMatching(/^PORT-/) });
    expect(port.body).not.toContain("123456789");
    expect(port.body).not.toContain("4321");
    const row = [...ctx.repo.catalog.portingRequests.values()][0]!;
    expect(row.accountNumberEncrypted).not.toContain("123456789");
    expect(JSON.stringify(ctx.sandbox.calls)).not.toContain("123456789");
    const dup = await ctx.app.inject({
      method: "POST",
      url: `/v1/catalog/orders/${order.id}/porting`,
      headers: auth,
      payload: { phoneNumber: "514 555-0142", losingCarrier: "Fido", authorizedName: "Test", accountNumber: "1", pin: "1" },
    });
    expect(dup.json().error).toBe("porting_exists");

    const badIccid = await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/sim`, headers: auth, payload: { iccid: "1234" } });
    expect(badIccid.statusCode).toBe(400);
    const sim = await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/sim`, headers: auth, payload: { iccid: "8930200000000000001" } });
    expect(sim.statusCode, sim.body).toBe(200);
    expect(sim.json().device).toMatchObject({ kind: "sim", iccid: "8930200000000000001" });

    ctx.clock.advance(SANDBOX_TIMINGS.portConfirmMs + MIN);
    expect((await sync(ctx, auth, order.id)).state).toBe("pending_provider");
    expect((await ctx.app.inject({ method: "GET", url: `/v1/catalog/orders/${order.id}/porting`, headers: auth })).json().status).toBe("confirmed");

    ctx.clock.advance(SANDBOX_TIMINGS.portCompleteMs);
    expect((await sync(ctx, auth, order.id)).state).toBe("active");
    const d = await detail(ctx, auth, order.id);
    expect(d.service?.phoneE164).toBe("+15145550142");
    expect(d.porting?.status).toBe("completed");
    expect(d.devices[0]?.status).toBe("active");
  });

  it("a port rejected by the losing carrier fails the order", async () => {
    const ctx = await sandboxCtx();
    const { mobile } = await seedOffers(ctx);
    const { auth } = await makeUser(ctx);
    const order = await createOrder(ctx, auth, { offerId: mobile.id, simKind: "sim" });
    await acceptAndSubmit(ctx, auth, order.id);
    await ctx.app.inject({
      method: "POST",
      url: `/v1/catalog/orders/${order.id}/porting`,
      headers: auth,
      payload: { phoneNumber: "5145550142", losingCarrier: "Fido", authorizedName: "Test", accountNumber: "REJECT", pin: "1111" },
    });
    await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/sim`, headers: auth, payload: { iccid: "8930200000000000001" } });
    ctx.clock.advance(SANDBOX_TIMINGS.portConfirmMs + MIN);
    const failed = await sync(ctx, auth, order.id);
    expect(failed.state).toBe("failed");
    expect(failed.failureReason).toMatch(/PIN/);
    expect((await detail(ctx, auth, order.id)).porting?.status).toBe("rejected");
  });
});

describe("catalog: internet term contract (credit check, appointment, early cancellation fee)", () => {
  it("runs the whole lifecycle through admin credit approval and a technician appointment", async () => {
    const ctx = await sandboxCtx();
    const { internet } = await seedOffers(ctx);
    const { auth, user } = await makeUser(ctx);
    const { auth: adminAuth, user: adminUser } = await makeAdmin(ctx);
    const admin = adminUser.id;

    expect((await ctx.app.inject({ method: "POST", url: "/v1/catalog/orders", headers: auth, payload: { offerId: internet.id } })).json().error).toBe(
      "service_address_required",
    );
    const outside = await ctx.app.inject({ method: "POST", url: "/v1/catalog/orders", headers: auth, payload: { offerId: internet.id, serviceAddress: { ...ADDRESS, postalCode: "G1R 2J6" } } });
    expect(outside.statusCode).toBe(422);
    const order = await createOrder(ctx, auth, { offerId: internet.id, serviceAddress: ADDRESS });
    expect(order.serviceAddress?.postalCode).toBe("H2X 1Y4");
    expect(order).toMatchObject({ termMonths: 24, discountCents: 24_000, simKind: null });

    const noCredit = await acceptAndSubmit(ctx, auth, order.id);
    expect(noCredit.json().error).toBe("credit_check_consent_required");
    const submitted = await acceptAndSubmit(ctx, auth, order.id, { creditCheckConsent: true });
    expect(submitted.json().state).toBe("credit_check");
    expect((await ctx.repo.listConsents(user.id)).map((c) => c.kind).sort()).toEqual(["contract_summary", "credit_check", "internet_code"]);
    expect(ctx.sandbox.calls.some((c) => c.method === "submitOrder")).toBe(false);

    // Only CATALOG_ADMIN_USER_IDS can approve.
    const approve = { event: "credit_approved", reason: "Dossier vérifié" };
    expect((await ctx.app.inject({ method: "POST", url: `/v1/admin/catalog/orders/${order.id}/events`, payload: approve })).statusCode).toBe(401);
    const denied = await ctx.app.inject({ method: "POST", url: `/v1/admin/catalog/orders/${order.id}/events`, headers: auth, payload: approve });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe("admin_only");
    const approved = await ctx.app.inject({ method: "POST", url: `/v1/admin/catalog/orders/${order.id}/events`, headers: adminAuth, payload: approve });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ state: "pending_provider", providerOrderId: expect.stringMatching(/^SBX-/) });

    // Technician appointment.
    ctx.clock.advance(SANDBOX_TIMINGS.processingMs);
    const slots = (await ctx.app.inject({ method: "GET", url: `/v1/catalog/orders/${order.id}/appointment-slots`, headers: auth })).json().slots;
    expect(slots.length).toBeGreaterThan(0);
    const wrong = await ctx.app.inject({
      method: "POST",
      url: `/v1/catalog/orders/${order.id}/appointment`,
      headers: auth,
      payload: { startsAt: "2030-01-01T13:00:00Z", endsAt: "2030-01-01T17:00:00Z" },
    });
    expect(wrong.statusCode).toBe(409);
    const booked = await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/appointment`, headers: auth, payload: slots[0] });
    expect(booked.statusCode, booked.body).toBe(201);
    expect(booked.json()).toMatchObject({ status: "booked", startsAt: slots[0].startsAt });
    expect((await detail(ctx, auth, order.id)).order.state).toBe("scheduled");

    // After the install window the wholesaler reports it done.
    ctx.clock.advance(new Date(slots[0].endsAt).getTime() - ctx.clock.now().getTime() + MIN);
    const active = await sync(ctx, auth, order.id);
    expect(active.state).toBe("active");
    const d = await detail(ctx, auth, order.id);
    expect(d.appointments[0]?.status).toBe("completed");
    expect(d.service?.termEndsAt).toBe(new Date(new Date(active.activatedAt!).setUTCMonth(new Date(active.activatedAt!).getUTCMonth() + 24)).toISOString());

    // Internet Code trial (30 days): no fee. Later: remaining discount, declining monthly.
    const trial = (await ctx.app.inject({ method: "GET", url: `/v1/catalog/orders/${order.id}/cancellation-quote`, headers: auth })).json();
    expect(trial).toMatchObject({ feeCents: 0, basis: "trial", inTrial: true });
    ctx.clock.advance(92 * DAY);
    const later = (await ctx.app.inject({ method: "GET", url: `/v1/catalog/orders/${order.id}/cancellation-quote`, headers: auth })).json();
    expect(later).toMatchObject({ basis: "discount_declining", feeCents: 21_000, monthsRemaining: 21 });
    expect(later.explanation.fr).toContain("Solde du rabais");

    const cancelled = (await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/cancel`, headers: auth })).json() as CancelOrderResponse;
    expect(cancelled.order.state).toBe("cancelled");
    expect(cancelled.cancellation.feeCents).toBe(21_000);
    const events = (await detail(ctx, auth, order.id)).events;
    expect(events.find((e) => e.event === "cancel_requested")?.details).toMatchObject({ feeCents: 21_000, basis: "discount_declining" });
    expect(events.find((e) => e.event === "credit_approved")).toMatchObject({ actor: "admin", actorUserId: admin });
  });

  it("a declined credit check fails the order", async () => {
    const ctx = await sandboxCtx();
    const { internet } = await seedOffers(ctx);
    const { auth } = await makeUser(ctx);
    const { auth: adminAuth } = await makeAdmin(ctx);
    const order = await createOrder(ctx, auth, { offerId: internet.id, serviceAddress: ADDRESS });
    await acceptAndSubmit(ctx, auth, order.id, { creditCheckConsent: true });
    const res = await ctx.app.inject({ method: "POST", url: `/v1/admin/catalog/orders/${order.id}/events`, headers: adminAuth, payload: { event: "credit_declined" } });
    expect(res.json()).toMatchObject({ state: "failed", failureReason: "Crédit refusé" });
    const invalid = await ctx.app.inject({ method: "POST", url: `/v1/admin/catalog/orders/${order.id}/events`, headers: adminAuth, payload: { event: "credit_approved" } });
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json().error).toBe("invalid_transition");
    const notAllowed = await ctx.app.inject({ method: "POST", url: `/v1/admin/catalog/orders/${order.id}/events`, headers: adminAuth, payload: { event: "submit" } });
    expect(notAllowed.statusCode).toBe(400);
  });
});

describe("catalog: admin offers", () => {
  it("creates, updates and lists offers; gated by CATALOG_ADMIN_USER_IDS", async () => {
    const ctx = await sandboxCtx();
    const { auth } = await makeUser(ctx);
    const body = {
      code: "mobile-50",
      productLine: "mobile",
      provider: "sandbox",
      name: { fr: "Mobile 50 Go", en: "Mobile 50 GB" },
      description: { fr: "5G", en: "5G" },
      monthlyPriceCents: 4500,
      attributes: { dataGb: 50, esim: true },
    };
    // Empty CATALOG_ADMIN_USER_IDS: nobody is admin.
    expect((await ctx.app.inject({ method: "POST", url: "/v1/admin/catalog/offers", headers: auth, payload: body })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "GET", url: "/v1/admin/catalog/orders", headers: auth })).statusCode).toBe(403);

    const ctx2 = await sandboxCtx({ CATALOG_ADMIN_USER_IDS: "someone-else" });
    expect(ctx2.deps.config.CATALOG_ADMIN_USER_IDS).toEqual(["someone-else"]);
    const { auth: adminAuth } = await makeAdmin(ctx2);
    const created = await ctx2.app.inject({ method: "POST", url: "/v1/admin/catalog/offers", headers: adminAuth, payload: body });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ code: "mobile-50", status: "draft", termMonths: 0 });
    expect((await ctx2.app.inject({ method: "POST", url: "/v1/admin/catalog/offers", headers: adminAuth, payload: body })).statusCode).toBe(409);
    expect((await ctx2.app.inject({ method: "POST", url: "/v1/admin/catalog/offers", headers: adminAuth, payload: { ...body, code: "x-25", termMonths: 25 } })).statusCode).toBe(400);
    expect((await ctx2.app.inject({ method: "GET", url: "/v1/catalog/offers" })).json().offers).toEqual([]);

    const patched = await ctx2.app.inject({ method: "PATCH", url: `/v1/admin/catalog/offers/${created.json().id}`, headers: adminAuth, payload: { status: "active", availableFsas: ["h2x"] } });
    expect(patched.json()).toMatchObject({ status: "active", availableFsas: ["H2X"] });
    expect((await ctx2.app.inject({ method: "PATCH", url: `/v1/admin/catalog/offers/${created.json().id}`, headers: adminAuth, payload: { code: "renamed" } })).statusCode).toBe(400);
    expect((await ctx2.app.inject({ method: "GET", url: "/v1/catalog/offers?postalCode=H2X1Y4" })).json().offers).toHaveLength(1);
    expect((await ctx2.app.inject({ method: "GET", url: "/v1/admin/catalog/offers", headers: adminAuth })).json().offers).toHaveLength(1);
    expect((await ctx2.app.inject({ method: "GET", url: "/v1/admin/catalog/orders?state=draft,bogus", headers: adminAuth })).statusCode).toBe(400);
    expect((await ctx2.app.inject({ method: "GET", url: "/v1/admin/catalog/orders?state=draft", headers: adminAuth })).json()).toEqual({ orders: [] });
  });
});

describe("catalog: provider webhooks", () => {
  const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("hex");

  it("sandbox: rejects a bad signature, applies a signed status update", async () => {
    const ctx = await sandboxCtx();
    const { mobile } = await seedOffers(ctx);
    const { auth } = await makeUser(ctx);
    const order = await createOrder(ctx, auth, { offerId: mobile.id, simKind: "esim" });
    const providerOrderId = (await acceptAndSubmit(ctx, auth, order.id)).json().providerOrderId as string;
    await ctx.app.inject({ method: "POST", url: `/v1/catalog/orders/${order.id}/esim`, headers: auth, payload: {} });
    ctx.clock.advance(SANDBOX_TIMINGS.processingMs + MIN);

    const body = JSON.stringify({ orders: [providerOrderId] });
    const bad = await ctx.app.inject({ method: "POST", url: "/webhooks/provisioning/sandbox", headers: { "content-type": "application/json", "x-sandbox-signature": "00" }, payload: body });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe("invalid_signature");
    expect((await detail(ctx, auth, order.id)).order.state).toBe("pending_provider");

    const good = await ctx.app.inject({
      method: "POST",
      url: "/webhooks/provisioning/sandbox",
      headers: { "content-type": "application/json", "x-sandbox-signature": sign(body, SANDBOX_WEBHOOK_SECRET) },
      payload: body,
    });
    expect(good.statusCode, good.body).toBe(200);
    expect(good.json()).toEqual({ received: 1, applied: 1 });
    expect((await detail(ctx, auth, order.id)).order.state).toBe("active");
    // Replays are harmless.
    const replay = await ctx.app.inject({
      method: "POST",
      url: "/webhooks/provisioning/sandbox",
      headers: { "content-type": "application/json", "x-sandbox-signature": sign(body, SANDBOX_WEBHOOK_SECRET) },
      payload: body,
    });
    expect(replay.statusCode).toBe(200);
    expect((await detail(ctx, auth, order.id)).events.filter((e) => e.event === "activated")).toHaveLength(1);
    // Another provider's path is not served.
    expect((await ctx.app.inject({ method: "POST", url: "/webhooks/provisioning/videotron", headers: { "content-type": "application/json" }, payload: body })).statusCode).toBe(404);
  });

  it("videotron: HMAC-SHA256 with VIDEOTRON_WEBHOOK_SECRET; 503 when the secret is missing", async () => {
    const secret = "test-videotron-webhook-secret";
    const config = testConfig({ PROVISIONING_PROVIDER: "videotron", VIDEOTRON_WEBHOOK_SECRET: secret });
    const ctx = await setup({ config: { PROVISIONING_PROVIDER: "videotron", VIDEOTRON_WEBHOOK_SECRET: secret }, provisioning: createProvisioningProvider(config) });
    const body = JSON.stringify({ events: [{ type: "ORDER_STATUS", order: { orderId: "VT-UNKNOWN", status: "COMPLETED" } }] });
    const url = "/webhooks/provisioning/videotron";
    const json = { "content-type": "application/json" };

    const unsigned = await ctx.app.inject({ method: "POST", url, headers: json, payload: body });
    expect(unsigned.statusCode).toBe(401);
    const wrongKey = await ctx.app.inject({ method: "POST", url, headers: { ...json, "x-videotron-signature": sign(body, "other-secret") }, payload: body });
    expect(wrongKey.statusCode).toBe(401);
    const tampered = await ctx.app.inject({ method: "POST", url, headers: { ...json, "x-videotron-signature": sign(body, secret) }, payload: body.replace("VT-UNKNOWN", "VT-OTHER") });
    expect(tampered.statusCode).toBe(401);
    const ok = await ctx.app.inject({ method: "POST", url, headers: { ...json, "x-videotron-signature": sign(body, secret) }, payload: body });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ received: 1, applied: 0 }); // unknown order: ignored

    const noSecretConfig = testConfig({ PROVISIONING_PROVIDER: "videotron" });
    const ctx2 = await setup({ config: { PROVISIONING_PROVIDER: "videotron" }, provisioning: createProvisioningProvider(noSecretConfig) });
    const res = await ctx2.app.inject({ method: "POST", url, headers: { ...json, "x-videotron-signature": sign(body, secret) }, payload: body });
    expect(res.statusCode).toBe(503);
  });

  it("videotron without API credentials: availability answers 503, orders stay pending_provider for retry", async () => {
    const config = testConfig({ PROVISIONING_PROVIDER: "videotron" });
    const ctx = await setup({ config: { PROVISIONING_PROVIDER: "videotron" }, provisioning: createProvisioningProvider(config) });
    const { mobile } = await seedOffers(ctx);
    const { auth } = await makeUser(ctx);
    expect((await ctx.app.inject({ method: "GET", url: "/v1/catalog/availability?postalCode=H2X1Y4" })).statusCode).toBe(503);
    const order = await createOrder(ctx, auth, { offerId: mobile.id, simKind: "sim" });
    expect(order.provider).toBe("videotron");
    const submitted = (await acceptAndSubmit(ctx, auth, order.id)).json() as ServiceOrder;
    expect(submitted).toMatchObject({ state: "pending_provider", providerOrderId: null });
    const d = await detail(ctx, auth, order.id);
    expect(d.events.at(-1)).toMatchObject({ event: "note", details: { submitFailed: "ProviderNotConfiguredError" } });
  });
});
