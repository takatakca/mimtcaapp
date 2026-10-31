import type postgres from "postgres";
import type {
  NewPartnerCall,
  PartnerApiKeyRow,
  PartnerAvailabilityPatch,
  PartnerAvailabilityRow,
  PartnerCallPatch,
  PartnerCallRow,
  PartnerCreditInput,
  PartnerCreditResult,
  PartnerHuntGroupRow,
  PartnerLedgerRow,
  PartnerLinkCreateResult,
  PartnerLinkRequestRow,
  PartnerMemberLinkRow,
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
  "id, business_id, name, slug, status, credit_per_minute, credit_balance, webhook_url, webhook_secret_encrypted, credits_exhausted_at, created_by, created_at, updated_at";
const KEY_COLS = "id, partner_id, prefix, key_sha256, label, created_by, created_at, last_used_at, revoked_at";
const MEMBER_COLS = "id, partner_id, external_id, name, email, phone, handle, language, active, extension_id, created_at, updated_at";
const HUNT_COLS = "id, partner_id, key, ring_group_id, created_at, updated_at";
const LEDGER_COLS = "id, partner_id, delta, reason, reference, idempotency_key, balance_after, meta, created_by, created_at";
const CALL_COLS =
  "id, partner_id, call_sid, direction, from_number, to_number, hunt_group_key, member_id, external_id, answered_leg_sid, started_at, answered_at, ended_at, talk_s, credits_charged, billing, recording_id, reference, finalized_at, created_at";
const LINK_REQUEST_COLS = "id, partner_id, member_id, code_sha256, expires_at, attempts, used_at, invalidated_at, created_at";
const LINK_COLS = "id, partner_id, member_id, user_id, number_id, request_id, created_at, updated_at, revoked_at, revoked_by";
// Weekly windows are read back as text too (same camelCase transform concern, and it keeps the exact shape).
const AVAILABILITY_COLS = "member_id, partner_id, status, weekly::text as weekly_text, until, user_status, created_at, updated_at";
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

type AvailabilityRowText = Omit<PartnerAvailabilityRow, "weekly"> & { weeklyText: string | null };
const availabilityRow = ({ weeklyText, ...r }: AvailabilityRowText): PartnerAvailabilityRow => ({
  ...r,
  weekly: weeklyText ? (JSON.parse(weeklyText) as PartnerAvailabilityRow["weekly"]) : null,
});

/** Partner columns a patch may set (camelCase field → column). */
const PARTNER_PATCH: Record<keyof PartnerPatch, string> = {
  name: "name",
  slug: "slug",
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

  async createPartner(p: { businessId: string; name: string; slug?: string | null; creditPerMinute: number | null; createdBy: string | null }) {
    return first<PartnerRow>(
      await this.sql.unsafe(`insert into partners (business_id, name, slug, credit_per_minute, created_by) values ($1, $2, $3, $4, $5) returning ${PARTNER_COLS}`, [
        p.businessId,
        p.name,
        p.slug ?? null,
        p.creditPerMinute,
        p.createdBy,
      ]),
    )!;
  }

  async getPartnerBySlug(slug: string) {
    return first<PartnerRow>(await this.sql.unsafe(`select ${PARTNER_COLS} from partners where slug = $1`, [slug]));
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
      `insert into partner_calls (partner_id, call_sid, direction, from_number, to_number, hunt_group_key, started_at, member_id, external_id, reference)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (call_sid) do nothing`,
      [c.partnerId, c.callSid, c.direction, c.fromNumber, c.toNumber, c.huntGroupKey, c.startedAt, c.memberId ?? null, c.externalId ?? null, c.reference ?? null],
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

  async countOpenOutboundCalls(memberId: string, since: Date) {
    const [row] = await this.sql`
      select count(*)::int as n from partner_calls
      where member_id = ${memberId} and direction = 'outbound' and finalized_at is null and started_at > ${since}`;
    return (row as { n: number }).n;
  }

  async createLinkRequest(r: { partnerId: string; memberId: string; codeSha256: string; expiresAt: Date; at: Date }) {
    return (await this.sql.begin(async (tx) => {
      await tx`update partner_link_requests set invalidated_at = ${r.at} where member_id = ${r.memberId} and used_at is null and invalidated_at is null`;
      return first<PartnerLinkRequestRow>(
        await tx.unsafe(
          `insert into partner_link_requests (partner_id, member_id, code_sha256, expires_at, created_at) values ($1, $2, $3, $4, $5) returning ${LINK_REQUEST_COLS}`,
          [r.partnerId, r.memberId, r.codeSha256, r.expiresAt, r.at],
        ),
      )!;
    })) as PartnerLinkRequestRow;
  }

  async getLinkRequest(id: string) {
    return first<PartnerLinkRequestRow>(await this.sql.unsafe(`select ${LINK_REQUEST_COLS} from partner_link_requests where id = $1`, [id]));
  }

  async findLinkRequestByHash(codeSha256: string) {
    return first<PartnerLinkRequestRow>(await this.sql.unsafe(`select ${LINK_REQUEST_COLS} from partner_link_requests where code_sha256 = $1`, [codeSha256]));
  }

  async recordLinkRequestFailure(id: string, maxAttempts: number, at: Date) {
    return first<PartnerLinkRequestRow>(
      await this.sql.unsafe(
        `update partner_link_requests set attempts = attempts + 1,
           invalidated_at = case when invalidated_at is null and attempts + 1 >= $2 then $3::timestamptz else invalidated_at end
         where id = $1 returning ${LINK_REQUEST_COLS}`,
        [id, maxAttempts, at],
      ),
    );
  }

  async consumeLinkRequest(id: string, at: Date) {
    return (
      await this.sql`update partner_link_requests set used_at = ${at}
        where id = ${id} and used_at is null and invalidated_at is null and expires_at > ${at} returning id`
    ).length === 1;
  }

  async createLink(l: { partnerId: string; memberId: string; userId: string; requestId: string | null; at: Date }): Promise<PartnerLinkCreateResult> {
    try {
      const link = first<PartnerMemberLinkRow>(
        await this.sql.unsafe(
          `insert into partner_member_links (partner_id, member_id, user_id, request_id, created_at, updated_at) values ($1, $2, $3, $4, $5, $5) returning ${LINK_COLS}`,
          [l.partnerId, l.memberId, l.userId, l.requestId, l.at],
        ),
      )!;
      return { status: "created", link };
    } catch (err) {
      // The partial unique indexes of 0027 are the source of truth (two approvals at once cannot both win).
      const e = err as { code?: string; constraint_name?: string };
      if (e.code === "23505" && e.constraint_name === "partner_member_links_member_active") return { status: "member_taken" };
      if (e.code === "23505" && e.constraint_name === "partner_member_links_user_active") return { status: "user_taken" };
      throw err;
    }
  }

  async getLink(id: string) {
    return first<PartnerMemberLinkRow>(await this.sql.unsafe(`select ${LINK_COLS} from partner_member_links where id = $1`, [id]));
  }

  async getActiveLinkByMember(memberId: string) {
    return first<PartnerMemberLinkRow>(await this.sql.unsafe(`select ${LINK_COLS} from partner_member_links where member_id = $1 and revoked_at is null`, [memberId]));
  }

  async getActiveLinkByUser(partnerId: string, userId: string) {
    return first<PartnerMemberLinkRow>(
      await this.sql.unsafe(`select ${LINK_COLS} from partner_member_links where partner_id = $1 and user_id = $2 and revoked_at is null`, [partnerId, userId]),
    );
  }

  async listActiveLinksByUser(userId: string) {
    return (await this.sql.unsafe(`select ${LINK_COLS} from partner_member_links where user_id = $1 and revoked_at is null order by created_at desc, id`, [
      userId,
    ])) as unknown as PartnerMemberLinkRow[];
  }

  async revokeLink(id: string, by: "user" | "partner" | "system", at: Date) {
    return first<PartnerMemberLinkRow>(
      await this.sql.unsafe(`update partner_member_links set revoked_at = $2, revoked_by = $3 where id = $1 and revoked_at is null returning ${LINK_COLS}`, [id, at, by]),
    );
  }

  async setLinkNumber(id: string, numberId: string | null) {
    return first<PartnerMemberLinkRow>(
      await this.sql.unsafe(`update partner_member_links set number_id = $2 where id = $1 and revoked_at is null returning ${LINK_COLS}`, [id, numberId]),
    );
  }

  async getAvailability(memberId: string) {
    const r = first<AvailabilityRowText>(await this.sql.unsafe(`select ${AVAILABILITY_COLS} from partner_member_availability where member_id = $1`, [memberId]));
    return r ? availabilityRow(r) : null;
  }

  async listAvailability(partnerId: string) {
    const rows = (await this.sql.unsafe(`select ${AVAILABILITY_COLS} from partner_member_availability where partner_id = $1 order by member_id`, [
      partnerId,
    ])) as unknown as AvailabilityRowText[];
    return rows.map(availabilityRow);
  }

  async upsertAvailability(partnerId: string, memberId: string, patch: PartnerAvailabilityPatch) {
    // One statement: insert with the defaults, or update only the fields the patch defines ($n is null-safe with the
    // `has` flags, so « clear to null » and « leave as is » stay distinct).
    const has = (k: keyof PartnerAvailabilityPatch) => patch[k] !== undefined;
    // The jsonb parameter is serialized by the driver: pass the object itself (a string would be stored as a JSON string).
    const weekly = patch.weekly ?? null;
    const r = first<AvailabilityRowText>(
      await this.sql.unsafe(
        `insert into partner_member_availability (member_id, partner_id, status, weekly, until, user_status)
         values ($1, $2, coalesce($3, 'available'), $5::jsonb, $7, $9)
         on conflict (member_id) do update set
           status = case when $4 then excluded.status else partner_member_availability.status end,
           weekly = case when $6 then excluded.weekly else partner_member_availability.weekly end,
           until = case when $8 then excluded.until else partner_member_availability.until end,
           user_status = case when $10 then excluded.user_status else partner_member_availability.user_status end
         returning ${AVAILABILITY_COLS}`,
        [memberId, partnerId, patch.status ?? null, has("status"), weekly, has("weekly"), patch.until ?? null, has("until"), patch.userStatus ?? null, has("userStatus")] as never[],
      ),
    )!;
    return availabilityRow(r);
  }

  async swapLinkSubscriptionState(linkId: string, state: string) {
    const rows = await this.sql`update partner_member_links set subscription_state = ${state}
      where id = ${linkId} and revoked_at is null and subscription_state is distinct from ${state} returning id`;
    return rows.length > 0;
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
