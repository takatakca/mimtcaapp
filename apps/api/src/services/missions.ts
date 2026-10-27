// « Missions MIMT » (docs/MIMT-MISSIONS.md, packages/shared/src/missions.ts).
//
// Rules, all enforced here or by the database (0017_missions.sql):
//  - a reward is granted only from a server-side event: the route or webhook that just did the thing calls
//    grantMission(); no route lets the client claim a mission;
//  - at most once per account and mission, once per owner (phone number hash, else TAKATAK id hash) so deleting the
//    account and signing up again earns nothing, and install_app once per attested device;
//  - the reward and its minutes are written in one transaction; every grant is in the audit log (no personal data);
//  - bonus minutes go to the CURRENT usage month (no carry-over): paid plans' outbound minutes, the free plan's
//    app-to-app (on-net) minutes. Total per account ≤ MISSION_MINUTES_CAP (150 min);
//  - free-plan minutes respect the free tier's monthly budget (FREE_TIER_MONTHLY_BUDGET_CAD): when it is reached the
//    reward is recorded as "pending" and its minutes are added on a later month, once the budget allows it;
//  - MISSIONS=off (config.ts) grants nothing new;
//  - a mission never breaks the route that triggered it: failures are logged and swallowed.
import {
  MISSION_MINUTES_CAP,
  MISSIONS,
  missionDef,
  type MissionBucket,
  type MissionDto,
  type MissionGrantedDto,
  type MissionId,
  type MissionsResponse,
} from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { monthPeriod } from "../lib/time.js";
import type { MissionRewardRow } from "../repo/missions.js";
import type { TelecomAccount, User } from "../repo/types.js";
import { planOf } from "../plansConfig.js";
import { getPlan, usagePeriods } from "./accounts.js";
import { freeTierSpendCad } from "./freeTier.js";

/** USD per app-leg minute (Twilio Voice SDK), the cost of one on-net minute: docs/MIMT-UNIT-ECONOMICS.md. */
const APP_LEG_USD_PER_MIN = 0.004;

/**
 * Web Push services a real browser subscribes with. An endpoint anywhere else is saved (routes/push.ts) but does
 * not complete the mission: a made-up URL is not "notifications turned on".
 */
const PUSH_SERVICE_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^android\.googleapis\.com$/];

export function isKnownPushService(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return PUSH_SERVICE_HOSTS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

type Log = { warn: (obj: object, msg: string) => void };

export interface GrantMissionInput {
  account: TelecomAccount;
  /** The account owner when the caller already has it (saves a read). */
  user?: User | null;
  mission: MissionId;
  /** What triggered it, without personal data: "otp", "handle", "web_push", "device:ios", "stripe:sub_…". */
  sourceRef: string;
  /** install_app: the attested device key (stored only as a keyed hash). */
  deviceKey?: string;
  log?: Log;
}

const BLOCKED_ACCOUNT = new Set(["CLOSED", "SUSPENDED"]);

/** Where an account's mission minutes go: the free plan's own app-to-app pool, else outbound minutes. */
export async function missionBucket(deps: AppDeps, accountId: string): Promise<MissionBucket> {
  return planOf(await getPlan(deps.repo, accountId)).caps.onNetMinutes !== null ? "on_net" : "outbound";
}

/** True when `minutes` more on-net minutes stay within the free tier's monthly budget. */
async function freeBudgetAllows(deps: AppDeps, minutes: number, now: Date): Promise<boolean> {
  const spend = await freeTierSpendCad(deps, now);
  const cost = minutes * APP_LEG_USD_PER_MIN * deps.config.USD_TO_CAD;
  return spend + cost <= deps.config.FREE_TIER_MONTHLY_BUDGET_CAD;
}

/** Keyed hash of who owns the account: the sign-in phone number, else the TAKATAK id. */
function ownerHash(deps: AppDeps, user: User): string | null {
  if (user.phoneE164) return deps.cipher.subjectHash("phone", user.phoneE164);
  if (user.globalUserId) return deps.cipher.subjectHash("global", user.globalUserId);
  return null;
}

const toDto = (row: MissionRewardRow): MissionGrantedDto => ({
  id: row.missionId,
  minutes: row.minutes,
  bucket: row.bucket,
  status: row.status === "pending" ? "pending" : "granted",
  period: row.status === "granted" && row.minutes > 0 ? row.period : null,
});

/**
 * Grants `mission` to the account if it was never granted to this account, owner or device. Returns what was
 * recorded, or null (already granted, switched off, account closed, or an error that was logged).
 */
export async function grantMission(deps: AppDeps, input: GrantMissionInput): Promise<MissionGrantedDto | null> {
  if (deps.config.MISSIONS === "off") return null;
  try {
    return await grant(deps, input);
  } catch (err) {
    input.log?.warn({ err: { message: (err as Error).message }, mission: input.mission }, "mission grant failed");
    return null;
  }
}

async function grant(deps: AppDeps, input: GrantMissionInput): Promise<MissionGrantedDto | null> {
  const { repo } = deps;
  const { account, mission } = input;
  if (BLOCKED_ACCOUNT.has(account.status)) return null;
  const user = input.user ?? (await repo.getUser(account.ownerUserId));
  if (!user || user.status === "deleted" || user.status === "suspended" || user.status === "pending_deletion") return null;

  const existing = await repo.missions.listForAccount(account.id);
  if (existing.some((r) => r.missionId === mission)) return null;
  const def = missionDef(mission);
  const earned = existing.reduce((sum, r) => sum + r.minutes, 0);
  const minutes = Math.max(0, Math.min(def.minutes, MISSION_MINUTES_CAP - earned));

  const now = deps.now();
  const bucket = minutes > 0 ? await missionBucket(deps, account.id) : null;
  const pending = bucket === "on_net" && !(await freeBudgetAllows(deps, minutes, now));
  const row = await repo.missions.grant({
    telecomAccountId: account.id,
    missionId: mission,
    minutes,
    bucket,
    status: pending ? "pending" : "granted",
    period: !pending && minutes > 0 ? monthPeriod(now) : null,
    ownerHash: ownerHash(deps, user),
    deviceHash: input.deviceKey ? deps.cipher.subjectHash("device", input.deviceKey) : null,
    sourceRef: input.sourceRef.slice(0, 200),
    grantedAt: now,
    usagePeriods: usagePeriods(now),
  });
  if (!row) return null;
  // No personal data: internal ids, the mission and the minutes only.
  await repo.audit({
    actorUserId: null,
    action: "mission.granted",
    targetType: "telecom_account",
    targetId: account.id,
    meta: { mission, minutes, bucket, status: row.status, period: row.period, source: input.sourceRef.split(":")[0] },
    at: now,
  });
  return toDto(row);
}

/** Adds the minutes of pending rewards once the free-tier budget allows it (called by GET /v1/missions). */
export async function creditPendingMissions(deps: AppDeps, account: TelecomAccount, rows: MissionRewardRow[], log?: Log): Promise<MissionRewardRow[]> {
  if (deps.config.MISSIONS === "off" || BLOCKED_ACCOUNT.has(account.status)) return rows;
  const pending = rows.filter((r) => r.status === "pending");
  if (!pending.length) return rows;
  try {
    const now = deps.now();
    const bucket = await missionBucket(deps, account.id);
    const out = [...rows];
    for (const row of pending) {
      if (bucket === "on_net" && !(await freeBudgetAllows(deps, row.minutes, now))) break;
      const credited = await deps.repo.missions.creditPending(row.id, bucket, usagePeriods(now), now);
      if (!credited) continue;
      out[out.indexOf(row)] = credited;
      await deps.repo.audit({
        actorUserId: null,
        action: "mission.credited",
        targetType: "telecom_account",
        targetId: account.id,
        meta: { mission: row.missionId, minutes: row.minutes, bucket, period: credited.period },
        at: now,
      });
    }
    return out;
  } catch (err) {
    log?.warn({ err: { message: (err as Error).message } }, "pending mission credit failed");
    return rows;
  }
}

/** GET /v1/missions body. invite_friend is also done when a referral of this user was rewarded before missions. */
export async function missionsView(deps: AppDeps, account: TelecomAccount, user: User, log?: Log): Promise<MissionsResponse> {
  const now = deps.now();
  const rows = await creditPendingMissions(deps, account, await deps.repo.missions.listForAccount(account.id), log);
  const byId = new Map(rows.map((r) => [r.missionId, r]));
  const rewardedReferral = byId.has("invite_friend")
    ? null
    : (await deps.repo.referrals.listReferralsByReferrer(user.id)).find((r) => r.status === "rewarded" && r.rewardedAt) ?? null;
  const missions: MissionDto[] = MISSIONS.map((def) => {
    const row = byId.get(def.id);
    const grantedAt = row?.grantedAt ?? (def.id === "invite_friend" ? (rewardedReferral?.rewardedAt ?? null) : null);
    return {
      id: def.id,
      status: row?.status === "pending" ? "pending" : grantedAt ? "done" : "todo",
      rewardKind: def.rewardKind,
      minutes: def.minutes,
      needsPurchase: def.needsPurchase,
      grantedAt: grantedAt ? grantedAt.toISOString() : null,
    };
  });
  return {
    enabled: deps.config.MISSIONS === "on",
    missions,
    totalMinutes: rows.filter((r) => r.status === "granted").reduce((sum, r) => sum + r.minutes, 0),
    capMinutes: MISSION_MINUTES_CAP,
    bucket: await missionBucket(deps, account.id),
    period: monthPeriod(now),
  };
}
