import type postgres from "postgres";
import type {
  CalendarConnectionPatch,
  CalendarConnectionRow,
  CalendarJobStatus,
  CalendarRepository,
  CalendarSourceType,
  CalendarSyncJobRow,
} from "./calendar.js";

type Sql = postgres.Sql<{}>;

const CONN_COLS =
  "user_id, google_email, refresh_token_encrypted, scope, calendar_id, status, sync_calls, sync_missed_calls, sync_voicemails, sync_summaries, include_content, reconnect_notified_at, last_sync_at, connected_at, updated_at";
const JOB_COLS = "id, user_id, source_type, source_id, status, attempts, next_attempt_at, google_event_id, last_error, created_at, done_at";

const first = <T>(rows: readonly unknown[]): T | null => (rows[0] as T | undefined) ?? null;

const CONN_PATCH: Record<keyof CalendarConnectionPatch, string> = {
  syncCalls: "sync_calls",
  syncMissedCalls: "sync_missed_calls",
  syncVoicemails: "sync_voicemails",
  syncSummaries: "sync_summaries",
  includeContent: "include_content",
  status: "status",
  reconnectNotifiedAt: "reconnect_notified_at",
  lastSyncAt: "last_sync_at",
};

/** « Google Agenda » on Postgres (0024_calendar.sql). */
export class PostgresCalendarRepository implements CalendarRepository {
  constructor(private readonly sql: Sql) {}

  async upsertConnection(c: { userId: string; googleEmail: string | null; refreshTokenEncrypted: string; scope: string; at: Date }) {
    return first<CalendarConnectionRow>(
      await this.sql.unsafe(
        `insert into calendar_connections (user_id, google_email, refresh_token_encrypted, scope, connected_at)
         values ($1, $2, $3, $4, $5)
         on conflict (user_id) do update set google_email = excluded.google_email,
           refresh_token_encrypted = excluded.refresh_token_encrypted, scope = excluded.scope, status = 'active',
           reconnect_notified_at = null
         returning ${CONN_COLS}`,
        [c.userId, c.googleEmail, c.refreshTokenEncrypted, c.scope, c.at],
      ),
    )!;
  }

  async getConnection(userId: string) {
    return first<CalendarConnectionRow>(await this.sql.unsafe(`select ${CONN_COLS} from calendar_connections where user_id = $1`, [userId]));
  }

  async updateConnection(userId: string, patch: CalendarConnectionPatch) {
    const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && k in CONN_PATCH) as [keyof CalendarConnectionPatch, unknown][];
    if (!entries.length) return this.getConnection(userId);
    const set = entries.map(([k], i) => `${CONN_PATCH[k]} = $${i + 2}`).join(", ");
    return first<CalendarConnectionRow>(
      await this.sql.unsafe(`update calendar_connections set ${set} where user_id = $1 returning ${CONN_COLS}`, [userId, ...entries.map(([, v]) => v)] as never[]),
    );
  }

  async deleteConnection(userId: string) {
    return this.sql.begin(async (tx) => {
      await tx`delete from calendar_sync_jobs where user_id = ${userId} and status = 'pending'`;
      const rows = await tx`delete from calendar_connections where user_id = ${userId} returning user_id`;
      return rows.length > 0;
    }) as Promise<boolean>;
  }

  async markNeedsReconnect(userId: string, at: Date) {
    return this.sql.begin(async (tx) => {
      const rows = (await tx`select reconnect_notified_at from calendar_connections where user_id = ${userId} for update`) as unknown as Array<{ reconnectNotifiedAt: Date | null }>;
      if (!rows[0]) return false;
      const firstTime = rows[0].reconnectNotifiedAt === null;
      await tx`update calendar_connections set status = 'needs_reconnect', reconnect_notified_at = coalesce(reconnect_notified_at, ${at}) where user_id = ${userId}`;
      return firstTime;
    }) as Promise<boolean>;
  }

  async enqueueJob(j: { userId: string; sourceType: CalendarSourceType; sourceId: string; notBefore: Date }) {
    return first<CalendarSyncJobRow>(
      await this.sql.unsafe(
        `insert into calendar_sync_jobs (user_id, source_type, source_id, next_attempt_at) values ($1, $2, $3, $4)
         on conflict (user_id, source_type, source_id) do nothing returning ${JOB_COLS}`,
        [j.userId, j.sourceType, j.sourceId, j.notBefore],
      ),
    );
  }

  async getJob(id: string) {
    return first<CalendarSyncJobRow>(await this.sql.unsafe(`select ${JOB_COLS} from calendar_sync_jobs where id = $1`, [id]));
  }

  async listDueJobs(now: Date, limit: number) {
    return (await this.sql.unsafe(
      `select ${JOB_COLS} from calendar_sync_jobs where status = 'pending' and next_attempt_at <= $1 order by next_attempt_at, id limit $2`,
      [now, limit],
    )) as unknown as CalendarSyncJobRow[];
  }

  async finishJob(id: string, r: { status: CalendarJobStatus; at: Date; googleEventId?: string | null; error?: string | null; nextAttemptAt?: Date | null; countAttempt?: boolean }) {
    const pending = r.status === "pending";
    await this.sql.unsafe(
      `update calendar_sync_jobs set status = $2, attempts = attempts + $3, google_event_id = coalesce($4, google_event_id),
         last_error = $5, next_attempt_at = $6, done_at = $7 where id = $1`,
      [id, r.status, r.countAttempt === false ? 0 : 1, r.googleEventId ?? null, r.error ? r.error.slice(0, 300) : null, pending ? (r.nextAttemptAt ?? r.at) : null, pending ? null : r.at] as never[],
    );
  }

  async purgeFinishedJobs(before: Date) {
    const rows = await this.sql`delete from calendar_sync_jobs where status <> 'pending' and done_at < ${before} returning id`;
    return rows.length;
  }
}
