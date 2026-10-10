import { DEFAULT_CALL_SETTINGS, type CallSettings, type WeeklySchedule } from "@mimt/shared";
import type postgres from "postgres";
import type { BlockedNumber, CallControlsRepository } from "./callControls.js";

type Sql = postgres.Sql<{}>;
type Row = Record<string, any>;

export class PostgresCallControlsRepository implements CallControlsRepository {
  constructor(private readonly sql: Sql) {}

  async listBlocks(accountId: string) {
    return (await this.sql`select * from blocked_numbers where telecom_account_id = ${accountId}
      order by created_at desc, id`) as unknown as BlockedNumber[];
  }
  async addBlock(input: { telecomAccountId: string; e164: string; label: string | null }) {
    const inserted = await this.sql`insert into blocked_numbers (telecom_account_id, e164, label)
      values (${input.telecomAccountId}, ${input.e164}, ${input.label})
      on conflict (telecom_account_id, e164) do nothing returning *`;
    if (inserted[0]) return { block: inserted[0] as BlockedNumber, created: true };
    const rows = await this.sql`select * from blocked_numbers where telecom_account_id = ${input.telecomAccountId} and e164 = ${input.e164}`;
    return { block: rows[0] as BlockedNumber, created: false };
  }
  async removeBlock(accountId: string, id: string) {
    const rows = await this.sql`delete from blocked_numbers where id = ${id} and telecom_account_id = ${accountId} returning id`;
    return rows.length === 1;
  }
  async isBlocked(accountId: string, e164: string) {
    const rows = await this.sql`select 1 from blocked_numbers where telecom_account_id = ${accountId} and e164 = ${e164}`;
    return rows.length > 0;
  }

  async getCallSettings(accountId: string) {
    const rows = await this.sql`select * from call_settings where telecom_account_id = ${accountId}`;
    return rows[0] ? toSettings(rows[0] as Row) : structuredClone(DEFAULT_CALL_SETTINGS);
  }
  async saveCallSettings(accountId: string, s: CallSettings) {
    const schedule = s.dnd.schedule ? this.sql.json(s.dnd.schedule as unknown as postgres.JSONValue) : null;
    const rows = await this.sql`insert into call_settings
        (telecom_account_id, forwarding_mode, forwarding_target, forwarding_timeout_s, dnd_enabled, dnd_schedule, blocked_call_action)
      values (${accountId}, ${s.forwarding.mode}, ${s.forwarding.target}, ${s.forwarding.timeoutS}, ${s.dnd.enabled}, ${schedule}, ${s.blockedCallAction})
      on conflict (telecom_account_id) do update set
        forwarding_mode = excluded.forwarding_mode, forwarding_target = excluded.forwarding_target,
        forwarding_timeout_s = excluded.forwarding_timeout_s, dnd_enabled = excluded.dnd_enabled,
        dnd_schedule = excluded.dnd_schedule, blocked_call_action = excluded.blocked_call_action
      returning *`;
    return toSettings(rows[0] as Row);
  }
}

const toSettings = (r: Row): CallSettings => ({
  forwarding: { mode: r.forwardingMode, target: r.forwardingTarget ?? null, timeoutS: r.forwardingTimeoutS },
  dnd: { enabled: r.dndEnabled, schedule: (r.dndSchedule as WeeklySchedule | null) ?? null },
  blockedCallAction: r.blockedCallAction,
});
