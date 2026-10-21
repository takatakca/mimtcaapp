import type postgres from "postgres";
import type { HandleRepository, HandleRow } from "./handles.js";

type Sql = postgres.Sql<{}>;
const maybe = <T>(rows: readonly unknown[]): T | null => (rows[0] as T | undefined) ?? null;

/** MIMT handles on Postgres (0013_user_handles.sql). Shares the connection pool of PostgresRepository. */
export class PostgresHandleRepository implements HandleRepository {
  constructor(private readonly sql: Sql) {}

  async forUser(userId: string) {
    return maybe<HandleRow>(await this.sql`select handle, user_id, telecom_account_id, created_at from user_handles where user_id = ${userId}`);
  }
  async find(handle: string) {
    return maybe<HandleRow>(await this.sql`select handle, user_id, telecom_account_id, created_at from user_handles where handle = ${handle}`);
  }
  async create(row: Omit<HandleRow, "createdAt">) {
    return maybe<HandleRow>(
      await this.sql`insert into user_handles (handle, user_id, telecom_account_id) values (${row.handle}, ${row.userId}, ${row.telecomAccountId})
        on conflict do nothing returning handle, user_id, telecom_account_id, created_at`,
    );
  }
}
