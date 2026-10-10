// TODO(shared-types): local placeholders for API shapes that other agents are still adding to
// packages/shared/src (catalog request/response wrappers for /v1/catalog/*). Re-check before merging and switch the imports to "@mimt/shared" once they exist;
// then delete this file.
import type { Offer, OrderEventRecord, ServiceAddress, ServiceOrder } from "@mimt/shared";

// ------------------------------------------------------------------------------ catalog

/** GET /v1/catalog/offers?postalCode= */
export interface OffersResponse {
  postalCode: string | null;
  offers: Offer[];
}

/** POST /v1/catalog/orders */
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
}
