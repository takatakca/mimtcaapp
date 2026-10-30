import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { PLANS, type NumberState, type PlanCode } from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { requireUser } from "../auth/guard.js";
import { forbidden } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { DAY_MS, monthPeriod } from "../lib/time.js";
import { billingSourceOf, HELD_STATES, isLiveSubscription, planFromSubscriptions } from "../services/accounts.js";

const priceOf = (code: string): number => {
  const plan = (PLANS as Record<string, { monthlyPriceCents?: number }>)[code];
  return plan?.monthlyPriceCents ?? 0;
};

/**
 * Backend « experience dashboard » (v1, read-only): aggregates for the MIMT staff
 * dashboard app. Same allowlist as the catalog admin: CATALOG_ADMIN_USER_IDS.
 * No new data pipelines — every number below comes from rows that already exist.
 */
export async function adminDashboardRoutes(app: FastifyInstance, deps: AppDeps) {
  const admin = {
    preHandler: [
      requireUser(deps),
      async (req: FastifyRequest) => {
        if (!deps.config.CATALOG_ADMIN_USER_IDS.includes(req.userId)) throw forbidden("admin_only", "Réservé aux administrateurs MIMT.");
      },
    ],
  };

  // ------------------------------------------------------------------ overview
  app.get("/v1/admin/overview", admin, async (_req, reply) => {
    void reply.header("cache-control", "no-store");
    const { repo } = deps;
    const now = deps.now();
    const since7d = new Date(now.getTime() - 7 * DAY_MS);
    const since30d = new Date(now.getTime() - 30 * DAY_MS);
    const [signups7d, signups30d, activeUsers, calls30d, messages30d, voicemails30d, liveSubs] = await Promise.all([
      repo.countUsersSince(since7d),
      repo.countUsersSince(since30d),
      repo.countUsersByStatus("active"),
      repo.countCallsSince(since30d),
      repo.countMessagesSince(since30d),
      repo.countVoicemailsSince(since30d),
      repo.listSubscriptionsByStatus(["active", "trialing", "past_due"]),
    ]);
    let mrrCents = 0;
    for (const s of liveSubs) {
      if (s.kind !== "plan" || !isLiveSubscription(s, now)) continue;
      mrrCents += priceOf(s.code) * (s.quantity || 1);
    }
    return { signups7d, signups30d, activeUsers, mrrCents, calls30d, messages30d, voicemails30d };
  });

  // ------------------------------------------------------------------ users
  const UsersQuery = z.object({
    q: z.string().trim().max(100).default(""),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });
  app.get("/v1/admin/users", admin, async (req, reply) => {
    const query = parse(UsersQuery, req.query);
    void reply.header("cache-control", "no-store");
    const { repo } = deps;
    const now = deps.now();
    const users = query.q ? await repo.searchUsers(query.q, query.limit) : await repo.listRecentUsers(query.limit);
    const rows = [];
    for (const u of users) {
      const account = await repo.getAccountByOwner(u.id);
      let plan: PlanCode = "free";
      let planSource: string | null = null;
      let numbers: string[] = [];
      if (account) {
        const subs = await repo.listSubscriptions(account.id);
        plan = planFromSubscriptions(subs, now);
        planSource = billingSourceOf(subs, "plan", plan, now);
        numbers = (await repo.listNumbersByAccount(account.id)).map((n) => n.e164);
      }
      rows.push({
        id: u.id,
        email: u.email,
        phoneE164: u.phoneE164,
        displayName: u.displayName,
        status: u.status,
        createdAt: u.createdAt,
        phoneVerifiedAt: u.phoneVerifiedAt,
        account: account
          ? { id: account.id, kind: account.kind, status: account.status, plan, planSource, numbers }
          : null,
      });
    }
    return { users: rows };
  });

  // ------------------------------------------------------------------ usage
  const UsageQuery = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });
  app.get("/v1/admin/usage", admin, async (req, reply) => {
    const q = parse(UsageQuery, req.query);
    void reply.header("cache-control", "no-store");
    const { repo } = deps;
    const now = deps.now();
    const period = monthPeriod(now);
    const accounts = await repo.listAccountsPage(q.limit, q.offset);
    const rows = [];
    for (const a of accounts) {
      const [usage, subs, ents] = await Promise.all([
        repo.getUsage(a.id, period),
        repo.listSubscriptions(a.id),
        repo.listEntitlements(a.id),
      ]);
      const plan = planFromSubscriptions(subs, now);
      const caps = PLANS[plan].caps;
      rows.push({
        accountId: a.id,
        ownerUserId: a.ownerUserId,
        kind: a.kind,
        status: a.status,
        plan,
        usage: {
          minutesOut: usage.minutesOut,
          minutesIn: usage.minutesIn,
          smsOut: usage.smsOut,
          smsIn: usage.smsIn,
          spendCad: usage.spendCad,
        },
        caps: { outboundMinutes: caps.outboundMinutes, inboundMinutes: caps.inboundMinutes, messages: caps.messages },
        entitlements: ents.map((e) => ({ feature: e.feature, limit: e.limit })),
      });
    }
    const topTalkers = rows
      .map((r) => ({ accountId: r.accountId, minutes: r.usage.minutesOut + r.usage.minutesIn }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10);
    const e911Gaps = [];
    for (const a of accounts) {
      const [addr, ack] = await Promise.all([repo.getE911Address(a.id), repo.getLatestE911Ack(a.ownerUserId)]);
      if (!addr || !ack) e911Gaps.push({ accountId: a.id, ownerUserId: a.ownerUserId, missingAddress: !addr, missingAck: !ack });
    }
    const held = await repo.listNumbersInStates([...HELD_STATES] as NumberState[]);
    const byArea = new Map<string, number>();
    for (const n of held) {
      const m = /^\+1(\d{3})/.exec(n.e164);
      const area = m?.[1] ?? "other";
      byArea.set(area, (byArea.get(area) ?? 0) + 1);
    }
    const numberInventory = [...byArea.entries()]
      .map(([areaCode, count]) => ({ areaCode, count }))
      .sort((a, b) => b.count - a.count);
    return { period, accounts: rows, topTalkers, e911Gaps, numberInventory, page: { limit: q.limit, offset: q.offset } };
  });

  // ------------------------------------------------------------------ revenue
  app.get("/v1/admin/revenue", admin, async (_req, reply) => {
    void reply.header("cache-control", "no-store");
    const { repo } = deps;
    const now = deps.now();
    const subs = await repo.listSubscriptionsByStatus(["active", "trialing", "past_due", "incomplete"]);
    const byPlanSource = new Map<string, number>();
    let mrrCents = 0;
    const trials = [];
    const dunning = [];
    for (const s of subs) {
      const key = `${s.kind}:${s.code}:${s.source}`;
      byPlanSource.set(key, (byPlanSource.get(key) ?? 0) + 1);
      if (s.kind === "plan" && isLiveSubscription(s, now)) mrrCents += priceOf(s.code) * (s.quantity || 1);
      const dto = {
        id: s.id,
        telecomAccountId: s.telecomAccountId,
        kind: s.kind,
        code: s.code,
        status: s.status,
        source: s.source,
        currentPeriodEnd: s.currentPeriodEnd,
      };
      if (s.status === "trialing") trials.push(dto);
      if (s.status === "past_due" || s.status === "incomplete") dunning.push(dto);
    }
    const payable = await repo.affiliates.listPayable();
    const affiliatePayoutsPending = payable.map((c) => ({
      id: c.id,
      affiliateId: c.affiliateId,
      commissionCents: c.commissionCents,
      reversedCents: c.reversedCents,
      status: c.status,
      payableAt: c.payableAt,
    }));
    const pointsLiability = await repo.points.totalLiability();
    return {
      mrrCents,
      byPlanSource: [...byPlanSource.entries()].map(([key, count]) => {
        const [kind, plan, source] = key.split(":");
        return { kind, plan, source, count };
      }),
      trials,
      dunning,
      affiliatePayoutsPending,
      pointsLiability,
    };
  });

  // ------------------------------------------------------------------ fraud
  const FraudQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
  app.get("/v1/admin/fraud", admin, async (req, reply) => {
    const q = parse(FraudQuery, req.query);
    void reply.header("cache-control", "no-store");
    const events = await deps.repo.listRecentFraudEvents(q.limit);
    const byRule: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    for (const e of events) {
      byRule[e.rule] = (byRule[e.rule] ?? 0) + 1;
      byAction[e.action] = (byAction[e.action] ?? 0) + 1;
    }
    return {
      events: events.map((e) => ({
        id: e.id,
        telecomAccountId: e.telecomAccountId,
        rule: e.rule,
        score: e.score,
        action: e.action,
        at: e.at,
      })),
      byRule,
      byAction,
      // Twilio Verify OTP attempts are never persisted server-side (external
      // service; the local rate limiter is in-memory only), so no OTP failure
      // rate can be reported from the database.
      otpFailureRate: null,
    };
  });

  // ------------------------------------------------------------------ support queue
  const SupportQuery = z.object({
    userId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });
  app.get("/v1/admin/support-queue", admin, async (req, reply) => {
    const q = parse(SupportQuery, req.query);
    void reply.header("cache-control", "no-store");
    const { repo } = deps;
    const recent = await repo.listRecentUsers(100);
    const unverifiedUsers = recent
      .filter((u) => !u.phoneVerifiedAt && u.status === "active")
      .slice(0, q.limit)
      .map((u) => ({ id: u.id, email: u.email, phoneE164: u.phoneE164, displayName: u.displayName, createdAt: u.createdAt }));
    const accounts = await repo.listAccountsPage(100, 0);
    const e911Gaps = [];
    for (const a of accounts) {
      const [addr, ack] = await Promise.all([repo.getE911Address(a.id), repo.getLatestE911Ack(a.ownerUserId)]);
      if (!addr || !ack) e911Gaps.push({ accountId: a.id, ownerUserId: a.ownerUserId, missingAddress: !addr, missingAck: !ack });
      if (e911Gaps.length >= q.limit) break;
    }
    const recentAudit = await repo.listAuditEntries({ limit: q.limit });
    const userAudit = q.userId ? await repo.listAuditEntries({ actorUserId: q.userId, limit: q.limit }) : [];
    return { unverifiedUsers, e911Gaps, recentAudit, userAudit };
  });
}
