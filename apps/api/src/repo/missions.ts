// « Missions MIMT » reward ledger (supabase/migrations/0017_missions.sql). Service: src/services/missions.ts.
import type { MissionBucket, MissionId } from "@mimt/shared";

export interface MissionRewardRow {
  id: string;
  telecomAccountId: string;
  missionId: MissionId;
  /** Bonus minutes: rewards granted before missions switched to points (2026-10-28); 0 for every new grant. */
  minutes: number;
  /** MIMT Points of the reward, credited to points_ledger with the key "mission:<account>:<mission>". */
  points: number;
  bucket: MissionBucket | null;
  status: "granted" | "pending";
  /** "YYYY-MM" the minutes were added to (null while pending or without minutes). */
  period: string | null;
  /** Keyed hash of the owner's phone (or TAKATAK id): one reward per person, even across deleted accounts. */
  ownerHash: string | null;
  /** Keyed hash of the attested device key (install_app). */
  deviceHash: string | null;
  sourceRef: string;
  grantedAt: Date;
  creditedAt: Date | null;
}

export type NewMissionReward = Omit<MissionRewardRow, "id" | "creditedAt" | "points"> & { points?: number };

export interface MissionRepository {
  listForAccount(accountId: string): Promise<MissionRewardRow[]>;
  /**
   * Records a reward, once. When it is "granted" with minutes, the minutes are added to `usagePeriods` (usage_ledger
   * bonus column of its bucket) in the SAME transaction: a reward is never recorded without its minutes or the
   * reverse. Null (nothing written) when the account, the owner or the device already has this mission.
   */
  grant(input: NewMissionReward & { usagePeriods: string[] }): Promise<MissionRewardRow | null>;
  /**
   * Adds a pending reward's minutes to `usagePeriods` in `bucket` (the account's plan may have changed since),
   * status → granted. Null when it was not pending any more (a concurrent credit already did it).
   */
  creditPending(id: string, bucket: MissionBucket, usagePeriods: string[], at: Date): Promise<MissionRewardRow | null>;
}

/** Usage ledger column of a bucket. */
export const bucketDelta = (bucket: MissionBucket | null, minutes: number) =>
  bucket === "on_net" ? { bonusMinutesOnNet: minutes } : bucket === "outbound" ? { bonusMinutesOut: minutes } : {};
