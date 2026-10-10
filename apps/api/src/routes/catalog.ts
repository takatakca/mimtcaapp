import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  consumerCodeFor,
  filterOffersForPostalCode,
  fsaOf,
  generateContractSummary,
  NANP_E164,
  normalizePostalCode,
  offerAvailableAt,
  ORDER_EVENTS,
  ORDER_STATES,
  PRODUCT_LINES,
  type ActivateSimResponse,
  type AdminOffersResponse,
  type AdminOrdersResponse,
  type AppointmentSlotsResponse,
  type AvailabilityResponse,
  type CancellationQuote,
  type CancelOrderResponse,
  type ContractSummaryResponse,
  type EsimResponse,
  type OfferDetailResponse,
  type OffersResponse,
  type OrderDetailResponse,
  type OrdersResponse,
  type OrderState,
  type ServiceOrder,
} from "@mimt/shared";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { loadContext, requireUser } from "../auth/guard.js";
import { needsServiceAddress, orderContractSummary, OrderService, viaProvider } from "../catalog/orders.js";
import { ProviderNotConfiguredError, ProviderRejectedError } from "../catalog/providers/types.js";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import type { DeviceRow, OfferRow, OrderRow, PortingRow } from "../repo/catalog.js";

// Internet / mobile resale: catalogue, orders, SIM/eSIM, port-in, wholesaler webhooks, admin.
// Contract: packages/shared/src/catalogApi.ts. Flow: docs/MIMT-RESALE.md.

/** Date → ISO string, recursively (the wire format of the shared contract). */
type Wire<T> = T extends Date ? string : T extends Array<infer U> ? Wire<U>[] : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;
function wire<T>(v: T): Wire<T> {
  if (v instanceof Date) return v.toISOString() as Wire<T>;
  if (Array.isArray(v)) return v.map(wire) as Wire<T>;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wire(x)])) as Wire<T>;
  return v as Wire<T>;
}
const orderDto = (o: OrderRow): ServiceOrder => wire(o);
/** Never sends the encrypted eSIM activation code. */
const deviceDto = ({ activationCodeEncrypted: _code, ...d }: DeviceRow) => wire(d);
/** Never sends the carrier account number, PIN or IMEI (even encrypted). */
const portingDto = ({ accountNumberEncrypted: _a, pinEncrypted: _p, imeiEncrypted: _i, ...p }: PortingRow) => wire(p);

const Id = z.object({ id: z.uuid() });
const LocalizedText = z.object({ fr: z.string().trim().min(1).max(2000), en: z.string().trim().min(1).max(2000) });
const Address = z.object({
  street: z.string().trim().min(3).max(200),
  unit: z.string().trim().max(20).nullish(),
  city: z.string().trim().min(2).max(100),
  province: z.string().trim().length(2).toUpperCase(),
  postalCode: z.string().trim().min(3).max(10),
});
const CreateOrder = z.object({ offerId: z.uuid(), serviceAddress: Address.optional(), simKind: z.enum(["sim", "esim"]).optional() });
const Submit = z.object({
  contractSummaryVersion: z.string().max(200).optional(),
  acceptContractSummary: z.boolean().optional(),
  acceptConsumerCode: z.boolean().optional(),
  creditCheckConsent: z.boolean().optional(),
  source: z.string().trim().min(1).max(40).optional(),
});
const Slot = z.object({ startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }) });
const Sim = z.object({ iccid: z.string().regex(/^\d{19,20}$/, "ICCID: 19 à 20 chiffres") });
const Esim = z.object({ eid: z.string().regex(/^\d{32}$/, "EID: 32 chiffres").nullish() });
const PortIn = z
  .object({
    phoneNumber: z.string().trim().min(10).max(20),
    losingCarrier: z.string().trim().min(2).max(80),
    authorizedName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().min(1).max(40),
    pin: z.string().trim().min(1).max(20).optional(),
    imei: z.string().regex(/^\d{15}$/, "IMEI: 15 chiffres").optional(),
  })
  .refine((b) => b.pin || b.imei, { message: "NIP de transfert ou IMEI requis", path: ["pin"] });
const Attributes = z.record(z.string(), z.unknown());
const OfferFields = {
  productLine: z.enum(PRODUCT_LINES as [string, ...string[]]),
  provider: z.enum(["videotron", "twilio", "sandbox"]),
  providerProductCode: z.string().trim().min(1).max(100).nullish(),
  name: LocalizedText,
  description: LocalizedText,
  monthlyPriceCents: z.number().int().min(0).max(1_000_000),
  setupFeeCents: z.number().int().min(0).max(1_000_000).optional(),
  termMonths: z.number().int().min(0).max(24).optional(),
  discountCents: z.number().int().min(0).max(1_000_000).optional(),
  attributes: Attributes.optional(),
  availableFsas: z.array(z.string().trim().regex(/^[A-Za-z](\d[A-Za-z]?)?$/)).max(2000).nullish(),
  status: z.enum(["draft", "active", "retired"]).optional(),
  stripePriceId: z.string().trim().min(1).max(100).nullish(),
};
const CreateOffer = z.object({ code: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,63}$/), ...OfferFields });
const UpdateOffer = z.object(OfferFields).partial().strict();
const AdminEvent = z.object({ event: z.enum(ORDER_EVENTS as [string, ...string[]]), reason: z.string().trim().min(1).max(500).optional() });

function phoneE164(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const e164 = d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith("1") ? `+${d}` : null;
  return e164 && NANP_E164.test(e164) ? e164 : null;
}

export async function catalogRoutes(app: FastifyInstance, deps: AppDeps) {
  const { repo, cipher } = deps;
  const catalog = repo.catalog;
  const orders = new OrderService(deps);
  const auth = { preHandler: requireUser(deps) };
  const admin = {
    preHandler: [
      requireUser(deps),
      async (req: FastifyRequest) => {
        if (!deps.config.CATALOG_ADMIN_USER_IDS.includes(req.userId)) throw forbidden("admin_only", "Réservé aux administrateurs MIMT.");
      },
    ],
  };

  async function ownOrder(req: FastifyRequest) {
    const { id } = parse(Id, req.params);
    const ctx = await loadContext(deps, req);
    const order = await catalog.getOrder(id);
    if (!order || order.telecomAccountId !== ctx.account.id) throw notFound("order_not_found", "Commande introuvable.");
    return { ...ctx, order };
  }

  async function offerOf(order: OrderRow): Promise<OfferRow> {
    const offer = await catalog.getOffer(order.offerId);
    if (!offer) throw notFound("offer_not_found", "Offre introuvable.");
    return offer;
  }

  /** A mobile order the wholesaler already has (SIM / eSIM / port-in steps). */
  function requireMobileAtProvider(order: OrderRow) {
    if (order.productLine !== "mobile") throw conflict("not_mobile", "Réservé aux forfaits mobiles.");
    if (order.state !== "pending_provider" || !order.providerOrderId) throw conflict("order_not_ready", "La commande n'est pas encore chez le fournisseur.");
  }

  // ---------------------------------------------------------------------------------- public

  app.get("/v1/catalog/offers", async (req): Promise<OffersResponse> => {
    const q = parse(z.object({ postalCode: z.string().trim().max(10).optional(), productLine: z.enum(PRODUCT_LINES as [string, ...string[]]).optional() }), req.query);
    const all = await catalog.listOffers({ status: "active", ...(q.productLine ? { productLine: q.productLine as OfferRow["productLine"] } : {}) });
    if (!q.postalCode) return { postalCode: null, offers: all.map(wire) };
    const fsa = fsaOf(q.postalCode);
    if (!fsa) throw badRequest("invalid_postal_code", "Code postal invalide.");
    return { postalCode: normalizePostalCode(q.postalCode) ?? fsa, offers: filterOffersForPostalCode(all, fsa).map(wire) };
  });

  app.get("/v1/catalog/offers/:id", async (req): Promise<OfferDetailResponse> => {
    const { id } = parse(Id, req.params);
    const offer = await catalog.getOffer(id);
    if (!offer || offer.status !== "active") throw notFound("offer_not_found", "Offre introuvable.");
    return { offer: wire(offer), contractSummary: generateContractSummary(offer) };
  });

  app.get("/v1/catalog/availability", async (req): Promise<AvailabilityResponse> => {
    const q = parse(z.object({ postalCode: z.string().trim().min(3).max(10) }), req.query);
    const fsa = fsaOf(q.postalCode);
    if (!fsa) throw badRequest("invalid_postal_code", "Code postal invalide.");
    const provider = orders.provider();
    const r = await viaProvider(() => provider.checkAvailability({ postalCode: q.postalCode }));
    const offers = filterOffersForPostalCode(await catalog.listOffers({ status: "active" }), fsa).filter((o) => r.productLines.includes(o.productLine));
    return {
      postalCode: r.postalCode,
      fsa: r.fsa,
      productLines: r.productLines,
      technology: r.technology,
      maxDownloadMbps: r.maxDownloadMbps,
      installRequired: r.installRequired,
      earliestInstallAt: r.earliestInstallAt?.toISOString() ?? null,
      offers: offers.map(wire),
    };
  });

  // ---------------------------------------------------------------------------------- orders

  app.post("/v1/catalog/orders", auth, async (req, reply) => {
    const body = parse(CreateOrder, req.body);
    const { user, account } = await loadContext(deps, req);
    const provider = orders.provider();
    const offer = await catalog.getOffer(body.offerId);
    if (!offer || offer.status !== "active") throw notFound("offer_not_found", "Offre introuvable.");

    let serviceAddress = null;
    if (needsServiceAddress(offer.productLine)) {
      if (!body.serviceAddress) throw badRequest("service_address_required", "Adresse de service requise.");
      const postalCode = normalizePostalCode(body.serviceAddress.postalCode);
      if (!postalCode) throw badRequest("invalid_postal_code", "Code postal invalide.");
      if (!offerAvailableAt(offer, postalCode.slice(0, 3))) throw new HttpError(422, "offer_not_available", "Cette offre n'est pas offerte à cette adresse.");
      serviceAddress = { ...body.serviceAddress, unit: body.serviceAddress.unit ?? null, postalCode };
    }
    let simKind: "sim" | "esim" | null = null;
    if (offer.productLine === "mobile") {
      if (!body.simKind) throw badRequest("sim_kind_required", "Choisissez une carte SIM ou une eSIM.");
      if (body.simKind === "esim" && offer.attributes.esim === false) throw badRequest("esim_not_supported", "Ce forfait n'offre pas l'eSIM.");
      simKind = body.simKind;
    }
    const order = await catalog.createOrder({
      telecomAccountId: account.id,
      userId: user.id,
      offerId: offer.id,
      offerCode: offer.code,
      productLine: offer.productLine,
      provider: provider.code,
      state: "draft",
      serviceAddress,
      monthlyPriceCents: offer.monthlyPriceCents,
      setupFeeCents: offer.setupFeeCents,
      termMonths: offer.termMonths,
      discountCents: offer.discountCents,
      simKind,
    });
    await catalog.addOrderEvent({ orderId: order.id, event: "note", fromState: null, toState: "draft", actor: "customer", actorUserId: user.id, details: { created: true }, at: deps.now() });
    return reply.code(201).send(orderDto(order));
  });

  app.get("/v1/catalog/orders", auth, async (req): Promise<OrdersResponse> => {
    const { account } = await loadContext(deps, req);
    return { orders: (await catalog.listOrdersByAccount(account.id)).map(orderDto) };
  });

  app.get("/v1/catalog/orders/:id", auth, async (req): Promise<OrderDetailResponse> => {
    const { order } = await ownOrder(req);
    const [events, offer, service, appointments, devices, porting] = await Promise.all([
      catalog.listOrderEvents(order.id),
      catalog.getOffer(order.offerId),
      catalog.getServiceByOrder(order.id),
      catalog.listAppointmentsByOrder(order.id),
      catalog.listDevicesByOrder(order.id),
      catalog.getPortingRequestByOrder(order.id),
    ]);
    return {
      order: orderDto(order),
      events: events.map(wire),
      ...(offer ? { offer: wire(offer) } : {}),
      service: service ? wire(service) : null,
      appointments: appointments.map(wire),
      devices: devices.map(deviceDto),
      porting: porting ? portingDto(porting) : null,
    };
  });

  app.get("/v1/catalog/orders/:id/contract-summary", auth, async (req): Promise<ContractSummaryResponse> => {
    const { order } = await ownOrder(req);
    return orderContractSummary(order, await offerOf(order));
  });

  app.post("/v1/catalog/orders/:id/submit", auth, async (req): Promise<ServiceOrder> => {
    const body = parse(Submit, req.body ?? {});
    const { user, order } = await ownOrder(req);
    if (order.state !== "draft") throw conflict("invalid_transition", "La commande a déjà été soumise.");
    orders.provider();
    const summary = orderContractSummary(order, await offerOf(order));
    if (body.acceptContractSummary !== true || !body.contractSummaryVersion) {
      throw badRequest("contract_summary_required", "Vous devez lire et accepter le résumé des renseignements essentiels.");
    }
    if (body.contractSummaryVersion !== summary.version) {
      throw conflict("contract_summary_outdated", "Le résumé du contrat a changé. Relisez-le et acceptez la nouvelle version.");
    }
    const code = consumerCodeFor(order.productLine);
    if (code !== "none" && body.acceptConsumerCode !== true) {
      throw badRequest("consumer_code_required", code === "wireless" ? "Acceptation du Code sur les services sans fil requise." : "Acceptation du Code sur les services Internet requise.");
    }
    if (order.termMonths > 0 && body.creditCheckConsent !== true) {
      throw badRequest("credit_check_consent_required", "Un contrat à terme exige votre consentement à une vérification de crédit.");
    }

    const now = deps.now();
    const consent = { userId: user.id, granted: true, version: summary.version, source: body.source ?? "app", ip: req.ip, at: now };
    await repo.addConsent({ ...consent, kind: "contract_summary" });
    if (code === "wireless") await repo.addConsent({ ...consent, kind: "wireless_code" });
    if (code === "internet") await repo.addConsent({ ...consent, kind: "internet_code" });
    if (order.termMonths > 0) await repo.addConsent({ ...consent, kind: "credit_check" });

    const submitted = await orders.transition(
      order,
      "submit",
      { actor: "customer", userId: user.id },
      { contractSummaryVersion: summary.version },
      { contractSummaryVersion: summary.version, contractAcceptedAt: now, submittedAt: now },
    );
    return orderDto(await viaProvider(() => orders.afterSubmit(submitted, user)));
  });

  app.post("/v1/catalog/orders/:id/sync", auth, async (req): Promise<ServiceOrder> => {
    const { order } = await ownOrder(req);
    return orderDto(await viaProvider(() => orders.sync(order)));
  });

  app.get("/v1/catalog/orders/:id/cancellation-quote", auth, async (req): Promise<CancellationQuote> => {
    const { order } = await ownOrder(req);
    return orders.quote(order);
  });

  app.post("/v1/catalog/orders/:id/cancel", auth, async (req): Promise<CancelOrderResponse> => {
    const { user, order } = await ownOrder(req);
    const r = await viaProvider(() => orders.cancel(order, { actor: "customer", userId: user.id }));
    return { order: orderDto(r.order), cancellation: r.cancellation };
  });

  // ------------------------------------------------------------------- install appointments

  app.get("/v1/catalog/orders/:id/appointment-slots", auth, async (req): Promise<AppointmentSlotsResponse> => {
    const { order } = await ownOrder(req);
    if (!needsServiceAddress(order.productLine)) throw conflict("appointment_not_needed", "Aucune installation requise pour ce service.");
    if (!order.providerOrderId || (order.state !== "pending_provider" && order.state !== "scheduled")) throw conflict("order_not_ready", "La commande n'est pas encore chez le fournisseur.");
    const provider = orders.provider();
    const slots = await viaProvider(() => provider.getAppointmentSlots(order.providerOrderId!));
    return { slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })) };
  });

  app.post("/v1/catalog/orders/:id/appointment", auth, async (req, reply) => {
    const body = parse(Slot, req.body);
    const { user, order } = await ownOrder(req);
    if (!needsServiceAddress(order.productLine)) throw conflict("appointment_not_needed", "Aucune installation requise pour ce service.");
    if (!order.providerOrderId || (order.state !== "pending_provider" && order.state !== "scheduled")) throw conflict("order_not_ready", "La commande n'est pas encore chez le fournisseur.");
    const provider = orders.provider();
    const appt = await viaProvider(() => provider.scheduleAppointment(order.providerOrderId!, { startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) }));
    const row = await orders.bookAppointmentRow(order, appt);
    await orders.transition(order, "appointment_scheduled", { actor: "customer", userId: user.id }, { ref: appt.ref, startsAt: appt.startsAt.toISOString() });
    return reply.code(201).send(wire(row));
  });

  // ------------------------------------------------------------------------------ SIM / eSIM

  app.post("/v1/catalog/orders/:id/sim", auth, async (req): Promise<ActivateSimResponse> => {
    const body = parse(Sim, req.body);
    const { account, order } = await ownOrder(req);
    requireMobileAtProvider(order);
    if (order.simKind !== "sim") throw conflict("sim_kind_mismatch", "Cette commande utilise une eSIM.");
    const provider = orders.provider();
    await viaProvider(() => provider.activateSim({ providerOrderId: order.providerOrderId!, iccid: body.iccid }));
    const existing = (await catalog.listDevicesByOrder(order.id)).find((d) => d.kind === "sim" && d.status !== "inactive");
    if (existing) await catalog.updateDevice(existing.id, { status: "inactive" });
    const device = await catalog.createDevice({ telecomAccountId: account.id, orderId: order.id, kind: "sim", iccid: body.iccid, status: "pending" });
    const synced = await viaProvider(() => orders.sync(order));
    const fresh = (await catalog.listDevicesByOrder(order.id)).find((d) => d.id === device.id) ?? device;
    return { order: orderDto(synced), device: deviceDto(fresh) };
  });

  app.post("/v1/catalog/orders/:id/esim", auth, async (req): Promise<EsimResponse> => {
    const body = parse(Esim, req.body ?? {});
    const { account, order } = await ownOrder(req);
    const existing = (await catalog.listDevicesByOrder(order.id)).find((d) => d.kind === "esim" && d.activationCodeEncrypted);
    if (existing) return esimResponse(order, existing); // idempotent: the same profile, never a second one
    requireMobileAtProvider(order);
    if (order.simKind !== "esim") throw conflict("sim_kind_mismatch", "Cette commande utilise une carte SIM physique.");
    const provider = orders.provider();
    const r = await viaProvider(() => provider.activateEsim({ providerOrderId: order.providerOrderId!, eid: body.eid ?? null }));
    const device = await catalog.createDevice({
      telecomAccountId: account.id,
      orderId: order.id,
      kind: "esim",
      iccid: r.iccid,
      eid: body.eid ?? null,
      activationCodeEncrypted: cipher.encrypt(r.activationCode),
      status: "pending",
    });
    await orders.note(order, { actor: "customer", userId: order.userId }, { esim: "profile_reserved", iccid: r.iccid });
    return esimResponse(await viaProvider(() => orders.sync(order)), device);
  });

  app.get("/v1/catalog/orders/:id/esim", auth, async (req): Promise<EsimResponse> => {
    const { order } = await ownOrder(req);
    const device = (await catalog.listDevicesByOrder(order.id)).find((d) => d.kind === "esim" && d.activationCodeEncrypted);
    if (!device) throw notFound("esim_not_found", "Aucune eSIM pour cette commande.");
    return esimResponse(order, device);
  });

  async function esimResponse(order: OrderRow, device: DeviceRow): Promise<EsimResponse> {
    const fresh = (await catalog.listDevicesByOrder(order.id)).find((d) => d.id === device.id) ?? device;
    const activationCode = cipher.decrypt(fresh.activationCodeEncrypted!);
    const [, smdpAddress = "", matchingId = ""] = activationCode.split("$");
    return { order: orderDto(order), device: deviceDto(fresh), activationCode, smdpAddress, matchingId };
  }

  // ------------------------------------------------------------------------------- port-in

  app.post("/v1/catalog/orders/:id/porting", auth, async (req, reply) => {
    const body = parse(PortIn, req.body);
    const { account, order } = await ownOrder(req);
    if (order.productLine !== "mobile") throw conflict("not_mobile", "Le transfert de numéro est réservé aux forfaits mobiles.");
    const allowed: OrderState[] = ["submitted", "credit_check", "pending_provider"];
    if (!allowed.includes(order.state)) throw conflict("order_not_ready", "Soumettez la commande avant de transférer votre numéro.");
    const phone = phoneE164(body.phoneNumber);
    if (!phone) throw badRequest("invalid_phone_number", "Numéro canadien invalide.");
    const fields = {
      phoneE164: phone,
      losingCarrier: body.losingCarrier,
      authorizedName: body.authorizedName,
      accountNumberEncrypted: cipher.encrypt(body.accountNumber),
      pinEncrypted: body.pin ? cipher.encrypt(body.pin) : null,
      imeiEncrypted: body.imei ? cipher.encrypt(body.imei) : null,
    };
    const existing = await catalog.getPortingRequestByOrder(order.id);
    if (existing && existing.status !== "rejected" && existing.status !== "cancelled") throw conflict("porting_exists", "Un transfert est déjà en cours pour cette commande.");
    let porting = existing
      ? await catalog.updatePortingRequest(existing.id, { ...fields, status: "pending", providerRef: null, rejectReason: null, dueAt: null, completedAt: null })
      : await catalog.createPortingRequest({ orderId: order.id, telecomAccountId: account.id, status: "pending", ...fields });
    if (order.providerOrderId) porting = await viaProvider(() => orders.sendPortIn(order, porting));
    return reply.code(201).send(portingDto(porting));
  });

  app.get("/v1/catalog/orders/:id/porting", auth, async (req) => {
    const { order } = await ownOrder(req);
    const porting = await catalog.getPortingRequestByOrder(order.id);
    if (!porting) throw notFound("porting_not_found", "Aucun transfert de numéro pour cette commande.");
    return portingDto(porting);
  });

  // ---------------------------------------------------------------------------------- admin

  app.get("/v1/admin/catalog/offers", admin, async (): Promise<AdminOffersResponse> => ({ offers: (await catalog.listOffers()).map(wire) }));

  app.post("/v1/admin/catalog/offers", admin, async (req, reply) => {
    const b = parse(CreateOffer, req.body);
    if (await catalog.getOfferByCode(b.code)) throw conflict("offer_code_taken", "Ce code d'offre existe déjà.");
    const offer = await catalog.createOffer({
      code: b.code,
      productLine: b.productLine as OfferRow["productLine"],
      provider: b.provider,
      providerProductCode: b.providerProductCode ?? null,
      name: b.name,
      description: b.description,
      monthlyPriceCents: b.monthlyPriceCents,
      setupFeeCents: b.setupFeeCents ?? 0,
      termMonths: b.termMonths ?? 0,
      discountCents: b.discountCents ?? 0,
      attributes: (b.attributes ?? {}) as OfferRow["attributes"],
      availableFsas: b.availableFsas?.map((f) => f.toUpperCase()) ?? null,
      status: b.status ?? "draft",
      stripePriceId: b.stripePriceId ?? null,
    });
    await repo.audit({ actorUserId: req.userId, action: "catalog.offer_created", targetType: "offer", targetId: offer.id, meta: { code: offer.code } });
    return reply.code(201).send(wire(offer));
  });

  app.patch("/v1/admin/catalog/offers/:id", admin, async (req) => {
    const { id } = parse(Id, req.params);
    const b = parse(UpdateOffer, req.body);
    if (!(await catalog.getOffer(id))) throw notFound("offer_not_found", "Offre introuvable.");
    const patch = { ...b, ...(b.availableFsas ? { availableFsas: b.availableFsas.map((f) => f.toUpperCase()) } : {}) } as Partial<OfferRow>;
    const offer = await catalog.updateOffer(id, patch);
    await repo.audit({ actorUserId: req.userId, action: "catalog.offer_updated", targetType: "offer", targetId: id, meta: { fields: Object.keys(b) } });
    return wire(offer);
  });

  app.get("/v1/admin/catalog/orders", admin, async (req): Promise<AdminOrdersResponse> => {
    const q = parse(z.object({ state: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const states = q.state ? q.state.split(",").map((s) => s.trim()) : ORDER_STATES.filter((s) => s !== "cancelled" && s !== "failed");
    if (states.some((s) => !ORDER_STATES.includes(s as OrderState))) throw badRequest("invalid_state", "État de commande inconnu.");
    return { orders: (await catalog.listOrdersInStates(states as OrderState[], q.limit)).map(orderDto) };
  });

  app.post("/v1/admin/catalog/orders/:id/events", admin, async (req): Promise<ServiceOrder> => {
    const { id } = parse(Id, req.params);
    const b = parse(AdminEvent, req.body);
    const order = await catalog.getOrder(id);
    if (!order) throw notFound("order_not_found", "Commande introuvable.");
    const updated = await viaProvider(() => orders.adminEvent(order, b.event as Parameters<OrderService["adminEvent"]>[1], req.userId, b.reason));
    await repo.audit({ actorUserId: req.userId, action: "catalog.order_event", targetType: "service_order", targetId: id, meta: { event: b.event } });
    return orderDto(updated);
  });

  app.post("/v1/admin/catalog/orders/:id/sync", admin, async (req): Promise<ServiceOrder> => {
    const { id } = parse(Id, req.params);
    const order = await catalog.getOrder(id);
    if (!order) throw notFound("order_not_found", "Commande introuvable.");
    return orderDto(await viaProvider(() => orders.sync(order)));
  });

  // -------------------------------------------------------------------- wholesaler webhooks

  // Signature checked by the adapter over the raw body (Vidéotron: HMAC-SHA256 with VIDEOTRON_WEBHOOK_SECRET).
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.post("/webhooks/provisioning/:provider", { config: { rateLimit: false } }, async (req, reply) => {
      const { provider: code } = parse(z.object({ provider: z.enum(["videotron", "sandbox"]) }), req.params);
      const provider = orders.provider();
      if (provider.code !== code) throw notFound("provider_not_active", "Ce fournisseur n'est pas actif.");
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : "");
      let events;
      try {
        events = provider.normalizeEvents({ headers: req.headers, rawBody });
      } catch (err) {
        if (err instanceof ProviderNotConfiguredError) throw new HttpError(503, "not_configured", "Provider webhooks are not configured on this server");
        if (err instanceof ProviderRejectedError && err.code === "bad_signature") throw new HttpError(401, "invalid_signature", "Signature verification failed");
        if (err instanceof SyntaxError) throw badRequest("invalid_body", "Invalid JSON");
        throw err;
      }
      const applied = await orders.applyEvents(provider, events, req.log);
      return reply.code(200).send({ received: events.length, applied });
    });
  });
}
