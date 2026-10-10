import type postgres from "postgres";
import type { EmailOutboxItem, MediaObject, MediaRepository, VoicemailSettings } from "./mediaTypes.js";

type Sql = postgres.Sql<{}>;
type Row = Record<string, any>;
const defined = (o: object): Row => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const maybe = <T>(rows: readonly unknown[]): T | null => (rows[0] as T | undefined) ?? null;
function one<T>(rows: readonly unknown[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected a row");
  return row as T;
}

/** Tables from supabase/migrations/0007_media_greetings.sql. */
export class PostgresMediaRepository implements MediaRepository {
  constructor(private readonly sql: Sql) {}

  async createMedia(m: Omit<MediaObject, "id" | "createdAt">) {
    return one<MediaObject>(await this.sql`insert into media_objects ${this.sql(defined(m))} returning *`);
  }
  async getMedia(id: string) {
    return maybe<MediaObject>(await this.sql`select * from media_objects where id = ${id}`);
  }
  async updateMedia(id: string, patch: Partial<Omit<MediaObject, "id" | "createdAt" | "telecomAccountId">>) {
    const fields = defined(patch);
    if (Object.keys(fields).length === 0) return this.getMedia(id);
    return maybe<MediaObject>(await this.sql`update media_objects set ${this.sql(fields)} where id = ${id} returning *`);
  }
  async deleteMedia(id: string) {
    await this.sql`delete from media_objects where id = ${id}`;
  }
  async listMediaForMessages(messageIds: string[]) {
    if (messageIds.length === 0) return [];
    return (await this.sql`select * from media_objects where message_id in ${this.sql(messageIds)} order by created_at`) as unknown as MediaObject[];
  }
  async listExpiredMedia(now: Date, limit: number) {
    return (await this.sql`select * from media_objects where expires_at < ${now} order by expires_at limit ${limit}`) as unknown as MediaObject[];
  }

  async getVoicemailSettings(accountId: string) {
    return maybe<VoicemailSettings>(await this.sql`select * from voicemail_settings where telecom_account_id = ${accountId}`);
  }
  async upsertVoicemailSettings(accountId: string, patch: Partial<Pick<VoicemailSettings, "greetingMediaId" | "emailEnabled">>) {
    const row: Row = { telecomAccountId: accountId, ...defined(patch), updatedAt: new Date() };
    const cols = Object.keys(row).filter((k) => k !== "telecomAccountId");
    return one<VoicemailSettings>(
      await this.sql`insert into voicemail_settings ${this.sql(row)}
        on conflict (telecom_account_id) do update set ${this.sql(row, cols)} returning *`,
    );
  }

  async enqueueEmail(e: { userId: string; template: EmailOutboxItem["template"]; payload: Record<string, unknown>; nextAttemptAt: Date }) {
    return one<EmailOutboxItem>(
      await this.sql`insert into email_outbox (user_id, template, payload, next_attempt_at)
        values (${e.userId}, ${e.template}, ${this.sql.json(e.payload as postgres.JSONValue)}, ${e.nextAttemptAt}) returning *`,
    );
  }
  async listDueEmails(now: Date, limit: number) {
    return (await this.sql`select * from email_outbox where sent_at is null and next_attempt_at <= ${now}
      order by next_attempt_at limit ${limit}`) as unknown as EmailOutboxItem[];
  }
  async markEmailSent(id: string, at: Date) {
    await this.sql`update email_outbox set sent_at = ${at}, next_attempt_at = null, attempts = attempts + 1 where id = ${id}`;
  }
  async markEmailFailed(id: string, error: string, nextAttemptAt: Date | null) {
    await this.sql`update email_outbox set attempts = attempts + 1, last_error = ${error.slice(0, 500)}, next_attempt_at = ${nextAttemptAt} where id = ${id}`;
  }
}
