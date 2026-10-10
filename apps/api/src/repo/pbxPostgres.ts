import type { RouteTarget, WeeklySchedule } from "@mimt/shared";
import type postgres from "postgres";
import type {
  BusinessHours,
  BusinessMemberRow,
  BusinessRow,
  BusinessSeats,
  DidRouteRow,
  ExtensionRow,
  IvrMenuRow,
  PbxRepository,
  RecordingRow,
  RingGroupRow,
  UserMinutes,
} from "./pbxTypes.js";
import type { Call } from "./types.js";

type Sql = postgres.Sql<{}>;
type Row = Record<string, any>;
const json = (sql: Sql, v: unknown) => sql.json(v as postgres.JSONValue);
const defined = (o: object): Row => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function first(rows: readonly unknown[]): Row {
  const row = rows[0];
  if (!row) throw new Error("expected a row");
  return row as Row;
}

const toBusiness = (r: Row): BusinessRow => ({
  id: r.id,
  name: r.name,
  takatakBusinessId: r.takatakBusinessId,
  telecomAccountId: r.telecomAccountId,
  mainNumber: r.mainNumber,
  locale: r.locale,
  recordingPolicy: {
    mode: r.recordingMode,
    consentPrompt: { fr: r.recordingConsentFr, en: r.recordingConsentEn },
    retentionDays: r.recordingRetentionDays,
  },
  createdAt: r.createdAt,
});

const toMember = (r: Row): BusinessMemberRow => ({
  id: r.id,
  businessId: r.businessId,
  userId: r.userId,
  email: r.email,
  role: r.role,
  status: r.status,
  invitedBy: r.invitedBy,
  claimedAt: r.claimedAt,
  createdAt: r.createdAt,
});

const toExtension = (r: Row): ExtensionRow => ({
  id: r.id,
  businessId: r.businessId,
  number: r.number,
  userId: r.userId,
  displayName: r.displayName,
  voicemail: {
    enabled: r.voicemailEnabled,
    greeting: r.voicemailGreetingFr && r.voicemailGreetingEn ? { fr: r.voicemailGreetingFr, en: r.voicemailGreetingEn } : null,
  },
  forwardToMobile: r.forwardToMobile,
  did: r.did,
  ringTimeoutS: r.ringTimeoutS,
  createdAt: r.createdAt,
});

function extensionColumns(e: Partial<Omit<ExtensionRow, "id" | "createdAt">>): Row {
  return defined({
    businessId: e.businessId,
    number: e.number,
    userId: e.userId,
    displayName: e.displayName,
    voicemailEnabled: e.voicemail?.enabled,
    voicemailGreetingFr: e.voicemail ? (e.voicemail.greeting?.fr ?? null) : undefined,
    voicemailGreetingEn: e.voicemail ? (e.voicemail.greeting?.en ?? null) : undefined,
    forwardToMobile: e.forwardToMobile,
    did: e.did,
    ringTimeoutS: e.ringTimeoutS,
  });
}

const toRingGroup = (r: Row): RingGroupRow => ({
  id: r.id,
  businessId: r.businessId,
  name: r.name,
  number: r.number,
  strategy: r.strategy,
  memberExtensionIds: (r.memberExtensionIds as string[] | null) ?? [],
  timeoutS: r.timeoutS,
  overflow: (r.overflow as RouteTarget | null) ?? null,
  createdAt: r.createdAt,
});

const toIvr = (r: Row): IvrMenuRow => ({
  id: r.id,
  businessId: r.businessId,
  name: r.name,
  greeting: { fr: r.greetingFr, en: r.greetingEn },
  greetingRecordingUrl: r.greetingRecordingUrl,
  options: ((r.options as Array<{ digit: string; target: RouteTarget }> | null) ?? []).sort((a, b) => a.digit.localeCompare(b.digit)),
  timeoutS: r.timeoutS,
  maxRetries: r.maxRetries,
  timeoutTarget: (r.timeoutTarget as RouteTarget | null) ?? null,
  invalidTarget: (r.invalidTarget as RouteTarget | null) ?? null,
  createdAt: r.createdAt,
});

const toDid = (r: Row): DidRouteRow => ({
  id: r.id,
  businessId: r.businessId,
  phoneNumberId: r.phoneNumberId,
  e164: r.e164,
  target: r.target as RouteTarget,
  createdAt: r.createdAt,
});

const toRecording = (r: Row): RecordingRow => ({
  id: r.id,
  businessId: r.businessId,
  callSid: r.callSid,
  recordingSid: r.recordingSid,
  recordingUrl: r.recordingUrl,
  extensionId: r.extensionId,
  userId: r.userId,
  source: r.source,
  fromNumber: r.fromNumber,
  toNumber: r.toNumber,
  durationS: r.durationS,
  retentionDays: r.retentionDays,
  deleteAfter: r.deleteAfter,
  createdAt: r.createdAt,
});

/** Postgres PBX store (tables from supabase/migrations/0003_business_pbx.sql). */
export class PostgresPbxRepository implements PbxRepository {
  constructor(private readonly sql: Sql) {}

  // businesses
  async createBusiness(b: Parameters<PbxRepository["createBusiness"]>[0]) {
    const p = b.recordingPolicy;
    const row = defined({
      name: b.name,
      takatakBusinessId: b.takatakBusinessId,
      telecomAccountId: b.telecomAccountId,
      mainNumber: b.mainNumber,
      locale: b.locale,
      ...(p
        ? { recordingMode: p.mode, recordingConsentFr: p.consentPrompt.fr, recordingConsentEn: p.consentPrompt.en, recordingRetentionDays: p.retentionDays }
        : {}),
    });
    return toBusiness(first(await this.sql`insert into businesses ${this.sql(row)} returning *`));
  }
  async getBusiness(id: string) {
    const r = (await this.sql`select * from businesses where id = ${id}`)[0];
    return r ? toBusiness(r) : null;
  }
  async getBusinessByAccount(telecomAccountId: string) {
    const r = (await this.sql`select * from businesses where telecom_account_id = ${telecomAccountId}`)[0];
    return r ? toBusiness(r) : null;
  }
  async updateBusiness(id: string, patch: Parameters<PbxRepository["updateBusiness"]>[1]) {
    const p = patch.recordingPolicy;
    const row = defined({
      name: patch.name,
      mainNumber: patch.mainNumber,
      locale: patch.locale,
      ...(p
        ? { recordingMode: p.mode, recordingConsentFr: p.consentPrompt.fr, recordingConsentEn: p.consentPrompt.en, recordingRetentionDays: p.retentionDays }
        : {}),
    });
    if (!Object.keys(row).length) {
      const cur = await this.getBusiness(id);
      if (!cur) throw new Error(`business ${id} not found`);
      return cur;
    }
    return toBusiness(first(await this.sql`update businesses set ${this.sql(row)} where id = ${id} returning *`));
  }
  async listBusinessesForUser(userId: string) {
    const members = (await this.sql`select * from business_members where user_id = ${userId} and status = 'active'`).map(toMember);
    if (!members.length) return [];
    const ids = members.map((m) => m.businessId);
    const businesses = (await this.sql`select * from businesses where id = any(${ids}::uuid[]) order by created_at`).map(toBusiness);
    return businesses.map((business) => ({ business, member: members.find((m) => m.businessId === business.id)! }));
  }

  // members
  async addMember(m: Parameters<PbxRepository["addMember"]>[0]) {
    return toMember(first(await this.sql`insert into business_members ${this.sql(defined(m))} returning *`));
  }
  async getMember(id: string) {
    const r = (await this.sql`select * from business_members where id = ${id}`)[0];
    return r ? toMember(r) : null;
  }
  async getMembership(businessId: string, userId: string) {
    const r = (await this.sql`select * from business_members where business_id = ${businessId} and user_id = ${userId} and status = 'active'`)[0];
    return r ? toMember(r) : null;
  }
  async findMemberByEmail(businessId: string, email: string) {
    const r = (await this.sql`select * from business_members where business_id = ${businessId} and lower(email) = lower(${email})`)[0];
    return r ? toMember(r) : null;
  }
  async listMembers(businessId: string) {
    return (await this.sql`select * from business_members where business_id = ${businessId} order by created_at`).map(toMember);
  }
  async updateMember(id: string, patch: Partial<Pick<BusinessMemberRow, "role">>) {
    return toMember(first(await this.sql`update business_members set ${this.sql(defined(patch))} where id = ${id} returning *`));
  }
  async deleteMember(id: string) {
    return (await this.sql`delete from business_members where id = ${id} returning id`).length > 0;
  }
  async claimInvites(userId: string, email: string, at: Date) {
    const rows = await this.sql`
      update business_members m set user_id = ${userId}, status = 'active', claimed_at = ${at}
      where m.status = 'invited' and lower(m.email) = lower(${email})
        and not exists (select 1 from business_members x where x.business_id = m.business_id and x.user_id = ${userId})
      returning *`;
    return rows.map(toMember);
  }

  // extensions
  async createExtension(e: Parameters<PbxRepository["createExtension"]>[0]) {
    return toExtension(first(await this.sql`insert into extensions ${this.sql(extensionColumns(e))} returning *`));
  }
  async getExtension(id: string) {
    const r = (await this.sql`select * from extensions where id = ${id}`)[0];
    return r ? toExtension(r) : null;
  }
  async findExtensionByNumber(businessId: string, number: string) {
    const r = (await this.sql`select * from extensions where business_id = ${businessId} and number = ${number}`)[0];
    return r ? toExtension(r) : null;
  }
  async listExtensions(businessId: string) {
    return (await this.sql`select * from extensions where business_id = ${businessId} order by number`).map(toExtension);
  }
  async listExtensionsByUser(userId: string) {
    return (await this.sql`select * from extensions where user_id = ${userId} order by created_at`).map(toExtension);
  }
  async updateExtension(id: string, patch: Parameters<PbxRepository["updateExtension"]>[1]) {
    const row = extensionColumns(patch);
    if (!Object.keys(row).length) {
      const cur = await this.getExtension(id);
      if (!cur) throw new Error(`extension ${id} not found`);
      return cur;
    }
    return toExtension(first(await this.sql`update extensions set ${this.sql(row)} where id = ${id} returning *`));
  }
  async deleteExtension(id: string) {
    return (await this.sql`delete from extensions where id = ${id} returning id`).length > 0;
  }

  // ring groups
  private async ringGroupById(id: string) {
    const r = (
      await this.sql`select g.*, coalesce((select array_agg(m.extension_id::text order by m.position) from ring_group_members m
          where m.ring_group_id = g.id), '{}') as member_extension_ids
        from ring_groups g where g.id = ${id}`
    )[0];
    return r ? toRingGroup(r) : null;
  }
  async createRingGroup(g: Parameters<PbxRepository["createRingGroup"]>[0]) {
    return (await this.ringGroupById(await this.insertRingGroup(g)))!;
  }
  private async insertRingGroup(g: Parameters<PbxRepository["createRingGroup"]>[0]): Promise<string> {
    return this.sql.begin(async (tx) => {
      const row = first(
        await tx`insert into ring_groups (business_id, name, number, strategy, timeout_s, overflow)
          values (${g.businessId}, ${g.name}, ${g.number}, ${g.strategy}, ${g.timeoutS}, ${g.overflow ? tx.json(g.overflow as postgres.JSONValue) : null})
          returning id`,
      );
      await this.replaceMembers(tx, row.id as string, g.memberExtensionIds);
      return row.id as string;
    }) as Promise<string>;
  }
  private async replaceMembers(tx: postgres.TransactionSql<{}>, ringGroupId: string, ids: string[]) {
    await tx`delete from ring_group_members where ring_group_id = ${ringGroupId}`;
    if (ids.length) {
      await tx`insert into ring_group_members ${tx(ids.map((extensionId, position) => ({ ringGroupId, extensionId, position })))}`;
    }
  }
  async getRingGroup(id: string) {
    return this.ringGroupById(id);
  }
  async listRingGroups(businessId: string) {
    const rows = await this.sql`select g.*, coalesce((select array_agg(m.extension_id::text order by m.position) from ring_group_members m
        where m.ring_group_id = g.id), '{}') as member_extension_ids
      from ring_groups g where g.business_id = ${businessId} order by g.created_at`;
    return rows.map(toRingGroup);
  }
  async updateRingGroup(id: string, patch: Parameters<PbxRepository["updateRingGroup"]>[1]) {
    await this.sql.begin(async (tx) => {
      const cols = defined({ name: patch.name, number: patch.number, strategy: patch.strategy, timeoutS: patch.timeoutS });
      if (Object.keys(cols).length) await tx`update ring_groups set ${tx(cols)} where id = ${id}`;
      if (patch.overflow !== undefined) {
        await tx`update ring_groups set overflow = ${patch.overflow ? tx.json(patch.overflow as postgres.JSONValue) : null} where id = ${id}`;
      }
      if (patch.memberExtensionIds) await this.replaceMembers(tx, id, patch.memberExtensionIds);
    });
    const g = await this.ringGroupById(id);
    if (!g) throw new Error(`ring group ${id} not found`);
    return g;
  }
  async deleteRingGroup(id: string) {
    return (await this.sql`delete from ring_groups where id = ${id} returning id`).length > 0;
  }

  // IVR
  private async ivrById(id: string) {
    const r = (
      await this.sql`select v.*, coalesce((select json_agg(json_build_object('digit', o.digit, 'target', o.target)) from ivr_options o
          where o.ivr_menu_id = v.id), '[]'::json) as options
        from ivr_menus v where v.id = ${id}`
    )[0];
    return r ? toIvr(r) : null;
  }
  private async replaceOptions(tx: postgres.TransactionSql<{}>, menuId: string, options: IvrMenuRow["options"]) {
    await tx`delete from ivr_options where ivr_menu_id = ${menuId}`;
    for (const o of options) {
      await tx`insert into ivr_options (ivr_menu_id, digit, target) values (${menuId}, ${o.digit}, ${tx.json(o.target as postgres.JSONValue)})`;
    }
  }
  async createIvrMenu(m: Parameters<PbxRepository["createIvrMenu"]>[0]) {
    const id = (await this.sql.begin(async (tx) => {
      const row = first(
        await tx`insert into ivr_menus (business_id, name, greeting_fr, greeting_en, greeting_recording_url, timeout_s, max_retries, timeout_target, invalid_target)
          values (${m.businessId}, ${m.name}, ${m.greeting.fr}, ${m.greeting.en}, ${m.greetingRecordingUrl}, ${m.timeoutS}, ${m.maxRetries},
                  ${m.timeoutTarget ? tx.json(m.timeoutTarget as postgres.JSONValue) : null},
                  ${m.invalidTarget ? tx.json(m.invalidTarget as postgres.JSONValue) : null})
          returning id`,
      );
      await this.replaceOptions(tx, row.id as string, m.options);
      return row.id as string;
    })) as string;
    return (await this.ivrById(id))!;
  }
  async getIvrMenu(id: string) {
    return this.ivrById(id);
  }
  async listIvrMenus(businessId: string) {
    const ids = await this.sql`select id from ivr_menus where business_id = ${businessId} order by created_at`;
    const out: IvrMenuRow[] = [];
    for (const r of ids) {
      const m = await this.ivrById(r.id as string);
      if (m) out.push(m);
    }
    return out;
  }
  async updateIvrMenu(id: string, patch: Parameters<PbxRepository["updateIvrMenu"]>[1]) {
    await this.sql.begin(async (tx) => {
      const cols = defined({
        name: patch.name,
        greetingFr: patch.greeting?.fr,
        greetingEn: patch.greeting?.en,
        greetingRecordingUrl: patch.greetingRecordingUrl,
        timeoutS: patch.timeoutS,
        maxRetries: patch.maxRetries,
      });
      if (Object.keys(cols).length) await tx`update ivr_menus set ${tx(cols)} where id = ${id}`;
      if (patch.timeoutTarget !== undefined) {
        await tx`update ivr_menus set timeout_target = ${patch.timeoutTarget ? tx.json(patch.timeoutTarget as postgres.JSONValue) : null} where id = ${id}`;
      }
      if (patch.invalidTarget !== undefined) {
        await tx`update ivr_menus set invalid_target = ${patch.invalidTarget ? tx.json(patch.invalidTarget as postgres.JSONValue) : null} where id = ${id}`;
      }
      if (patch.options) await this.replaceOptions(tx, id, patch.options);
    });
    const m = await this.ivrById(id);
    if (!m) throw new Error(`ivr menu ${id} not found`);
    return m;
  }
  async deleteIvrMenu(id: string) {
    return (await this.sql`delete from ivr_menus where id = ${id} returning id`).length > 0;
  }

  // hours
  async getHours(businessId: string) {
    const r = (await this.sql`select * from business_hours where business_id = ${businessId}`)[0];
    if (!r) return null;
    const holidays = await this.sql`select to_char(date, 'YYYY-MM-DD') as date, name from holidays where business_id = ${businessId} order by date`;
    const h: BusinessHours = {
      businessId,
      timezone: "America/Montreal",
      weekly: r.weekly as WeeklySchedule,
      holidays: holidays.map((x) => ({ date: x.date as string, name: x.name as string })),
      quebecHolidays: r.quebecHolidays,
      openTarget: r.openTarget as RouteTarget,
      closedTarget: r.closedTarget as RouteTarget,
    };
    return h;
  }
  async putHours(h: BusinessHours) {
    await this.sql.begin(async (tx) => {
      await tx`insert into business_hours (business_id, timezone, weekly, quebec_holidays, open_target, closed_target)
        values (${h.businessId}, ${h.timezone}, ${tx.json(h.weekly as unknown as postgres.JSONValue)}, ${h.quebecHolidays},
                ${tx.json(h.openTarget as postgres.JSONValue)}, ${tx.json(h.closedTarget as postgres.JSONValue)})
        on conflict (business_id) do update set weekly = excluded.weekly, quebec_holidays = excluded.quebec_holidays,
          open_target = excluded.open_target, closed_target = excluded.closed_target`;
      await tx`delete from holidays where business_id = ${h.businessId}`;
      const unique = [...new Map(h.holidays.map((x) => [x.date, x])).values()];
      if (unique.length) {
        await tx`insert into holidays ${tx(unique.map((x) => ({ businessId: h.businessId, date: x.date, name: x.name })))}`;
      }
    });
    return (await this.getHours(h.businessId))!;
  }

  // DID routes
  async upsertDidRoute(r: Parameters<PbxRepository["upsertDidRoute"]>[0]) {
    return toDid(
      first(
        await this.sql`insert into did_routes (business_id, phone_number_id, e164, target)
          values (${r.businessId}, ${r.phoneNumberId}, ${r.e164}, ${json(this.sql, r.target)})
          on conflict (phone_number_id) do update set business_id = excluded.business_id, e164 = excluded.e164, target = excluded.target
          returning *`,
      ),
    );
  }
  async getDidRoute(id: string) {
    const r = (await this.sql`select * from did_routes where id = ${id}`)[0];
    return r ? toDid(r) : null;
  }
  async getDidRouteByE164(e164: string) {
    const r = (await this.sql`select * from did_routes where e164 = ${e164}`)[0];
    return r ? toDid(r) : null;
  }
  async listDidRoutes(businessId: string) {
    return (await this.sql`select * from did_routes where business_id = ${businessId} order by created_at`).map(toDid);
  }
  async deleteDidRoute(id: string) {
    return (await this.sql`delete from did_routes where id = ${id} returning id`).length > 0;
  }

  // recordings
  async createRecording(r: Parameters<PbxRepository["createRecording"]>[0]) {
    const inserted = await this.sql`insert into recordings ${this.sql(defined(r))} on conflict (recording_sid) do nothing returning *`;
    const row = inserted[0] ?? first(await this.sql`select * from recordings where recording_sid = ${r.recordingSid}`);
    return toRecording(row);
  }
  async getRecording(id: string) {
    const r = (await this.sql`select * from recordings where id = ${id}`)[0];
    return r ? toRecording(r) : null;
  }
  async listRecordings(businessId: string, opts: { userId?: string; limit?: number } = {}) {
    const limit = opts.limit ?? 200;
    const rows = opts.userId
      ? await this.sql`select * from recordings where business_id = ${businessId} and user_id = ${opts.userId} order by created_at desc limit ${limit}`
      : await this.sql`select * from recordings where business_id = ${businessId} order by created_at desc limit ${limit}`;
    return rows.map(toRecording);
  }
  async listExpiredRecordings(now: Date, limit: number) {
    return (await this.sql`select * from recordings where delete_after <= ${now} order by delete_after limit ${limit}`).map(toRecording);
  }
  async deleteRecording(id: string) {
    return (await this.sql`delete from recordings where id = ${id} returning id`).length > 0;
  }

  // seats
  async getSeats(businessId: string): Promise<BusinessSeats> {
    const r = (await this.sql`select business_id, seats, stripe_subscription_id from business_seats where business_id = ${businessId}`)[0];
    return r ? { businessId, seats: r.seats as number, stripeSubscriptionId: r.stripeSubscriptionId as string | null } : { businessId, seats: 1, stripeSubscriptionId: null };
  }
  async setSeats(businessId: string, seats: number, stripeSubscriptionId?: string | null) {
    const r =
      stripeSubscriptionId === undefined
        ? first(
            await this.sql`insert into business_seats (business_id, seats) values (${businessId}, ${seats})
              on conflict (business_id) do update set seats = excluded.seats returning *`,
          )
        : first(
            await this.sql`insert into business_seats (business_id, seats, stripe_subscription_id) values (${businessId}, ${seats}, ${stripeSubscriptionId})
              on conflict (business_id) do update set seats = excluded.seats, stripe_subscription_id = excluded.stripe_subscription_id returning *`,
          );
    return { businessId, seats: r.seats as number, stripeSubscriptionId: r.stripeSubscriptionId as string | null };
  }

  // business CDR
  async listBusinessCalls(telecomAccountId: string, opts: { userId?: string; limit: number; before?: { startedAt: Date; id: string } }) {
    const { before, userId } = opts;
    const byUser = userId ? this.sql`and user_id = ${userId}` : this.sql``;
    const rows = before
      ? await this.sql`select * from calls where telecom_account_id = ${telecomAccountId} ${byUser}
          and (date_trunc('milliseconds', started_at), id) < (${before.startedAt}, ${before.id}::uuid)
          order by date_trunc('milliseconds', started_at) desc, id desc limit ${opts.limit}`
      : await this.sql`select * from calls where telecom_account_id = ${telecomAccountId} ${byUser}
          order by date_trunc('milliseconds', started_at) desc, id desc limit ${opts.limit}`;
    return rows as unknown as Call[];
  }
  async countActiveCallsByUser(telecomAccountId: string, userId: string, since: Date) {
    const r = first(
      await this.sql`select count(*)::int as n from calls
        where telecom_account_id = ${telecomAccountId} and user_id = ${userId} and kind <> 'emergency' and started_at >= ${since}
          and status in ('queued', 'initiated', 'ringing', 'in-progress')`,
    );
    return r.n as number;
  }
  async minutesByUser(telecomAccountId: string, since: Date): Promise<UserMinutes[]> {
    const rows = await this.sql`
      select user_id::text as user_id,
        coalesce(sum(ceil(coalesce(duration_s, 0) / 60.0)) filter (where direction = 'outbound'), 0)::int as outbound_minutes,
        coalesce(sum(ceil(coalesce(duration_s, 0) / 60.0)) filter (where direction = 'inbound'), 0)::int as inbound_minutes
      from calls
      where telecom_account_id = ${telecomAccountId} and user_id is not null and kind = 'pstn' and status = 'completed' and started_at >= ${since}
      group by user_id order by user_id`;
    return rows.map((r) => ({ userId: r.userId as string, outboundMinutes: r.outboundMinutes as number, inboundMinutes: r.inboundMinutes as number }));
  }
}
