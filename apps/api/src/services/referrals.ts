// Referral program (docs/MIMT-PARITY.md §3, P1 item 3).
// - Every user gets a code (GET /v1/referrals). A new user redeems a friend's code at signup or on the
//   first checkout, before any paid plan and within REDEEM_WINDOW_DAYS of account creation.
// - When the referee's first paid plan invoice is paid (Stripe invoice.paid), both get one month of Premium.
// - Anti-fraud: no self-referral; the same attested device or the same card on both sides (or on two
//   referees of the same referrer) settles the referral as "rejected" with no reward.
import { planOf } from "../plansConfig.js";
import { createHash, randomInt } from "node:crypto";
import type { PlanCode, ReferralDto, ReferralRejectReason } from "@mimt/shared";
import type { AppDeps } from "../deps.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { addDays, daysBetween } from "../lib/time.js";
import type { ReferralRow } from "../repo/referrals.js";
import type { Subscription, TelecomAccount, User } from "../repo/types.js";
import { isLiveSubscription, planFromSubscriptions, recomputeEntitlements } from "./accounts.js";

export const REFERRAL_REWARD = { months: 1, days: 30, plan: "premium" as const satisfies PlanCode };
export const REDEEM_WINDOW_DAYS = 30;

/** No 0/O/1/I: codes are read aloud and typed by hand. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE = /^[A-Z0-9]{6,12}$/;
const PLAN_RANK: PlanCode[] = ["free", "lock", "premium", "business", "business_pro"];

export const hashDeviceKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function normalizeReferralCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  return CODE.test(code) ? code : null;
}

export function referralDto(r: ReferralRow): ReferralDto {
  return {
    id: r.id,
    status: r.status,
    rejectReason: r.rejectReason,
    createdAt: r.createdAt.toISOString(),
    rewardedAt: r.rewardedAt?.toISOString() ?? null,
  };
}

export async function ensureReferralCode(deps: AppDeps, userId: string): Promise<string> {
  const existing = await deps.repo.referrals.getCodeForUser(userId);
  if (existing) return existing.code;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    const row = await deps.repo.referrals.createCode(userId, code);
    if (row) return row.code;
    const mine = await deps.repo.referrals.getCodeForUser(userId);
    if (mine) return mine.code; // concurrent first call
  }
  throw new Error("could not allocate a referral code");
}

const PAID_SOURCES = new Set<Subscription["source"]>(["stripe", "iap_apple", "iap_google"]);

/** Same device: a device key of the referee is attested to the referrer, or already used by another referee of theirs. */
async function sharesDevice(deps: AppDeps, referrerUserId: string, refereeUserId: string, keys: string[], referralId?: string): Promise<boolean> {
  if (!keys.length) return false;
  const hashes = new Set(keys.map(hashDeviceKey));
  for (const key of keys) {
    if ((await deps.repo.referrals.findDeviceUsers(key)).includes(referrerUserId)) return true;
  }
  const referrerKeys = await deps.repo.referrals.listDeviceKeys(referrerUserId);
  if (referrerKeys.some((k) => hashes.has(hashDeviceKey(k)))) return true;
  const siblings = await deps.repo.referrals.listReferralsByReferrer(referrerUserId);
  return siblings.some((r) => r.id !== referralId && r.refereeUserId !== refereeUserId && r.deviceKeyHash !== null && hashes.has(r.deviceKeyHash));
}

/** Redeems a friend's code for this (new) user. Throws an HttpError with a stable code on refusal. */
export async function redeemReferral(
  deps: AppDeps,
  input: { user: User; account: TelecomAccount; code: string; deviceKey?: string },
): Promise<ReferralRow> {
  const { repo } = deps;
  const code = normalizeReferralCode(input.code);
  if (!code) throw badRequest("invalid_referral_code", "Ce code de parrainage n'est pas valide.");
  const owner = await repo.referrals.findCode(code);
  if (!owner) throw notFound("referral_code_not_found", "Ce code de parrainage n'existe pas.");
  if (owner.userId === input.user.id) throw forbidden("self_referral", "Vous ne pouvez pas utiliser votre propre code.");
  if (await repo.referrals.getReferralForReferee(input.user.id)) throw conflict("already_referred", "Un code de parrainage est déjà lié à ce compte.");
  if (daysBetween(input.account.createdAt, deps.now()) > REDEEM_WINDOW_DAYS) {
    throw conflict("referral_window_closed", "Le code doit être utilisé dans les 30 jours suivant l'inscription.");
  }
  const subs = await repo.listSubscriptions(input.account.id);
  if (subs.some((s) => s.kind === "plan" && PAID_SOURCES.has(s.source))) {
    throw conflict("referral_after_purchase", "Le code doit être utilisé avant le premier forfait payant.");
  }
  const keys = [...new Set([...(input.deviceKey ? [input.deviceKey] : []), ...(await repo.referrals.listDeviceKeys(input.user.id))])];
  if (await sharesDevice(deps, owner.userId, input.user.id, keys)) {
    await repo.addFraudEvent({ telecomAccountId: input.account.id, rule: "referral_same_device", score: 50, action: "block", details: { code } });
    throw forbidden("same_device", "Ce code ne peut pas être utilisé sur cet appareil.");
  }
  const row = await repo.referrals.createReferral({
    code,
    referrerUserId: owner.userId,
    refereeUserId: input.user.id,
    deviceKeyHash: input.deviceKey ? hashDeviceKey(input.deviceKey) : null,
  });
  if (!row) throw conflict("already_referred", "Un code de parrainage est déjà lié à ce compte.");
  await repo.audit({ actorUserId: input.user.id, action: "referral.redeemed", targetType: "user", targetId: owner.userId, meta: { referralId: row.id } });
  return row;
}

/**
 * Called on every paid plan invoice of an account. The first one settles the account's pending referral:
 * rewarded (both get a Premium month) or rejected (same device / same card). Idempotent.
 */
export async function settleReferralOnPaidPlan(deps: AppDeps, input: { account: TelecomAccount; fingerprint: string | null }): Promise<ReferralRow["status"] | null> {
  const { repo } = deps;
  const referral = await repo.referrals.getReferralForReferee(input.account.ownerUserId);
  if (!referral || referral.status !== "pending") return null;
  const now = deps.now();
  const referrerAccount = await repo.getAccountByOwner(referral.referrerUserId);

  let reason: ReferralRejectReason | null = null;
  const refereeKeys = await repo.referrals.listDeviceKeys(referral.refereeUserId);
  const storedHash = referral.deviceKeyHash;
  if (await sharesDevice(deps, referral.referrerUserId, referral.refereeUserId, refereeKeys, referral.id)) reason = "same_device";
  else if (storedHash && (await repo.referrals.listDeviceKeys(referral.referrerUserId)).some((k) => hashDeviceKey(k) === storedHash)) reason = "same_device";
  if (!reason && input.fingerprint) {
    const referrerCards = referrerAccount ? await repo.referrals.listPaymentFingerprints(referrerAccount.id) : [];
    const siblings = await repo.referrals.listReferralsByReferrer(referral.referrerUserId);
    if (referrerCards.includes(input.fingerprint) || siblings.some((r) => r.id !== referral.id && r.refereePaymentFingerprint === input.fingerprint)) {
      reason = "same_payment";
    }
  }

  const settled = await repo.referrals.settleReferral(referral.id, {
    status: reason ? "rejected" : "rewarded",
    rejectReason: reason,
    refereePaymentFingerprint: input.fingerprint,
    at: now,
  });
  if (!settled) return null;
  if (reason) {
    await repo.addFraudEvent({ telecomAccountId: input.account.id, rule: `referral_${reason}`, score: 50, action: "block", details: { referralId: referral.id } });
    await repo.audit({ actorUserId: null, action: "referral.rejected", targetType: "user", targetId: referral.refereeUserId, meta: { referralId: referral.id, reason } });
    return "rejected";
  }
  await grantPremiumMonth(deps, input.account, `referral:${referral.id}:referee`);
  if (referrerAccount && referrerAccount.status !== "CLOSED" && referrerAccount.status !== "SUSPENDED") {
    await grantPremiumMonth(deps, referrerAccount, `referral:${referral.id}:referrer`);
  }
  await repo.audit({ actorUserId: null, action: "referral.rewarded", targetType: "user", targetId: referral.refereeUserId, meta: { referralId: referral.id } });
  return "rewarded";
}

/**
 * One month of Premium. Accounts already paying Premium or more through Stripe get the month as a Stripe
 * balance credit (their next invoice); everyone else gets a 30-day Premium grant, stacked after any
 * grant still running.
 */
export async function grantPremiumMonth(deps: AppDeps, account: TelecomAccount, key: string): Promise<"stripe_credit" | "premium_grant"> {
  const { repo } = deps;
  const now = deps.now();
  const subs = await repo.listSubscriptions(account.id);
  const paid = subs.filter((s) => s.kind === "plan" && s.source === "stripe" && isLiveSubscription(s, now));
  const paidPlan = planFromSubscriptions(paid, now);
  const premiumCents = planOf(REFERRAL_REWARD.plan).monthlyPriceCents;
  if (PLAN_RANK.indexOf(paidPlan) >= PLAN_RANK.indexOf(REFERRAL_REWARD.plan) && account.stripeCustomerId && deps.billing?.creditBalance) {
    await deps.billing.creditBalance({
      customerId: account.stripeCustomerId,
      amountCents: premiumCents,
      description: "Parrainage MIMT : 1 mois Premium offert / Referral: 1 free Premium month",
      idempotencyKey: key,
    });
    return "stripe_credit";
  }
  const runningEnd = subs
    .filter((s) => s.source === "manual" && s.stripeSubscriptionId?.startsWith("referral:") && isLiveSubscription(s, now) && s.currentPeriodEnd)
    .reduce((max, s) => Math.max(max, s.currentPeriodEnd!.getTime()), now.getTime());
  await repo.upsertSubscription({
    telecomAccountId: account.id,
    kind: "plan",
    code: REFERRAL_REWARD.plan,
    quantity: 1,
    stripeSubscriptionId: key,
    status: "active",
    source: "manual",
    currentPeriodEnd: addDays(new Date(runningEnd), REFERRAL_REWARD.days),
  });
  await recomputeEntitlements(repo, account);
  await deps.notifier.notify(account.ownerUserId, "referral_reward", { months: REFERRAL_REWARD.months, plan: REFERRAL_REWARD.plan });
  return "premium_grant";
}
