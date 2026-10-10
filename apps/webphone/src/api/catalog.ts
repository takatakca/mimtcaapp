// Services (resale: internet, mobile) catalog and orders. Request/response wrappers are local
// placeholders until the catalog routes publish them in packages/shared (see pending.ts).
import type { ServiceOrder } from "@mimt/shared";
import type { HttpClient } from "./http";
import type { CreateOrderRequest, OffersResponse, OrderDetailResponse, OrdersResponse } from "./pending";

export function catalogEndpoints(request: HttpClient["request"]) {
  return {
    offers: (postalCode?: string) => request<OffersResponse>("GET", "/v1/catalog/offers", { query: { postalCode } }),
    orders: () => request<OrdersResponse>("GET", "/v1/catalog/orders"),
    order: (orderId: string) => request<OrderDetailResponse>("GET", `/v1/catalog/orders/${encodeURIComponent(orderId)}`),
    createOrder: (body: CreateOrderRequest) => request<ServiceOrder>("POST", "/v1/catalog/orders", { body }),
  };
}
