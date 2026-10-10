import { createHmac } from "node:crypto";
import { fsaOf, type ProductLine } from "@mimt/shared";
import { safeEqual } from "../../lib/crypto.js";
import { ClientCredentialsTokenCache, JsonHttpClient, type FetchLike } from "./http.js";
import {
  ProviderNotConfiguredError,
  ProviderRejectedError,
  type AppointmentSlot,
  type AvailabilityQuery,
  type AvailabilityResult,
  type EsimActivation,
  type PortInInput,
  type PortStatus,
  type ProviderAppointment,
  type ProviderEvent,
  type ProviderOrderInput,
  type ProviderOrderPhase,
  type ProviderOrderStatus,
  type ProviderUsage,
  type ProvisioningProvider,
  type SimActivation,
  type SuspendReason,
} from "./types.js";

/*
 * Vidéotron wholesale adapter — SKELETON.
 *
 * TAKATAK/MIMT has a signed agreement with Vidéotron, but the technical interface (REST API,
 * reseller portal, SFTP files) is not known yet. Everything Vidéotron-specific is isolated here and
 * marked TODO(videotron). Paths, field names and status codes below are PLACEHOLDERS to be replaced
 * with the real specification (see docs/MIMT-RESALE.md › "Ce qu'il faut demander à Vidéotron").
 *
 * What is real and tested already: configuration, OAuth2 client-credentials token cache, HTTP client
 * (timeouts, retries, idempotency keys, reseller header), NotConfigured behaviour.
 * If Vidéotron only offers a portal or files, keep this interface and implement the methods with a
 * work queue (orders exported to SFTP, statuses imported by a job) instead of HTTP calls.
 */

export interface VideotronConfig {
  VIDEOTRON_API_BASE_URL?: string;
  VIDEOTRON_CLIENT_ID?: string;
  VIDEOTRON_CLIENT_SECRET?: string;
  VIDEOTRON_RESELLER_ID?: string;
  /** Defaults to `${VIDEOTRON_API_BASE_URL}/oauth2/token`. TODO(videotron): real token endpoint. */
  VIDEOTRON_TOKEN_URL?: string;
  /** Shared secret for their webhooks, if they push events. */
  VIDEOTRON_WEBHOOK_SECRET?: string;
}

const REQUIRED = ["VIDEOTRON_API_BASE_URL", "VIDEOTRON_CLIENT_ID", "VIDEOTRON_CLIENT_SECRET", "VIDEOTRON_RESELLER_ID"] as const;

export const videotronConfigured = (c: VideotronConfig) => REQUIRED.every((k) => Boolean(c[k]));

// TODO(videotron): replace with their real status vocabulary.
const PHASES: Record<string, ProviderOrderPhase> = {
  RECEIVED: "received",
  IN_PROGRESS: "received",
  PENDING_APPOINTMENT: "awaiting_appointment",
  SCHEDULED: "scheduled",
  COMPLETED: "completed",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
};

// TODO(videotron): their product families.
const LINES: Record<string, ProductLine> = {
  MOBILE: "mobile",
  INTERNET_RES: "internet_residential",
  INTERNET_BUS: "internet_business",
  HOME_PHONE: "home_phone",
};

interface VOrder {
  orderId: string;
  status: string;
  serviceId?: string | null;
  msisdn?: string | null;
  appointment?: { id: string; start: string; end: string } | null;
  reason?: string | null;
}

export class VideotronProvisioningProvider implements ProvisioningProvider {
  readonly code = "videotron" as const;
  private readonly http: JsonHttpClient | null;

  constructor(
    private readonly config: VideotronConfig,
    opts: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
  ) {
    if (!videotronConfigured(config)) {
      this.http = null;
      return;
    }
    const base = config.VIDEOTRON_API_BASE_URL!.replace(/\/$/, "");
    const tokens = new ClientCredentialsTokenCache({
      tokenUrl: config.VIDEOTRON_TOKEN_URL ?? `${base}/oauth2/token`,
      clientId: config.VIDEOTRON_CLIENT_ID!,
      clientSecret: config.VIDEOTRON_CLIENT_SECRET!,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
    this.http = new JsonHttpClient({
      baseUrl: base,
      tokens,
      // TODO(videotron): confirm how the reseller account is identified (header, path, token claim).
      defaultHeaders: { "x-reseller-id": config.VIDEOTRON_RESELLER_ID!, "accept-language": "fr-CA" },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
  }

  private api(): JsonHttpClient {
    if (!this.http) {
      const missing = REQUIRED.filter((k) => !this.config[k]);
      throw new ProviderNotConfiguredError("videotron", `missing ${missing.join(", ")}`);
    }
    return this.http;
  }

  async checkAvailability(q: AvailabilityQuery): Promise<AvailabilityResult> {
    // TODO(videotron): serviceability / address qualification endpoint.
    const r = await this.api().request<{
      products: Array<{ family: string; code: string }>;
      maxDownloadMbps?: number;
      technology?: "cable" | "fibre" | "fixed_wireless";
      installRequired?: boolean;
      earliestInstall?: string;
    }>({ method: "GET", path: "/serviceability", query: { postalCode: q.postalCode.replace(/\s+/g, ""), street: q.street, unit: q.unit ?? undefined, city: q.city } });
    const fsa = fsaOf(q.postalCode) ?? "";
    const lines = [...new Set(r.products.map((p) => LINES[p.family]).filter((x): x is ProductLine => Boolean(x)))];
    return {
      postalCode: q.postalCode,
      fsa,
      productLines: lines,
      providerProductCodes: r.products.map((p) => p.code),
      maxDownloadMbps: r.maxDownloadMbps ?? null,
      technology: r.technology ?? null,
      installRequired: r.installRequired ?? false,
      earliestInstallAt: r.earliestInstall ? new Date(r.earliestInstall) : null,
    };
  }

  async submitOrder(input: ProviderOrderInput): Promise<ProviderOrderStatus> {
    // TODO(videotron): order creation payload. Our order id is both the idempotency key and their external reference.
    const r = await this.api().request<VOrder>({
      method: "POST",
      path: "/orders",
      idempotencyKey: input.idempotencyKey,
      body: {
        externalReference: input.idempotencyKey,
        productCode: input.providerProductCode ?? input.offerCode,
        customer: { name: input.customer.name, email: input.customer.email, phone: input.customer.phone, language: input.customer.locale === "fr-CA" ? "fr" : "en" },
        serviceAddress: input.serviceAddress && {
          street: input.serviceAddress.street,
          unit: input.serviceAddress.unit,
          city: input.serviceAddress.city,
          province: input.serviceAddress.province,
          postalCode: input.serviceAddress.postalCode.replace(/\s+/g, ""),
        },
        sim: input.simKind && { type: input.simKind === "esim" ? "ESIM" : "PSIM", iccid: input.iccid, eid: input.eid, imei: input.imei },
        portIn: input.portIn,
      },
    });
    return mapOrder(r);
  }

  async getOrderStatus(providerOrderId: string) {
    return mapOrder(await this.api().request<VOrder>({ method: "GET", path: `/orders/${encodeURIComponent(providerOrderId)}` }));
  }

  async getAppointmentSlots(providerOrderId: string): Promise<AppointmentSlot[]> {
    // TODO(videotron): technician availability.
    const r = await this.api().request<{ slots: Array<{ start: string; end: string }> }>({ method: "GET", path: `/orders/${encodeURIComponent(providerOrderId)}/appointment-slots` });
    return r.slots.map((s) => ({ startsAt: new Date(s.start), endsAt: new Date(s.end) }));
  }

  async scheduleAppointment(providerOrderId: string, slot: AppointmentSlot): Promise<ProviderAppointment> {
    const r = await this.api().request<{ id: string; start: string; end: string }>({
      method: "POST",
      path: `/orders/${encodeURIComponent(providerOrderId)}/appointment`,
      idempotencyKey: `${providerOrderId}:appt:${slot.startsAt.toISOString()}`,
      body: { start: slot.startsAt.toISOString(), end: slot.endsAt.toISOString() },
    });
    return { ref: r.id, startsAt: new Date(r.start), endsAt: new Date(r.end) };
  }

  async activateSim(input: { providerOrderId: string; iccid: string }): Promise<SimActivation> {
    // TODO(videotron): SIM activation (may be part of the order itself).
    const r = await this.api().request<{ iccid: string; msisdn?: string | null }>({
      method: "POST",
      path: `/orders/${encodeURIComponent(input.providerOrderId)}/sim-activation`,
      idempotencyKey: `${input.providerOrderId}:sim:${input.iccid}`,
      body: { iccid: input.iccid },
    });
    return { iccid: r.iccid, phoneE164: r.msisdn ? toE164(r.msisdn) : null };
  }

  async activateEsim(input: { providerOrderId: string; eid: string | null }): Promise<EsimActivation> {
    // TODO(videotron): eSIM profile download (which SM-DP+? Vidéotron's or a partner's).
    const r = await this.api().request<{ iccid: string; smdpAddress: string; matchingId: string }>({
      method: "POST",
      path: `/orders/${encodeURIComponent(input.providerOrderId)}/esim`,
      idempotencyKey: `${input.providerOrderId}:esim`,
      body: { eid: input.eid },
    });
    return { iccid: r.iccid, smdpAddress: r.smdpAddress, matchingId: r.matchingId, activationCode: `LPA:1$${r.smdpAddress}$${r.matchingId}` };
  }

  async suspend(providerServiceId: string, reason: SuspendReason) {
    await this.api().request({ method: "POST", path: `/services/${encodeURIComponent(providerServiceId)}/suspend`, idempotencyKey: `${providerServiceId}:suspend:${reason}`, body: { reason: reason.toUpperCase() } });
  }

  async restore(providerServiceId: string) {
    await this.api().request({ method: "POST", path: `/services/${encodeURIComponent(providerServiceId)}/restore`, body: {} });
  }

  async cancel(ref: { providerOrderId?: string | null; providerServiceId?: string | null }, effectiveAt: Date) {
    const path = ref.providerServiceId
      ? `/services/${encodeURIComponent(ref.providerServiceId)}/cancel`
      : ref.providerOrderId
        ? `/orders/${encodeURIComponent(ref.providerOrderId)}/cancel`
        : null;
    if (!path) throw new ProviderRejectedError("Nothing to cancel", "nothing_to_cancel");
    const r = await this.api().request<{ effectiveDate?: string; status?: string }>({
      method: "POST",
      path,
      idempotencyKey: `${ref.providerServiceId ?? ref.providerOrderId}:cancel`,
      body: { effectiveDate: effectiveAt.toISOString() },
    });
    return { effectiveAt: r.effectiveDate ? new Date(r.effectiveDate) : effectiveAt, pending: r.status !== "CANCELLED" };
  }

  async portIn(input: PortInInput) {
    // TODO(videotron): port-in (LNP) request. Canadian practice: account number + PIN, or IMEI/ESN.
    const r = await this.api().request<{ portId: string; dueDate?: string | null }>({
      method: "POST",
      path: "/port-ins",
      idempotencyKey: `${input.providerOrderId}:port:${input.phoneE164}`,
      body: {
        orderId: input.providerOrderId,
        msisdn: input.phoneE164.replace(/^\+1/, ""),
        losingCarrier: input.losingCarrier,
        authorizedName: input.authorizedName,
        accountNumber: input.accountNumber,
        pin: input.pin,
        imei: input.imei,
      },
    });
    return { portRef: r.portId, dueAt: r.dueDate ? new Date(r.dueDate) : null };
  }

  async getPortStatus(portRef: string): Promise<PortStatus> {
    const r = await this.api().request<{ status: string; dueDate?: string | null; reason?: string | null }>({ method: "GET", path: `/port-ins/${encodeURIComponent(portRef)}` });
    const map: Record<string, PortStatus["status"]> = { SUBMITTED: "submitted", CONFIRMED: "confirmed", COMPLETED: "completed", REJECTED: "rejected", CANCELLED: "cancelled" };
    return { status: map[r.status] ?? "submitted", dueAt: r.dueDate ? new Date(r.dueDate) : null, reason: r.reason ?? null };
  }

  async usage(providerServiceId: string, period: string): Promise<ProviderUsage> {
    // TODO(videotron): usage feed (API, or daily usage files to import).
    const r = await this.api().request<{ dataMb: number; roamingDataMb?: number; voiceMinutes?: number; sms?: number; overageCents?: number; roamingCents?: number; asOf?: string }>({
      method: "GET",
      path: `/services/${encodeURIComponent(providerServiceId)}/usage`,
      query: { period },
    });
    return {
      period,
      dataMb: r.dataMb,
      roamingDataMb: r.roamingDataMb ?? 0,
      voiceMinutes: r.voiceMinutes ?? 0,
      sms: r.sms ?? 0,
      overageCents: r.overageCents ?? 0,
      roamingCents: r.roamingCents ?? 0,
      capturedAt: r.asOf ? new Date(r.asOf) : new Date(),
    };
  }

  normalizeEvents(input: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer }): ProviderEvent[] {
    const secret = this.config.VIDEOTRON_WEBHOOK_SECRET;
    if (!secret) throw new ProviderNotConfiguredError("videotron", "missing VIDEOTRON_WEBHOOK_SECRET");
    // TODO(videotron): real signature scheme and header name.
    const sig = input.headers["x-videotron-signature"];
    const expected = createHmac("sha256", secret).update(input.rawBody).digest("hex");
    if (typeof sig !== "string" || !safeEqual(sig, expected)) throw new ProviderRejectedError("Bad signature", "bad_signature", 401);
    const body = JSON.parse(input.rawBody.toString("utf8")) as { events?: Array<{ type: string; order?: VOrder; serviceId?: string; at?: string }> };
    const out: ProviderEvent[] = [];
    for (const e of body.events ?? []) {
      if (e.type === "ORDER_STATUS" && e.order) out.push({ type: "order.updated", providerOrderId: e.order.orderId, status: mapOrder(e.order) });
      else if (e.serviceId && (e.type === "SERVICE_SUSPENDED" || e.type === "SERVICE_RESTORED" || e.type === "SERVICE_CANCELLED")) {
        const type = e.type === "SERVICE_SUSPENDED" ? "service.suspended" : e.type === "SERVICE_RESTORED" ? "service.restored" : "service.cancelled";
        out.push({ type, providerServiceId: e.serviceId, at: e.at ? new Date(e.at) : new Date() });
      }
    }
    return out;
  }
}

function mapOrder(r: VOrder): ProviderOrderStatus {
  return {
    providerOrderId: r.orderId,
    phase: PHASES[r.status] ?? "received",
    providerServiceId: r.serviceId ?? null,
    phoneE164: r.msisdn ? toE164(r.msisdn) : null,
    appointment: r.appointment ? { ref: r.appointment.id, startsAt: new Date(r.appointment.start), endsAt: new Date(r.appointment.end) } : null,
    reason: r.reason ?? null,
  };
}

const toE164 = (msisdn: string) => {
  const d = msisdn.replace(/\D/g, "");
  return d.length === 10 ? `+1${d}` : `+${d}`;
};
