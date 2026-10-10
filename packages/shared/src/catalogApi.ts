// REST contract of the resale routes (/v1/catalog/*, /v1/admin/catalog/*, /webhooks/provisioning/*).
// Implemented in apps/api/src/routes/catalog.ts. Flow: docs/MIMT-RESALE.md. Dates are ISO strings.

import type {
  Appointment,
  Device,
  Offer,
  OfferAttributes,
  OfferStatus,
  OrderEvent,
  OrderEventRecord,
  PortingRequest,
  ProductLine,
  ProviderCode,
  ServiceAddress,
  ServiceInstance,
  ServiceOrder,
  LocalizedText,
} from "./catalog.js";
import type { CancellationBasis, ContractSummary } from "./consumerCodes.js";

// ------------------------------------------------------------------------------------ public

/** GET /v1/catalog/offers?postalCode=&productLine= (no auth). Active offers, cheapest first. */
export interface OffersResponse {
  /** Normalized postal code or FSA used to filter; null when none was given. */
  postalCode: string | null;
  offers: Offer[];
}

/** GET /v1/catalog/offers/:id (no auth): the offer and its Critical Information Summary (French first). */
export interface OfferDetailResponse {
  offer: Offer;
  contractSummary: ContractSummary;
}

/** GET /v1/catalog/availability?postalCode= (no auth). Asks the wholesaler what it can deliver there. */
export interface AvailabilityResponse {
  postalCode: string;
  fsa: string;
  productLines: ProductLine[];
  technology: "cable" | "fibre" | "fixed_wireless" | null;
  maxDownloadMbps: number | null;
  installRequired: boolean;
  earliestInstallAt: string | null;
  /** Active catalogue offers sold at this FSA for one of the available product lines. */
  offers: Offer[];
}

// ------------------------------------------------------------------------------------ orders

/**
 * POST /v1/catalog/orders → 201 ServiceOrder (state "draft").
 * Internet and home phone need serviceAddress; mobile needs simKind.
 */
export interface CreateOrderRequest {
  offerId: string;
  serviceAddress?: ServiceAddress;
  simKind?: "sim" | "esim";
}

/** GET /v1/catalog/orders */
export interface OrdersResponse {
  orders: ServiceOrder[];
}

/** GET /v1/catalog/orders/:id */
export interface OrderDetailResponse {
  order: ServiceOrder;
  events: OrderEventRecord[];
  offer?: Offer;
  service: ServiceInstance | null;
  appointments: Appointment[];
  /** SIM / eSIM / modem. The eSIM activation code is never here (GET .../esim). */
  devices: Device[];
  /** Port-in status; the carrier account number and PIN are never returned. */
  porting: PortingRequest | null;
}

/**
 * GET /v1/catalog/orders/:id/contract-summary → ContractSummary for the price and term frozen on the order.
 * The customer must read it, then send its `version` back when submitting.
 */
export type ContractSummaryResponse = ContractSummary;

/**
 * POST /v1/catalog/orders/:id/submit → ServiceOrder.
 * Records the consents (contract_summary, wireless_code / internet_code, credit_check) then moves
 * the order through the state machine: month-to-month goes to the wholesaler at once; a term
 * contract waits in "credit_check" until approved.
 */
export interface SubmitOrderRequest {
  /** `version` of the contract summary the customer accepted. 409 contract_summary_outdated if it changed. */
  contractSummaryVersion: string;
  acceptContractSummary: true;
  /** Required for mobile (Wireless Code) and internet (Internet Code). */
  acceptConsumerCode?: boolean;
  /** Required when the offer has a commitment (termMonths > 0). */
  creditCheckConsent?: boolean;
  /** Where the consent was given ("web", "mobile"…). Defaults to "app". */
  source?: string;
}

/** GET /v1/catalog/orders/:id/cancellation-quote and part of the cancel response. */
export interface CancellationQuote {
  orderId: string;
  /** Early cancellation fee (CAD cents, before taxes). */
  feeCents: number;
  /** Financed device balance (a debt, not a fee). */
  deviceBalanceCents: number;
  totalCents: number;
  basis: CancellationBasis;
  inTrial: boolean;
  monthsRemaining: number;
  effectiveAt: string;
  explanation: LocalizedText;
}

/** POST /v1/catalog/orders/:id/cancel. Before the wholesaler has the order: cancelled at once. */
export interface CancelOrderResponse {
  order: ServiceOrder;
  cancellation: CancellationQuote;
}

/** GET /v1/catalog/orders/:id/appointment-slots (internet: technician install). */
export interface AppointmentSlotsResponse {
  slots: Array<{ startsAt: string; endsAt: string }>;
}

/** POST /v1/catalog/orders/:id/appointment → Appointment. Must be one of the offered slots. */
export interface BookAppointmentRequest {
  startsAt: string;
  endsAt: string;
}

/** POST /v1/catalog/orders/:id/sim (physical SIM, mobile). */
export interface ActivateSimRequest {
  /** ICCID printed on the SIM card (19–20 digits). */
  iccid: string;
}
export interface ActivateSimResponse {
  order: ServiceOrder;
  device: Device;
}

/** POST /v1/catalog/orders/:id/esim (mobile). GET on the same path shows the code again (owner only). */
export interface ActivateEsimRequest {
  /** Handset EID (32 digits), when known. */
  eid?: string | null;
}
export interface EsimResponse {
  order: ServiceOrder;
  device: Device;
  /** "LPA:1$<SM-DP+>$<matching id>": encode as a QR code. Sensitive: do not log or cache. */
  activationCode: string;
  smdpAddress: string;
  matchingId: string;
}

/**
 * POST /v1/catalog/orders/:id/porting → 201 PortingRequest (mobile number port-in).
 * The account number, PIN and IMEI are encrypted at rest and only sent to the wholesaler.
 */
export interface PortInRequest {
  /** Number to bring, "+15145551234" or "514 555-1234". */
  phoneNumber: string;
  losingCarrier: string;
  /** Account holder's name as known by the losing carrier. */
  authorizedName: string;
  accountNumber: string;
  /** Transfer PIN; or `imei` of the old handset when the carrier has no PIN. */
  pin?: string;
  imei?: string;
}

// ------------------------------------------------------------------------------------- admin
// /v1/admin/catalog/* : only MIMT user ids listed in CATALOG_ADMIN_USER_IDS (403 otherwise).

/** POST /v1/admin/catalog/offers → 201 Offer. Defaults: status "draft", no setup fee, no term. */
export interface AdminCreateOfferRequest {
  code: string;
  productLine: ProductLine;
  provider: ProviderCode;
  providerProductCode?: string | null;
  name: LocalizedText;
  description: LocalizedText;
  monthlyPriceCents: number;
  setupFeeCents?: number;
  termMonths?: number;
  discountCents?: number;
  attributes?: OfferAttributes;
  availableFsas?: string[] | null;
  status?: OfferStatus;
  stripePriceId?: string | null;
}

/** PATCH /v1/admin/catalog/offers/:id → Offer. The code cannot change. */
export type AdminUpdateOfferRequest = Partial<Omit<AdminCreateOfferRequest, "code">>;

/** GET /v1/admin/catalog/offers → all statuses. GET /v1/admin/catalog/orders?state=a,b → AdminOrdersResponse. */
export interface AdminOffersResponse {
  offers: Offer[];
}
export interface AdminOrdersResponse {
  orders: ServiceOrder[];
}

/**
 * POST /v1/admin/catalog/orders/:id/events → ServiceOrder. Applies one state-machine event as an admin
 * (e.g. credit_approved after a manual credit check, suspended, fail). 409 invalid_transition otherwise.
 */
export interface AdminOrderEventRequest {
  event: OrderEvent;
  reason?: string;
}
