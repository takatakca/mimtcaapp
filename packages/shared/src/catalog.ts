// Product catalog, service orders and provisioning (phase 3: internet and mobile resale).
// Source of truth: docs/MIMT-RESALE.md. Prices are CAD cents before taxes.
// Dates are generic: the API stores `Date`, the wire format (JSON) carries ISO strings.

export type ProductLine =
  | "voip_consumer"
  | "voip_business"
  | "internet_residential"
  | "internet_business"
  | "mobile"
  | "home_phone"
  /** Not sold yet; reserved so the catalog does not need a migration later. */
  | "tv";

export const PRODUCT_LINES: readonly ProductLine[] = [
  "voip_consumer",
  "voip_business",
  "internet_residential",
  "internet_business",
  "mobile",
  "home_phone",
  "tv",
];

/** Which consumer code governs the contract (CRTC). VoIP and home phone: none of the two. */
export type ConsumerCode = "wireless" | "internet" | "none";

export function consumerCodeFor(line: ProductLine): ConsumerCode {
  if (line === "mobile") return "wireless";
  if (line === "internet_residential" || line === "internet_business") return "internet";
  return "none";
}

export const isInternetLine = (line: ProductLine) => line === "internet_residential" || line === "internet_business";

/** Upstream that delivers the service. "sandbox" is the fake provider used in dev and tests. */
export type ProviderCode = "videotron" | "twilio" | "sandbox";
export type OfferStatus = "draft" | "active" | "retired";

export interface LocalizedText {
  fr: string;
  en: string;
}

export interface OfferAttributes {
  /** Internet: advertised download / upload speed. */
  downloadMbps?: number;
  uploadMbps?: number;
  /** Internet: monthly usage allowance in GB; null = unlimited. */
  internetDataGb?: number | null;
  /** Mobile: high-speed data per month in GB; null = unlimited. */
  dataGb?: number | null;
  /** Mobile: speed after the allowance (no overage billed when set). */
  throttleKbps?: number | null;
  /** Mobile: overage price per GB when there is no throttle. */
  overagePerGbCents?: number | null;
  /** Mobile: Canada-wide minutes / texts; null = unlimited. */
  minutes?: number | null;
  sms?: number | null;
  network?: "4g" | "5g";
  esim?: boolean;
  /** Internet technology delivered by the wholesaler. */
  technology?: "cable" | "fibre" | "fixed_wireless";
  /** Install by a technician required (vs. self-install). */
  technicianInstall?: boolean;
  /** Included roaming zones, e.g. ["us"]. */
  roamingZones?: string[];
}

export interface Offer<D = string> {
  id: string;
  code: string;
  productLine: ProductLine;
  provider: ProviderCode;
  /** The wholesaler's product / rate-plan code (filled once Vidéotron gives its catalogue). */
  providerProductCode: string | null;
  name: LocalizedText;
  description: LocalizedText;
  monthlyPriceCents: number;
  setupFeeCents: number;
  /** Commitment in months; 0 = no contract (month to month). The Wireless Code caps it at 24. */
  termMonths: number;
  /**
   * Value of the device subsidy (mobile) or of the term discount (internet) given in exchange for the
   * commitment. It is the only basis allowed for an early cancellation fee on a term contract.
   */
  discountCents: number;
  attributes: OfferAttributes;
  /**
   * Postal-code prefixes where the offer is sold: "H" (all of Montreal), "H2X" (one FSA), ...
   * null = no restriction in the catalogue (the provider's availability check still applies).
   */
  availableFsas: string[] | null;
  status: OfferStatus;
  /** Optional Stripe price; when null the API creates/looks up one from monthlyPriceCents. */
  stripePriceId: string | null;
  createdAt: D;
  updatedAt: D;
}

export interface ServiceAddress {
  street: string;
  unit: string | null;
  city: string;
  province: string;
  /** Canadian postal code, "H2X 1Y4". */
  postalCode: string;
}

const POSTAL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

/** "h2x1y4" → "H2X 1Y4"; null when it is not a Canadian postal code. */
export function normalizePostalCode(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!POSTAL.test(s)) return null;
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

/** Forward sortation area (first three characters). Accepts a full postal code or an FSA. */
export function fsaOf(postalCodeOrFsa: string): string | null {
  const s = postalCodeOrFsa.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]$/.test(s)) return s;
  const full = normalizePostalCode(s);
  return full ? full.slice(0, 3) : null;
}

/** True when the offer is sold at this FSA (prefix match on availableFsas). */
export function offerAvailableAt(offer: Pick<Offer<unknown>, "availableFsas">, fsa: string): boolean {
  if (offer.availableFsas === null) return true;
  const f = fsa.toUpperCase();
  return offer.availableFsas.some((p) => f.startsWith(p.toUpperCase().replace(/\s+/g, "")));
}

/** Active offers sold at the postal code / FSA, cheapest first. */
export function filterOffersForPostalCode<T extends Pick<Offer<unknown>, "availableFsas" | "status" | "monthlyPriceCents">>(
  offers: readonly T[],
  postalCodeOrFsa: string,
): T[] {
  const fsa = fsaOf(postalCodeOrFsa);
  if (!fsa) return [];
  return offers.filter((o) => o.status === "active" && offerAvailableAt(o, fsa)).sort((a, b) => a.monthlyPriceCents - b.monthlyPriceCents);
}

// ------------------------------------------------------------------------------------ orders

export type OrderState =
  | "draft"
  | "submitted"
  | "credit_check"
  | "pending_provider"
  | "scheduled"
  | "active"
  | "suspended"
  | "cancel_requested"
  | "cancelled"
  | "failed";

export const ORDER_STATES: readonly OrderState[] = [
  "draft",
  "submitted",
  "credit_check",
  "pending_provider",
  "scheduled",
  "active",
  "suspended",
  "cancel_requested",
  "cancelled",
  "failed",
];

export const TERMINAL_ORDER_STATES: readonly OrderState[] = ["cancelled", "failed"];

export type OrderEvent =
  /** Customer submits the draft (contract summary and consents accepted). */
  | "submit"
  /** A credit check is required (term contract) and was started. */
  | "credit_check_started"
  | "credit_approved"
  | "credit_declined"
  /** The wholesaler acknowledged the order (records its reference; state unchanged). */
  | "provider_accepted"
  | "provider_rejected"
  /** Install appointment booked or moved. */
  | "appointment_scheduled"
  | "activated"
  | "suspended"
  | "restored"
  | "cancel_requested"
  | "cancel_confirmed"
  /** Unrecoverable technical error. */
  | "fail";

export const ORDER_EVENTS: readonly OrderEvent[] = [
  "submit",
  "credit_check_started",
  "credit_approved",
  "credit_declined",
  "provider_accepted",
  "provider_rejected",
  "appointment_scheduled",
  "activated",
  "suspended",
  "restored",
  "cancel_requested",
  "cancel_confirmed",
  "fail",
];

/**
 * draft → submitted → (credit_check) → pending_provider → scheduled → active ⇄ suspended → cancel_requested → cancelled.
 * Anything before the wholesaler has the order cancels at once; after that, cancellation waits for the
 * wholesaler's confirmation. failed and cancelled are terminal.
 */
const TRANSITIONS: Record<OrderState, Partial<Record<OrderEvent, OrderState>>> = {
  draft: { submit: "submitted", cancel_requested: "cancelled", fail: "failed" },
  submitted: {
    credit_check_started: "credit_check",
    // No check needed (month to month, prepaid): approved at once.
    credit_approved: "pending_provider",
    cancel_requested: "cancelled",
    fail: "failed",
  },
  credit_check: {
    credit_approved: "pending_provider",
    credit_declined: "failed",
    cancel_requested: "cancelled",
    fail: "failed",
  },
  // pending_provider: waiting on the wholesaler (sending the order, then processing it).
  pending_provider: {
    provider_accepted: "pending_provider",
    appointment_scheduled: "scheduled",
    activated: "active",
    provider_rejected: "failed",
    cancel_requested: "cancel_requested",
    fail: "failed",
  },
  scheduled: {
    appointment_scheduled: "scheduled",
    activated: "active",
    provider_rejected: "failed",
    cancel_requested: "cancel_requested",
    fail: "failed",
  },
  active: { suspended: "suspended", cancel_requested: "cancel_requested" },
  suspended: { restored: "active", cancel_requested: "cancel_requested" },
  cancel_requested: { cancel_confirmed: "cancelled" },
  cancelled: {},
  failed: {},
};

/** Pure order state machine. Returns the next state, or null when the event is not allowed in this state. */
export function nextOrderState(order: { state: OrderState }, event: OrderEvent): OrderState | null {
  return TRANSITIONS[order.state][event] ?? null;
}

export const isTerminalOrderState = (s: OrderState) => TERMINAL_ORDER_STATES.includes(s);

export interface ServiceOrder<D = string> {
  id: string;
  telecomAccountId: string;
  userId: string;
  offerId: string;
  offerCode: string;
  productLine: ProductLine;
  provider: ProviderCode;
  state: OrderState;
  serviceAddress: ServiceAddress | null;
  /** Price and term frozen at order time (the contract). */
  monthlyPriceCents: number;
  setupFeeCents: number;
  termMonths: number;
  discountCents: number;
  /** SIM / eSIM choice for mobile. */
  simKind: "sim" | "esim" | null;
  contractSummaryVersion: string | null;
  contractAcceptedAt: D | null;
  providerOrderId: string | null;
  failureReason: string | null;
  submittedAt: D | null;
  activatedAt: D | null;
  cancelledAt: D | null;
  createdAt: D;
  updatedAt: D;
}

export interface OrderEventRecord<D = string> {
  id: string;
  orderId: string;
  event: OrderEvent | "note";
  fromState: OrderState | null;
  toState: OrderState | null;
  actor: "customer" | "admin" | "system" | "provider";
  actorUserId: string | null;
  details: Record<string, unknown>;
  at: D;
}

export type ServiceStatus = "active" | "suspended" | "cancelled";

export interface ServiceInstance<D = string> {
  id: string;
  telecomAccountId: string;
  orderId: string;
  offerId: string;
  offerCode: string;
  productLine: ProductLine;
  provider: ProviderCode;
  providerServiceId: string | null;
  status: ServiceStatus;
  /** Mobile / home phone number. */
  phoneE164: string | null;
  serviceAddress: ServiceAddress | null;
  monthlyPriceCents: number;
  termMonths: number;
  discountCents: number;
  activatedAt: D;
  /** End of the commitment; null for month to month. */
  termEndsAt: D | null;
  cancelledAt: D | null;
  /** Bill-shock: the account holder agreed to go above the default caps (Wireless Code). */
  overageCapConsentCents: number | null;
  roamingCapConsentCents: number | null;
  /** Usage notification thresholds (percent) already sent this period, with the period. */
  usageNotified: { period: string; thresholds: number[] };
  stripeSubscriptionId: string | null;
  stripeSubscriptionItemId: string | null;
  createdAt: D;
  updatedAt: D;
}

export type DeviceKind = "modem" | "router" | "sim" | "esim" | "phone" | "set_top_box";
export type DeviceStatus = "pending" | "shipped" | "active" | "returned" | "inactive";

export interface Device<D = string> {
  id: string;
  telecomAccountId: string;
  orderId: string | null;
  serviceId: string | null;
  kind: DeviceKind;
  serial: string | null;
  /** SIM / eSIM ICCID (19–20 digits). */
  iccid: string | null;
  /** Handset IMEI (15 digits). */
  imei: string | null;
  /** eSIM-capable handset EID (32 digits). */
  eid: string | null;
  mac: string | null;
  status: DeviceStatus;
  /** Remaining device balance financed by MIMT (mobile), drives the early cancellation fee. */
  financedBalanceCents: number;
  createdAt: D;
  updatedAt: D;
}

export type AppointmentStatus = "booked" | "completed" | "cancelled" | "missed";

export interface Appointment<D = string> {
  id: string;
  orderId: string;
  providerRef: string | null;
  startsAt: D;
  endsAt: D;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: D;
  updatedAt: D;
}

export type PortingStatus = "pending" | "submitted" | "confirmed" | "completed" | "rejected" | "cancelled";

/**
 * Mobile number port-in (Canadian practice: the losing carrier validates the account number and the
 * PIN, or the IMEI/ESN of the handset when there is no PIN). The sensitive fields are never in this
 * shape: the API keeps them encrypted (AES-256-GCM) and only sends them to the wholesaler.
 */
export interface PortingRequest<D = string> {
  id: string;
  orderId: string;
  telecomAccountId: string;
  phoneE164: string;
  losingCarrier: string;
  authorizedName: string;
  status: PortingStatus;
  providerRef: string | null;
  rejectReason: string | null;
  dueAt: D | null;
  completedAt: D | null;
  createdAt: D;
  updatedAt: D;
}

export interface UsageSnapshot<D = string> {
  id: string;
  serviceId: string;
  /** Billing period "YYYY-MM". */
  period: string;
  dataMb: number;
  roamingDataMb: number;
  voiceMinutes: number;
  sms: number;
  /** Charges accrued this period above the plan (CAD cents, before taxes). */
  overageCents: number;
  roamingCents: number;
  capturedAt: D;
}
