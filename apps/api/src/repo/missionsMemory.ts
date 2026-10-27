import { randomUUID } from "node:crypto";
import type { MissionBucket } from "@mimt/shared";
import { bucketDelta, type MissionRepository, type MissionRewardRow, type NewMissionReward } from "./missions.js";
import type { UsageDelta } from "./types.js";

type AddUsage = (accountId: string, periods: string[], delta: UsageDelta) => Promise<void>;

/** Same rules as the Postgres unique indexes of 0017_missions.sql. */
export class MemoryMissionRepository implements MissionRepository {
  readonly rows: MissionRewardRow[] = [];

  constructor(private readonly addUsage: AddUsage) {}

  async listForAccount(accountId: string) {
    return this.rows.filter((r) => r.telecomAccountId === accountId).map((r) => ({ ...r }));
  }

  async grant(input: NewMissionReward & { usagePeriods: string[] }) {
    const { usagePeriods, ...row } = input;
    const taken = this.rows.some(
      (r) =>
        r.missionId === row.missionId &&
        (r.telecomAccountId === row.telecomAccountId ||
          (row.ownerHash !== null && r.ownerHash === row.ownerHash) ||
          (row.deviceHash !== null && r.deviceHash === row.deviceHash)),
    );
    if (taken) return null;
    const created: MissionRewardRow = { ...row, id: randomUUID(), creditedAt: row.status === "granted" && row.minutes > 0 ? row.grantedAt : null };
    this.rows.push(created);
    if (created.creditedAt) await this.addUsage(row.telecomAccountId, usagePeriods, bucketDelta(row.bucket, row.minutes));
    return { ...created };
  }

  async creditPending(id: string, bucket: MissionBucket, usagePeriods: string[], at: Date) {
    const row = this.rows.find((r) => r.id === id && r.status === "pending");
    if (!row) return null;
    row.status = "granted";
    row.bucket = row.minutes > 0 ? bucket : null;
    row.period = usagePeriods[0] ?? null;
    row.creditedAt = at;
    if (row.minutes > 0) await this.addUsage(row.telecomAccountId, usagePeriods, bucketDelta(row.bucket, row.minutes));
    return { ...row };
  }
}
