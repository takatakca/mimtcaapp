import type postgres from "postgres";
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

type Sql = postgres.Sql<{}>;
type Row = Record<string, any>;

const JSON_COLUMNS = new Set(["name", "description", "attributes", "serviceAddress", "details", "usageNotified"]);

function one<T>(rows: readonly unknown[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected a row");
  return row as T;
}
const maybe = <T>(rows: readonly unknown[]): T | null => (rows[0] as T | undefined) ?? null;
const many = <T>(rows: readonly unknown[]) => rows as unknown as T[];

/** Catalog storage on Postgres (0005_catalog.sql). Shares the connection pool of PostgresRepository. */
export class PostgresCatalogRepository implements CatalogRepository {
  constructor(private readonly sql: Sql) {}

  /** Drops undefined values and wraps jsonb columns so `sql(obj)` serializes them. */
  private cols(o: object): Row {
    const out: Row = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      out[k] = JSON_COLUMNS.has(k) && v !== null ? this.sql.json(v as postgres.JSONValue) : v;
    }
    return out;
  }

  async createOffer(o: Parameters<CatalogRepository["createOffer"]>[0]) {
    return one<OfferRow>(await this.sql`insert into offers ${this.sql(this.cols(o))} returning *`);
  }
  async updateOffer(id: string, patch: Partial<OfferRow>) {
    return one<OfferRow>(await this.sql`update offers set ${this.sql(this.cols({ ...patch, updatedAt: new Date() }))} where id = ${id} returning *`);
  }
  async getOffer(id: string) {
    return maybe<OfferRow>(await this.sql`select * from offers where id = ${id}`);
  }
  async getOfferByCode(code: string) {
    return maybe<OfferRow>(await this.sql`select * from offers where code = ${code}`);
  }
  async listOffers(filter: { status?: OfferRow["status"]; productLine?: OfferRow["productLine"] } = {}) {
    return many<OfferRow>(
      await this.sql`select * from offers
        where (${filter.status ?? null}::text is null or status = ${filter.status ?? null})
          and (${filter.productLine ?? null}::text is null or product_line = ${filter.productLine ?? null})
        order by monthly_price_cents, code`,
    );
  }

  async createOrder(o: Parameters<CatalogRepository["createOrder"]>[0]) {
    return one<OrderRow>(await this.sql`insert into service_orders ${this.sql(this.cols(o))} returning *`);
  }
  async getOrder(id: string) {
    return maybe<OrderRow>(await this.sql`select * from service_orders where id = ${id}`);
  }
  async updateOrder(id: string, expectedState: OrderRow["state"], patch: Partial<OrderRow>) {
    return maybe<OrderRow>(
      await this.sql`update service_orders set ${this.sql(this.cols({ ...patch, updatedAt: new Date() }))}
        where id = ${id} and state = ${expectedState} returning *`,
    );
  }
  async listOrdersByAccount(accountId: string) {
    return many<OrderRow>(await this.sql`select * from service_orders where telecom_account_id = ${accountId} order by created_at desc, id desc`);
  }
  async listOrdersInStates(states: OrderRow["state"][], limit: number) {
    return many<OrderRow>(await this.sql`select * from service_orders where state = any(${states}) order by updated_at limit ${limit}`);
  }

  async addOrderEvent(e: Parameters<CatalogRepository["addOrderEvent"]>[0]) {
    return one<OrderEventRow>(await this.sql`insert into order_events ${this.sql(this.cols(e))} returning *`);
  }
  async listOrderEvents(orderId: string) {
    return many<OrderEventRow>(await this.sql`select * from order_events where order_id = ${orderId} order by at, id`);
  }

  async createService(s: Parameters<CatalogRepository["createService"]>[0]) {
    return one<ServiceRow>(await this.sql`insert into service_instances ${this.sql(this.cols(s))} returning *`);
  }
  async getService(id: string) {
    return maybe<ServiceRow>(await this.sql`select * from service_instances where id = ${id}`);
  }
  async getServiceByOrder(orderId: string) {
    return maybe<ServiceRow>(await this.sql`select * from service_instances where order_id = ${orderId}`);
  }
  async getServiceByProviderId(provider: string, providerServiceId: string) {
    return maybe<ServiceRow>(await this.sql`select * from service_instances where provider = ${provider} and provider_service_id = ${providerServiceId}`);
  }
  async listServicesByAccount(accountId: string) {
    return many<ServiceRow>(await this.sql`select * from service_instances where telecom_account_id = ${accountId} order by created_at desc, id desc`);
  }
  async listServicesInStatuses(statuses: ServiceRow["status"][], limit: number) {
    return many<ServiceRow>(await this.sql`select * from service_instances where status = any(${statuses}) order by updated_at limit ${limit}`);
  }
  async updateService(id: string, patch: Partial<ServiceRow>) {
    return one<ServiceRow>(await this.sql`update service_instances set ${this.sql(this.cols({ ...patch, updatedAt: new Date() }))} where id = ${id} returning *`);
  }

  async createDevice(d: Parameters<CatalogRepository["createDevice"]>[0]) {
    return one<DeviceRow>(await this.sql`insert into devices ${this.sql(this.cols(d))} returning *`);
  }
  async listDevicesByOrder(orderId: string) {
    return many<DeviceRow>(await this.sql`select * from devices where order_id = ${orderId} order by created_at`);
  }
  async updateDevice(id: string, patch: Partial<DeviceRow>) {
    return one<DeviceRow>(await this.sql`update devices set ${this.sql(this.cols({ ...patch, updatedAt: new Date() }))} where id = ${id} returning *`);
  }

  async createAppointment(a: Parameters<CatalogRepository["createAppointment"]>[0]) {
    return one<AppointmentRow>(await this.sql`insert into appointments ${this.sql(this.cols(a))} returning *`);
  }
  async listAppointmentsByOrder(orderId: string) {
    return many<AppointmentRow>(await this.sql`select * from appointments where order_id = ${orderId} order by starts_at`);
  }
  async updateAppointment(id: string, patch: Partial<AppointmentRow>) {
    return one<AppointmentRow>(await this.sql`update appointments set ${this.sql(this.cols({ ...patch, updatedAt: new Date() }))} where id = ${id} returning *`);
  }

  async createPortingRequest(p: Parameters<CatalogRepository["createPortingRequest"]>[0]) {
    return one<PortingRow>(await this.sql`insert into porting_requests ${this.sql(this.cols(p))} returning *`);
  }
  async getPortingRequestByOrder(orderId: string) {
    return maybe<PortingRow>(await this.sql`select * from porting_requests where order_id = ${orderId}`);
  }
  async listPortingInStatuses(statuses: PortingRow["status"][], limit: number) {
    return many<PortingRow>(await this.sql`select * from porting_requests where status = any(${statuses}) order by updated_at limit ${limit}`);
  }
  async updatePortingRequest(id: string, patch: Partial<PortingRow>) {
    return one<PortingRow>(await this.sql`update porting_requests set ${this.sql(this.cols({ ...patch, updatedAt: new Date() }))} where id = ${id} returning *`);
  }

  async addUsageSnapshot(u: Omit<UsageSnapshotRow, "id">) {
    return one<UsageSnapshotRow>(await this.sql`insert into usage_snapshots ${this.sql(this.cols(u))} returning *`);
  }
  async getLatestUsageSnapshot(serviceId: string) {
    return maybe<UsageSnapshotRow>(await this.sql`select * from usage_snapshots where service_id = ${serviceId} order by captured_at desc limit 1`);
  }
}
