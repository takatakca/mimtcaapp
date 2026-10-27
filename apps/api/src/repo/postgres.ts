import type { NumberState } from "@mimt/shared";
import postgres from "postgres";
import { resolvePostgresTls } from "./postgresTls.js";
import { emptyUsage } from "./types.js";
import { PostgresPbxRepository } from "./pbxPostgres.js";
import { PostgresCatalogRepository } from "./catalogPostgres.js";
import { PostgresCallControlsRepository } from "./callControlsPostgres.js";
import { PostgresMediaRepository } from "./mediaPostgres.js";
import { PostgresReferralRepository } from "./referralsPostgres.js";
import { PostgresNumberHoldRepository } from "./numberHoldsPostgres.js";
import { PostgresHandleRepository } from "./handlesPostgres.js";
import { PostgresWebPushRepository } from "./webPushPostgres.js";
import { PostgresMissionRepository } from "./missionsPostgres.js";
import { PostgresPortInRepository } from "./portInPostgres.js";
import { PostgresMeetingRepository } from "./meetingsPostgres.js";
import type {
  AuditEntry,
  Call,
  Consent,
  Conversation,
  E911Acknowledgement,
  E911Address,
  Entitlement,
  FraudEvent,
  Handoff,
  Message,
  OutboxEvent,
  PhoneNumber,
  PushToken,
  RefreshToken,
  Repository,
  Subscription,
  TelecomAccount,
  Usage,
  UsageDelta,
  PurgeResult,
  User,
  Voicemail,
} from "./types.js";

type Sql = postgres.Sql<{}>;
type Row = Record<string, any>;

/** Drops undefined values so `sql(obj)` only touches the provided columns. */
const defined = (o: object): Row => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function one<T>(rows: readonly unknown[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected a row");
  return row as T;
}
const maybe = <T>(rows: readonly unknown[]): T | null => (rows[0] as T | undefined) ?? null;

export class PostgresRepository implements Repository {
  readonly sql: Sql;
  readonly tlsCaSource: "environment" | "file" | "none";
  readonly suppliedCaInvalid: boolean;
  private pbxRepo?: PostgresPbxRepository;
  get pbx(): PostgresPbxRepository {
    return (this.pbxRepo ??= new PostgresPbxRepository(this.sql));
  }
  private catalogRepo?: PostgresCatalogRepository;
  get catalog(): PostgresCatalogRepository {
    return (this.catalogRepo ??= new PostgresCatalogRepository(this.sql));
  }
  private callControlsRepo?: PostgresCallControlsRepository;
  get callControls(): PostgresCallControlsRepository {
    return (this.callControlsRepo ??= new PostgresCallControlsRepository(this.sql));
  }
  private portInRepo?: PostgresPortInRepository;
  get portIns(): PostgresPortInRepository {
    return (this.portInRepo ??= new PostgresPortInRepository(this.sql));
  }
  private meetingRepo?: PostgresMeetingRepository;
  get meetings(): PostgresMeetingRepository {
    return (this.meetingRepo ??= new PostgresMeetingRepository(this.sql));
  }

  private mediaRepo?: PostgresMediaRepository;
  get media(): PostgresMediaRepository {
    return (this.mediaRepo ??= new PostgresMediaRepository(this.sql));
  }

  private referralRepo?: PostgresReferralRepository;
  get referrals(): PostgresReferralRepository {
    return (this.referralRepo ??= new PostgresReferralRepository(this.sql));
  }

  private numberHoldRepo?: PostgresNumberHoldRepository;
  get numberHolds(): PostgresNumberHoldRepository {
    return (this.numberHoldRepo ??= new PostgresNumberHoldRepository(this.sql));
  }

  private handleRepo?: PostgresHandleRepository;
  get handles(): PostgresHandleRepository {
    return (this.handleRepo ??= new PostgresHandleRepository(this.sql));
  }

  private missionRepo?: PostgresMissionRepository;
  get missions(): PostgresMissionRepository {
    return (this.missionRepo ??= new PostgresMissionRepository(this.sql));
  }

  private webPushRepo?: PostgresWebPushRepository;
  get webPush(): PostgresWebPushRepository {
    return (this.webPushRepo ??= new PostgresWebPushRepository(this.sql));
  }

  constructor(databaseUrl: string, opts: { max?: number; sslCaPem?: string } = {}) {
    const tls = resolvePostgresTls(databaseUrl, opts.sslCaPem);
    this.tlsCaSource = tls.caSource;
    this.suppliedCaInvalid = tls.suppliedCaInvalid;
    this.sql = postgres(tls.url, {
      max: opts.max ?? 10,
      // The trusted PEM comes from Coolify or a mounted local CA file.
      // Keep CA and hostname verification on; never fall back to rejectUnauthorized=false.
      ...(tls.ssl ? { ssl: tls.ssl } : {}),
      transform: postgres.camel,
      types: {
        // numeric → JS number (amounts here are small and stored with 5 decimals).
        numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      },
      onnotice: () => {},
    });
  }

  async appliedMigrations() {
    try {
      return (await this.sql<{ name: string }[]>`select name from mimt_schema_migrations`).map((r) => r.name);
    } catch {
      return [];
    }
  }

  async ping() {
    await this.sql`select 1`;
  }
  async close() {
    await this.sql.end({ timeout: 5 });
  }

  // users
  async createUser(u: Parameters<Repository["createUser"]>[0]) {
    return one<User>(await this.sql`insert into users ${this.sql(defined(u))} returning *`);
  }
  async getUser(id: string) {
    return maybe<User>(await this.sql`select * from users where id = ${id}`);
  }
  async findUserByGlobalId(globalUserId: string) {
    return maybe<User>(await this.sql`select * from users where global_user_id = ${globalUserId}`);
  }
  async findUserByPhone(e164: string) {
    return maybe<User>(await this.sql`select * from users where phone_e164 = ${e164}`);
  }
  async updateUser(id: string, patch: Partial<User>) {
    return one<User>(await this.sql`update users set ${this.sql(defined(patch))} where id = ${id} returning *`);
  }
  async listUsersDueForDeletion(now: Date, limit: number) {
    return (await this.sql`select * from users where status = 'pending_deletion' and deletion_scheduled_at <= ${now}
      order by deletion_scheduled_at limit ${limit}`) as unknown as User[];
  }
  async purgeUserData(userId: string, accountId: string | null): Promise<PurgeResult> {
    return this.sql.begin(async (tx) => {
      const result: PurgeResult = { mediaPaths: [], twilioMediaUrls: [], recordingSids: [] };
      if (accountId) {
        await tx`delete from voicemail_settings where telecom_account_id = ${accountId}`;
        const media = (await tx`delete from media_objects where telecom_account_id = ${accountId} returning path, twilio_url`) as unknown as Array<{
          path: string | null;
          twilioUrl: string | null;
        }>;
        for (const m of media) {
          if (m.path) result.mediaPaths.push(m.path);
          if (m.twilioUrl) result.twilioMediaUrls.push(m.twilioUrl);
        }
        const voicemails = (await tx`delete from voicemails where telecom_account_id = ${accountId} returning recording_sid, audio_path`) as unknown as Array<{
          recordingSid: string;
          audioPath: string | null;
        }>;
        for (const v of voicemails) {
          result.recordingSids.push(v.recordingSid);
          if (v.audioPath) result.mediaPaths.push(v.audioPath);
        }
        await tx`delete from messages where telecom_account_id = ${accountId}`;
        await tx`delete from e911_addresses where telecom_account_id = ${accountId}`;
        await tx`delete from blocked_numbers where telecom_account_id = ${accountId}`;
        await tx`delete from call_settings where telecom_account_id = ${accountId}`;
        await tx`delete from spam_scores where telecom_account_id = ${accountId}`;
        await tx`delete from ai_usage where telecom_account_id = ${accountId}`;
        await tx`delete from ai_receptionist_messages where telecom_account_id = ${accountId}`;
        await tx`delete from ai_receptionist_configs where telecom_account_id = ${accountId}`;
        await tx`delete from port_in_requests where telecom_account_id = ${accountId}`;
        await tx`delete from number_holds where telecom_account_id = ${accountId}`;
        await tx`delete from payment_fingerprints where telecom_account_id = ${accountId}`;
        await tx`delete from entitlements where telecom_account_id = ${accountId}`;
      }
      await tx`delete from refresh_tokens where user_id = ${userId}`;
      await tx`delete from push_tokens where user_id = ${userId}`;
      await tx`delete from web_push_subscriptions where user_id = ${userId}`;
      await tx`delete from attested_devices where user_id = ${userId}`;
      await tx`delete from user_handles where user_id = ${userId}`;
      await tx`delete from consents where user_id = ${userId}`;
      await tx`delete from email_outbox where user_id = ${userId}`;
      await tx`delete from ad_rewards where user_id = ${userId}`;
      await tx`delete from referrals where referrer_user_id = ${userId} or referee_user_id = ${userId}`;
      await tx`delete from referral_codes where user_id = ${userId}`;
      await tx`delete from meeting_invites where user_id = ${userId}`;
      await tx`delete from meetings where host_user_id = ${userId}`;
      await tx`update users set global_user_id = null, auth_user_id = null, display_name = null, email = null, phone_e164 = null,
        phone_verified_at = null, device_verified_at = null, status = 'deleted', updated_at = now() where id = ${userId}`;
      return result;
    }) as Promise<PurgeResult>;
  }

  // refresh tokens
  async createRefreshToken(t: Parameters<Repository["createRefreshToken"]>[0]) {
    return one<RefreshToken>(await this.sql`insert into refresh_tokens ${this.sql(defined(t))} returning *`);
  }
  async findRefreshToken(tokenHash: string) {
    return maybe<RefreshToken>(await this.sql`select * from refresh_tokens where token_hash = ${tokenHash}`);
  }
  async revokeRefreshToken(id: string) {
    const rows = await this.sql`update refresh_tokens set revoked_at = now() where id = ${id} and revoked_at is null returning id`;
    return rows.length === 1;
  }
  async revokeRefreshFamily(familyId: string) {
    await this.sql`update refresh_tokens set revoked_at = now() where family_id = ${familyId} and revoked_at is null`;
  }
  async revokeUserRefreshTokens(userId: string) {
    await this.sql`update refresh_tokens set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
  }

  // accounts
  async createAccount(a: Parameters<Repository["createAccount"]>[0]) {
    return one<TelecomAccount>(await this.sql`insert into telecom_accounts ${this.sql(defined(a))} returning *`);
  }
  async getAccount(id: string) {
    return maybe<TelecomAccount>(await this.sql`select * from telecom_accounts where id = ${id}`);
  }
  async getAccountByOwner(userId: string) {
    return maybe<TelecomAccount>(
      await this.sql`select * from telecom_accounts where owner_user_id = ${userId} order by (kind = 'consumer') desc, created_at limit 1`,
    );
  }
  async findAccountByStripeCustomer(customerId: string) {
    return maybe<TelecomAccount>(await this.sql`select * from telecom_accounts where stripe_customer_id = ${customerId}`);
  }
  async updateAccount(id: string, patch: Partial<TelecomAccount>) {
    return one<TelecomAccount>(await this.sql`update telecom_accounts set ${this.sql(defined(patch))} where id = ${id} returning *`);
  }
  async addIntlCredit(id: string, cents: number) {
    const row = one<{ intlCreditCents: number }>(
      await this.sql`update telecom_accounts set intl_credit_cents = intl_credit_cents + ${cents} where id = ${id} returning intl_credit_cents`,
    );
    return row.intlCreditCents;
  }

  // subscriptions & entitlements
  async listSubscriptions(accountId: string) {
    return (await this.sql`select * from subscriptions where telecom_account_id = ${accountId} order by created_at`) as unknown as Subscription[];
  }
  async upsertSubscription(s: Parameters<Repository["upsertSubscription"]>[0]) {
    const row = defined(s);
    if (s.stripeSubscriptionId) {
      return one<Subscription>(
        await this.sql`insert into subscriptions ${this.sql(row)}
          on conflict (stripe_subscription_id) do update set ${this.sql(row, "status", "code", "kind", "quantity", "currentPeriodEnd")}
          returning *`,
      );
    }
    return one<Subscription>(await this.sql`insert into subscriptions ${this.sql(row)} returning *`);
  }
  async findSubscriptionByExternalId(externalId: string) {
    const [row] = (await this.sql`select * from subscriptions where stripe_subscription_id = ${externalId} limit 1`) as unknown as Subscription[];
    return row ?? null;
  }
  async listEntitlements(accountId: string) {
    return (await this.sql`select * from entitlements where telecom_account_id = ${accountId}`) as unknown as Entitlement[];
  }
  async replaceEntitlements(accountId: string, source: string, items: Array<Pick<Entitlement, "feature" | "limit">>) {
    await this.sql.begin(async (tx) => {
      await tx`delete from entitlements where telecom_account_id = ${accountId} and source = ${source}`;
      if (items.length) {
        const rows = items.map((i) => ({ telecomAccountId: accountId, source, feature: i.feature, limit: i.limit }));
        await tx`insert into entitlements ${tx(rows)}`;
      }
    });
  }

  // numbers
  async createNumber(n: Parameters<Repository["createNumber"]>[0]) {
    return one<PhoneNumber>(await this.sql`insert into phone_numbers ${this.sql(defined(n))} returning *`);
  }
  async getNumber(id: string) {
    return maybe<PhoneNumber>(await this.sql`select * from phone_numbers where id = ${id}`);
  }
  async getNumberByE164(e164: string) {
    return maybe<PhoneNumber>(await this.sql`select * from phone_numbers where e164 = ${e164}`);
  }
  async listNumbersByAccount(accountId: string) {
    return (await this.sql`select * from phone_numbers where telecom_account_id = ${accountId} order by created_at`) as unknown as PhoneNumber[];
  }
  async listNumbersInStates(states: NumberState[]) {
    return (await this.sql`select * from phone_numbers where state = any(${states})`) as unknown as PhoneNumber[];
  }
  async updateNumber(id: string, patch: Partial<PhoneNumber>) {
    return one<PhoneNumber>(await this.sql`update phone_numbers set ${this.sql(defined(patch))} where id = ${id} returning *`);
  }
  async purgeNumberContent(numberId: string, e164: string) {
    await this.sql.begin(async (tx) => {
      await tx`delete from messages where our_number = ${e164}`;
      await tx`delete from voicemails where phone_number_id = ${numberId}`;
    });
  }

  // e911
  async upsertE911Address(a: Parameters<Repository["upsertE911Address"]>[0]) {
    const row = defined(a);
    const cols = Object.keys(row).filter((k) => k !== "telecomAccountId");
    return one<E911Address>(
      await this.sql`insert into e911_addresses ${this.sql(row)}
        on conflict (telecom_account_id) do update set ${this.sql(row, cols)}
        returning *`,
    );
  }
  async getE911Address(accountId: string) {
    return maybe<E911Address>(await this.sql`select * from e911_addresses where telecom_account_id = ${accountId}`);
  }
  async addE911Ack(a: Omit<E911Acknowledgement, "id">) {
    return one<E911Acknowledgement>(await this.sql`insert into e911_acknowledgements ${this.sql(defined(a))} returning *`);
  }
  async getLatestE911Ack(userId: string) {
    return maybe<E911Acknowledgement>(
      await this.sql`select * from e911_acknowledgements where user_id = ${userId} order by accepted_at desc limit 1`,
    );
  }
  async listE911Acks(userId: string) {
    return (await this.sql`select * from e911_acknowledgements where user_id = ${userId} order by accepted_at`) as unknown as E911Acknowledgement[];
  }

  // calls
  async upsertCall(c: Parameters<Repository["upsertCall"]>[0]) {
    const inserted = await this.sql`insert into calls ${this.sql(defined(c))} on conflict (twilio_call_sid) do nothing returning *`;
    return maybe<Call>(inserted) ?? one<Call>(await this.sql`select * from calls where twilio_call_sid = ${c.twilioCallSid}`);
  }
  async getCallBySid(sid: string) {
    return maybe<Call>(await this.sql`select * from calls where twilio_call_sid = ${sid}`);
  }
  async updateCall(id: string, patch: Partial<Call>) {
    return one<Call>(await this.sql`update calls set ${this.sql(defined(patch))} where id = ${id} returning *`);
  }
  async countActiveCalls(accountId: string, since: Date) {
    const row = one<{ n: number }>(
      await this.sql`select count(*)::int as n from calls
        where telecom_account_id = ${accountId} and kind <> 'emergency' and started_at >= ${since}
          and status in ('queued', 'initiated', 'ringing', 'in-progress')`,
    );
    return row.n;
  }
  async listCalls(accountId: string, limit: number) {
    return (await this.sql`select * from calls where telecom_account_id = ${accountId} order by started_at desc limit ${limit}`) as unknown as Call[];
  }

  async listCallsPage(accountId: string, opts: { limit: number; before?: { startedAt: Date; id: string } }) {
    const { before } = opts;
    // Cursors carry millisecond Dates: compare on millisecond-truncated timestamps so they round-trip.
    const rows = before
      ? await this.sql`select * from calls where telecom_account_id = ${accountId}
          and (date_trunc('milliseconds', started_at), id) < (${before.startedAt}, ${before.id}::uuid)
          order by date_trunc('milliseconds', started_at) desc, id desc limit ${opts.limit}`
      : await this.sql`select * from calls where telecom_account_id = ${accountId}
          order by date_trunc('milliseconds', started_at) desc, id desc limit ${opts.limit}`;
    return rows as unknown as Call[];
  }

  // messages
  async createMessage(m: Parameters<Repository["createMessage"]>[0]) {
    return one<Message>(await this.sql`insert into messages ${this.sql(defined(m))} returning *`);
  }
  async updateMessageBySid(sid: string, patch: Partial<Message>) {
    return maybe<Message>(await this.sql`update messages set ${this.sql(defined(patch))} where twilio_sid = ${sid} returning *`);
  }
  async listConversations(accountId: string) {
    const rows = await this.sql`
      select distinct on (our_number, peer)
        peer, our_number, id as last_message_id, created_at as last_message_at,
        body_encrypted as last_body_encrypted, direction as last_direction
      from messages where telecom_account_id = ${accountId}
      order by our_number, peer, created_at desc, id desc`;
    return (rows as unknown as Conversation[]).sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  }
  async listMessages(accountId: string, peer: string, opts: { limit: number; before?: { createdAt: Date; id: string } }) {
    const { before } = opts;
    const rows = before
      ? await this.sql`select * from messages where telecom_account_id = ${accountId} and peer = ${peer}
          and (created_at, id) < (${before.createdAt}, ${before.id}::uuid)
          order by created_at desc, id desc limit ${opts.limit}`
      : await this.sql`select * from messages where telecom_account_id = ${accountId} and peer = ${peer}
          order by created_at desc, id desc limit ${opts.limit}`;
    return rows as unknown as Message[];
  }
  async countOutboundSince(accountId: string, since: Date) {
    return one<{ n: number }>(
      await this.sql`select count(*)::int as n from messages where telecom_account_id = ${accountId} and direction = 'outbound' and created_at >= ${since}`,
    ).n;
  }
  async countFingerprintRecipientsSince(accountId: string, fingerprint: string, since: Date) {
    return one<{ n: number }>(
      await this.sql`select count(distinct peer)::int as n from messages
        where telecom_account_id = ${accountId} and direction = 'outbound' and body_fingerprint = ${fingerprint} and created_at >= ${since}`,
    ).n;
  }
  async hasOutboundTo(accountId: string, peer: string, before: Date) {
    const rows = await this.sql`select 1 from messages where telecom_account_id = ${accountId} and peer = ${peer} and created_at < ${before} limit 1`;
    return rows.length > 0;
  }
  async countNewRecipientsSince(accountId: string, since: Date) {
    return one<{ n: number }>(
      await this.sql`select count(distinct m.peer)::int as n from messages m
        where m.telecom_account_id = ${accountId} and m.direction = 'outbound' and m.created_at >= ${since}
          and not exists (select 1 from messages p where p.telecom_account_id = m.telecom_account_id and p.peer = m.peer and p.created_at < ${since})`,
    ).n;
  }

  // voicemail
  async createVoicemail(v: Parameters<Repository["createVoicemail"]>[0]) {
    const inserted = await this.sql`insert into voicemails ${this.sql(defined(v))} on conflict (recording_sid) do nothing returning *`;
    return maybe<Voicemail>(inserted) ?? one<Voicemail>(await this.sql`select * from voicemails where recording_sid = ${v.recordingSid}`);
  }
  async updateVoicemailByRecordingSid(sid: string, patch: Partial<Voicemail>) {
    return maybe<Voicemail>(await this.sql`update voicemails set ${this.sql(defined(patch))} where recording_sid = ${sid} returning *`);
  }
  async listVoicemails(accountId: string) {
    return (await this.sql`select * from voicemails where telecom_account_id = ${accountId} order by created_at desc`) as unknown as Voicemail[];
  }
  async getVoicemail(id: string) {
    return maybe<Voicemail>(await this.sql`select * from voicemails where id = ${id}`);
  }
  async markVoicemailListened(id: string, at: Date) {
    await this.sql`update voicemails set listened_at = ${at} where id = ${id} and listened_at is null`;
  }
  async deleteVoicemail(id: string) {
    const rows = await this.sql`delete from voicemails where id = ${id} returning id`;
    return rows.length > 0;
  }

  // push tokens
  async upsertPushToken(t: Parameters<Repository["upsertPushToken"]>[0]) {
    return one<PushToken>(
      await this.sql`insert into push_tokens ${this.sql(t)}
        on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, kind = excluded.kind, updated_at = now()
        returning *`,
    );
  }
  async listPushTokens(userId: string) {
    return (await this.sql`select * from push_tokens where user_id = ${userId} order by updated_at desc`) as unknown as PushToken[];
  }
  async deletePushTokensForUser(userId: string) {
    await this.sql`delete from push_tokens where user_id = ${userId}`;
  }

  // consents
  async addConsent(c: Omit<Consent, "id">) {
    return one<Consent>(await this.sql`insert into consents ${this.sql(defined(c))} returning *`);
  }
  async listConsents(userId: string) {
    return (await this.sql`select * from consents where user_id = ${userId} order by at`) as unknown as Consent[];
  }

  // usage
  async addUsage(accountId: string, periods: string[], d: UsageDelta) {
    await this.sql.begin(async (tx) => {
      for (const period of periods) {
        await tx`
          insert into usage_ledger (telecom_account_id, period, minutes_out, minutes_in, sms_out, sms_in, mms_out, minutes_on_net,
                                    bonus_minutes_out, bonus_minutes_on_net, spend_cad, intl_spend_cad)
          values (${accountId}, ${period}, ${d.minutesOut ?? 0}, ${d.minutesIn ?? 0}, ${d.smsOut ?? 0}, ${d.smsIn ?? 0}, ${d.mmsOut ?? 0},
                  ${d.minutesOnNet ?? 0}, ${d.bonusMinutesOut ?? 0}, ${d.bonusMinutesOnNet ?? 0}, ${d.spendCad ?? 0}, ${d.intlSpendCad ?? 0})
          on conflict (telecom_account_id, period) do update set
            minutes_out = usage_ledger.minutes_out + excluded.minutes_out,
            minutes_in = usage_ledger.minutes_in + excluded.minutes_in,
            sms_out = usage_ledger.sms_out + excluded.sms_out,
            sms_in = usage_ledger.sms_in + excluded.sms_in,
            mms_out = usage_ledger.mms_out + excluded.mms_out,
            minutes_on_net = usage_ledger.minutes_on_net + excluded.minutes_on_net,
            bonus_minutes_out = usage_ledger.bonus_minutes_out + excluded.bonus_minutes_out,
            bonus_minutes_on_net = usage_ledger.bonus_minutes_on_net + excluded.bonus_minutes_on_net,
            spend_cad = usage_ledger.spend_cad + excluded.spend_cad,
            intl_spend_cad = usage_ledger.intl_spend_cad + excluded.intl_spend_cad`;
      }
    });
  }
  async getUsage(accountId: string, period: string): Promise<Usage> {
    const row = maybe<Usage>(
      await this.sql`select telecom_account_id, period, minutes_out, minutes_in, sms_out, sms_in, mms_out, minutes_on_net,
          bonus_minutes_out, bonus_minutes_on_net, spend_cad, intl_spend_cad
        from usage_ledger where telecom_account_id = ${accountId} and period = ${period}`,
    );
    return row ?? emptyUsage(accountId, period);
  }
  async freePlanUsage(period: string, now: Date) {
    // Same rule as planFromSubscriptions/isLiveSubscription: a live paid plan takes the account out of the free tier.
    const [row] = await this.sql<{ spendCad: number | string; smsOut: number | string }[]>`
      select coalesce(sum(u.spend_cad), 0)::float8 as spend_cad, coalesce(sum(u.sms_out), 0)::int as sms_out
      from usage_ledger u
      where u.period = ${period}
        and not exists (
          select 1 from subscriptions s
          where s.telecom_account_id = u.telecom_account_id
            and s.kind = 'plan' and s.code <> 'free'
            and s.status in ('active', 'trialing', 'past_due')
            and not (s.source = 'manual' and s.current_period_end is not null and s.current_period_end <= ${now}))`;
    return { spendCad: Number(row?.spendCad ?? 0), smsOut: Number(row?.smsOut ?? 0) };
  }
  async countActiveFreeNumbers(now: Date) {
    const [row] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from phone_numbers p
      where p.telecom_account_id is not null and p.state in ('active', 'locked', 'grace')
        and not exists (
          select 1 from subscriptions s
          where s.telecom_account_id = p.telecom_account_id
            and s.kind = 'plan' and s.code <> 'free'
            and s.status in ('active', 'trialing', 'past_due')
            and not (s.source = 'manual' and s.current_period_end is not null and s.current_period_end <= ${now}))`;
    return row?.n ?? 0;
  }
  async countFreeNumberClaimsSince(since: Date) {
    const [row] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where action = 'number.claimed' and meta->>'plan' = 'free' and at >= ${since}`;
    return row?.n ?? 0;
  }

  // fraud
  async addFraudEvent(e: Omit<FraudEvent, "id" | "at">) {
    return one<FraudEvent>(
      await this.sql`insert into fraud_events (telecom_account_id, rule, score, action, details)
        values (${e.telecomAccountId}, ${e.rule}, ${e.score}, ${e.action}, ${this.sql.json(e.details as postgres.JSONValue)}) returning *`,
    );
  }
  async listFraudEvents(accountId: string) {
    return (await this.sql`select * from fraud_events where telecom_account_id = ${accountId} order by at desc`) as unknown as FraudEvent[];
  }

  // handoffs & single-use keys
  async createHandoff(h: Parameters<Repository["createHandoff"]>[0]) {
    return one<Handoff>(await this.sql`insert into handoffs ${this.sql(defined(h))} returning *`);
  }
  async findHandoffByTokenHash(tokenHash: string) {
    return maybe<Handoff>(await this.sql`select * from handoffs where token_hash = ${tokenHash}`);
  }
  async claimHandoff(id: string, userId: string, at: Date) {
    const rows = await this.sql`update handoffs set claimed_at = ${at}, claimed_by_user_id = ${userId}
      where id = ${id} and claimed_at is null returning id`;
    return rows.length === 1;
  }
  async useOnce(key: string, expiresAt: Date) {
    await this.sql`delete from used_once_keys where expires_at < now() - interval '1 day'`;
    const rows = await this.sql`insert into used_once_keys (key, expires_at) values (${key}, ${expiresAt}) on conflict do nothing returning key`;
    return rows.length === 1;
  }

  // opt-outs
  async setOptOut(ourNumber: string, peer: string, optedOut: boolean) {
    await this.sql`insert into sms_opt_outs (our_number, peer, opted_out) values (${ourNumber}, ${peer}, ${optedOut})
      on conflict (our_number, peer) do update set opted_out = excluded.opted_out, updated_at = now()`;
  }
  async isOptedOut(ourNumber: string, peer: string) {
    const rows = await this.sql`select 1 from sms_opt_outs where our_number = ${ourNumber} and peer = ${peer} and opted_out`;
    return rows.length > 0;
  }

  // outbox
  async enqueueOutbox(eventType: OutboxEvent["eventType"], payload: Record<string, unknown>) {
    return one<OutboxEvent>(
      await this.sql`insert into takatak_outbox (event_type, payload) values (${eventType}, ${this.sql.json(payload as postgres.JSONValue)}) returning *`,
    );
  }
  async listDueOutbox(now: Date, limit: number) {
    return (await this.sql`select * from takatak_outbox where delivered_at is null and next_attempt_at <= ${now}
      order by next_attempt_at limit ${limit}`) as unknown as OutboxEvent[];
  }
  async markOutboxDelivered(id: string, at: Date) {
    await this.sql`update takatak_outbox set delivered_at = ${at}, attempts = attempts + 1 where id = ${id}`;
  }
  async markOutboxFailed(id: string, error: string, nextAttemptAt: Date | null) {
    await this.sql`update takatak_outbox set attempts = attempts + 1, last_error = ${error}, next_attempt_at = ${nextAttemptAt} where id = ${id}`;
  }

  async audit(e: AuditEntry) {
    await this.sql`insert into audit_log (actor_user_id, action, target_type, target_id, ip, meta, at)
      values (${e.actorUserId}, ${e.action}, ${e.targetType ?? null}, ${e.targetId ?? null}, ${e.ip ?? null},
              ${this.sql.json((e.meta ?? {}) as postgres.JSONValue)}, coalesce(${e.at ?? null}::timestamptz, now()))`;
  }

  async bindDevice(input: { platform: "ios" | "android"; deviceKey: string; userId: string; verifiedAt: Date }) {
    const rows = await this.sql`
      insert into attested_devices (platform, device_key, user_id, verified_at)
      values (${input.platform}, ${input.deviceKey}, ${input.userId}, ${input.verifiedAt})
      on conflict (platform, device_key) do update
        set verified_at = excluded.verified_at
        where attested_devices.user_id = excluded.user_id
      returning user_id`;
    return rows.length === 1 ? "ok" : "taken";
  }

  async grantAdReward(input: { userId: string; transactionId: string; minutes: number; createdAt: Date }) {
    const rows = await this.sql`
      insert into ad_rewards (user_id, transaction_id, minutes, created_at)
      values (${input.userId}, ${input.transactionId}, ${input.minutes}, ${input.createdAt})
      on conflict (transaction_id) do nothing
      returning id`;
    return rows.length === 1;
  }

  async countAdRewardsSince(userId: string, since: Date) {
    const rows = await this.sql`select count(*)::int as n from ad_rewards where user_id = ${userId} and created_at >= ${since}`;
    return Number((rows[0] as { n?: number } | undefined)?.n ?? 0);
  }

  async claimAdReward(userId: string, at: Date) {
    const rows = await this.sql`
      update ad_rewards set claimed_at = ${at}
      where id = (
        select id from ad_rewards where user_id = ${userId} and claimed_at is null order by created_at limit 1
      )
      returning transaction_id, minutes`;
    const row = rows[0] as { transactionId: string; minutes: number } | undefined;
    return row ? { transactionId: row.transactionId, minutes: row.minutes } : null;
  }
}
