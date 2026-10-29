// « MIMT Points » (docs/MIMT-POINTS.md, packages/shared/src/points.ts, supabase/migrations/0018_points.sql).
//
// Earning is never a client claim: the routes and webhooks that SEE the event call earnPoints() (missions, a referral
// that converts, a paid Stripe invoice, a verified App Store / Google Play renewal). Each event has one idempotency
// key, so a retried webhook or a double click never pays twice. Campaigns (the owner's marketing) add points at earn
// time, inside the same transaction, until their budget is spent. Daily and monthly earn caps apply to everything.
//
// Redeeming (POST /v1/points/redeem): the price is debited and the redemption recorded atomically; then the reward is
// delivered; if delivery fails the points are given back by a compensating credit. Every step is audited.
//
// Refunds and chargebacks (clawbackInvoicePoints, clawbackStorePoints): the points of the payment are taken back by a
// "clawback" debit, never below a zero balance; the shortfall is kept as `owed`, repaid first by the next points
// earned, and no redemption is possible while anything is owed.
//
// POINTS=off (pointsConfig.ts): nothing is earned or redeemed; balances and history stay readable. Clawbacks still
// apply (taking back points of a refunded payment is never a reason to wait).
import {
  campaignMatches,
  MISSION_POINTS_CAP,
  POINTS_PER_DOLLAR,
  REFERRAL_POINTS,
  adFreeFor,
  type PointsCampaignDto,
  type PointsCampaignAdminDto,
  type PointsEarnEvent,
  type PointsEarnedDto,
  type PointsEntryDto,
  type PointsCatalogResponse,
  type PointsRedeemResponse,
  type PointsResponse,
  type PointsReward,
  type PointsRewardDto,
} from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { conflict, forbidden, HttpError, notFound } from "../lib/errors.js";
import { addDays, dayPeriod, monthPeriod } from "../lib/time.js";
import type { MissionRewardRow } from "../repo/missions.js";
import type { PointsCampaignRow, PointsClawbackResult, PointsEarnEntry, PointsLedgerRow } from "../repo/points.js";
import { creditedPoints } from "../repo/points.js";
import type { Subscription, TelecomAccount, User } from "../repo/types.js";
import { planOf } from "../plansConfig.js";
import { addOnsFromSubscriptions, isLiveSubscription, planFromSubscriptions, recomputeEntitlements, trialingOnly, usagePeriods } from "./accounts.js";
import { freeTierSpendCad } from "./freeTier.js";

type Log = { warn: (obj: object, msg: string) => void; error?: (obj: object, msg: string) => void };

const BLOCKED_ACCOUNT = new Set(["CLOSED", "SUSPENDED"]);
/** USD per app-leg minute (Twilio Voice SDK): the free tier's cost of one bonus app-to-app minute. */
const APP_LEG_USD_PER_MIN = 0.004;

const startOfDay = (d: Date) => new Date(`${dayPeriod(d)}T00:00:00.000Z`);
const startOfMonth = (d: Date) => new Date(`${monthPeriod(d)}-01T00:00:00.000Z`);

export const pointsEnabled = (deps: AppDeps) => deps.config.points.enabled;

// ------------------------------------------------------------------------------------------- earning

export interface EarnPointsInput {
  account: TelecomAccount;
  event: PointsEarnEvent;
  /** Base points of the event (≥ 0). 0 still lets a bonus campaign targeting the event pay. */
  points: number;
  /** One key per event, forever: "invoice:in_…", "mission:<account>:<id>", "referral:<id>", "store:ios:<tx>". */
  key: string;
  log?: Log;
}

/** Ledger entries for an event: its base points and every matching live campaign. */
export function earnEntries(input: { account: TelecomAccount; event: PointsEarnEvent; points: number; key: string }, campaigns: PointsCampaignRow[]): PointsEarnEntry[] {
  const reference = input.event.reason === "mission" ? `mission:${input.event.action}` : input.event.action;
  const base = Math.max(0, Math.floor(input.points));
  const entries: PointsEarnEntry[] = [];
  if (base > 0) {
    entries.push({ reason: input.event.reason, points: base, idempotencyKey: input.key, reference, meta: input.event.interval ? { interval: input.event.interval } : {} });
  }
  for (const c of campaigns) {
    if (!campaignMatches(c.target, input.event)) continue;
    if (c.kind === "multiplier" && c.multiplier && base > 0) {
      const extra = Math.floor(base * (c.multiplier - 1));
      if (extra > 0) entries.push({ reason: "campaign", points: extra, idempotencyKey: `${input.key}:c:${c.id}`, reference, campaignId: c.id, meta: { multiplier: c.multiplier } });
    } else if (c.kind === "bonus" && c.bonusPoints) {
      // A fixed bonus is paid once per account and campaign, whatever the number of matching events.
      // meta.trigger: the event that paid it, so a refund of that payment takes the bonus back too.
      entries.push({ reason: "campaign", points: c.bonusPoints, idempotencyKey: `campaign:${c.id}:${input.account.id}`, reference, campaignId: c.id, meta: { bonus: true, trigger: input.key } });
    }
  }
  return entries;
}

/**
 * Credits an event's points (and its campaigns). Returns what was credited, or null when nothing was (switched
 * off, closed account, already credited, error). Never throws: an error is logged and the triggering route goes on.
 */
export async function earnPoints(deps: AppDeps, input: EarnPointsInput): Promise<PointsEarnedDto | null> {
  if (!pointsEnabled(deps) || BLOCKED_ACCOUNT.has(input.account.status)) return null;
  try {
    const now = deps.now();
    const campaigns = await deps.repo.points.activeCampaigns(now);
    const entries = earnEntries(input, campaigns);
    if (!entries.length) return null;
    const { config } = deps;
    const result = await deps.repo.points.earn({
      telecomAccountId: input.account.id,
      at: now,
      entries,
      caps: { daily: config.points.dailyEarnCap, monthly: config.points.monthlyEarnCap, dayStart: startOfDay(now), monthStart: startOfMonth(now) },
    });
    if (!result.written.length) return null;
    const points = creditedPoints(result);
    // No personal data: internal ids, the event and the amounts.
    await deps.repo.audit({
      actorUserId: null,
      action: "points.earned",
      targetType: "telecom_account",
      targetId: input.account.id,
      meta: {
        event: `${input.event.reason}:${input.event.action}`,
        points,
        requested: entries.filter((e) => result.written.some((w) => w.idempotencyKey === e.idempotencyKey)).reduce((s, e) => s + e.points, 0),
        campaigns: result.written.filter((w) => w.campaignId).map((w) => ({ id: w.campaignId, points: w.delta })),
        ...(result.repaid ? { repaidOwed: result.repaid } : {}),
        balance: result.balance,
      },
      at: now,
    });
    return points > 0 ? { points, balance: result.balance } : null;
  } catch (err) {
    input.log?.warn({ err: { message: (err as Error).message }, event: input.event.reason, key: input.key.split(":")[0] }, "points earn failed");
    return null;
  }
}

export const missionPointsKey = (accountId: string, missionId: string) => `mission:${accountId}:${missionId}`;

/**
 * Credits the points of mission rewards that have none in the ledger yet (just granted, granted while POINTS was
 * off, or a crash between the two writes). Idempotent: each mission has one key per account.
 */
export async function settleMissionPoints(deps: AppDeps, account: TelecomAccount, rows: MissionRewardRow[], log?: Log): Promise<PointsEarnedDto | null> {
  if (!pointsEnabled(deps)) return null;
  const owed = rows.filter((r) => r.status === "granted");
  if (!owed.length) return null;
  try {
    const used = await deps.repo.points.usedKeys(owed.map((r) => missionPointsKey(account.id, r.missionId)));
    let last: PointsEarnedDto | null = null;
    let total = 0;
    for (const r of owed) {
      const key = missionPointsKey(account.id, r.missionId);
      if (used.has(key)) continue;
      const earned = await earnPoints(deps, { account, event: { reason: "mission", action: r.missionId }, points: r.points ?? 0, key, log });
      if (earned) {
        total += earned.points;
        last = earned;
      }
    }
    return last ? { points: total, balance: last.balance } : null;
  } catch (err) {
    log?.warn({ err: { message: (err as Error).message } }, "mission points settle failed");
    return null;
  }
}

/** Referrer's points when the referred friend's first paid invoice clears (services/referrals.ts). */
export const earnReferralPoints = (deps: AppDeps, referrer: TelecomAccount, referralId: string, log?: Log) =>
  earnPoints(deps, { account: referrer, event: { reason: "referral", action: "referral" }, points: REFERRAL_POINTS, key: `referral:${referralId}`, log });

const TAX_LINE = /\b(TPS|GST|TVQ|QST)\b|9-1-1/;

/**
 * Amount of a paid Stripe invoice before taxes, CAD cents. MIMT bills GST, QST and the Quebec 9-1-1 tax as their own
 * lines (billing/taxes.ts), so the paid amount is prorated on the non-tax lines; a customer-balance credit (referral
 * month, points credit) lowers amount_paid and therefore the points. Without lines: the GST + QST rate.
 */
export function invoicePreTaxCents(inv: { amount_paid?: number | null; total?: number | null; lines?: { data?: Array<{ amount?: number | null; description?: string | null }> } | null }): number {
  const paid = Math.max(0, inv.amount_paid ?? 0);
  if (!paid) return 0;
  const lines = inv.lines?.data ?? [];
  const total = inv.total ?? 0;
  if (lines.length && total > 0) {
    const nonTax = lines.filter((l) => !TAX_LINE.test(l.description ?? "")).reduce((s, l) => s + Math.max(0, l.amount ?? 0), 0);
    return Math.min(paid, Math.floor((paid * nonTax) / total));
  }
  return Math.floor(paid / 1.14975);
}

/** Points for a paid Stripe invoice (routes/billing.ts invoice.paid). Key: the invoice id. */
export function earnInvoicePoints(deps: AppDeps, account: TelecomAccount, invoice: Parameters<typeof invoicePreTaxCents>[0] & { id?: string | null }, interval: "month" | "year" | undefined, log?: Log) {
  if (!invoice.id) return Promise.resolve(null);
  const cents = invoicePreTaxCents(invoice);
  return earnPoints(deps, { account, event: { reason: "purchase", action: "invoice", ...(interval ? { interval } : {}) }, points: Math.floor((cents * POINTS_PER_DOLLAR) / 100), key: `invoice:${invoice.id}`, log });
}

/** Points for a verified App Store / Google Play period (routes/billing.ts). Price: MIMT's own list price of the SKU. */
export function earnStorePoints(deps: AppDeps, account: TelecomAccount, input: { key: string; priceCents: number; interval: "month" | "year" }, log?: Log) {
  return earnPoints(deps, { account, event: { reason: "purchase", action: "store", interval: input.interval }, points: Math.floor((input.priceCents * POINTS_PER_DOLLAR) / 100), key: input.key, log });
}

// ------------------------------------------------------------------------------------------- clawback

export interface ClawbackInput {
  accountId: string;
  /** Earn key of the payment ("invoice:<id>", "store:ios:<transactionId>", "store:android:<token>:<period end>"). */
  source: string;
  /** refund: share = refunded / amount (cumulative, as Stripe reports it); chargeback: everything. */
  reason: "refund" | "chargeback";
  share: { num: number; den: number };
  key: string;
  reference: "clawback:invoice" | "clawback:store";
  log?: Log;
}

/**
 * Takes back the points of a refunded or charged-back payment (repo clawback: balance never negative, shortfall
 * kept as owed). Idempotent by key. Audited with internal ids only (account, ledger row). Never throws: the webhook
 * goes on and the error is logged.
 */
export async function clawbackPoints(deps: AppDeps, input: ClawbackInput): Promise<PointsClawbackResult | null> {
  try {
    const now = deps.now();
    const result = await deps.repo.points.clawback({
      telecomAccountId: input.accountId,
      at: now,
      source: input.source,
      share: input.share,
      idempotencyKey: input.key,
      reference: input.reference,
      meta: { reason: input.reason },
    });
    if (result.status === "applied" && result.points > 0) {
      await deps.repo.audit({
        actorUserId: null,
        action: "points.clawed_back",
        targetType: "telecom_account",
        targetId: input.accountId,
        meta: {
          ledgerEntryId: result.row?.id ?? null,
          kind: input.reference === "clawback:invoice" ? "invoice" : "store",
          reason: input.reason,
          points: result.points,
          debited: result.debited,
          owedAdded: result.owedAdded,
          owed: result.owed,
          balance: result.balance,
        },
        at: now,
      });
    }
    return result;
  } catch (err) {
    input.log?.warn({ err: { message: (err as Error).message }, kind: input.reference, reason: input.reason }, "points clawback failed");
    return null;
  }
}

/**
 * Stripe charge.refunded (share = amount_refunded / amount, cumulative) or charge.dispute.created (everything) on the
 * invoice that earned points. Keys: "clawback:<invoice>:<refunded cents>" and "clawback:<invoice>:dispute", so a
 * replayed webhook changes nothing and a second partial refund only takes the difference.
 */
export async function clawbackInvoicePoints(
  deps: AppDeps,
  input: { invoiceId: string; reason: "refund" | "chargeback"; refundedCents?: number; amountCents?: number },
  log?: Log,
): Promise<PointsClawbackResult | null> {
  const source = `invoice:${input.invoiceId}`;
  const accountId = await deps.repo.points.accountOfKey(source);
  if (!accountId) return null;
  const partial = input.reason === "refund" && input.amountCents && input.amountCents > 0 && input.refundedCents !== undefined;
  const share = partial ? { num: Math.max(0, input.refundedCents!), den: input.amountCents! } : { num: 1, den: 1 };
  const key = input.reason === "refund" ? `clawback:${input.invoiceId}:${partial ? input.refundedCents : "full"}` : `clawback:${input.invoiceId}:dispute`;
  return clawbackPoints(deps, { accountId, source, reason: input.reason, share, key, reference: "clawback:invoice", log });
}

/**
 * App Store REFUND (the refunded transaction's own points key) or Google Play voided purchase (the newest paid
 * period of that purchase token: Play's notification does not say which renewal, and a refund is almost always the
 * latest one). Everything that period earned is taken back.
 */
export async function clawbackStorePoints(
  deps: AppDeps,
  input: { platform: "ios"; transactionId: string } | { platform: "android"; accountId: string; transactionId: string },
  log?: Log,
): Promise<PointsClawbackResult | null> {
  const source =
    input.platform === "ios"
      ? `store:ios:${input.transactionId}`
      : await deps.repo.points.latestPurchaseKey(input.accountId, `store:android:${input.transactionId}:`);
  // The account that earned the points (the ledger row of that period).
  const accountId = source ? await deps.repo.points.accountOfKey(source) : null;
  if (!source || !accountId) return null;
  return clawbackPoints(deps, { accountId, source, reason: "refund", share: { num: 1, den: 1 }, key: `clawback:${source}`, reference: "clawback:store", log });
}

// ------------------------------------------------------------------------------------------- reading

const campaignDto = (c: PointsCampaignRow): PointsCampaignDto => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  target: c.target,
  multiplier: c.multiplier,
  bonusPoints: c.bonusPoints,
  startsAt: c.startsAt.toISOString(),
  endsAt: c.endsAt.toISOString(),
});

export const campaignAdminDto = (c: PointsCampaignRow): PointsCampaignAdminDto => ({
  ...campaignDto(c),
  budgetPoints: c.budgetPoints,
  spentPoints: c.spentPoints,
  active: c.active,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const entryDto = (l: PointsLedgerRow): PointsEntryDto => ({
  id: l.id,
  delta: l.delta,
  reason: l.reason,
  label: l.reference,
  campaignName: l.campaignName ?? null,
  balanceAfter: l.balanceAfter,
  createdAt: l.createdAt.toISOString(),
});

/** GET /v1/points. Settles mission points still owed first (self-healing, idempotent). */
export async function pointsView(deps: AppDeps, account: TelecomAccount, log?: Log): Promise<PointsResponse> {
  const now = deps.now();
  await settleMissionPoints(deps, account, await deps.repo.missions.listForAccount(account.id), log);
  const [acct, ledger, campaigns] = await Promise.all([deps.repo.points.getAccount(account.id), deps.repo.points.listLedger(account.id, 30), deps.repo.points.activeCampaigns(now)]);
  const { points } = deps.config;
  return {
    enabled: points.enabled,
    balance: acct?.balance ?? 0,
    lifetimeEarned: acct?.lifetimeEarned ?? 0,
    owed: acct?.owed ?? 0,
    history: ledger.map(entryDto),
    campaigns: points.enabled ? campaigns.map(campaignDto) : [],
    rules: {
      pointsPerDollar: POINTS_PER_DOLLAR,
      referralPoints: REFERRAL_POINTS,
      missionPointsCap: MISSION_POINTS_CAP,
      dailyEarnCap: points.dailyEarnCap,
      monthlyEarnCap: points.monthlyEarnCap,
      expiryMonths: points.expiry.enabled ? points.expiry.months : null,
    },
  };
}

interface Standing {
  plan: ReturnType<typeof planFromSubscriptions>;
  subs: Subscription[];
  trialing: boolean;
  /** A live plan billed by Stripe (not a trial), with a Stripe customer: invoice credits land on its next bill. */
  stripePaying: boolean;
  /** Ad-free by its plan or a bought "Sans pub" add-on (a points week does not count: it can be extended). */
  adFreeOtherwise: boolean;
}

async function standing(deps: AppDeps, account: TelecomAccount, now: Date): Promise<Standing> {
  const subs = await deps.repo.listSubscriptions(account.id);
  const plan = planFromSubscriptions(subs, now);
  const notPoints = subs.filter((s) => !s.stripeSubscriptionId?.startsWith("points:"));
  return {
    plan,
    subs,
    trialing: plan !== "free" && trialingOnly(subs, plan),
    stripePaying: Boolean(account.stripeCustomerId) && subs.some((s) => s.kind === "plan" && s.source === "stripe" && s.status !== "trialing" && isLiveSubscription(s, now)),
    adFreeOtherwise: adFreeFor(plan, addOnsFromSubscriptions(notPoints, now)),
  };
}

function eligible(r: PointsReward, s: Standing, deps: AppDeps): boolean {
  switch (r.eligibility) {
    case "paid":
      return s.plan !== "free" && !s.trialing;
    case "free":
      return s.plan === "free";
    case "stripe_paid":
      return s.stripePaying && Boolean(deps.billing?.creditBalance);
    case "not_ad_free":
      return !s.adFreeOtherwise;
  }
}

/** GET /v1/points/catalog: every enabled reward, with whether this account can take it now. */
export async function catalogView(deps: AppDeps, account: TelecomAccount): Promise<PointsCatalogResponse> {
  const now = deps.now();
  const [acct, used, s] = await Promise.all([deps.repo.points.getAccount(account.id), deps.repo.points.countRedemptions(account.id, startOfMonth(now)), standing(deps, account, now)]);
  const balance = acct?.balance ?? 0;
  const enabled = pointsEnabled(deps);
  const rewards: PointsRewardDto[] = deps.config.points.catalog
    .filter((r) => r.enabled)
    .map(({ enabled: _enabled, ...r }) => {
      const usedThisMonth = used[r.id] ?? 0;
      const reason = !enabled
        ? "paused"
        : !eligible({ ...r, enabled: true }, s, deps)
          ? "plan"
          : usedThisMonth >= r.monthlyLimit
            ? "monthly_limit"
            : balance < r.points
              ? "balance"
              : null;
      return { ...r, available: reason === null, unavailableReason: reason, usedThisMonth };
    });
  return { enabled, balance, rewards };
}

// ------------------------------------------------------------------------------------------- redeeming

/** True when `minutes` more app-to-app minutes stay within the free tier's monthly budget. */
async function freeBudgetAllows(deps: AppDeps, minutes: number, now: Date): Promise<boolean> {
  const cost = minutes * APP_LEG_USD_PER_MIN * deps.config.USD_TO_CAD;
  return (await freeTierSpendCad(deps, now)) + cost <= deps.config.FREE_TIER_MONTHLY_BUDGET_CAD;
}

/** Delivers a reward. Returns a reference of what was done (no personal data) and, for ad-free days, the end. */
async function fulfil(deps: AppDeps, account: TelecomAccount, r: PointsReward, redemptionId: string, s: Standing, now: Date): Promise<{ ref: string; until?: Date }> {
  const periods = usagePeriods(now);
  switch (r.kind) {
    case "bonus_minutes_out":
      await deps.repo.addUsage(account.id, periods, { bonusMinutesOut: r.quantity });
      return { ref: `usage:${periods[0]}` };
    case "bonus_minutes_on_net":
      await deps.repo.addUsage(account.id, periods, { bonusMinutesOnNet: r.quantity });
      return { ref: `usage:${periods[0]}` };
    case "bonus_messages":
      await deps.repo.addUsage(account.id, periods, { bonusMessages: r.quantity });
      return { ref: `usage:${periods[0]}` };
    case "ad_free_days": {
      // A "Sans pub" grant with an end date (same model as the referral month: a manual row, ignored once past its
      // end). Stacked after a points week still running.
      const runningEnd = s.subs
        .filter((x) => x.source === "manual" && x.stripeSubscriptionId?.startsWith("points:") && isLiveSubscription(x, now) && x.currentPeriodEnd)
        .reduce((max, x) => Math.max(max, x.currentPeriodEnd!.getTime()), now.getTime());
      const until = addDays(new Date(runningEnd), r.quantity);
      await deps.repo.upsertSubscription({
        telecomAccountId: account.id,
        kind: "addon",
        code: "no_ads",
        quantity: 1,
        stripeSubscriptionId: `points:${redemptionId}`,
        status: "active",
        source: "manual",
        currentPeriodEnd: until,
      });
      await recomputeEntitlements(deps.repo, account);
      return { ref: `no_ads:${until.toISOString().slice(0, 10)}`, until };
    }
    case "invoice_credit": {
      if (!deps.billing?.creditBalance || !account.stripeCustomerId) throw new Error("billing_not_configured");
      await deps.billing.creditBalance({
        customerId: account.stripeCustomerId,
        amountCents: r.quantity,
        description: `Points MIMT : crédit de ${(r.quantity / 100).toFixed(2).replace(".", ",")} $ / MIMT Points credit`,
        idempotencyKey: `points:${redemptionId}`,
      });
      return { ref: `stripe_credit:${r.quantity}` };
    }
  }
}

export interface RedeemInput {
  account: TelecomAccount;
  user: User;
  rewardId: string;
  clientKey: string;
  ip?: string | null;
  log?: Log;
}

/** POST /v1/points/redeem. Throws HttpError for every refusal; nothing is debited when it throws before step 3. */
export async function redeemReward(deps: AppDeps, input: RedeemInput): Promise<PointsRedeemResponse> {
  const { account, user } = input;
  if (!pointsEnabled(deps)) throw conflict("points_paused", "Les Points MIMT sont en pause. Votre solde est conservé.");
  if (BLOCKED_ACCOUNT.has(account.status)) throw forbidden("account_blocked", "Ce compte ne peut pas échanger de points.");
  const reward = deps.config.points.catalog.find((r) => r.id === input.rewardId && r.enabled);
  if (!reward) throw notFound("unknown_reward", "Cette récompense n'existe pas.");
  const now = deps.now();
  const s = await standing(deps, account, now);
  if (!eligible(reward, s, deps)) throw conflict("not_eligible", "Cette récompense n'est pas offerte avec votre forfait.");
  // Free-plan fulfilments respect the free tier's monthly budget (services/freeTier.ts).
  if (reward.kind === "bonus_minutes_on_net" && !(await freeBudgetAllows(deps, reward.quantity, now))) {
    throw conflict("free_budget_reached", "La réserve du forfait Gratuit est pleine ce mois-ci. Réessayez le mois prochain : vos points restent à vous.");
  }
  let monthlyLimit = reward.monthlyLimit;
  if (reward.kind === "invoice_credit") monthlyLimit = Math.min(monthlyLimit, Math.floor(deps.config.points.invoiceCreditMaxCentsPerMonth / reward.quantity));

  // 1. Atomic debit + pending redemption (balance lock, idempotency key, monthly limit).
  const result = await deps.repo.points.redeem({
    telecomAccountId: account.id,
    at: now,
    clientKey: input.clientKey,
    rewardId: reward.id,
    points: reward.points,
    monthlyLimit,
    monthStart: startOfMonth(now),
  });
  if (result.status === "insufficient") throw conflict("insufficient_points", "Vous n'avez pas assez de points pour cette récompense.");
  if (result.status === "owed") {
    throw conflict("points_owed", `Un paiement a été remboursé : ${result.owed} points sont dus et seront repris sur vos prochains gains. Les échanges reprendront ensuite.`);
  }
  if (result.status === "monthly_limit") throw conflict("monthly_limit", "Vous avez atteint la limite de cette récompense pour ce mois-ci.");
  if (result.status === "replay") {
    const r = result.redemption;
    if (r.rewardId !== reward.id) throw conflict("idempotency_conflict", "Cette clé a déjà servi pour une autre récompense.");
    if (r.status === "pending") throw conflict("redemption_in_progress", "Cet échange est en cours.");
    if (r.status === "refunded") throw conflict("redemption_failed", "Cet échange a échoué; vos points ont été remis.");
    return { redemptionId: r.id, rewardId: reward.id, status: "fulfilled", points: r.points, balance: result.balance, replay: true };
  }
  const redemption = result.redemption;
  await deps.repo.audit({
    actorUserId: user.id,
    action: "points.redeemed",
    targetType: "telecom_account",
    targetId: account.id,
    ip: input.ip ?? null,
    meta: { redemptionId: redemption.id, reward: reward.id, points: reward.points, balance: result.balance },
    at: now,
  });

  // 2. Delivery; 3. on failure, compensating credit (the points come back).
  let done: { ref: string; until?: Date };
  try {
    done = await fulfil(deps, account, reward, redemption.id, s, now);
  } catch (err) {
    const message = (err as Error).message.slice(0, 200);
    input.log?.warn({ err: { message }, reward: reward.id, redemption: redemption.id }, "points fulfilment failed, refunding");
    await deps.repo.points.refundRedemption(redemption.id, message, deps.now());
    await deps.repo.audit({
      actorUserId: null,
      action: "points.refunded",
      targetType: "telecom_account",
      targetId: account.id,
      meta: { redemptionId: redemption.id, reward: reward.id, points: reward.points, error: message },
    });
    throw new HttpError(502, "fulfilment_failed", `La récompense n'a pas pu être livrée; vos ${reward.points} points ont été remis.`);
  }
  await deps.repo.points.finishRedemption(redemption.id, done.ref, deps.now());
  await deps.repo.audit({
    actorUserId: null,
    action: "points.fulfilled",
    targetType: "telecom_account",
    targetId: account.id,
    meta: { redemptionId: redemption.id, reward: reward.id, ref: done.ref },
  });
  return {
    redemptionId: redemption.id,
    rewardId: reward.id,
    status: "fulfilled",
    points: reward.points,
    balance: result.balance,
    ...(done.until ? { until: done.until.toISOString() } : {}),
    replay: false,
  };
}

/** Plan price of a store SKU period, CAD cents (MIMT's list price; the store's commission is MIMT's cost). */
export function storePeriodPriceCents(kind: "plan" | "addon", code: string, interval: "month" | "year", addOnPrices: { monthlyPriceCents: number; yearlyPriceCents: number } | null): number {
  if (kind === "addon") return addOnPrices ? (interval === "year" ? addOnPrices.yearlyPriceCents : addOnPrices.monthlyPriceCents) : 0;
  const plan = planOf(code as Parameters<typeof planOf>[0]);
  if (!plan) return 0;
  return interval === "year" ? (plan.yearlyPriceCents ?? plan.monthlyPriceCents * 12) : plan.monthlyPriceCents;
}
