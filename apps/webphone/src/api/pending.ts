// TODO(shared-types): local placeholders for API shapes that other agents are still adding to
// packages/shared/src (ai.ts for the AI receptionist / voicemail insight, catalog request/response
// wrappers). Re-check before merging and switch the imports to "@mimt/shared" once they exist;
// then delete this file.
import type { BilingualText, Offer, OrderEventRecord, RouteTarget, ServiceAddress, ServiceOrder } from "@mimt/shared";

// ------------------------------------------------------------------------------ AI receptionist

export interface AiFaqEntry {
  question: string;
  answer: string;
}

export interface AiTransferTarget {
  /** What the caller asks for ("ventes", "soutien"…). */
  label: string;
  target: RouteTarget;
}

/** GET/PUT /v1/business/:id/ai-receptionist */
export interface AiReceptionistConfig {
  enabled: boolean;
  greeting: BilingualText;
  faq: AiFaqEntry[];
  transferTargets: AiTransferTarget[];
  /** Where the call goes when the assistant cannot help. */
  fallbackTarget: RouteTarget | null;
}
export type AiReceptionistRequest = AiReceptionistConfig;

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
