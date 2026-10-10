import type { ProductLine, ProviderCode, ServiceAddress } from "@mimt/shared";

/**
 * Provisioning adapter: the one place that knows how a wholesaler (Vidéotron, ...) takes orders.
 * The platform (orders, state machine, billing, consumer codes) only talks to this interface, so
 * plugging the real Vidéotron interface in is a matter of filling `videotron.ts`.
 * See docs/MIMT-RESALE.md.
 */
export interface ProvisioningProvider {
  readonly code: Extract<ProviderCode, "videotron" | "sandbox">;

  /** Which product lines can be delivered at this address (Vidéotron: serviceability / "qualification"). */
  checkAvailability(address: AvailabilityQuery): Promise<AvailabilityResult>;
  /** Sends an order. Must be idempotent on `input.idempotencyKey` (our order id). */
  submitOrder(input: ProviderOrderInput): Promise<ProviderOrderStatus>;
  getOrderStatus(providerOrderId: string): Promise<ProviderOrderStatus>;
  /** Free install slots for an order that needs a technician. */
  getAppointmentSlots(providerOrderId: string): Promise<AppointmentSlot[]>;
  scheduleAppointment(providerOrderId: string, slot: AppointmentSlot): Promise<ProviderAppointment>;
  /** Activates a physical SIM by ICCID on a mobile order. */
  activateSim(input: { providerOrderId: string; iccid: string }): Promise<SimActivation>;
  /** Reserves an eSIM profile; returns the LPA activation code shown as a QR code. */
  activateEsim(input: { providerOrderId: string; eid: string | null }): Promise<EsimActivation>;
  suspend(providerServiceId: string, reason: SuspendReason): Promise<void>;
  restore(providerServiceId: string): Promise<void>;
  /** Cancels an in-flight order (providerOrderId) or a live service (providerServiceId). */
  cancel(ref: { providerOrderId?: string | null; providerServiceId?: string | null }, effectiveAt: Date): Promise<{ effectiveAt: Date; pending: boolean }>;
  /** Mobile number port-in. Secrets are passed in clear here only, never logged. */
  portIn(input: PortInInput): Promise<{ portRef: string; dueAt: Date | null }>;
  getPortStatus(portRef: string): Promise<PortStatus>;
  usage(providerServiceId: string, period: string): Promise<ProviderUsage>;
  /** Verifies and converts an inbound webhook / file record into normalized events. Throws on a bad signature. */
  normalizeEvents(input: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer }): ProviderEvent[];
}

export interface AvailabilityQuery {
  postalCode: string;
  street?: string;
  unit?: string | null;
  city?: string;
  province?: string;
}

export interface AvailabilityResult {
  postalCode: string;
  fsa: string;
  productLines: ProductLine[];
  /** Wholesaler product codes sellable at this address (when it tells us). */
  providerProductCodes: string[] | null;
  maxDownloadMbps: number | null;
  technology: "cable" | "fibre" | "fixed_wireless" | null;
  installRequired: boolean;
  earliestInstallAt: Date | null;
}

export interface ProviderOrderInput {
  /** Our order id: the provider must deduplicate on it. */
  idempotencyKey: string;
  productLine: ProductLine;
  offerCode: string;
  providerProductCode: string | null;
  customer: { name: string; email: string | null; phone: string | null; locale: "fr-CA" | "en-CA" };
  serviceAddress: ServiceAddress | null;
  simKind: "sim" | "esim" | null;
  iccid: string | null;
  imei: string | null;
  eid: string | null;
  /** True when a port-in will follow (no new number to assign). */
  portIn: boolean;
}

export type ProviderOrderPhase =
  /** Received, being processed. */
  | "received"
  /** Needs a technician appointment before it can continue. */
  | "awaiting_appointment"
  | "scheduled"
  | "completed"
  | "rejected"
  | "cancelled";

export interface ProviderOrderStatus {
  providerOrderId: string;
  phase: ProviderOrderPhase;
  /** Set once the service exists at the provider. */
  providerServiceId: string | null;
  phoneE164: string | null;
  appointment: ProviderAppointment | null;
  reason: string | null;
}

export interface AppointmentSlot {
  startsAt: Date;
  endsAt: Date;
}

export interface ProviderAppointment extends AppointmentSlot {
  ref: string;
}

export interface SimActivation {
  phoneE164: string | null;
  iccid: string;
}

export interface EsimActivation {
  iccid: string;
  /** "LPA:1$<SM-DP+ address>$<matching id>" (GSMA SGP.22), encoded in the QR code. Sensitive. */
  activationCode: string;
  smdpAddress: string;
  matchingId: string;
}

export type SuspendReason = "non_payment" | "fraud" | "customer_request" | "lost_stolen";

export interface PortInInput {
  providerOrderId: string;
  phoneE164: string;
  losingCarrier: string;
  authorizedName: string;
  accountNumber: string;
  /** Transfer PIN, or the old handset IMEI/ESN when the losing carrier has no PIN. */
  pin: string | null;
  imei: string | null;
}

export interface PortStatus {
  status: "submitted" | "confirmed" | "completed" | "rejected" | "cancelled";
  dueAt: Date | null;
  reason: string | null;
}

export interface ProviderUsage {
  period: string;
  dataMb: number;
  roamingDataMb: number;
  voiceMinutes: number;
  sms: number;
  overageCents: number;
  roamingCents: number;
  capturedAt: Date;
}

export type ProviderEvent =
  | { type: "order.updated"; providerOrderId: string; status: ProviderOrderStatus }
  | { type: "service.suspended" | "service.restored" | "service.cancelled"; providerServiceId: string; at: Date }
  | { type: "port.updated"; portRef: string; status: PortStatus }
  | { type: "usage.updated"; providerServiceId: string; usage: ProviderUsage };

/** Thrown by an adapter that is not configured yet (the API answers 503). */
export class ProviderNotConfiguredError extends Error {
  constructor(
    readonly provider: string,
    detail: string,
  ) {
    super(`${provider} provisioning is not configured: ${detail}`);
    this.name = "ProviderNotConfiguredError";
  }
}

/** The provider refused the request (validation, unknown address, ...). Not retried. */
export class ProviderRejectedError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderRejectedError";
  }
}
