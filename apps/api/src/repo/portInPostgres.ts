import type postgres from "postgres";
import { PORT_IN_OPEN_NUMBER_STATUSES } from "@mimt/shared";
import { PortInNumberTakenError, type NewPortIn, type PortInNumberRow, type PortInRepository, type PortInRow, type PortInWithNumbers } from "./portIn.js";

type Sql = postgres.Sql<{}>;
type Row = Record<string, any>;

const OPEN = [...PORT_IN_OPEN_NUMBER_STATUSES] as string[];

function first<T>(rows: readonly unknown[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected a row");
  return row as T;
}

const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === "23505";

/** Port-in storage on Postgres (0009_port_in.sql). Shares the connection pool of PostgresRepository. */
export class PostgresPortInRepository implements PortInRepository {
  constructor(private readonly sql: Sql) {}

  /** Drops undefined values and wraps the jsonb column. */
  private cols(o: object): Row {
    const out: Row = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      out[k] = k === "serviceAddress" && v !== null ? this.sql.json(v as postgres.JSONValue) : v;
    }
    return out;
  }

  private async attach(rows: readonly PortInRow[]): Promise<PortInWithNumbers[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const numbers = (await this.sql`select * from port_in_numbers where port_in_id = any(${ids}::uuid[]) order by e164`) as unknown as PortInNumberRow[];
    return rows.map((request) => ({ request, numbers: numbers.filter((n) => n.portInId === request.id) }));
  }

  async create(r: NewPortIn, e164s: string[]) {
    try {
      const id = (await this.sql.begin(async (tx) => {
        const row = first<{ id: string }>(await tx`insert into port_in_requests ${tx(this.cols(r))} returning id`);
        await tx`insert into port_in_numbers ${tx(e164s.map((e164) => ({ portInId: row.id, e164 })))}`;
        return row.id;
      })) as string;
      return (await this.get(id))!;
    } catch (e) {
      if (isUniqueViolation(e)) throw new PortInNumberTakenError(e164s[0] ?? "");
      throw e;
    }
  }

  async get(id: string) {
    const rows = (await this.sql`select * from port_in_requests where id = ${id}`) as unknown as PortInRow[];
    return (await this.attach(rows))[0] ?? null;
  }

  async getByCarrierRef(carrierRef: string) {
    const rows = (await this.sql`select * from port_in_requests where carrier_ref = ${carrierRef}`) as unknown as PortInRow[];
    return (await this.attach(rows))[0] ?? null;
  }

  async listByAccounts(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = (await this.sql`select * from port_in_requests where telecom_account_id = any(${ids}::uuid[])
      order by created_at desc, id desc limit 200`) as unknown as PortInRow[];
    return this.attach(rows);
  }

  async update(id: string, patch: Parameters<PortInRepository["update"]>[1]) {
    return first<PortInRow>(await this.sql`update port_in_requests set ${this.sql(this.cols(patch))} where id = ${id} returning *`);
  }

  async updateNumber(id: string, patch: Parameters<PortInRepository["updateNumber"]>[1]) {
    try {
      return first<PortInNumberRow>(await this.sql`update port_in_numbers set ${this.sql(this.cols(patch))} where id = ${id} returning *`);
    } catch (e) {
      if (isUniqueViolation(e)) throw new PortInNumberTakenError("");
      throw e;
    }
  }

  async findOpenNumber(e164: string) {
    const rows = await this.sql`select * from port_in_numbers where e164 = ${e164} and status = any(${OPEN}::text[]) limit 1`;
    return (rows[0] as PortInNumberRow | undefined) ?? null;
  }
}
