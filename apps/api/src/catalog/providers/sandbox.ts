import { createHash, createHmac } from "node:crypto";
import { fsaOf, isInternetLine, normalizePostalCode, type ProductLine } from "@mimt/shared";
import { safeEqual } from "../../lib/crypto.js";
import {
  ProviderRejectedError,
  type AppointmentSlot,
  type AvailabilityQuery,
  type AvailabilityResult,
  type EsimActivation,
  type PortInInput,
  type PortStatus,
  type ProviderEvent,
  type ProviderOrderInput,
  type ProviderOrderStatus,
  type ProviderUsage,
  type ProvisioningProvider,
  type SimActivation,
  type SuspendReason,
} from "./types.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Timings of the fake wholesaler (exported so tests can advance the clock past them). */
export const SANDBOX_TIMINGS = {
  /** Order acknowledged → needs appointment (internet) / ready (mobile). */
  processingMs: 5 * MIN,
  /** Port-in: submitted → confirmed → completed. */
  portConfirmMs: 30 * MIN,
  portCompleteMs: 2 * HOUR,
} as const;

export const SANDBOX_WEBHOOK_SECRET = "sandbox-webhook-secret";

interface SandboxOrder {
  id: string;
  input: ProviderOrderInput;
  createdAt: Date;
  appointment: { ref: string; startsAt: Date; endsAt: Date } | null;
  activated: boolean;
  cancelledAt: Date | null;
  portRef: string | null;
}

interface SandboxPort {
  ref: string;
  orderId: string;
  phoneE164: string;
  createdAt: Date;
  rejected: boolean;
}

const hashInt = (s: string) => createHash("sha256").update(s).digest().readUInt32BE(0);

/** Quebec FSAs start with G, H or J. A "0" in second position is a rural FSA: no wired internet in the sandbox. */
export function sandboxCoverage(fsa: string): { lines: ProductLine[]; technology: AvailabilityResult["technology"]; maxDownloadMbps: number | null } {
  const quebec = /^[GHJ]/.test(fsa);
  if (!quebec) return { lines: [], technology: null, maxDownloadMbps: null };
  const wired = fsa[1] !== "0";
  return {
    lines: wired ? ["mobile", "internet_residential", "internet_business", "home_phone"] : ["mobile"],
    technology: wired ? (fsa.startsWith("H") ? "fibre" : "cable") : null,
    maxDownloadMbps: wired ? (fsa.startsWith("H") ? 1000 : 400) : null,
  };
}

/**
 * Fully working fake wholesaler for dev and tests: deterministic, driven by the injected clock.
 * - Availability by FSA (see sandboxCoverage).
 * - Internet: received → awaiting_appointment (after 5 min) → scheduled → completed once the slot ends.
 * - Mobile: completed 5 min after the SIM/eSIM is activated; with a port-in, once the port completes (2 h).
 * - Port-in rejected when the account number is "REJECT" or the PIN is "0000".
 */
export class SandboxProvisioningProvider implements ProvisioningProvider {
  readonly code = "sandbox" as const;
  private readonly orders = new Map<string, SandboxOrder>();
  private readonly ports = new Map<string, SandboxPort>();
  private readonly suspended = new Set<string>();
  private readonly cancelledServices = new Set<string>();
  private readonly usageOverrides = new Map<string, Partial<ProviderUsage>>();
  /** Every call, for assertions in tests (secrets are masked). */
  readonly calls: Array<{ method: string; args: unknown }> = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  private log(method: string, args: unknown) {
    this.calls.push({ method, args });
  }

  async checkAvailability(q: AvailabilityQuery): Promise<AvailabilityResult> {
    this.log("checkAvailability", q);
    const postal = normalizePostalCode(q.postalCode);
    const fsa = fsaOf(q.postalCode);
    if (!fsa) throw new ProviderRejectedError("Invalid postal code", "invalid_postal_code", 400);
    const cov = sandboxCoverage(fsa);
    const wired = cov.lines.some(isInternetLine);
    return {
      postalCode: postal ?? fsa,
      fsa,
      productLines: cov.lines,
      providerProductCodes: null,
      maxDownloadMbps: cov.maxDownloadMbps,
      technology: cov.technology,
      installRequired: wired,
      earliestInstallAt: wired ? this.slotsFrom(this.now())[0]!.startsAt : null,
    };
  }

  async submitOrder(input: ProviderOrderInput): Promise<ProviderOrderStatus> {
    this.log("submitOrder", { ...input });
    const id = `SBX-${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 12).toUpperCase()}`;
    const existing = this.orders.get(id);
    if (existing) return this.status(existing); // idempotent
    if (input.productLine !== "mobile") {
      const fsa = input.serviceAddress ? fsaOf(input.serviceAddress.postalCode) : null;
      if (!fsa || !sandboxCoverage(fsa).lines.includes(input.productLine)) {
        throw new ProviderRejectedError("Address not serviceable", "address_not_serviceable", 422);
      }
    }
    const order: SandboxOrder = { id, input, createdAt: this.now(), appointment: null, activated: false, cancelledAt: null, portRef: null };
    this.orders.set(id, order);
    return this.status(order);
  }

  async getOrderStatus(providerOrderId: string): Promise<ProviderOrderStatus> {
    return this.status(this.order(providerOrderId));
  }

  async getAppointmentSlots(providerOrderId: string): Promise<AppointmentSlot[]> {
    this.order(providerOrderId);
    return this.slotsFrom(this.now());
  }

  async scheduleAppointment(providerOrderId: string, slot: AppointmentSlot) {
    const o = this.order(providerOrderId);
    if (!isInternetLine(o.input.productLine) && o.input.productLine !== "home_phone") {
      throw new ProviderRejectedError("No appointment for this product", "appointment_not_needed", 409);
    }
    const ok = this.slotsFrom(this.now()).some((s) => s.startsAt.getTime() === slot.startsAt.getTime());
    if (!ok) throw new ProviderRejectedError("Slot not available", "slot_unavailable", 409);
    o.appointment = { ref: `APT-${o.id.slice(4)}-${slot.startsAt.getTime() / MIN}`, startsAt: slot.startsAt, endsAt: slot.endsAt };
    this.log("scheduleAppointment", { providerOrderId, slot });
    return { ...o.appointment };
  }

  async activateSim(input: { providerOrderId: string; iccid: string }): Promise<SimActivation> {
    const o = this.order(input.providerOrderId);
    if (!/^89\d{17,18}$/.test(input.iccid)) throw new ProviderRejectedError("Invalid ICCID", "invalid_iccid", 422);
    o.activated = true;
    this.log("activateSim", input);
    return { iccid: input.iccid, phoneE164: o.input.portIn ? null : this.assignedNumber(o) };
  }

  async activateEsim(input: { providerOrderId: string; eid: string | null }): Promise<EsimActivation> {
    const o = this.order(input.providerOrderId);
    o.activated = true;
    this.log("activateEsim", input);
    const h = createHash("sha256").update(o.id).digest("hex").toUpperCase();
    const matchingId = `${h.slice(0, 5)}-${h.slice(5, 10)}-${h.slice(10, 15)}-${h.slice(15, 20)}`;
    const smdpAddress = "smdp.sandbox.mimt.test";
    const iccid = `8930200000${String(hashInt(o.id) % 1_000_000_000).padStart(9, "0")}`;
    return { iccid, smdpAddress, matchingId, activationCode: `LPA:1$${smdpAddress}$${matchingId}` };
  }

  async suspend(providerServiceId: string, reason: SuspendReason) {
    this.log("suspend", { providerServiceId, reason });
    this.suspended.add(providerServiceId);
  }

  async restore(providerServiceId: string) {
    this.log("restore", { providerServiceId });
    this.suspended.delete(providerServiceId);
  }

  async cancel(ref: { providerOrderId?: string | null; providerServiceId?: string | null }, effectiveAt: Date) {
    this.log("cancel", { ...ref, effectiveAt });
    if (ref.providerOrderId) {
      const o = this.orders.get(ref.providerOrderId);
      if (o && !o.cancelledAt) o.cancelledAt = effectiveAt;
    }
    if (ref.providerServiceId) this.cancelledServices.add(ref.providerServiceId);
    return { effectiveAt, pending: false };
  }

  async portIn(input: PortInInput) {
    // Never keep or log the account number / PIN / IMEI.
    this.log("portIn", { providerOrderId: input.providerOrderId, phoneE164: input.phoneE164, losingCarrier: input.losingCarrier, accountNumber: "***", pin: input.pin ? "***" : null, imei: input.imei ? "***" : null });
    const o = this.order(input.providerOrderId);
    const ref = `PORT-${o.id.slice(4)}`;
    const port: SandboxPort = { ref, orderId: o.id, phoneE164: input.phoneE164, createdAt: this.now(), rejected: input.accountNumber === "REJECT" || input.pin === "0000" };
    this.ports.set(ref, port);
    o.portRef = ref;
    return { portRef: ref, dueAt: new Date(port.createdAt.getTime() + SANDBOX_TIMINGS.portCompleteMs) };
  }

  async getPortStatus(portRef: string): Promise<PortStatus> {
    const p = this.ports.get(portRef);
    if (!p) throw new ProviderRejectedError("Unknown port", "unknown_port", 404);
    return this.portStatus(p);
  }

  async usage(providerServiceId: string, period: string): Promise<ProviderUsage> {
    const now = this.now();
    const day = period === now.toISOString().slice(0, 7) ? now.getUTCDate() : 30;
    const perDay = 200 + (hashInt(providerServiceId) % 400);
    return {
      period,
      dataMb: day * perDay,
      roamingDataMb: 0,
      voiceMinutes: day * 12,
      sms: day * 8,
      overageCents: 0,
      roamingCents: 0,
      capturedAt: now,
      ...this.usageOverrides.get(providerServiceId),
    };
  }

  /** Test helper: force usage figures for a service. */
  setUsage(providerServiceId: string, usage: Partial<ProviderUsage>) {
    this.usageOverrides.set(providerServiceId, usage);
  }

  /** Body: {"orders": ["SBX-..."]}, header x-sandbox-signature = hex HMAC-SHA256(body, SANDBOX_WEBHOOK_SECRET). */
  normalizeEvents(input: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer }): ProviderEvent[] {
    const sig = input.headers["x-sandbox-signature"];
    const expected = createHmac("sha256", SANDBOX_WEBHOOK_SECRET).update(input.rawBody).digest("hex");
    if (typeof sig !== "string" || !safeEqual(sig, expected)) throw new ProviderRejectedError("Bad signature", "bad_signature", 401);
    const body = JSON.parse(input.rawBody.toString("utf8")) as { orders?: string[] };
    return (body.orders ?? []).filter((id) => this.orders.has(id)).map((id) => ({ type: "order.updated" as const, providerOrderId: id, status: this.status(this.orders.get(id)!) }));
  }

  // -------------------------------------------------------------------------------- internals

  private order(id: string): SandboxOrder {
    const o = this.orders.get(id);
    if (!o) throw new ProviderRejectedError("Unknown order", "unknown_order", 404);
    return o;
  }

  private assignedNumber(o: SandboxOrder) {
    return `+1514555${String(hashInt(o.id) % 10_000).padStart(4, "0")}`;
  }

  private serviceId(o: SandboxOrder) {
    return `SVC-${o.id.slice(4)}`;
  }

  private portStatus(p: SandboxPort): PortStatus {
    const age = this.now().getTime() - p.createdAt.getTime();
    const dueAt = new Date(p.createdAt.getTime() + SANDBOX_TIMINGS.portCompleteMs);
    if (p.rejected) {
      return age >= SANDBOX_TIMINGS.portConfirmMs
        ? { status: "rejected", dueAt: null, reason: "Losing carrier: account number or PIN does not match" }
        : { status: "submitted", dueAt, reason: null };
    }
    if (age >= SANDBOX_TIMINGS.portCompleteMs) return { status: "completed", dueAt, reason: null };
    if (age >= SANDBOX_TIMINGS.portConfirmMs) return { status: "confirmed", dueAt, reason: null };
    return { status: "submitted", dueAt, reason: null };
  }

  private status(o: SandboxOrder): ProviderOrderStatus {
    const now = this.now();
    const base = { providerOrderId: o.id, providerServiceId: null, phoneE164: null, appointment: o.appointment ? { ...o.appointment } : null, reason: null };
    if (o.cancelledAt) return { ...base, phase: "cancelled" };
    const processed = now.getTime() - o.createdAt.getTime() >= SANDBOX_TIMINGS.processingMs;

    if (o.input.productLine === "mobile") {
      if (!processed || !o.activated) return { ...base, phase: "received" };
      if (o.portRef) {
        const p = this.portStatus(this.ports.get(o.portRef)!);
        if (p.status === "rejected") return { ...base, phase: "rejected", reason: p.reason };
        if (p.status !== "completed") return { ...base, phase: "received" };
        return { ...base, phase: "completed", providerServiceId: this.serviceId(o), phoneE164: this.ports.get(o.portRef)!.phoneE164 };
      }
      if (o.input.portIn) return { ...base, phase: "received" }; // waiting for the port request
      return { ...base, phase: "completed", providerServiceId: this.serviceId(o), phoneE164: this.assignedNumber(o) };
    }

    if (!processed) return { ...base, phase: "received" };
    if (!o.appointment) return { ...base, phase: "awaiting_appointment" };
    if (now < o.appointment.endsAt) return { ...base, phase: "scheduled" };
    return { ...base, phase: "completed", providerServiceId: this.serviceId(o), phoneE164: o.input.productLine === "home_phone" ? this.assignedNumber(o) : null };
  }

  /** Two slots (9–13 h and 13–17 h Eastern ≈ 13–17 and 17–21 UTC) on each of the next 3 weekdays, starting 2 days out. */
  private slotsFrom(now: Date): AppointmentSlot[] {
    const slots: AppointmentSlot[] = [];
    let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 2 * DAY);
    while (slots.length < 6) {
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) {
        for (const h of [13, 17]) slots.push({ startsAt: new Date(d.getTime() + h * HOUR), endsAt: new Date(d.getTime() + (h + 4) * HOUR) });
      }
      d = new Date(d.getTime() + DAY);
    }
    return slots;
  }
}
