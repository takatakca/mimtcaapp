import type postgres from "postgres";
import type { WebPushRepository, WebPushSubscriptionRow } from "./webPush.js";

type Sql = postgres.Sql<{}>;
const COLS = "id, user_id, endpoint, p256dh, auth, created_at";

/** Web Push on Postgres (0014_web_push.sql). Shares the connection pool of PostgresRepository. */
export class PostgresWebPushRepository implements WebPushRepository {
  constructor(private readonly sql: Sql) {}

  async upsert(s: Omit<WebPushSubscriptionRow, "id" | "createdAt">) {
    const [row] = await this.sql`insert into web_push_subscriptions (user_id, endpoint, p256dh, auth)
      values (${s.userId}, ${s.endpoint}, ${s.p256dh}, ${s.auth})
      on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
      returning ${this.sql.unsafe(COLS)}`;
    return row as unknown as WebPushSubscriptionRow;
  }
  async listForUser(userId: string) {
    return (await this.sql`select ${this.sql.unsafe(COLS)} from web_push_subscriptions where user_id = ${userId}`) as unknown as WebPushSubscriptionRow[];
  }
  async deleteByEndpoint(endpoint: string) {
    await this.sql`delete from web_push_subscriptions where endpoint = ${endpoint}`;
  }
  async getKey(name: string) {
    const [r] = await this.sql<{ valueEncrypted: string }[]>`select value_encrypted from server_keys where name = ${name}`;
    return r?.valueEncrypted ?? null;
  }
  async putKeyOnce(name: string, valueEncrypted: string) {
    await this.sql`insert into server_keys (name, value_encrypted) values (${name}, ${valueEncrypted}) on conflict (name) do nothing`;
    return (await this.getKey(name))!;
  }
}
