import type {
  Appointment,
  Device,
  Offer,
  OfferStatus,
  OrderEventRecord,
  OrderState,
  PortingRequest,
  PortingStatus,
  ProductLine,
  ServiceInstance,
  ServiceOrder,
  ServiceStatus,
  UsageSnapshot,
} from "@mimt/shared";

// Catalog / resale storage (supabase/migrations/0005_catalog.sql). Exposed as `repo.catalog`.

export type OfferRow = Offer<Date>;
export type OrderRow = ServiceOrder<Date>;
export type OrderEventRow = OrderEventRecord<Date>;
export type ServiceRow = ServiceInstance<Date>;
export type AppointmentRow = Appointment<Date>;
export type UsageSnapshotRow = UsageSnapshot<Date>;

/** eSIM activation code is sensitive (anyone with it can download the profile): encrypted at rest. */
export type DeviceRow = Device<Date> & { activationCodeEncrypted: string | null };

/** Port-in authorisation data, encrypted at the application level (AES-256-GCM, lib/crypto.ts). */
export type PortingRow = PortingRequest<Date> & {
  accountNumberEncrypted: string;
  pinEncrypted: string | null;
  imeiEncrypted: string | null;
};

type Insert<T, Optional extends keyof T = never> = Omit<T, "id" | "createdAt" | "updatedAt" | Optional> & Partial<Pick<T, Optional>>;

export interface CatalogRepository {
  createOffer(o: Insert<OfferRow, "stripePriceId">): Promise<OfferRow>;
  updateOffer(id: string, patch: Partial<Omit<OfferRow, "id" | "createdAt" | "code">>): Promise<OfferRow>;
  getOffer(id: string): Promise<OfferRow | null>;
  getOfferByCode(code: string): Promise<OfferRow | null>;
  listOffers(filter?: { status?: OfferStatus; productLine?: ProductLine }): Promise<OfferRow[]>;

  createOrder(o: Insert<OrderRow, "contractSummaryVersion" | "contractAcceptedAt" | "providerOrderId" | "failureReason" | "submittedAt" | "activatedAt" | "cancelledAt">): Promise<OrderRow>;
  getOrder(id: string): Promise<OrderRow | null>;
  /**
   * Compare-and-set on the state: applies the patch only if the order is still in `expectedState`.
   * Returns null when another writer moved it first (route vs. sync job).
   */
  updateOrder(id: string, expectedState: OrderState, patch: Partial<Omit<OrderRow, "id" | "createdAt">>): Promise<OrderRow | null>;
  /** Newest first. */
  listOrdersByAccount(accountId: string): Promise<OrderRow[]>;
  /** Oldest update first (work queue). */
  listOrdersInStates(states: OrderState[], limit: number): Promise<OrderRow[]>;

  /** Append-only audit trail. */
  addOrderEvent(e: Omit<OrderEventRow, "id" | "at"> & { at?: Date }): Promise<OrderEventRow>;
  listOrderEvents(orderId: string): Promise<OrderEventRow[]>;

  createService(s: Insert<ServiceRow, "cancelledAt" | "stripeSubscriptionId" | "stripeSubscriptionItemId" | "overageCapConsentCents" | "roamingCapConsentCents" | "usageNotified">): Promise<ServiceRow>;
  getService(id: string): Promise<ServiceRow | null>;
  getServiceByOrder(orderId: string): Promise<ServiceRow | null>;
  getServiceByProviderId(provider: string, providerServiceId: string): Promise<ServiceRow | null>;
  listServicesByAccount(accountId: string): Promise<ServiceRow[]>;
  listServicesInStatuses(statuses: ServiceStatus[], limit: number): Promise<ServiceRow[]>;
  updateService(id: string, patch: Partial<Omit<ServiceRow, "id" | "createdAt">>): Promise<ServiceRow>;

  createDevice(d: Insert<DeviceRow, "serial" | "iccid" | "imei" | "eid" | "mac" | "activationCodeEncrypted" | "financedBalanceCents" | "serviceId">): Promise<DeviceRow>;
  listDevicesByOrder(orderId: string): Promise<DeviceRow[]>;
  updateDevice(id: string, patch: Partial<Omit<DeviceRow, "id" | "createdAt">>): Promise<DeviceRow>;

  createAppointment(a: Insert<AppointmentRow, "notes">): Promise<AppointmentRow>;
  listAppointmentsByOrder(orderId: string): Promise<AppointmentRow[]>;
  updateAppointment(id: string, patch: Partial<Omit<AppointmentRow, "id" | "createdAt" | "orderId">>): Promise<AppointmentRow>;

  createPortingRequest(p: Insert<PortingRow, "providerRef" | "rejectReason" | "dueAt" | "completedAt">): Promise<PortingRow>;
  getPortingRequestByOrder(orderId: string): Promise<PortingRow | null>;
  listPortingInStatuses(statuses: PortingStatus[], limit: number): Promise<PortingRow[]>;
  updatePortingRequest(id: string, patch: Partial<Omit<PortingRow, "id" | "createdAt" | "orderId">>): Promise<PortingRow>;

  addUsageSnapshot(u: Omit<UsageSnapshotRow, "id">): Promise<UsageSnapshotRow>;
  getLatestUsageSnapshot(serviceId: string): Promise<UsageSnapshotRow | null>;
}
