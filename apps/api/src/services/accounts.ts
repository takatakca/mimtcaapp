import { isSubscriptionAddOn, PLANS, SUBSCRIPTION_ADD_ONS, type Feature, type PlanCode, type SubscriptionAddOnCode } from "@mimt/shared";
import type { AccountStatus, Repository, Subscription, TelecomAccount, User } from "../repo/types.js";
import { dayPeriod, monthPeriod } from "../lib/time.js";

const PLAN_RANK: PlanCode[] = ["free", "lock", "premium", "business", "business_pro"];
const LIVE_STATUSES = new Set<Subscription["status"]>(["active", "trialing", "past_due"]);

export async function ensureAccount(repo: Repository, user: User): Promise<TelecomAccount> {
  const existing = await repo.getAccountByOwner(user.id);
  if (existing) return existing;
  return repo.createAccount({
    ownerUserId: user.id,
    kind: "consumer",
    status: user.globalUserId ? "ACTIVE_MANAGED" : "ACTIVE_INDEPENDENT",
    riskTier: "new",
  });
}

/**
 * Live = active/trialing/past_due. Manual grants (referral rewards) also end at currentPeriodEnd, because no
 * webhook will ever cancel them. Stripe and store rows are left to their webhooks / receipt checks.
 */
export function isLiveSubscription(s: Subscription, now: Date = new Date()): boolean {
  if (!LIVE_STATUSES.has(s.status)) return false;
  if (s.source === "manual" && s.currentPeriodEnd && s.currentPeriodEnd.getTime() <= now.getTime()) return false;
  return true;
}

export function planFromSubscriptions(subs: Subscription[], now: Date = new Date()): PlanCode {
  let best: PlanCode = "free";
  for (const s of subs) {
    if (s.kind !== "plan" || !isLiveSubscription(s, now) || !(s.code in PLANS)) continue;
    const code = s.code as PlanCode;
    if (PLAN_RANK.indexOf(code) > PLAN_RANK.indexOf(best)) best = code;
  }
  return best;
}

/** Live subscription add-ons ("no_ads"…), sorted, without duplicates. */
export function addOnsFromSubscriptions(subs: Subscription[], now: Date = new Date()): SubscriptionAddOnCode[] {
  const codes = new Set<SubscriptionAddOnCode>();
  for (const s of subs) if (s.kind === "addon" && isSubscriptionAddOn(s.code) && isLiveSubscription(s, now)) codes.add(s.code);
  return [...codes].sort();
}

export async function getPlan(repo: Repository, accountId: string): Promise<PlanCode> {
  return planFromSubscriptions(await repo.listSubscriptions(accountId));
}

export interface AccountFeatures {
  plan: PlanCode;
  features: Set<Feature>;
  extraNumbers: number;
  /** Live subscription add-ons ("no_ads"). */
  addOns: SubscriptionAddOnCode[];
}

export async function getFeatures(repo: Repository, accountId: string): Promise<AccountFeatures> {
  const [subs, ents] = await Promise.all([repo.listSubscriptions(accountId), repo.listEntitlements(accountId)]);
  const plan = planFromSubscriptions(subs);
  const features = new Set<Feature>(PLANS[plan].features);
  const addOns = addOnsFromSubscriptions(subs);
  for (const code of addOns) for (const f of SUBSCRIPTION_ADD_ONS[code].features) features.add(f);
  let extraNumbers = 0;
  for (const e of ents) {
    // Plan features come from the live plan above: a stored "plan" row can be stale (e.g. an expired referral month).
    if (e.source === "plan") continue;
    features.add(e.feature);
    if (e.feature === "extra_number") extraNumbers += e.limit ?? 1;
  }
  return { plan, features, extraNumbers, addOns };
}

/** Rebuilds plan/add-on entitlements from subscriptions and tells TAKATAK. */
export async function recomputeEntitlements(repo: Repository, account: TelecomAccount): Promise<void> {
  const subs = await repo.listSubscriptions(account.id);
  const plan = planFromSubscriptions(subs);
  await repo.replaceEntitlements(
    account.id,
    "plan",
    PLANS[plan].features.map((feature) => ({ feature, limit: null })),
  );
  const extra = subs
    .filter((s) => s.kind === "addon" && s.code === "extra_number" && LIVE_STATUSES.has(s.status))
    .reduce((n, s) => n + s.quantity, 0);
  const addonItems: Array<{ feature: Feature; limit: number | null }> = extra ? [{ feature: "extra_number", limit: extra }] : [];
  for (const code of addOnsFromSubscriptions(subs)) {
    for (const feature of SUBSCRIPTION_ADD_ONS[code].features) if (!addonItems.some((i) => i.feature === feature)) addonItems.push({ feature, limit: null });
  }
  await repo.replaceEntitlements(account.id, "addon", addonItems);
  const { features } = await getFeatures(repo, account.id);
  const owner = await repo.getUser(account.ownerUserId);
  await repo.enqueueOutbox("entitlement.updated", {
    telecom_account_id: account.id,
    global_user_id: owner?.globalUserId ?? null,
    workspace_id: account.workspaceId,
    plan,
    features: [...features].sort(),
  });
}

export async function setAccountStatus(repo: Repository, account: TelecomAccount, status: AccountStatus, reason: string): Promise<TelecomAccount> {
  if (account.status === status) return account;
  const updated = await repo.updateAccount(account.id, { status });
  const owner = await repo.getUser(account.ownerUserId);
  await repo.enqueueOutbox("telecom_account.status_changed", {
    telecom_account_id: account.id,
    global_user_id: owner?.globalUserId ?? null,
    workspace_id: account.workspaceId,
    status,
    previous_status: account.status,
    reason,
  });
  await repo.audit({ actorUserId: null, action: "account.status_changed", targetType: "telecom_account", targetId: account.id, meta: { status, reason } });
  return updated;
}

/** Usage is written to the month row (caps) and the day row (daily spend guard). Periods are UTC. */
export const usagePeriods = (at: Date) => [monthPeriod(at), dayPeriod(at)];

export const outboundBlocked = (a: TelecomAccount) => a.status === "OUTBOUND_SUSPENDED" || a.status === "SUSPENDED" || a.status === "CLOSED";

/** Numbers that still belong to the user (quarantined/released ones do not). */
export const HELD_STATES = new Set(["active", "locked", "grace", "porting_in"]);
