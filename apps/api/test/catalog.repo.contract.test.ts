import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORDER_CONSENT_KINDS } from "@mimt/shared";
import { MemoryRepository } from "../src/repo/memory.js";
import { PostgresRepository } from "../src/repo/postgres.js";
import type { Repository } from "../src/repo/types.js";

// Same behaviour from the memory and Postgres catalog stores (supabase/migrations/0005_catalog.sql).
// Postgres runs only with TEST_DATABASE_URL (a scratch database with every migration applied).
const pgUrl = process.env.TEST_DATABASE_URL;

const TABLES = "consents, usage_snapshots, porting_requests, appointments, devices, order_events, service_instances, service_orders, offers, telecom_accounts, users";

const impls: Array<[string, () => Repository, boolean]> = [
  ["memory", () => new MemoryRepository(), true],
  ["postgres", () => new PostgresRepository(pgUrl ?? "postgres://unused", { max: 1 }), Boolean(pgUrl)],
];

for (const [name, make, enabled] of impls) {
  describe.skipIf(!enabled)(`catalog repository contract: ${name}`, () => {
    let repo: Repository;
    beforeAll(() => {
      repo = make();
    });
    afterAll(() => repo.close());
    beforeEach(async () => {
      if (repo instanceof PostgresRepository) await repo.sql.unsafe(`truncate ${TABLES} cascade`);
      else repo = make();
    });

    async function seed() {
      const user = await repo.createUser({ globalUserId: null, locale: "fr-CA", displayName: "A" });
      const account = await repo.createAccount({ ownerUserId: user.id, kind: "consumer", status: "ACTIVE_INDEPENDENT", riskTier: "standard" });
      const c = repo.catalog;
      const offer = await c.createOffer({
        code: "internet-500",
        productLine: "internet_residential",
        provider: "sandbox",
        providerProductCode: null,
        name: { fr: "Internet 500", en: "Internet 500" },
        description: { fr: "Fibre", en: "Fibre" },
        monthlyPriceCents: 5500,
        setupFeeCents: 0,
        termMonths: 12,
        discountCents: 6000,
        attributes: { downloadMbps: 500, uploadMbps: 100, internetDataGb: null },
        availableFsas: ["H", "J4K"],
        status: "active",
      });
      const order = await c.createOrder({
        telecomAccountId: account.id,
        userId: user.id,
        offerId: offer.id,
        offerCode: offer.code,
        productLine: offer.productLine,
        provider: "sandbox",
        state: "draft",
        serviceAddress: { street: "1 rue A", unit: null, city: "Montréal", province: "QC", postalCode: "H2X 1Y4" },
        monthlyPriceCents: 5500,
        setupFeeCents: 0,
        termMonths: 12,
        discountCents: 6000,
        simKind: null,
      });
      return { user, account, offer, order };
    }

    it("offers: create, read, filter, update", async () => {
      const { offer } = await seed();
      const c = repo.catalog;
      expect(offer).toMatchObject({ stripePriceId: null, availableFsas: ["H", "J4K"], attributes: { downloadMbps: 500, internetDataGb: null } });
      expect(offer.name.fr).toBe("Internet 500");
      expect(offer.createdAt).toBeInstanceOf(Date);
      const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = offer;
      await c.createOffer({ ...fields, code: "mobile-10", productLine: "mobile", monthlyPriceCents: 2500, availableFsas: null, status: "draft", stripePriceId: null });
      expect((await c.getOfferByCode("internet-500"))?.id).toBe(offer.id);
      expect((await c.getOffer(offer.id))?.code).toBe("internet-500");
      expect((await c.listOffers()).map((o) => o.code)).toEqual(["mobile-10", "internet-500"]);
      expect((await c.listOffers({ status: "active" })).map((o) => o.code)).toEqual(["internet-500"]);
      expect((await c.listOffers({ productLine: "mobile" })).map((o) => o.code)).toEqual(["mobile-10"]);
      const updated = await c.updateOffer(offer.id, { status: "retired", name: { fr: "Internet 500 (ancien)", en: "Internet 500 (old)" } });
      expect(updated).toMatchObject({ status: "retired", name: { fr: "Internet 500 (ancien)" } });
      await expect(c.createOffer({ ...fields })).rejects.toThrow(); // code is unique
    });

    it("orders: compare-and-set on the state, provider reference, work queue, events", async () => {
      const { account, order } = await seed();
      const c = repo.catalog;
      expect(order).toMatchObject({ state: "draft", providerOrderId: null, contractAcceptedAt: null, serviceAddress: { postalCode: "H2X 1Y4" } });
      const now = new Date();
      const submitted = await c.updateOrder(order.id, "draft", { state: "submitted", contractSummaryVersion: "v1", contractAcceptedAt: now, submittedAt: now });
      expect(submitted?.state).toBe("submitted");
      expect(submitted?.contractAcceptedAt?.getTime()).toBe(now.getTime());
      expect(await c.updateOrder(order.id, "draft", { state: "cancelled" })).toBeNull(); // lost the race
      await c.updateOrder(order.id, "submitted", { state: "pending_provider", providerOrderId: "SBX-1" });
      expect((await c.getOrderByProviderRef("sandbox", "SBX-1"))?.id).toBe(order.id);
      expect(await c.getOrderByProviderRef("videotron", "SBX-1")).toBeNull();
      expect((await c.listOrdersByAccount(account.id)).map((o) => o.id)).toEqual([order.id]);
      expect((await c.listOrdersInStates(["pending_provider"], 10)).map((o) => o.id)).toEqual([order.id]);
      expect(await c.listOrdersInStates(["active"], 10)).toEqual([]);

      await c.addOrderEvent({ orderId: order.id, event: "submit", fromState: "draft", toState: "submitted", actor: "customer", actorUserId: order.userId, details: { v: "v1" }, at: new Date(Date.now() - 1000) });
      await c.addOrderEvent({ orderId: order.id, event: "note", fromState: "submitted", toState: "submitted", actor: "system", actorUserId: null, details: {} });
      const events = await c.listOrderEvents(order.id);
      expect(events.map((e) => e.event)).toEqual(["submit", "note"]);
      expect(events[0]).toMatchObject({ details: { v: "v1" }, actor: "customer" });
      expect(events[1]?.at).toBeInstanceOf(Date);
    });

    it("services, devices, appointments", async () => {
      const { account, order, offer } = await seed();
      const c = repo.catalog;
      const s = await c.createService({
        telecomAccountId: account.id,
        orderId: order.id,
        offerId: offer.id,
        offerCode: offer.code,
        productLine: offer.productLine,
        provider: "sandbox",
        providerServiceId: "SVC-1",
        status: "active",
        phoneE164: null,
        serviceAddress: order.serviceAddress,
        monthlyPriceCents: 5500,
        termMonths: 12,
        discountCents: 6000,
        activatedAt: new Date(),
        termEndsAt: new Date(Date.now() + 365 * 86_400_000),
      });
      expect(s).toMatchObject({ cancelledAt: null, usageNotified: { period: "", thresholds: [] }, overageCapConsentCents: null });
      expect((await c.getService(s.id))?.orderId).toBe(order.id);
      expect((await c.getServiceByOrder(order.id))?.id).toBe(s.id);
      expect((await c.getServiceByProviderId("sandbox", "SVC-1"))?.id).toBe(s.id);
      expect((await c.listServicesByAccount(account.id)).map((x) => x.id)).toEqual([s.id]);
      const u = await c.updateService(s.id, { status: "suspended", usageNotified: { period: "2026-10", thresholds: [50] } });
      expect(u).toMatchObject({ status: "suspended", usageNotified: { period: "2026-10", thresholds: [50] } });
      expect((await c.listServicesInStatuses(["suspended"], 10)).map((x) => x.id)).toEqual([s.id]);
      const { id: _id, createdAt: _c, updatedAt: _u, ...serviceFields } = s;
      await expect(c.createService({ ...serviceFields, providerServiceId: "SVC-2" })).rejects.toThrow(); // one service per order

      const d = await c.createDevice({ telecomAccountId: account.id, orderId: order.id, kind: "esim", iccid: "8930200000000000001", status: "pending", activationCodeEncrypted: "v1.xxx" });
      expect(d).toMatchObject({ serial: null, imei: null, financedBalanceCents: 0, serviceId: null, activationCodeEncrypted: "v1.xxx" });
      await c.updateDevice(d.id, { status: "active", serviceId: s.id });
      expect((await c.listDevicesByOrder(order.id))[0]).toMatchObject({ status: "active", serviceId: s.id });

      const start = new Date(Date.now() + 2 * 86_400_000);
      const a = await c.createAppointment({ orderId: order.id, providerRef: "APT-1", startsAt: start, endsAt: new Date(start.getTime() + 4 * 3600_000), status: "booked" });
      expect(a.notes).toBeNull();
      await c.updateAppointment(a.id, { status: "completed" });
      expect((await c.listAppointmentsByOrder(order.id))[0]?.status).toBe("completed");

      await c.addUsageSnapshot({ serviceId: s.id, period: "2026-10", dataMb: 100, roamingDataMb: 0, voiceMinutes: 1, sms: 2, overageCents: 0, roamingCents: 0, capturedAt: new Date(Date.now() - 1000) });
      await c.addUsageSnapshot({ serviceId: s.id, period: "2026-10", dataMb: 200, roamingDataMb: 0, voiceMinutes: 1, sms: 2, overageCents: 0, roamingCents: 0, capturedAt: new Date() });
      expect((await c.getLatestUsageSnapshot(s.id))?.dataMb).toBe(200);
    });

    it("consents accept the order flow kinds (consents_kind_check)", async () => {
      const { user } = await seed();
      for (const kind of [...ORDER_CONSENT_KINDS, "ai_processing" as const]) {
        await repo.addConsent({ userId: user.id, kind, granted: true, version: "cis-1", source: "web", ip: null, at: new Date() });
      }
      expect((await repo.listConsents(user.id)).map((c) => c.kind).sort()).toEqual(["ai_processing", "contract_summary", "credit_check", "internet_code", "wireless_code"]);
    });

    it("porting requests", async () => {
      const { account, order } = await seed();
      const c = repo.catalog;
      const p = await c.createPortingRequest({
        orderId: order.id,
        telecomAccountId: account.id,
        phoneE164: "+15145550142",
        losingCarrier: "Fido",
        authorizedName: "A",
        status: "pending",
        accountNumberEncrypted: "v1.acct",
        pinEncrypted: "v1.pin",
        imeiEncrypted: null,
      });
      expect(p).toMatchObject({ providerRef: null, dueAt: null, completedAt: null, rejectReason: null });
      expect((await c.getPortingRequestByOrder(order.id))?.id).toBe(p.id);
      await c.updatePortingRequest(p.id, { status: "submitted", providerRef: "PORT-1", dueAt: new Date() });
      expect((await c.getPortingRequestByProviderRef("PORT-1"))?.id).toBe(p.id);
      expect((await c.listPortingInStatuses(["submitted"], 10)).map((x) => x.id)).toEqual([p.id]);
    });
  });
}
