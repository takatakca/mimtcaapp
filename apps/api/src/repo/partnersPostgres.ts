import type postgres from "postgres";
import type {
  NewPartnerCall,
  PartnerApiKeyRow,
  PartnerCallPatch,
  PartnerCallRow,
  PartnerCreditInput,
  PartnerCreditResult,
  PartnerHuntGroupRow,
  PartnerLedgerRow,
  PartnerMemberFields,
  PartnerMemberRow,
  PartnerPatch,
  PartnerRepository,
  PartnerRow,
  PartnerWebhookEventRow,
} from "./partners.js";

type Sql = postgres.Sql<{}>;
type Json = postgres.JSONValue;

const PARTNER_COLS =
  "id, business_id, name, status, credit_per_minute, credit_balance, webhook_url, webhook_secret_encrypted, credits_exhausted_at, created_by, created_at, updated_at";
const KEY_COLS = "id, partner_id, prefix, key_sha256, label, created_by, created_at, last_used_at, revoked_at";
const MEMBER_COLS = "id, partner_id, external_id, name, email, phone, handle, language, active, extension_id, created_at, updated_at";
const HUNT_COLS = "id, partner_id, key, ring_group_id, created_at, updated_at";
const LEDGER_COLS = "id, partner_id, delta, reason, reference, idempotency_key, balance_after, meta, created_by, created_at";
const CALL_COLS =
  "id, partner_id, call_sid, direction, from_number, to_number, hunt_group_key, member_id, external_id, answered_leg_sid, started_at, answered_at, ended_at, talk_s, credits_charged, billing, recording_id, finalized_at, created_at";
// The payload is read back as text: the client's camelCase transform would otherwise rename the snake_case keys
// the partner receives (call_id → callId).
const EVENT_COLS = "id, partner_id, event_type, payload::text as payload_text, attempts, next_attempt_at, delivered_at, last_error, created_at";

const first = <T>(rows: readonly unknown[]): T | null => (rows[0] as T | undefined) ?? null;

type EventRowText = Omit<PartnerWebhookEventRow, "payload"> & { payloadText: string };
const eventRow = ({ payloadText, ...r }: EventRowText): PartnerWebhookEventRow => ({ ...r, payload: JSON.parse(payloadText) as Record<string, unknown> });
const firstEvent = (rows: readonly unknown[]) => {
  const r = first<EventRowText>(rows);
  return r ? eventRow(r) : null;
};

/** Partner columns a patch may set (camelCase field → column). */
const PARTNER_PATCH: Record<keyof PartnerPatch, string> = {
  name: "name",
  status: "status",
  creditPerMinute: "credit_per_minute",
  webhookUrl: "webhook_url",
  webhookSecretEncrypted: "webhook_secret_encrypted",
  creditsExhaustedAt: "credits_exhausted_at",
};
const CALL_PATCH: Record<keyof PartnerCallPatch, string> = {
  endedAt: "ended_at",
  talkS: "talk_s",
  creditsCharged: "credits_charged",
  billing: "billing",
  recordingId: "recording_id",
};

/** Builds `set a = $2, b = $3` from the defined fields of a patch ($1 is the id). */
function setClause<P extends object>(patch: P, columns: Record<keyof P, string>): { sql: string; values: unknown[] } {
  const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && k in columns) as [keyof P, unknown][];
  return { sql: entries.map(([k], i) => `${columns[k]} = $${i + 2}`).join(", "), values: entries.map(([, v]) => v) };
}

/** MIMT Connect on Postgres (0023_partners.sql). Credit moves are one transaction after `select … for update` on the partner. */
export class PostgresPartnerRepository implements PartnerRepository {
  constructor(private readonly sql: Sql) {}

  async createPartner(p: { businessId: string; name: string; creditPerMinute: number | null; createdBy: string | null }) {
    return first<PartnerRow>(
      await this.sql.unsafe(`insert into partners (business_id, name, credit_per_minute, created_by) values ($1, $2, $3, $4) returning ${PARTNER_COLS}`, [
        p.businessId,
        p.name,
        p.creditPerMinute,
        p.createdBy,
      ]),
    )!;
  }

  async getPartner(id: string) {
    return first<PartnerRow>(await this.sql.unsafe(`select ${PARTNER_COLS} from partners where id = $1`, [id]));
  }

  async getPartnerByBusiness(businessId: string) {
    return first<PartnerRow>(await this.sql.unsafe(`select ${PARTNER_COLS} from partners where business_id = $1`, [businessId]));
  }

  async listPartners() {
    return (await this.sql.unsafe(`select ${PARTNER_COLS} from partners order by created_at`)) as unknown as PartnerRow[];
  }

  async updatePartner(id: string, patch: PartnerPatch) {
    const set = setClause(patch, PARTNER_PATCH);
    if (!set.values.length) return this.getPartner(id);
    return first<PartnerRow>(await this.sql.unsafe(`update partners set ${set.sql} where id = $1 returning ${PARTNER_COLS}`, [id, ...set.values] as never[]));
  }

  async createApiKey(k: Pick<PartnerApiKeyRow, "partnerId" | "prefix" | "keySha256" | "label" | "createdBy">) {
    return first<PartnerApiKeyRow>(
      await this.sql.unsafe(`insert into partner_api_keys (partner_id, prefix, key_sha256, label, created_by) values ($1, $2, $3, $4, $5) returning ${KEY_COLS}`, [
        k.partnerId,
        k.prefix,
        k.keySha256,
        k.label,
        k.createdBy,
      ]),
    )!;
  }

  async findApiKeyByHash(keySha256: string) {
    return first<PartnerApiKeyRow>(await this.sql.unsafe(`select ${KEY_COLS} from partner_api_keys where key_sha256 = $1`, [keySha256]));
  }

  async listApiKeys(partnerId: string) {
    return (await this.sql.unsafe(`select ${KEY_COLS} from partner_api_keys where partner_id = $1 order by created_at desc`, [partnerId])) as unknown as PartnerApiKeyRow[];
  }

  async revokeApiKey(partnerId: string, id: string, at: Date) {
    return first<PartnerApiKeyRow>(
      await this.sql.unsafe(`update partner_api_keys set revoked_at = $3 where id = $1 and partner_id = $2 and revoked_at is null returning ${KEY_COLS}`, [id, partnerId, at]),
    );
  }

  async touchApiKey(id: string, at: Date) {
    await this.sql`update partner_api_keys set last_used_at = ${at} where id = ${id}`;
  }

  async upsertMember(partnerId: string, externalId: string, f: PartnerMemberFields) {
    const rows = await this.sql.unsafe(
      `insert into partner_members (partner_id, external_id, name, email, phone, handle, language, active, extension_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (partner_id, external_id) do update set name = excluded.name, email = excluded.email, phone = excluded.phone,
         handle = excluded.handle, language = excluded.language, active = excluded.active, extension_id = excluded.extension_id
       returning ${MEMBER_COLS}, (xmax = 0) as created`,
      [partnerId, externalId, f.name, f.email, f.phone, f.handle, f.language, f.active, f.extensionId],
    );
    const { created, ...member } = first<PartnerMemberRow & { created: boolean }>(rows)!;
    return { member, created };
  }

  async getMember(partnerId: string, externalId: string) {
    return first<PartnerMemberRow>(await this.sql.unsafe(`select ${MEMBER_COLS} from partner_members where partner_id = $1 and external_id = $2`, [partnerId, externalId]));
  }

  async getMemberById(id: string) {
    return first<PartnerMemberRow>(await this.sql.unsafe(`select ${MEMBER_COLS} from partner_members where id = $1`, [id]));
  }

  async getMemberByExtension(extensionId: string) {
    return first<PartnerMemberRow>(await this.sql.unsafe(`select ${MEMBER_COLS} from partner_members where extension_id = $1 limit 1`, [extensionId]));
  }

  async listMembers(partnerId: string) {
    return (await this.sql.unsafe(`select ${MEMBER_COLS} from partner_members where partner_id = $1 order by external_id collate "C"`, [partnerId])) as unknown as PartnerMemberRow[];
  }

  async upsertHuntGroup(h: { partnerId: string; key: string; ringGroupId: string }) {
    return first<PartnerHuntGroupRow>(
      await this.sql.unsafe(
        `insert into partner_hunt_groups (partner_id, key, ring_group_id) values ($1, $2, $3)
         on conflict (partner_id, key) do update set ring_group_id = excluded.ring_group_id returning ${HUNT_COLS}`,
        [h.partnerId, h.key, h.ringGroupId],
      ),
    )!;
  }

  async getHuntGroup(partnerId: string, key: string) {
    return first<PartnerHuntGroupRow>(await this.sql.unsafe(`select ${HUNT_COLS} from partner_hunt_groups where partner_id = $1 and key = $2`, [partnerId, key]));
  }

  async getHuntGroupByRingGroup(ringGroupId: string) {
    return first<PartnerHuntGroupRow>(await this.sql.unsafe(`select ${HUNT_COLS} from partner_hunt_groups where ring_group_id = $1`, [ringGroupId]));
  }

  async listHuntGroups(partnerId: string) {
    return (await this.sql.unsafe(`select ${HUNT_COLS} from partner_hunt_groups where partner_id = $1 order by key collate "C"`, [partnerId])) as unknown as PartnerHuntGroupRow[];
  }

  async applyCredit(input: PartnerCreditInput): Promise<PartnerCreditResult> {
    return (await this.sql.begin(async (tx) => {
      // The lock serializes every move of this partner's credits: the key check and the balance below are exact.
      const locked = first<{ creditBalance: number }>(await tx`select credit_balance from partners where id = ${input.partnerId} for update`);
      if (!locked) throw new Error("unknown partner");
      const seen = first<PartnerLedgerRow>(await tx.unsafe(`select ${LEDGER_COLS} from partner_credit_ledger where idempotency_key = $1`, [input.idempotencyKey]));
      if (seen) return { status: "duplicate", row: seen, balance: locked.creditBalance };
      const balance = locked.creditBalance;
      let delta: number;
      if (input.reason === "topup") {
        if (!(input.credits > 0)) throw new Error("top-up must be positive");
        delta = input.credits;
      } else if (input.reason === "call") {
        if (input.credits < 0) throw new Error("call cost must be >= 0");
        delta = 0 - Math.min(input.credits, balance);
      } else {
        if (balance + input.credits < 0) return { status: "insufficient", balance };
        delta = input.credits;
      }
      const [updated] = await tx`update partners set credit_balance = credit_balance + ${delta} where id = ${input.partnerId} returning credit_balance`;
      const after = (updated as { creditBalance: number }).creditBalance;
      const row = first<PartnerLedgerRow>(
        await tx.unsafe(
          `insert into partner_credit_ledger (partner_id, delta, reason, reference, idempotency_key, balance_after, meta, created_by, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${LEDGER_COLS}`,
          [input.partnerId, delta, input.reason, input.reference, input.idempotencyKey, after, tx.json((input.meta ?? {}) as Json) as never, input.createdBy ?? null, input.at],
        ),
      )!;
      return { status: "applied", row, balance: after };
    })) as PartnerCreditResult;
  }

  async listLedger(partnerId: string, limit: number) {
    return (await this.sql.unsafe(`select ${LEDGER_COLS} from partner_credit_ledger where partner_id = $1 order by created_at desc, seq desc limit $2`, [
      partnerId,
      limit,
    ])) as unknown as PartnerLedgerRow[];
  }

  async createCall(c: NewPartnerCall) {
    await this.sql.unsafe(
      `insert into partner_calls (partner_id, call_sid, direction, from_number, to_number, hunt_group_key, started_at)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (call_sid) do nothing`,
      [c.partnerId, c.callSid, c.direction, c.fromNumber, c.toNumber, c.huntGroupKey, c.startedAt],
    );
    return (await this.getCallBySid(c.callSid))!;
  }

  async getCallBySid(callSid: string) {
    return first<PartnerCallRow>(await this.sql.unsafe(`select ${CALL_COLS} from partner_calls where call_sid = $1`, [callSid]));
  }

  async updateCall(id: string, patch: PartnerCallPatch) {
    const set = setClause(patch, CALL_PATCH);
    if (!set.values.length) return first<PartnerCallRow>(await this.sql.unsafe(`select ${CALL_COLS} from partner_calls where id = $1`, [id]));
    return first<PartnerCallRow>(await this.sql.unsafe(`update partner_calls set ${set.sql} where id = $1 returning ${CALL_COLS}`, [id, ...set.values] as never[]));
  }

  async markAnswered(id: string, a: { memberId: string; externalId: string; legSid: string; at: Date }) {
    return first<PartnerCallRow>(
      await this.sql.unsafe(
        `update partner_calls set member_id = $2, external_id = $3, answered_leg_sid = $4, answered_at = $5
         where id = $1 and answered_at is null returning ${CALL_COLS}`,
        [id, a.memberId, a.externalId, a.legSid, a.at],
      ),
    );
  }

  async claimFinalize(id: string, at: Date) {
    return (await this.sql`update partner_calls set finalized_at = ${at} where id = ${id} and finalized_at is null returning id`).length === 1;
  }

  async listCalls(partnerId: string, opts: { since?: Date; externalId?: string; limit: number }) {
    return (await this.sql.unsafe(
      `select ${CALL_COLS} from partner_calls
       where partner_id = $1 and ($2::timestamptz is null or started_at > $2) and ($3::text is null or external_id = $3)
       order by started_at, id limit $4`,
      [partnerId, opts.since ?? null, opts.externalId ?? null, opts.limit],
    )) as unknown as PartnerCallRow[];
  }

  async listRecentCalls(partnerId: string, limit: number) {
    return (await this.sql.unsafe(`select ${CALL_COLS} from partner_calls where partner_id = $1 order by started_at desc, id desc limit $2`, [
      partnerId,
      limit,
    ])) as unknown as PartnerCallRow[];
  }

  async enqueueEvent(e: { partnerId: string; eventType: PartnerWebhookEventRow["eventType"]; payload: Record<string, unknown>; at: Date }) {
    return firstEvent(
      await this.sql.unsafe(
        `insert into partner_webhook_events (partner_id, event_type, payload, next_attempt_at, created_at) values ($1, $2, $3, $4, $4) returning ${EVENT_COLS}`,
        [e.partnerId, e.eventType, this.sql.json(e.payload as Json) as never, e.at],
      ),
    )!;
  }

  async listDueEvents(now: Date, limit: number) {
    return ((await this.sql.unsafe(
      `select ${EVENT_COLS} from partner_webhook_events
       where delivered_at is null and next_attempt_at is not null and next_attempt_at <= $1 order by created_at limit $2`,
      [now, limit],
    )) as unknown as EventRowText[]).map(eventRow);
  }

  async markEventDelivered(id: string, at: Date) {
    await this.sql`update partner_webhook_events set delivered_at = ${at}, next_attempt_at = null, attempts = attempts + 1 where id = ${id}`;
  }

  async markEventFailed(id: string, error: string, nextAttemptAt: Date | null) {
    await this.sql`update partner_webhook_events set last_error = ${error.slice(0, 300)}, next_attempt_at = ${nextAttemptAt}, attempts = attempts + 1 where id = ${id}`;
  }

  async getEvent(id: string) {
    return firstEvent(await this.sql.unsafe(`select ${EVENT_COLS} from partner_webhook_events where id = $1`, [id]));
  }
}
