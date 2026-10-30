import type postgres from "postgres";
import { EARN_REASONS } from "@mimt/shared";
import type {
  NewPointsCampaign,
  PointsAccountRow,
  PointsCampaignPatch,
  PointsCampaignRow,
  PointsClawbackInput,
  PointsClawbackResult,
  PointsEarnInput,
  PointsEarnResult,
  PointsLedgerRow,
  PointsRedeemInput,
  PointsRedeemResult,
  PointsRedemptionRow,
  PointsRepository,
} from "./points.js";

type Sql = postgres.Sql<{}>;
type Tx = postgres.TransactionSql<{}>;
type Json = postgres.JSONValue;

const ACCOUNT_COLS = "telecom_account_id, balance, lifetime_earned::float8 as lifetime_earned, owed, last_activity_at";
const LEDGER_COLS = "id, telecom_account_id, delta, reason, reference, campaign_id, idempotency_key, balance_after, meta, created_at";
const CAMPAIGN_COLS =
  "id, name, kind, target, multiplier::float8 as multiplier, bonus_points, starts_at, ends_at, budget_points, spent_points, active, created_by, created_at, updated_at";
const REDEMPTION_COLS = "id, telecom_account_id, reward_id, points, status, client_key, fulfilment_ref, error, created_at, updated_at";

const first = <T>(rows: readonly unknown[]): T | null => (rows[0] as T | undefined) ?? null;

/** MIMT Points on Postgres (0018_points.sql). Every write is one transaction after `select … for update` on the balance. */
export class PostgresPointsRepository implements PointsRepository {
  constructor(private readonly sql: Sql) {}

  /** Creates the balance row if needed, then locks it for the rest of the transaction. */
  private async lock(tx: Tx, accountId: string, at: Date): Promise<PointsAccountRow> {
    await tx`insert into points_accounts (telecom_account_id, last_activity_at) values (${accountId}, ${at}) on conflict do nothing`;
    return first<PointsAccountRow>(await tx.unsafe(`select ${ACCOUNT_COLS} from points_accounts where telecom_account_id = $1 for update`, [accountId]))!;
  }

  /** Appends a ledger row and moves the balance (the CHECKs refuse a negative balance). */
  private async write(
    tx: Tx,
    accountId: string,
    row: { delta: number; reason: string; reference: string; campaignId: string | null; idempotencyKey: string; meta: Record<string, unknown>; at: Date },
  ): Promise<PointsLedgerRow> {
    const earned = row.delta > 0 && row.reason !== "refund" ? row.delta : 0;
    const [acct] = await tx`
      update points_accounts set balance = balance + ${row.delta}, lifetime_earned = lifetime_earned + ${earned}, last_activity_at = ${row.at}
      where telecom_account_id = ${accountId} returning balance`;
    const rows = await tx.unsafe(
      `insert into points_ledger (telecom_account_id, delta, reason, reference, campaign_id, idempotency_key, balance_after, meta, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${LEDGER_COLS}`,
      [accountId, row.delta, row.reason, row.reference, row.campaignId, row.idempotencyKey, (acct as { balance: number }).balance, tx.json(row.meta as Json) as never, row.at],
    );
    return first<PointsLedgerRow>(rows)!;
  }

  async getAccount(accountId: string) {
    return first<PointsAccountRow>(await this.sql.unsafe(`select ${ACCOUNT_COLS} from points_accounts where telecom_account_id = $1`, [accountId]));
  }

  async listLedger(accountId: string, limit: number) {
    return (await this.sql`
      select l.id, l.telecom_account_id, l.delta, l.reason, l.reference, l.campaign_id, c.name as campaign_name, l.idempotency_key,
             l.balance_after, l.meta, l.created_at
      from points_ledger l left join points_campaigns c on c.id = l.campaign_id
      where l.telecom_account_id = ${accountId}
      order by l.created_at desc, l.seq desc limit ${limit}`) as unknown as PointsLedgerRow[];
  }

  async usedKeys(keys: string[]) {
    if (!keys.length) return new Set<string>();
    const rows = (await this.sql`select idempotency_key from points_ledger where idempotency_key = any(${keys})`) as unknown as { idempotencyKey: string }[];
    return new Set(rows.map((r) => r.idempotencyKey));
  }

  async earn(input: PointsEarnInput): Promise<PointsEarnResult> {
    return (await this.sql.begin(async (tx) => {
      await this.lock(tx, input.telecomAccountId, input.at);
      const written: PointsLedgerRow[] = [];
      let duplicates = 0;
      const reasons = [...EARN_REASONS];
      for (const e of input.entries) {
        if ((await tx`select 1 from points_ledger where idempotency_key = ${e.idempotencyKey}`).length) {
          duplicates++;
          continue;
        }
        const [sums] = await tx`
          select coalesce(sum(delta) filter (where created_at >= ${input.caps.dayStart}), 0)::int as day,
                 coalesce(sum(delta) filter (where created_at >= ${input.caps.monthStart}), 0)::int as month
          from points_ledger where telecom_account_id = ${input.telecomAccountId} and reason = any(${reasons})`;
        const { day, month } = sums as { day: number; month: number };
        let grant = Math.max(0, Math.min(Math.floor(e.points), input.caps.daily - day, input.caps.monthly - month));
        const meta: Record<string, unknown> = { ...(e.meta ?? {}) };
        if (e.campaignId) {
          const c = first<PointsCampaignRow>(await tx.unsafe(`select ${CAMPAIGN_COLS} from points_campaigns where id = $1 for update`, [e.campaignId]));
          const live = c && c.active && c.startsAt.getTime() <= input.at.getTime() && input.at.getTime() < c.endsAt.getTime();
          grant = live ? Math.max(0, Math.min(grant, c.budgetPoints - c.spentPoints)) : 0;
          if (grant > 0) await tx`update points_campaigns set spent_points = spent_points + ${grant} where id = ${e.campaignId}`;
        }
        if (grant < e.points) meta.requested = e.points;
        written.push(
          await this.write(tx, input.telecomAccountId, {
            delta: grant,
            reason: e.reason,
            reference: e.reference,
            campaignId: e.campaignId ?? null,
            idempotencyKey: e.idempotencyKey,
            meta,
            at: input.at,
          }),
        );
      }
      const credit = written.filter((w) => w.delta > 0).at(-1);
      const repaid = credit ? await this.repayOwed(tx, input.telecomAccountId, credit.idempotencyKey, input.at) : 0;
      const acct = first<PointsAccountRow>(await tx.unsafe(`select ${ACCOUNT_COLS} from points_accounts where telecom_account_id = $1`, [input.telecomAccountId]))!;
      return { written, repaid, duplicates, balance: acct.balance };
    })) as PointsEarnResult;
  }

  /**
   * After a credit (key `creditKey`), points owed are taken from the balance first (one "clawback" debit, same
   * transaction, row already locked).
   */
  private async repayOwed(tx: Tx, accountId: string, creditKey: string, at: Date): Promise<number> {
    const acct = first<PointsAccountRow>(await tx.unsafe(`select ${ACCOUNT_COLS} from points_accounts where telecom_account_id = $1`, [accountId]))!;
    const repay = Math.min(acct.owed, acct.balance);
    if (repay <= 0) return 0;
    await this.write(tx, accountId, { delta: -repay, reason: "clawback", reference: "owed", campaignId: null, idempotencyKey: `owed:${creditKey}`, meta: { repaid: repay }, at });
    await tx`update points_accounts set owed = owed - ${repay} where telecom_account_id = ${accountId}`;
    return repay;
  }

  async clawback(input: PointsClawbackInput): Promise<PointsClawbackResult> {
    return (await this.sql.begin(async (tx) => {
      const acct = await this.lock(tx, input.telecomAccountId, input.at);
      if ((await tx`select 1 from points_ledger where idempotency_key = ${input.idempotencyKey}`).length) {
        return { status: "duplicate", earned: 0, points: 0, debited: 0, owedAdded: 0, balance: acct.balance, owed: acct.owed, row: null };
      }
      const reasons = [...EARN_REASONS];
      const [sums] = await tx`
        select coalesce(sum(delta) filter (where reason = any(${reasons})
                 and (idempotency_key = ${input.source} or starts_with(idempotency_key, ${`${input.source}:`}) or meta->>'trigger' = ${input.source})), 0)::int as earned,
               coalesce(sum((meta->>'points')::int) filter (where reason = 'clawback' and meta->>'source' = ${input.source}), 0)::int as taken
        from points_ledger where telecom_account_id = ${input.telecomAccountId}`;
      const { earned, taken } = sums as { earned: number; taken: number };
      const target = input.share.den > 0 ? Math.floor((earned * Math.min(input.share.num, input.share.den)) / input.share.den) : earned;
      const points = Math.max(0, target - taken);
      const debited = Math.min(points, acct.balance);
      const owedAdded = points - debited;
      const row = await this.write(tx, input.telecomAccountId, {
        delta: debited > 0 ? -debited : 0,
        reason: "clawback",
        reference: input.reference,
        campaignId: null,
        idempotencyKey: input.idempotencyKey,
        meta: { ...(input.meta ?? {}), source: input.source, points, debited, owed: owedAdded },
        at: input.at,
      });
      const [after] = (await tx`
        update points_accounts set owed = owed + ${owedAdded} where telecom_account_id = ${input.telecomAccountId} returning balance, owed`) as unknown as [{ balance: number; owed: number }];
      return { status: "applied", earned, points, debited, owedAdded, balance: after.balance, owed: after.owed, row };
    })) as PointsClawbackResult;
  }

  async accountOfKey(key: string) {
    const [row] = (await this.sql`select telecom_account_id from points_ledger where idempotency_key = ${key}`) as unknown as { telecomAccountId: string }[];
    return row?.telecomAccountId ?? null;
  }

  async latestPurchaseKey(accountId: string, prefix: string) {
    const [row] = (await this.sql`
      select idempotency_key from points_ledger
      where telecom_account_id = ${accountId} and reason = 'purchase' and starts_with(idempotency_key, ${prefix})
      order by created_at desc, seq desc limit 1`) as unknown as { idempotencyKey: string }[];
    return row?.idempotencyKey ?? null;
  }

  async redeem(input: PointsRedeemInput): Promise<PointsRedeemResult> {
    return (await this.sql.begin(async (tx) => {
      const acct = await this.lock(tx, input.telecomAccountId, input.at);
      const existing = first<PointsRedemptionRow>(
        await tx.unsafe(`select ${REDEMPTION_COLS} from points_redemptions where telecom_account_id = $1 and client_key = $2`, [input.telecomAccountId, input.clientKey]),
      );
      if (existing) return { status: "replay", redemption: existing, balance: acct.balance };
      if (acct.owed > 0) return { status: "owed", owed: acct.owed, balance: acct.balance };
      const [{ used }] = (await tx`
        select count(*)::int as used from points_redemptions
        where telecom_account_id = ${input.telecomAccountId} and reward_id = ${input.rewardId} and status <> 'refunded'
          and created_at >= ${input.monthStart}`) as unknown as [{ used: number }];
      if (used >= input.monthlyLimit) return { status: "monthly_limit", used };
      if (acct.balance < input.points) return { status: "insufficient", balance: acct.balance };
      const redemption = first<PointsRedemptionRow>(
        await tx.unsafe(
          `insert into points_redemptions (telecom_account_id, reward_id, points, client_key, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $5) returning ${REDEMPTION_COLS}`,
          [input.telecomAccountId, input.rewardId, input.points, input.clientKey, input.at],
        ),
      )!;
      const row = await this.write(tx, input.telecomAccountId, {
        delta: -input.points,
        reason: "redeem",
        reference: `reward:${input.rewardId}`,
        campaignId: null,
        idempotencyKey: `redeem:${redemption.id}`,
        meta: { redemptionId: redemption.id, ...(input.meta ?? {}) },
        at: input.at,
      });
      return { status: "created", redemption, balance: row.balanceAfter };
    })) as PointsRedeemResult;
  }

  async finishRedemption(id: string, fulfilmentRef: string | null, at: Date) {
    return first<PointsRedemptionRow>(
      await this.sql.unsafe(
        `update points_redemptions set status = 'fulfilled', fulfilment_ref = $2, updated_at = $3 where id = $1 and status = 'pending' returning ${REDEMPTION_COLS}`,
        [id, fulfilmentRef, at],
      ),
    );
  }

  async refundRedemption(id: string, error: string, at: Date) {
    return (await this.sql.begin(async (tx) => {
      const r = first<PointsRedemptionRow>(await tx.unsafe(`select ${REDEMPTION_COLS} from points_redemptions where id = $1`, [id]));
      if (!r) return null;
      await this.lock(tx, r.telecomAccountId, at);
      const redemption = first<PointsRedemptionRow>(
        await tx.unsafe(
          `update points_redemptions set status = 'refunded', error = $2, updated_at = $3 where id = $1 and status = 'pending' returning ${REDEMPTION_COLS}`,
          [id, error.slice(0, 200), at],
        ),
      );
      if (!redemption) return null;
      const row = await this.write(tx, r.telecomAccountId, {
        delta: r.points,
        reason: "refund",
        reference: `reward:${r.rewardId}`,
        campaignId: null,
        idempotencyKey: `refund:${r.id}`,
        meta: { redemptionId: r.id },
        at,
      });
      const repaid = await this.repayOwed(tx, r.telecomAccountId, `refund:${r.id}`, at);
      return { redemption, balance: row.balanceAfter - repaid };
    })) as { redemption: PointsRedemptionRow; balance: number } | null;
  }

  async countRedemptions(accountId: string, since: Date) {
    const rows = (await this.sql`
      select reward_id, count(*)::int as n from points_redemptions
      where telecom_account_id = ${accountId} and status <> 'refunded' and created_at >= ${since} group by reward_id`) as unknown as { rewardId: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.rewardId, r.n]));
  }

  async createCampaign(c: NewPointsCampaign) {
    return first<PointsCampaignRow>(
      await this.sql.unsafe(
        `insert into points_campaigns (name, kind, target, multiplier, bonus_points, starts_at, ends_at, budget_points, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${CAMPAIGN_COLS}`,
        [c.name, c.kind, c.target, c.multiplier, c.bonusPoints, c.startsAt, c.endsAt, c.budgetPoints, c.createdBy],
      ),
    )!;
  }

  async updateCampaign(id: string, patch: PointsCampaignPatch) {
    return first<PointsCampaignRow>(
      await this.sql.unsafe(
        `update points_campaigns set name = coalesce($2, name), ends_at = coalesce($3, ends_at), budget_points = coalesce($4, budget_points),
           active = coalesce($5, active) where id = $1 returning ${CAMPAIGN_COLS}`,
        [id, patch.name ?? null, patch.endsAt ?? null, patch.budgetPoints ?? null, patch.active ?? null],
      ),
    );
  }

  async getCampaign(id: string) {
    return first<PointsCampaignRow>(await this.sql.unsafe(`select ${CAMPAIGN_COLS} from points_campaigns where id = $1`, [id]));
  }

  async listCampaigns() {
    return (await this.sql.unsafe(`select ${CAMPAIGN_COLS} from points_campaigns order by starts_at desc`)) as unknown as PointsCampaignRow[];
  }

  async activeCampaigns(at: Date) {
    return (await this.sql.unsafe(
      `select ${CAMPAIGN_COLS} from points_campaigns where active and starts_at <= $1 and ends_at > $1 and spent_points < budget_points order by starts_at`,
      [at],
    )) as unknown as PointsCampaignRow[];
  }

  async listExpirable(before: Date, limit: number) {
    return (await this.sql.unsafe(
      `select ${ACCOUNT_COLS} from points_accounts where balance > 0 and last_activity_at < $1 order by last_activity_at limit $2`,
      [before, limit],
    )) as unknown as PointsAccountRow[];
  }

  async totalLiability() {
    const [row] = (await this.sql`select coalesce(sum(balance), 0)::int as n from points_accounts`) as unknown as Array<{ n: number }>;
    return row?.n ?? 0;
  }

  async expire(accountId: string, before: Date, at: Date) {
    return (await this.sql.begin(async (tx) => {
      const rows = await tx.unsafe(`select ${ACCOUNT_COLS} from points_accounts where telecom_account_id = $1 for update`, [accountId]);
      const a = first<PointsAccountRow>(rows);
      if (!a || a.balance <= 0 || a.lastActivityAt.getTime() >= before.getTime()) return null;
      return this.write(tx, accountId, {
        delta: -a.balance,
        reason: "expiry",
        reference: "inactivity",
        campaignId: null,
        idempotencyKey: `expiry:${accountId}:${a.lastActivityAt.toISOString()}`,
        meta: { inactiveSince: a.lastActivityAt.toISOString() },
        at,
      });
    })) as PointsLedgerRow | null;
  }
}
