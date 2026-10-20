import type postgres from "postgres";
import type { NumberHoldRepository, NumberHoldRow } from "./numberHolds.js";

type Sql = postgres.Sql<{}>;

const COLS = "id, e164, token_hash, ip_hash, status, telecom_account_id, checkout_session_id, expires_at, created_at";
const maybe = <T>(rows: readonly unknown[]): T | null => (rows[0] as T | undefined) ?? null;

/** Number picker holds on Postgres (0011_number_holds.sql). Shares the connection pool of PostgresRepository. */
export class PostgresNumberHoldRepository implements NumberHoldRepository {
  constructor(private readonly sql: Sql) {}

  async create(h: Parameters<NumberHoldRepository["create"]>[0]) {
    return this.sql.begin(async (tx) => {
      await tx`update number_holds set status = 'expired', updated_at = now()
        where e164 = ${h.e164} and status in ('held', 'checkout') and expires_at <= ${h.now}`;
      return maybe<NumberHoldRow>(
        await tx`insert into number_holds (e164, token_hash, ip_hash, expires_at, created_at)
          values (${h.e164}, ${h.tokenHash}, ${h.ipHash}, ${h.expiresAt}, ${h.now})
          on conflict do nothing returning ${tx.unsafe(COLS)}`,
      );
    }) as Promise<NumberHoldRow | null>;
  }
  async get(id: string) {
    return maybe<NumberHoldRow>(await this.sql`select ${this.sql.unsafe(COLS)} from number_holds where id = ${id}`);
  }
  async liveHeld(e164s: readonly string[], now: Date) {
    if (!e164s.length) return new Set<string>();
    const rows = await this.sql<{ e164: string }[]>`select e164 from number_holds
      where e164 in ${this.sql([...e164s])} and status in ('held', 'checkout') and expires_at > ${now}`;
    return new Set(rows.map((r) => r.e164));
  }
  async liveByIp(ipHash: string, now: Date) {
    return (await this.sql`select ${this.sql.unsafe(COLS)} from number_holds
      where ip_hash = ${ipHash} and status in ('held', 'checkout') and expires_at > ${now}`) as unknown as NumberHoldRow[];
  }
  async countByIpSince(ipHash: string, since: Date) {
    const [r] = await this.sql<{ n: number }[]>`select count(*)::int as n from number_holds where ip_hash = ${ipHash} and created_at >= ${since}`;
    return r?.n ?? 0;
  }
  async startCheckout(id: string, p: Parameters<NumberHoldRepository["startCheckout"]>[1]) {
    const rows = await this.sql`update number_holds
      set status = 'checkout', telecom_account_id = ${p.telecomAccountId}, checkout_session_id = ${p.checkoutSessionId},
          expires_at = ${p.expiresAt}, updated_at = now()
      where id = ${id} and status in ('held', 'checkout') and expires_at > ${p.now} returning id`;
    return rows.length > 0;
  }
  async finish(id: string, status: Parameters<NumberHoldRepository["finish"]>[1]) {
    const rows = await this.sql`update number_holds set status = ${status}, updated_at = now()
      where id = ${id} and status in ('held', 'checkout') returning id`;
    return rows.length > 0;
  }
}
