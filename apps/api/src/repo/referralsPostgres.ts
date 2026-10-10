import type postgres from "postgres";
import type { ReferralCodeRow, ReferralRepository, ReferralRow } from "./referrals.js";

type Sql = postgres.Sql<{}>;

const maybe = <T>(rows: readonly unknown[]): T | null => (rows[0] as T | undefined) ?? null;
const many = <T>(rows: readonly unknown[]) => rows as unknown as T[];

const REFERRAL_COLS = "id, code, referrer_user_id, referee_user_id, status, reject_reason, device_key_hash, referee_payment_fingerprint, rewarded_at, created_at";

/** Referral storage on Postgres (0008_referrals_addons.sql). Shares the connection pool of PostgresRepository. */
export class PostgresReferralRepository implements ReferralRepository {
  constructor(private readonly sql: Sql) {}

  async getCodeForUser(userId: string) {
    return maybe<ReferralCodeRow>(await this.sql`select code, user_id, created_at from referral_codes where user_id = ${userId}`);
  }
  async createCode(userId: string, code: string) {
    return maybe<ReferralCodeRow>(
      await this.sql`insert into referral_codes (code, user_id) values (${code}, ${userId})
        on conflict do nothing returning code, user_id, created_at`,
    );
  }
  async findCode(code: string) {
    return maybe<ReferralCodeRow>(await this.sql`select code, user_id, created_at from referral_codes where code = ${code}`);
  }

  async createReferral(r: Pick<ReferralRow, "code" | "referrerUserId" | "refereeUserId" | "deviceKeyHash">) {
    return maybe<ReferralRow>(
      await this.sql`insert into referrals (code, referrer_user_id, referee_user_id, device_key_hash)
        values (${r.code}, ${r.referrerUserId}, ${r.refereeUserId}, ${r.deviceKeyHash})
        on conflict (referee_user_id) do nothing
        returning ${this.sql.unsafe(REFERRAL_COLS)}`,
    );
  }
  async getReferralForReferee(userId: string) {
    return maybe<ReferralRow>(await this.sql`select ${this.sql.unsafe(REFERRAL_COLS)} from referrals where referee_user_id = ${userId}`);
  }
  async listReferralsByReferrer(userId: string) {
    return many<ReferralRow>(
      await this.sql`select ${this.sql.unsafe(REFERRAL_COLS)} from referrals where referrer_user_id = ${userId} order by created_at desc, id desc`,
    );
  }
  async settleReferral(id: string, o: Parameters<ReferralRepository["settleReferral"]>[1]) {
    const rows = await this.sql`update referrals
      set status = ${o.status}, reject_reason = ${o.rejectReason}, referee_payment_fingerprint = ${o.refereePaymentFingerprint},
          rewarded_at = ${o.status === "rewarded" ? o.at : null}, updated_at = now()
      where id = ${id} and status = 'pending' returning id`;
    return rows.length > 0;
  }

  async listDeviceKeys(userId: string) {
    const rows = await this.sql<{ deviceKey: string }[]>`select device_key from attested_devices where user_id = ${userId}`;
    return rows.map((r) => r.deviceKey);
  }
  async findDeviceUsers(deviceKey: string) {
    const rows = await this.sql<{ userId: string }[]>`select distinct user_id from attested_devices where device_key = ${deviceKey}`;
    return rows.map((r) => r.userId);
  }

  async addPaymentFingerprint(accountId: string, fingerprint: string, at: Date) {
    await this.sql`insert into payment_fingerprints (telecom_account_id, fingerprint, first_seen_at)
      values (${accountId}, ${fingerprint}, ${at}) on conflict do nothing`;
  }
  async listPaymentFingerprints(accountId: string) {
    const rows = await this.sql<{ fingerprint: string }[]>`select fingerprint from payment_fingerprints where telecom_account_id = ${accountId}`;
    return rows.map((r) => r.fingerprint);
  }
}
