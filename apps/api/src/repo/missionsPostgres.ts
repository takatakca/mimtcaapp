import type postgres from "postgres";
import type { MissionBucket } from "@mimt/shared";
import type { MissionRepository, MissionRewardRow, NewMissionReward } from "./missions.js";

type Sql = postgres.Sql<{}>;
type Tx = postgres.TransactionSql<{}>;

/** Mission reward ledger on Postgres (0017_missions.sql). Shares the connection pool of PostgresRepository. */
export class PostgresMissionRepository implements MissionRepository {
  constructor(private readonly sql: Sql) {}

  async listForAccount(accountId: string) {
    return (await this.sql`
      select id, telecom_account_id, mission_id, minutes, points, bucket, status, period, owner_hash, device_hash, source_ref, granted_at, credited_at
      from mission_rewards where telecom_account_id = ${accountId} order by granted_at`) as unknown as MissionRewardRow[];
  }

  /** Bonus minutes into usage_ledger, inside the caller's transaction. */
  private async credit(tx: Tx, row: Pick<MissionRewardRow, "telecomAccountId" | "bucket" | "minutes">, periods: string[]) {
    if (!row.bucket || row.minutes <= 0) return;
    const out = row.bucket === "outbound" ? row.minutes : 0;
    const onNet = row.bucket === "on_net" ? row.minutes : 0;
    for (const period of periods) {
      await tx`
        insert into usage_ledger (telecom_account_id, period, bonus_minutes_out, bonus_minutes_on_net)
        values (${row.telecomAccountId}, ${period}, ${out}, ${onNet})
        on conflict (telecom_account_id, period) do update set
          bonus_minutes_out = usage_ledger.bonus_minutes_out + excluded.bonus_minutes_out,
          bonus_minutes_on_net = usage_ledger.bonus_minutes_on_net + excluded.bonus_minutes_on_net,
          updated_at = now()`;
    }
  }

  async grant(input: NewMissionReward & { usagePeriods: string[] }) {
    const { usagePeriods, ...r } = input;
    const credited = r.status === "granted" && r.minutes > 0;
    return (await this.sql.begin(async (tx) => {
      // Any unique key (account, owner or device) already taken: nothing is written, nothing is credited.
      const rows = await tx`
        insert into mission_rewards (telecom_account_id, mission_id, minutes, points, bucket, status, period, owner_hash, device_hash,
                                     source_ref, granted_at, credited_at)
        values (${r.telecomAccountId}, ${r.missionId}, ${r.minutes}, ${r.points ?? 0}, ${r.bucket}, ${r.status}, ${r.period}, ${r.ownerHash},
                ${r.deviceHash}, ${r.sourceRef}, ${r.grantedAt}, ${credited ? r.grantedAt : null})
        on conflict do nothing
        returning id, telecom_account_id, mission_id, minutes, points, bucket, status, period, owner_hash, device_hash, source_ref, granted_at, credited_at`;
      const row = (rows[0] as MissionRewardRow | undefined) ?? null;
      if (row && credited) await this.credit(tx, row, usagePeriods);
      return row;
    })) as MissionRewardRow | null;
  }

  async creditPending(id: string, bucket: MissionBucket, usagePeriods: string[], at: Date) {
    return (await this.sql.begin(async (tx) => {
      const rows = await tx`
        update mission_rewards set status = 'granted', period = ${usagePeriods[0] ?? null}, credited_at = ${at},
          bucket = case when minutes > 0 then ${bucket}::text else null end
        where id = ${id} and status = 'pending'
        returning id, telecom_account_id, mission_id, minutes, points, bucket, status, period, owner_hash, device_hash, source_ref, granted_at, credited_at`;
      const row = (rows[0] as MissionRewardRow | undefined) ?? null;
      if (row) await this.credit(tx, row, usagePeriods);
      return row;
    })) as MissionRewardRow | null;
  }
}
