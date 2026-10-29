// Demo fixtures for MIMT Points (VITE_MOCK_API=1). Same routes and rules as apps/api routes/points.ts and
// services/points.ts, in memory: points come only from server-side events (here: the demo missions), redeeming
// debits atomically and replays a used key without debiting again.
import {
  MISSION_POINTS_CAP,
  POINTS_CATALOG,
  POINTS_PER_DOLLAR,
  REFERRAL_POINTS,
  type PlanCode,
  type PointsCatalogResponse,
  type PointsEntryDto,
  type PointsRedeemRequest,
  type PointsRedeemResponse,
  type PointsResponse,
  type PointsReward,
} from "@mimt/shared";
import type { MockHelpers, MockRoute } from "./mock.meetings";

interface State {
  balance: number;
  lifetime: number;
  history: PointsEntryDto[];
  /** client key → response */
  redemptions: Map<string, PointsRedeemResponse>;
  usedThisMonth: Record<string, number>;
}

const fresh = (): State => ({ balance: 0, lifetime: 0, history: [], redemptions: new Map(), usedThisMonth: {} });
let state = fresh();
let seq = 0;

export function resetPointsMock(): void {
  state = fresh();
}

/** Credits demo points (called where the real API would: a mission grant). */
export function earnMockPoints(points: number, label: string): void {
  if (points <= 0) return;
  state.balance += points;
  state.lifetime += points;
  state.history.unshift({ id: `pts-${++seq}`, delta: points, reason: "mission", label, campaignName: null, balanceAfter: state.balance, createdAt: new Date().toISOString() });
}

function eligible(r: PointsReward, plan: PlanCode): boolean {
  switch (r.eligibility) {
    case "paid":
      return plan !== "free";
    case "free":
      return plan === "free";
    case "stripe_paid":
      return plan !== "free";
    case "not_ad_free":
      return plan === "free" || plan === "lock";
  }
}

export function pointsMockRoutes(h: Pick<MockHelpers, "ok" | "fail">, plan: () => PlanCode): MockRoute[] {
  const view = (): PointsResponse => ({
    enabled: true,
    balance: state.balance,
    lifetimeEarned: state.lifetime,
    history: state.history.slice(0, 30),
    campaigns: [
      {
        id: "camp-demo",
        name: "Double points sur l'annuel",
        kind: "multiplier",
        target: "purchase_yearly",
        multiplier: 2,
        bonusPoints: null,
        startsAt: new Date(Date.now() - 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      },
    ],
    rules: { pointsPerDollar: POINTS_PER_DOLLAR, referralPoints: REFERRAL_POINTS, missionPointsCap: MISSION_POINTS_CAP, dailyEarnCap: 5000, monthlyEarnCap: 20000, expiryMonths: 12 },
  });
  const catalog = (): PointsCatalogResponse => ({
    enabled: true,
    balance: state.balance,
    rewards: POINTS_CATALOG.filter((r) => r.enabled).map(({ enabled: _e, ...r }) => {
      const used = state.usedThisMonth[r.id] ?? 0;
      const reason = !eligible({ ...r, enabled: true }, plan()) ? "plan" : used >= r.monthlyLimit ? "monthly_limit" : state.balance < r.points ? "balance" : null;
      return { ...r, available: reason === null, unavailableReason: reason, usedThisMonth: used };
    }),
  });
  return [
    ["GET", /^\/v1\/points$/, () => h.ok(view())],
    ["GET", /^\/v1\/points\/catalog$/, () => h.ok(catalog())],
    [
      "POST",
      /^\/v1\/points\/redeem$/,
      ({ body }) => {
        const b = body as PointsRedeemRequest;
        const done = state.redemptions.get(b.idempotencyKey);
        if (done) return done.rewardId === b.rewardId ? h.ok({ ...done, replay: true, balance: state.balance }) : h.fail(409, "idempotency_conflict");
        const r = POINTS_CATALOG.find((x) => x.id === b.rewardId && x.enabled);
        if (!r) return h.fail(404, "unknown_reward");
        if (!eligible(r, plan())) return h.fail(409, "not_eligible");
        if ((state.usedThisMonth[r.id] ?? 0) >= r.monthlyLimit) return h.fail(409, "monthly_limit");
        if (state.balance < r.points) return h.fail(409, "insufficient_points");
        state.balance -= r.points;
        state.usedThisMonth[r.id] = (state.usedThisMonth[r.id] ?? 0) + 1;
        state.history.unshift({ id: `pts-${++seq}`, delta: -r.points, reason: "redeem", label: `reward:${r.id}`, campaignName: null, balanceAfter: state.balance, createdAt: new Date().toISOString() });
        const res: PointsRedeemResponse = {
          redemptionId: `red-${seq}`,
          rewardId: r.id,
          status: "fulfilled",
          points: r.points,
          balance: state.balance,
          replay: false,
          ...(r.kind === "ad_free_days" ? { until: new Date(Date.now() + r.quantity * 86_400_000).toISOString() } : {}),
        };
        state.redemptions.set(b.idempotencyKey, res);
        return h.ok(res);
      },
    ],
  ];
}
