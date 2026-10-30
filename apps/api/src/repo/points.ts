// « MIMT Points » storage (supabase/migrations/0018_points.sql). Service and rules: src/services/points.ts.
//
// The repository owns the money-grade guarantees, in ONE transaction per call, after a row lock on the account's
// balance: idempotency keys (a key is used once, ever), balance never negative, daily/monthly earn caps, campaign
// budgets never overspent, points of a refunded payment taken back (clawback) with any shortfall kept as `owed`
// and repaid by the next credits. Memory and Postgres implementations behave the same (points.repo.contract.test.ts).
import type { PointsCampaignTarget, PointsReason } from "@mimt/shared";

export interface PointsAccountRow {
  telecomAccountId: string;
  balance: number;
  lifetimeEarned: number;
  /** Points still owed after a clawback the balance could not cover (0021_points_clawback.sql). */
  owed: number;
  lastActivityAt: Date;
}

export interface PointsLedgerRow {
  id: string;
  telecomAccountId: string;
  delta: number;
  reason: PointsReason;
  reference: string;
  campaignId: string | null;
  /** Filled by listLedger (the campaign's name), null otherwise. */
  campaignName?: string | null;
  idempotencyKey: string;
  balanceAfter: number;
  meta: Record<string, unknown>;
  createdAt: Date;
}

export interface PointsCampaignRow {
  id: string;
  name: string;
  kind: "multiplier" | "bonus";
  target: PointsCampaignTarget;
  multiplier: number | null;
  bonusPoints: number | null;
  startsAt: Date;
  endsAt: Date;
  budgetPoints: number;
  spentPoints: number;
  active: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewPointsCampaign = Omit<PointsCampaignRow, "id" | "spentPoints" | "active" | "createdAt" | "updatedAt">;
export type PointsCampaignPatch = Partial<Pick<PointsCampaignRow, "name" | "endsAt" | "budgetPoints" | "active">>;

export interface PointsRedemptionRow {
  id: string;
  telecomAccountId: string;
  rewardId: string;
  points: number;
  status: "pending" | "fulfilled" | "refunded";
  clientKey: string;
  fulfilmentRef: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PointsEarnEntry {
  reason: "mission" | "referral" | "purchase" | "campaign";
  /** Requested points (≥ 0). The credited amount may be lower: caps and campaign budget. */
  points: number;
  idempotencyKey: string;
  reference: string;
  /** reason "campaign": the campaign whose budget pays for it (locked, checked active and in its window at `at`). */
  campaignId?: string | null;
  meta?: Record<string, unknown>;
}

export interface PointsEarnInput {
  telecomAccountId: string;
  at: Date;
  entries: PointsEarnEntry[];
  /** Points earned (EARN_REASONS) since dayStart / monthStart may not pass daily / monthly. */
  caps: { daily: number; monthly: number; dayStart: Date; monthStart: Date };
}

export interface PointsEarnResult {
  /** Rows written by this call (a row with delta 0 = over a cap or budget, kept so a retry earns nothing later). */
  written: PointsLedgerRow[];
  /** Points owed taken from the balance after the credits (a "clawback" debit, key "owed:<last credit key>"). */
  repaid: number;
  /** Entries whose key was already used: nothing written for them. */
  duplicates: number;
  balance: number;
}

export interface PointsRedeemInput {
  telecomAccountId: string;
  at: Date;
  clientKey: string;
  rewardId: string;
  points: number;
  /** Most non-refunded redemptions of rewardId since monthStart. */
  monthlyLimit: number;
  monthStart: Date;
  meta?: Record<string, unknown>;
}

export type PointsRedeemResult =
  | { status: "created"; redemption: PointsRedemptionRow; balance: number }
  | { status: "replay"; redemption: PointsRedemptionRow; balance: number }
  | { status: "insufficient"; balance: number }
  | { status: "monthly_limit"; used: number }
  /** Points are owed after a refund or chargeback: no redemption until they are repaid by later earnings. */
  | { status: "owed"; owed: number; balance: number };

export interface PointsClawbackInput {
  telecomAccountId: string;
  at: Date;
  /**
   * The earn key of the payment: "invoice:<id>", "store:ios:<transactionId>", "store:android:<token>:<period end>".
   * Its points are the ledger credits with that key, its campaign extras ("<source>:c:<campaign>") and the campaign
   * bonuses it triggered (meta.trigger = source).
   */
  source: string;
  /** Share of the source's points to have taken back IN TOTAL after this call: refunded / amount, 1/1 for a chargeback. */
  share: { num: number; den: number };
  /** One key per refund state, e.g. "clawback:<invoice>:<cumulative refunded cents>" or "clawback:<invoice>:dispute". */
  idempotencyKey: string;
  /** Ledger reference (no personal data): "clawback:invoice", "clawback:store". */
  reference: string;
  meta?: Record<string, unknown>;
}

export interface PointsClawbackResult {
  /** applied: a row was written (its delta may be 0 when everything went to owed); duplicate: key already used. */
  status: "applied" | "duplicate";
  /** Points the source earned (credits) and points to take back by this call. */
  earned: number;
  points: number;
  /** Taken from the balance now (≤ balance) and added to `owed` (the rest). */
  debited: number;
  owedAdded: number;
  balance: number;
  owed: number;
  row: PointsLedgerRow | null;
}

export interface PointsRepository {
  getAccount(accountId: string): Promise<PointsAccountRow | null>;
  /** Newest first. */
  listLedger(accountId: string, limit: number): Promise<PointsLedgerRow[]>;
  /** The keys among `keys` already in the ledger. */
  usedKeys(keys: string[]): Promise<Set<string>>;
  /** Credits entries atomically (see PointsEarnInput). */
  earn(input: PointsEarnInput): Promise<PointsEarnResult>;

  /**
   * Takes back the points of a refunded or charged-back payment, atomically after the balance lock: target =
   * floor(earned × share), minus what earlier clawbacks of the same source already took. The balance is debited to
   * 0 at most and the rest goes to `owed`. Same idempotency key = duplicate, nothing written.
   */
  clawback(input: PointsClawbackInput): Promise<PointsClawbackResult>;
  /** Account of the ledger row with this idempotency key (e.g. the "invoice:<id>" credit), or null. */
  accountOfKey(key: string): Promise<string | null>;
  /** The newest credit key (reason "purchase") starting with `prefix` on this account (a Play period), or null. */
  latestPurchaseKey(accountId: string, prefix: string): Promise<string | null>;

  /** Debits the reward's price and records a pending redemption, atomically. Same clientKey = replay, no debit. */
  redeem(input: PointsRedeemInput): Promise<PointsRedeemResult>;
  /** pending → fulfilled. Null when it was not pending. */
  finishRedemption(id: string, fulfilmentRef: string | null, at: Date): Promise<PointsRedemptionRow | null>;
  /**
   * pending → refunded, with the compensating credit (reason "refund"), atomically. Points owed are then taken from
   * the balance first, as after any credit. Null when it was not pending.
   */
  refundRedemption(id: string, error: string, at: Date): Promise<{ redemption: PointsRedemptionRow; balance: number } | null>;
  /** Non-refunded redemptions per reward since `since`. */
  countRedemptions(accountId: string, since: Date): Promise<Record<string, number>>;

  createCampaign(c: NewPointsCampaign): Promise<PointsCampaignRow>;
  updateCampaign(id: string, patch: PointsCampaignPatch): Promise<PointsCampaignRow | null>;
  getCampaign(id: string): Promise<PointsCampaignRow | null>;
  listCampaigns(): Promise<PointsCampaignRow[]>;
  /** Active, in their window at `at`, budget not spent. */
  activeCampaigns(at: Date): Promise<PointsCampaignRow[]>;

  /** Accounts with a balance and no points activity since `before`. */
  listExpirable(before: Date, limit: number): Promise<PointsAccountRow[]>;
  /** Debits the whole balance (reason "expiry") if the account is still inactive since `before`. Null otherwise. */
  expire(accountId: string, before: Date, at: Date): Promise<PointsLedgerRow | null>;
  /** Sum of every points account balance: the outstanding points liability (experience dashboard). */
  totalLiability(): Promise<number>;
}

/** Points credited by an earn call (sum of written deltas; points owed that it repaid not deducted). */
export const creditedPoints = (r: PointsEarnResult) => r.written.reduce((s, w) => s + w.delta, 0);
