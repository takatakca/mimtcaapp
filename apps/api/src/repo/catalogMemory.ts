import { randomUUID } from "node:crypto";
import type {
  AppointmentRow,
  CatalogRepository,
  DeviceRow,
  OfferRow,
  OrderEventRow,
  OrderRow,
  PortingRow,
  ServiceRow,
  UsageSnapshotRow,
} from "./catalog.js";

const clone = <T>(v: T): T => structuredClone(v);
const byNewest = <T extends { createdAt: Date; id: string }>(a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);

function patchRow<T extends { updatedAt: Date }>(map: Map<string, T>, id: string, patch: Partial<T>, what: string): T {
  const row = map.get(id);
  if (!row) throw new Error(`${what} ${id} not found`);
  Object.assign(row, patch, { updatedAt: new Date() });
  return clone(row);
}

/** In-memory catalog storage (tests, local dev). Tables are public for assertions. */
export class MemoryCatalogRepository implements CatalogRepository {
  offers = new Map<string, OfferRow>();
  orders = new Map<string, OrderRow>();
  orderEvents: OrderEventRow[] = [];
  services = new Map<string, ServiceRow>();
  devices = new Map<string, DeviceRow>();
  appointments = new Map<string, AppointmentRow>();
  portingRequests = new Map<string, PortingRow>();
  usageSnapshots: UsageSnapshotRow[] = [];

  private stamp() {
    const now = new Date();
    return { id: randomUUID(), createdAt: now, updatedAt: now };
  }

  async createOffer(o: Parameters<CatalogRepository["createOffer"]>[0]) {
    if ([...this.offers.values()].some((x) => x.code === o.code)) throw new Error(`duplicate offer code ${o.code}`);
    const row: OfferRow = { stripePriceId: null, ...clone(o), ...this.stamp() };
    this.offers.set(row.id, row);
    return clone(row);
  }
  async updateOffer(id: string, patch: Partial<OfferRow>) {
    return patchRow(this.offers, id, clone(patch), "offer");
  }
  async getOffer(id: string) {
    const o = this.offers.get(id);
    return o ? clone(o) : null;
  }
  async getOfferByCode(code: string) {
    const o = [...this.offers.values()].find((x) => x.code === code);
    return o ? clone(o) : null;
  }
  async listOffers(filter: { status?: OfferRow["status"]; productLine?: OfferRow["productLine"] } = {}) {
    return [...this.offers.values()]
      .filter((o) => (!filter.status || o.status === filter.status) && (!filter.productLine || o.productLine === filter.productLine))
      .sort((a, b) => a.monthlyPriceCents - b.monthlyPriceCents || a.code.localeCompare(b.code))
      .map(clone);
  }

  async createOrder(o: Parameters<CatalogRepository["createOrder"]>[0]) {
    const row: OrderRow = {
      contractSummaryVersion: null,
      contractAcceptedAt: null,
      providerOrderId: null,
      failureReason: null,
      submittedAt: null,
      activatedAt: null,
      cancelledAt: null,
      ...clone(o),
      ...this.stamp(),
    };
    this.orders.set(row.id, row);
    return clone(row);
  }
  async getOrder(id: string) {
    const o = this.orders.get(id);
    return o ? clone(o) : null;
  }
  async updateOrder(id: string, expectedState: OrderRow["state"], patch: Partial<OrderRow>) {
    const o = this.orders.get(id);
    if (!o || o.state !== expectedState) return null;
    return patchRow(this.orders, id, clone(patch), "order");
  }
  async listOrdersByAccount(accountId: string) {
    return [...this.orders.values()].filter((o) => o.telecomAccountId === accountId).sort(byNewest).map(clone);
  }
  async listOrdersInStates(states: OrderRow["state"][], limit: number) {
    return [...this.orders.values()]
      .filter((o) => states.includes(o.state))
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async addOrderEvent(e: Parameters<CatalogRepository["addOrderEvent"]>[0]) {
    const row: OrderEventRow = { ...clone(e), id: randomUUID(), at: e.at ?? new Date() };
    this.orderEvents.push(row);
    return clone(row);
  }
  async listOrderEvents(orderId: string) {
    return this.orderEvents.filter((e) => e.orderId === orderId).map(clone);
  }

  async createService(s: Parameters<CatalogRepository["createService"]>[0]) {
    const row: ServiceRow = {
      cancelledAt: null,
      stripeSubscriptionId: null,
      stripeSubscriptionItemId: null,
      overageCapConsentCents: null,
      roamingCapConsentCents: null,
      usageNotified: { period: "", thresholds: [] },
      ...clone(s),
      ...this.stamp(),
    };
    if ([...this.services.values()].some((x) => x.orderId === row.orderId)) throw new Error(`service for order ${row.orderId} exists`);
    this.services.set(row.id, row);
    return clone(row);
  }
  async getService(id: string) {
    const s = this.services.get(id);
    return s ? clone(s) : null;
  }
  async getServiceByOrder(orderId: string) {
    const s = [...this.services.values()].find((x) => x.orderId === orderId);
    return s ? clone(s) : null;
  }
  async getServiceByProviderId(provider: string, providerServiceId: string) {
    const s = [...this.services.values()].find((x) => x.provider === provider && x.providerServiceId === providerServiceId);
    return s ? clone(s) : null;
  }
  async listServicesByAccount(accountId: string) {
    return [...this.services.values()].filter((s) => s.telecomAccountId === accountId).sort(byNewest).map(clone);
  }
  async listServicesInStatuses(statuses: ServiceRow["status"][], limit: number) {
    return [...this.services.values()].filter((s) => statuses.includes(s.status)).slice(0, limit).map(clone);
  }
  async updateService(id: string, patch: Partial<ServiceRow>) {
    return patchRow(this.services, id, clone(patch), "service");
  }

  async createDevice(d: Parameters<CatalogRepository["createDevice"]>[0]) {
    const row: DeviceRow = {
      serial: null,
      iccid: null,
      imei: null,
      eid: null,
      mac: null,
      activationCodeEncrypted: null,
      financedBalanceCents: 0,
      serviceId: null,
      ...clone(d),
      ...this.stamp(),
    };
    this.devices.set(row.id, row);
    return clone(row);
  }
  async listDevicesByOrder(orderId: string) {
    return [...this.devices.values()].filter((d) => d.orderId === orderId).map(clone);
  }
  async updateDevice(id: string, patch: Partial<DeviceRow>) {
    return patchRow(this.devices, id, clone(patch), "device");
  }

  async createAppointment(a: Parameters<CatalogRepository["createAppointment"]>[0]) {
    const row: AppointmentRow = { notes: null, ...clone(a), ...this.stamp() };
    this.appointments.set(row.id, row);
    return clone(row);
  }
  async listAppointmentsByOrder(orderId: string) {
    return [...this.appointments.values()].filter((a) => a.orderId === orderId).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).map(clone);
  }
  async updateAppointment(id: string, patch: Partial<AppointmentRow>) {
    return patchRow(this.appointments, id, clone(patch), "appointment");
  }

  async createPortingRequest(p: Parameters<CatalogRepository["createPortingRequest"]>[0]) {
    const row: PortingRow = { providerRef: null, rejectReason: null, dueAt: null, completedAt: null, ...clone(p), ...this.stamp() };
    this.portingRequests.set(row.id, row);
    return clone(row);
  }
  async getPortingRequestByOrder(orderId: string) {
    const p = [...this.portingRequests.values()].find((x) => x.orderId === orderId);
    return p ? clone(p) : null;
  }
  async listPortingInStatuses(statuses: PortingRow["status"][], limit: number) {
    return [...this.portingRequests.values()].filter((p) => statuses.includes(p.status)).slice(0, limit).map(clone);
  }
  async updatePortingRequest(id: string, patch: Partial<PortingRow>) {
    return patchRow(this.portingRequests, id, clone(patch), "porting request");
  }

  async addUsageSnapshot(u: Omit<UsageSnapshotRow, "id">) {
    const row: UsageSnapshotRow = { ...clone(u), id: randomUUID() };
    this.usageSnapshots.push(row);
    return clone(row);
  }
  async getLatestUsageSnapshot(serviceId: string) {
    const rows = this.usageSnapshots.filter((u) => u.serviceId === serviceId).sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
    return rows[0] ? clone(rows[0]) : null;
  }
}
