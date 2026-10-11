// Services (resale: internet, mobile) catalog and orders: /v1/catalog/*. Shapes come from
// packages/shared/src/catalogApi.ts (implemented by apps/api/src/routes/catalog.ts; flow in
// docs/MIMT-RESALE.md).
import type {
  ActivateEsimRequest,
  ActivateSimRequest,
  ActivateSimResponse,
  Appointment,
  AppointmentSlotsResponse,
  AvailabilityResponse,
  BookAppointmentRequest,
  CancellationQuote,
  CancelOrderResponse,
  ContractSummaryResponse,
  CreateOrderRequest,
  EsimResponse,
  OfferDetailResponse,
  OffersResponse,
  OrderDetailResponse,
  OrdersResponse,
  PortingRequest,
  PortInRequest,
  ProductLine,
  ServiceOrder,
  SubmitOrderRequest,
} from "@mimt/shared";
import type { HttpClient } from "./http";

const o = (id: string) => `/v1/catalog/orders/${encodeURIComponent(id)}`;

export function catalogEndpoints(request: HttpClient["request"]) {
  return {
    // Public (no session needed, but sending it is harmless).
    offers: (postalCode?: string, productLine?: ProductLine) =>
      request<OffersResponse>("GET", "/v1/catalog/offers", { query: { postalCode, productLine } }),
    offer: (offerId: string) => request<OfferDetailResponse>("GET", `/v1/catalog/offers/${encodeURIComponent(offerId)}`),
    availability: (postalCode: string) => request<AvailabilityResponse>("GET", "/v1/catalog/availability", { query: { postalCode } }),

    // Orders
    orders: () => request<OrdersResponse>("GET", "/v1/catalog/orders"),
    order: (orderId: string) => request<OrderDetailResponse>("GET", o(orderId)),
    /** 201 ServiceOrder in state "draft": nothing is sent to the wholesaler before submitOrder. */
    createOrder: (body: CreateOrderRequest) => request<ServiceOrder>("POST", "/v1/catalog/orders", { body }),
    contractSummary: (orderId: string) => request<ContractSummaryResponse>("GET", `${o(orderId)}/contract-summary`),
    /** Records the consents, then moves the order on (400 contract_summary_required, 409 contract_summary_outdated…). */
    submitOrder: (orderId: string, body: SubmitOrderRequest) => request<ServiceOrder>("POST", `${o(orderId)}/submit`, { body }),
    syncOrder: (orderId: string) => request<ServiceOrder>("POST", `${o(orderId)}/sync`),
    cancellationQuote: (orderId: string) => request<CancellationQuote>("GET", `${o(orderId)}/cancellation-quote`),
    cancelOrder: (orderId: string) => request<CancelOrderResponse>("POST", `${o(orderId)}/cancel`),

    // Internet: technician install
    appointmentSlots: (orderId: string) => request<AppointmentSlotsResponse>("GET", `${o(orderId)}/appointment-slots`),
    bookAppointment: (orderId: string, body: BookAppointmentRequest) =>
      request<Appointment>("POST", `${o(orderId)}/appointment`, { body }),

    // Mobile: SIM / eSIM, number port-in
    activateSim: (orderId: string, body: ActivateSimRequest) => request<ActivateSimResponse>("POST", `${o(orderId)}/sim`, { body }),
    /** The activation code is sensitive: shown on screen only, never stored or logged. */
    activateEsim: (orderId: string, body: ActivateEsimRequest = {}) => request<EsimResponse>("POST", `${o(orderId)}/esim`, { body }),
    esim: (orderId: string) => request<EsimResponse>("GET", `${o(orderId)}/esim`),
    /** 201 PortingRequest. The account number, PIN and IMEI are never sent back. */
    portIn: (orderId: string, body: PortInRequest) => request<PortingRequest>("POST", `${o(orderId)}/porting`, { body }),
    porting: (orderId: string) => request<PortingRequest>("GET", `${o(orderId)}/porting`),
  };
}
