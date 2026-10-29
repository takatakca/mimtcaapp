// MIMT Points inactivity expiry (docs/MIMT-POINTS.md). OFF by default: POINTS_EXPIRY=on turns it on,
// POINTS_EXPIRY_MONTHS (default 12) sets the inactivity window. A balance expires only when the account had NO points
// activity (earning or spending) for that long; any earning or spending restarts the clock. The whole balance is
// debited by one ledger row (reason "expiry", key "expiry:<account>:<last activity>"), so a re-run never debits twice.
// Daily, from server.ts (same single-instance poller model as the other jobs). POINTS=off also pauses it.
import type { FastifyBaseLogger } from "fastify";
import type { AppDeps } from "../deps.js";

type Log = Pick<FastifyBaseLogger, "warn" | "error">;
type Deps = Pick<AppDeps, "repo" | "config">;

export interface PointsExpiryResult {
  expired: number;
  points: number;
  errors: number;
  skipped?: "off";
}

/** The date before which an account's last activity makes its balance expire. */
export function expiryCutoff(now: Date, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

export async function runPointsExpiry(deps: Deps, opts: { now?: Date; log?: Log; limit?: number } = {}): Promise<PointsExpiryResult> {
  const { points } = deps.config;
  if (!points.enabled || !points.expiry.enabled) return { expired: 0, points: 0, errors: 0, skipped: "off" };
  const now = opts.now ?? new Date();
  const before = expiryCutoff(now, points.expiry.months);
  const result: PointsExpiryResult = { expired: 0, points: 0, errors: 0 };
  for (const acct of await deps.repo.points.listExpirable(before, opts.limit ?? 500)) {
    try {
      const row = await deps.repo.points.expire(acct.telecomAccountId, before, now);
      if (!row) continue;
      result.expired++;
      result.points += -row.delta;
      await deps.repo.audit({
        actorUserId: null,
        action: "points.expired",
        targetType: "telecom_account",
        targetId: acct.telecomAccountId,
        meta: { points: -row.delta, inactiveSince: acct.lastActivityAt.toISOString(), months: points.expiry.months },
        at: now,
      });
    } catch (err) {
      result.errors++;
      opts.log?.error({ err: { message: (err as Error).message }, account: acct.telecomAccountId }, "points expiry failed");
    }
  }
  return result;
}
