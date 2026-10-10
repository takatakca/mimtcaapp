import {
  computeCancellation,
  generateContractSummary,
  isInternetLine,
  isTerminalOrderState,
  nextOrderState,
  type CancellationQuote,
  type ContractSummary,
  type OrderEvent,
  type OrderEventRecord,
  type OrderState,
} from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { conflict, HttpError, notConfigured } from "../lib/errors.js";
import type { CatalogRepository, OfferRow, OrderRow, PortingRow, ServiceRow } from "../repo/catalog.js";
import type { User } from "../repo/types.js";
import {
  ProviderNotConfiguredError,
  ProviderRejectedError,
  type ProviderEvent,
  type ProviderOrderStatus,
  type ProvisioningProvider,
} from "./providers/types.js";

// Order lifecycle on top of the pure state machine (packages/shared/src/catalog.ts) and the
// provisioning adapter. Every transition is a compare-and-set on the state plus an audit event.
// Flow and responsibilities: docs/MIMT-RESALE.md.

type Actor = OrderEventRecord["actor"];
interface By {
  actor: Actor;
  userId: string | null;
}

export const SYSTEM: By = { actor: "system", userId: null };
const PROVIDER: By = { actor: "provider", userId: null };

/** States where the wholesaler holds the order (cancelling needs its confirmation). */
const AT_PROVIDER: readonly OrderState[] = ["pending_provider", "scheduled", "active", "suspended"];
/** States cancelled at once, before the wholesaler has the order. */
const LOCAL_ONLY: readonly OrderState[] = ["draft", "submitted", "credit_check"];

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

/** Maps adapter errors to HTTP: rejected → 422 (or the adapter's 4xx), not configured → 503. */
export async function viaProvider<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) throw notConfigured("Internet/mobile provisioning");
    if (err instanceof ProviderRejectedError) {
      const status = err.status && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 404 ? err.status : 422;
      throw new HttpError(status, `provider_${err.code}`, err.message);
    }
    throw err;
  }
}

/** Contract summary for the price and term frozen on the order (not the offer's current price). */
export function orderContractSummary(order: OrderRow, offer: OfferRow): ContractSummary {
  return generateContractSummary({
    code: offer.code,
    productLine: order.productLine,
    name: offer.name,
    description: offer.description,
    attributes: offer.attributes,
    monthlyPriceCents: order.monthlyPriceCents,
    setupFeeCents: order.setupFeeCents,
    termMonths: order.termMonths,
    discountCents: order.discountCents,
  });
}

export class OrderService {
  constructor(private readonly deps: AppDeps) {}

  private get repo(): CatalogRepository {
    return this.deps.repo.catalog;
  }

  /** The configured wholesaler, or 503 not_configured. */
  provider(): ProvisioningProvider {
    if (!this.deps.provisioning) throw notConfigured("Internet/mobile ordering");
    return this.deps.provisioning;
  }

  /** Applies one event: state-machine check, compare-and-set, audit row. */
  async transition(order: OrderRow, event: OrderEvent, by: By, details: Record<string, unknown> = {}, patch: Partial<OrderRow> = {}): Promise<OrderRow> {
    const to = nextOrderState(order, event);
    if (!to) throw conflict("invalid_transition", `Action « ${event} » impossible : la commande est à l'état « ${order.state} ».`);
    const updated = await this.repo.updateOrder(order.id, order.state, { ...patch, state: to });
    if (!updated) throw conflict("order_changed", "La commande vient de changer. Réessayez.");
    await this.repo.addOrderEvent({ orderId: order.id, event, fromState: order.state, toState: to, actor: by.actor, actorUserId: by.userId, details, at: this.deps.now() });
    return updated;
  }

  async note(order: OrderRow, by: By, details: Record<string, unknown>) {
    await this.repo.addOrderEvent({ orderId: order.id, event: "note", fromState: order.state, toState: order.state, actor: by.actor, actorUserId: by.userId, details, at: this.deps.now() });
  }

  /** After submit: term contracts wait for a credit check; month to month goes to the wholesaler. */
  async afterSubmit(order: OrderRow, user: User): Promise<OrderRow> {
    if (order.termMonths > 0) {
      // No credit bureau is connected yet: an admin approves or declines (POST /v1/admin/catalog/orders/:id/events).
      return this.transition(order, "credit_check_started", SYSTEM, { mode: "manual" });
    }
    const approved = await this.transition(order, "credit_approved", SYSTEM, { reason: "no_term" });
    return this.dispatch(approved, user);
  }

  /** Sends a pending_provider order that has no wholesaler reference yet. Safe to call again. */
  async dispatch(order: OrderRow, user?: User | null): Promise<OrderRow> {
    if (order.state !== "pending_provider" || order.providerOrderId) return order;
    const provider = this.provider();
    const owner = user ?? (await this.deps.repo.getUser(order.userId));
    const porting = await this.repo.getPortingRequestByOrder(order.id);
    let status: ProviderOrderStatus;
    try {
      status = await provider.submitOrder({
        idempotencyKey: order.id,
        productLine: order.productLine,
        offerCode: order.offerCode,
        providerProductCode: (await this.repo.getOffer(order.offerId))?.providerProductCode ?? null,
        customer: {
          name: owner?.displayName ?? "Client MIMT",
          email: owner?.email ?? null,
          phone: owner?.phoneE164 ?? null,
          locale: owner?.locale ?? "fr-CA",
        },
        serviceAddress: order.serviceAddress,
        simKind: order.simKind,
        iccid: null,
        imei: null,
        eid: null,
        portIn: Boolean(porting && porting.status !== "rejected" && porting.status !== "cancelled"),
      });
    } catch (err) {
      if (err instanceof ProviderRejectedError) {
        return this.transition(order, "provider_rejected", PROVIDER, { code: err.code }, { failureReason: err.message });
      }
      // Not configured, timeout, 5xx: stays in pending_provider, the next sync retries.
      await this.note(order, SYSTEM, { submitFailed: err instanceof Error ? err.name : "error" });
      return order;
    }
    let current = await this.transition(order, "provider_accepted", PROVIDER, { providerOrderId: status.providerOrderId }, { providerOrderId: status.providerOrderId });
    if (porting && porting.status === "pending") await this.sendPortIn(current, porting);
    current = await this.applyProviderStatus(current, status);
    return current;
  }

  /** Sends a stored port-in request to the wholesaler (secrets decrypted only for this call). */
  async sendPortIn(order: OrderRow, porting: PortingRow): Promise<PortingRow> {
    if (!order.providerOrderId) return porting;
    const { cipher } = this.deps;
    const r = await this.provider().portIn({
      providerOrderId: order.providerOrderId,
      phoneE164: porting.phoneE164,
      losingCarrier: porting.losingCarrier,
      authorizedName: porting.authorizedName,
      accountNumber: cipher.decrypt(porting.accountNumberEncrypted),
      pin: porting.pinEncrypted ? cipher.decrypt(porting.pinEncrypted) : null,
      imei: porting.imeiEncrypted ? cipher.decrypt(porting.imeiEncrypted) : null,
    });
    const updated = await this.repo.updatePortingRequest(porting.id, { status: "submitted", providerRef: r.portRef, dueAt: r.dueAt, rejectReason: null });
    await this.note(order, SYSTEM, { portIn: "submitted", portRef: r.portRef });
    return updated;
  }

  /** Pulls the wholesaler's view of the order (and of the port-in) and applies it. */
  async sync(order: OrderRow): Promise<OrderRow> {
    if (isTerminalOrderState(order.state)) return order;
    if (order.state === "pending_provider" && !order.providerOrderId) return this.dispatch(order);
    if (!order.providerOrderId || LOCAL_ONLY.includes(order.state)) return order;
    const provider = this.provider();
    const porting = await this.repo.getPortingRequestByOrder(order.id);
    if (porting?.status === "pending") await this.sendPortIn(order, porting);
    else if (porting?.providerRef && (porting.status === "submitted" || porting.status === "confirmed")) {
      const ps = await provider.getPortStatus(porting.providerRef);
      await this.applyPortStatus(porting, ps);
    }
    const status = await provider.getOrderStatus(order.providerOrderId);
    return this.applyProviderStatus(order, status);
  }

  async applyPortStatus(porting: PortingRow, ps: { status: PortingRow["status"]; dueAt: Date | null; reason: string | null }) {
    if (ps.status === porting.status) return porting;
    return this.repo.updatePortingRequest(porting.id, {
      status: ps.status,
      dueAt: ps.dueAt ?? porting.dueAt,
      rejectReason: ps.status === "rejected" ? ps.reason : null,
      completedAt: ps.status === "completed" ? this.deps.now() : porting.completedAt,
    });
  }

  /** Maps a wholesaler order status onto our state machine. Idempotent. */
  async applyProviderStatus(order: OrderRow, status: ProviderOrderStatus, by: By = PROVIDER): Promise<OrderRow> {
    const s = order.state;
    switch (status.phase) {
      case "scheduled": {
        if (!status.appointment) return order;
        const existing = (await this.repo.listAppointmentsByOrder(order.id)).find((a) => a.providerRef === status.appointment!.ref && a.status === "booked");
        if (!existing) await this.bookAppointmentRow(order, status.appointment);
        if (s === "pending_provider" || (s === "scheduled" && !existing)) {
          return this.transition(order, "appointment_scheduled", by, { ref: status.appointment.ref, startsAt: status.appointment.startsAt.toISOString() });
        }
        return order;
      }
      case "completed":
        if (s === "pending_provider" || s === "scheduled") return this.activate(order, status, by);
        return order;
      case "rejected":
        if (s === "pending_provider" || s === "scheduled") return this.transition(order, "provider_rejected", by, {}, { failureReason: status.reason ?? "Refusée par le fournisseur" });
        return order;
      case "cancelled":
        return this.confirmCancelled(order, by);
      default:
        return order;
    }
  }

  async bookAppointmentRow(order: OrderRow, appt: { ref: string; startsAt: Date; endsAt: Date }) {
    for (const a of await this.repo.listAppointmentsByOrder(order.id)) {
      if (a.status === "booked") await this.repo.updateAppointment(a.id, { status: "cancelled" });
    }
    return this.repo.createAppointment({ orderId: order.id, providerRef: appt.ref, startsAt: appt.startsAt, endsAt: appt.endsAt, status: "booked" });
  }

  private async activate(order: OrderRow, status: ProviderOrderStatus, by: By): Promise<OrderRow> {
    const now = this.deps.now();
    const active = await this.transition(order, "activated", by, { providerServiceId: status.providerServiceId }, { activatedAt: now });
    const service =
      (await this.repo.getServiceByOrder(order.id)) ??
      (await this.repo.createService({
        telecomAccountId: order.telecomAccountId,
        orderId: order.id,
        offerId: order.offerId,
        offerCode: order.offerCode,
        productLine: order.productLine,
        provider: order.provider,
        providerServiceId: status.providerServiceId,
        status: "active",
        phoneE164: status.phoneE164,
        serviceAddress: order.serviceAddress,
        monthlyPriceCents: order.monthlyPriceCents,
        termMonths: order.termMonths,
        discountCents: order.discountCents,
        activatedAt: now,
        termEndsAt: order.termMonths > 0 ? addMonths(now, order.termMonths) : null,
      }));
    for (const d of await this.repo.listDevicesByOrder(order.id)) {
      if (d.status === "pending" || d.status === "shipped") await this.repo.updateDevice(d.id, { status: "active", serviceId: service.id });
    }
    for (const a of await this.repo.listAppointmentsByOrder(order.id)) {
      if (a.status === "booked") await this.repo.updateAppointment(a.id, { status: "completed" });
    }
    const porting = await this.repo.getPortingRequestByOrder(order.id);
    if (porting && porting.status !== "completed" && porting.status !== "rejected" && porting.status !== "cancelled") {
      await this.repo.updatePortingRequest(porting.id, { status: "completed", completedAt: now });
    }
    // TODO(billing): start the Stripe subscription (monthlyPriceCents + setupFeeCents) here once resale billing is decided.
    return active;
  }

  /** The wholesaler confirmed a cancellation (or cancelled on its own). */
  private async confirmCancelled(order: OrderRow, by: By): Promise<OrderRow> {
    let o = order;
    if (isTerminalOrderState(o.state)) return o;
    if (o.state !== "cancel_requested") o = await this.transition(o, "cancel_requested", by, { initiatedBy: "provider" });
    if (o.state === "cancelled") return o;
    const now = this.deps.now();
    o = await this.transition(o, "cancel_confirmed", by, {}, { cancelledAt: now });
    const service = await this.repo.getServiceByOrder(o.id);
    if (service && service.status !== "cancelled") await this.repo.updateService(service.id, { status: "cancelled", cancelledAt: now });
    return o;
  }

  /** Early cancellation fee (Wireless / Internet Code), as if cancelled now. */
  async quote(order: OrderRow): Promise<CancellationQuote> {
    const now = this.deps.now();
    const devices = await this.repo.listDevicesByOrder(order.id);
    const service = await this.repo.getServiceByOrder(order.id);
    let usageFraction: number | undefined;
    if (service && order.productLine === "mobile") usageFraction = await this.usageFraction(service, order);
    const r = computeCancellation({
      productLine: order.productLine,
      termMonths: order.termMonths,
      discountCents: order.discountCents,
      monthlyPriceCents: order.monthlyPriceCents,
      activatedAt: order.activatedAt,
      cancelAt: now,
      deviceBalanceCents: devices.reduce((sum, d) => sum + d.financedBalanceCents, 0),
      ...(usageFraction === undefined ? {} : { usageFraction }),
    });
    return {
      orderId: order.id,
      feeCents: r.feeCents,
      deviceBalanceCents: r.deviceBalanceCents,
      totalCents: r.totalCents,
      basis: r.basis,
      inTrial: r.inTrial,
      monthsRemaining: r.monthsRemaining,
      effectiveAt: r.effectiveAt.toISOString(),
      explanation: r.explanation,
    };
  }

  private async usageFraction(service: ServiceRow, order: OrderRow): Promise<number | undefined> {
    const offer = await this.repo.getOffer(order.offerId);
    const gb = offer?.attributes.dataGb;
    const snap = await this.repo.getLatestUsageSnapshot(service.id);
    if (!gb || !snap) return undefined;
    return snap.dataMb / (gb * 1024);
  }

  /**
   * Customer (or admin) cancellation. Takes effect the day the notice is received; before the
   * wholesaler has the order it is cancelled at once, otherwise it waits for its confirmation.
   */
  async cancel(order: OrderRow, by: By): Promise<{ order: OrderRow; cancellation: CancellationQuote }> {
    const cancellation = await this.quote(order);
    const details = { feeCents: cancellation.feeCents, deviceBalanceCents: cancellation.deviceBalanceCents, basis: cancellation.basis };
    const now = this.deps.now();
    if (LOCAL_ONLY.includes(order.state)) {
      const o = await this.transition(order, "cancel_requested", by, details, { cancelledAt: now });
      return { order: o, cancellation };
    }
    if (!AT_PROVIDER.includes(order.state)) throw conflict("order_not_cancellable", "Cette commande ne peut plus être annulée.");
    const service = await this.repo.getServiceByOrder(order.id);
    const hasProviderRef = Boolean(order.providerOrderId || service?.providerServiceId);
    const provider = hasProviderRef ? this.provider() : null;
    let o = await this.transition(order, "cancel_requested", by, details);
    if (!provider) return { order: await this.confirmCancelled(o, SYSTEM), cancellation };
    try {
      const r = await provider.cancel({ providerOrderId: o.providerOrderId, providerServiceId: service?.providerServiceId ?? null }, now);
      if (!r.pending) o = await this.confirmCancelled(o, PROVIDER);
    } catch (err) {
      // The notice is recorded (cancel_requested); the next sync or an admin retries with the wholesaler.
      await this.note(o, SYSTEM, { cancelFailed: err instanceof Error ? err.name : "error" });
    }
    return { order: o, cancellation };
  }

  /** Admin-applied events, with their side effects at the wholesaler. */
  async adminEvent(order: OrderRow, event: OrderEvent, adminUserId: string, reason: string | undefined): Promise<OrderRow> {
    const by: By = { actor: "admin", userId: adminUserId };
    const details = reason ? { reason } : {};
    switch (event) {
      case "credit_approved": {
        const o = await this.transition(order, event, by, details);
        return this.dispatch(o);
      }
      case "credit_declined":
      case "fail":
        return this.transition(order, event, by, details, { failureReason: reason ?? (event === "credit_declined" ? "Crédit refusé" : "Échec technique") });
      case "suspended":
      case "restored": {
        if (!nextOrderState(order, event)) return this.transition(order, event, by, details); // throws invalid_transition
        const service = await this.repo.getServiceByOrder(order.id);
        if (service?.providerServiceId) {
          const provider = this.provider();
          await viaProvider(() => (event === "suspended" ? provider.suspend(service.providerServiceId!, "customer_request") : provider.restore(service.providerServiceId!)));
        }
        const o = await this.transition(order, event, by, details);
        if (service) await this.repo.updateService(service.id, { status: event === "suspended" ? "suspended" : "active" });
        return o;
      }
      case "cancel_requested":
        return (await this.cancel(order, by)).order;
      case "cancel_confirmed":
        if (order.state !== "cancel_requested") return this.transition(order, event, by, details); // throws invalid_transition
        return this.confirmCancelled(order, by);
      default:
        throw new HttpError(400, "event_not_allowed", `Événement « ${event} » réservé au système ou au fournisseur.`);
    }
  }

  /** Applies normalized webhook events. Unknown references are ignored; returns how many were applied. */
  async applyEvents(provider: ProvisioningProvider, events: ProviderEvent[], log: { warn: (o: object, m: string) => void }): Promise<number> {
    let applied = 0;
    for (const e of events) {
      try {
        if (e.type === "order.updated") {
          const order = await this.repo.getOrderByProviderRef(provider.code, e.providerOrderId);
          if (!order) continue;
          await this.applyProviderStatus(order, e.status);
        } else if (e.type === "port.updated") {
          const porting = await this.repo.getPortingRequestByProviderRef(e.portRef);
          if (!porting) continue;
          await this.applyPortStatus(porting, e.status);
        } else {
          const service = await this.repo.getServiceByProviderId(provider.code, e.providerServiceId);
          if (!service) continue;
          if (e.type === "usage.updated") {
            await this.repo.addUsageSnapshot({ serviceId: service.id, ...e.usage });
          } else {
            await this.applyServiceEvent(service, e.type);
          }
        }
        applied++;
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 409) {
          log.warn({ type: e.type, code: err.code }, "provider event ignored (state conflict)");
          continue;
        }
        throw err;
      }
    }
    return applied;
  }

  private async applyServiceEvent(service: ServiceRow, type: "service.suspended" | "service.restored" | "service.cancelled") {
    const order = await this.repo.getOrder(service.orderId);
    if (!order) return;
    if (type === "service.cancelled") {
      await this.confirmCancelled(order, PROVIDER);
      return;
    }
    const event = type === "service.suspended" ? "suspended" : "restored";
    if (!nextOrderState(order, event)) return;
    await this.transition(order, event, PROVIDER);
    await this.repo.updateService(service.id, { status: event === "suspended" ? "suspended" : "active" });
  }
}

export const needsServiceAddress = (line: OrderRow["productLine"]) => isInternetLine(line) || line === "home_phone";
