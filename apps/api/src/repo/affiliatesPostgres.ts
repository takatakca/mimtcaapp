import type postgres from "postgres";
import type { AffiliateStatus } from "@mimt/shared";
import type {
  AffiliateCommissionRow,
  AffiliatePatch,
  AffiliateReferralRow,
  AffiliateRepository,
  AffiliateRow,
  NewAffiliate,
  NewAffiliateCommission,
} from "./affiliates.js";

type Sql = postgres.Sql<{}>;

const AFF = "id, status, code, pii_enc, email_hash, phone_hash, province, channels, audience_size, locale, privacy_notice_version, casl_consent, adult_attested, commission_bps, duration_months, payout_threshold_cents, user_id, contract_mode, envelope_id, contract_sent_at, signed_at, decided_at, status_reason, created_at, updated_at";
const REF = "telecom_account_id, affiliate_id, source, touched_at, expires_at, commission_start_at, created_at";
const COM = "id, affiliate_id, telecom_account_id, kind, source_ref, stripe_invoice_id, net_revenue_cents, commission_bps, commission_cents, reversed_cents, status, reversal_reason, earned_at, payable_at, paid_at, payout_ref, created_at";

const first = <T>(rows: readonly unknown[]): T | null => (rows[0] as T | undefined) ?? null;
const PATCH_COLUMNS: Record<keyof AffiliatePatch, string> = {
  status: "status",
  code: "code",
  commissionBps: "commission_bps",
  durationMonths: "duration_months",
  payoutThresholdCents: "payout_threshold_cents",
  contractMode: "contract_mode",
  envelopeId: "envelope_id",
  contractSentAt: "contract_sent_at",
  signedAt: "signed_at",
  decidedAt: "decided_at",
  statusReason: "status_reason",
};
const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505";

/** Affiliate program on Postgres (0019_affiliates.sql). Shares the connection pool of PostgresRepository. */
export class PostgresAffiliateRepository implements AffiliateRepository {
  constructor(private readonly sql: Sql) {}

  async createApplication(a: NewAffiliate) {
    try {
      return first<AffiliateRow>(
        await this.sql.unsafe(
          `insert into affiliates (pii_enc, email_hash, phone_hash, province, channels, audience_size, locale, privacy_notice_version, casl_consent, adult_attested)
           values ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10) returning ${AFF}`,
          [a.piiEnc, a.emailHash, a.phoneHash, a.province, a.channels as unknown as string, a.audienceSize, a.locale, a.privacyNoticeVersion, a.caslConsent, a.adultAttested],
        ),
      );
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  async get(id: string) {
    return first<AffiliateRow>(await this.sql.unsafe(`select ${AFF} from affiliates where id = $1`, [id]));
  }
  async findByCode(code: string) {
    return first<AffiliateRow>(await this.sql.unsafe(`select ${AFF} from affiliates where code = $1`, [code]));
  }
  async findByEnvelope(envelopeId: string) {
    return first<AffiliateRow>(await this.sql.unsafe(`select ${AFF} from affiliates where envelope_id = $1`, [envelopeId]));
  }
  async findByUser(userId: string) {
    return first<AffiliateRow>(await this.sql.unsafe(`select ${AFF} from affiliates where user_id = $1`, [userId]));
  }
  async findUnboundByPhoneHash(phoneHash: string) {
    return (await this.sql.unsafe(
      `select ${AFF} from affiliates where phone_hash = $1 and user_id is null and status in ('active', 'suspended') order by created_at`,
      [phoneHash],
    )) as unknown as AffiliateRow[];
  }
  async list(filter: { status?: AffiliateStatus; limit: number }) {
    return (await this.sql.unsafe(
      `select ${AFF} from affiliates where ($1::text is null or status = $1) order by created_at desc limit $2`,
      [filter.status ?? null, filter.limit],
    )) as unknown as AffiliateRow[];
  }

  async update(id: string, from: readonly AffiliateStatus[], patch: AffiliatePatch) {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [keyof AffiliatePatch, unknown][];
    const sets = entries.map(([k], i) => `${PATCH_COLUMNS[k]} = $${i + 3}`);
    const query = `update affiliates set ${[...sets, "updated_at = now()"].join(", ")} where id = $1 and status = any($2::text[]) returning ${AFF}`;
    try {
      return first<AffiliateRow>(await this.sql.unsafe(query, [id, [...from] as unknown as string, ...(entries.map(([, v]) => v) as never[])]));
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  async bindUser(id: string, userId: string) {
    try {
      const rows = await this.sql`update affiliates set user_id = ${userId} where id = ${id} and user_id is null returning id`;
      return rows.length === 1;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }

  async purgeRejected(before: Date) {
    const rows = await this.sql`
      delete from affiliates a where a.status = 'rejected' and coalesce(a.decided_at, a.updated_at) < ${before}
        and not exists (select 1 from affiliate_commissions c where c.affiliate_id = a.id)
      returning a.id`;
    return rows.length;
  }

  async recordReferral(r: Omit<AffiliateReferralRow, "commissionStartAt" | "createdAt">) {
    const inserted = first<AffiliateReferralRow>(
      await this.sql.unsafe(
        `insert into affiliate_referrals (telecom_account_id, affiliate_id, source, touched_at, expires_at)
         values ($1, $2, $3, $4, $5) on conflict (telecom_account_id) do nothing returning ${REF}`,
        [r.telecomAccountId, r.affiliateId, r.source, r.touchedAt, r.expiresAt],
      ),
    );
    if (inserted) return { row: inserted, created: true };
    return { row: (await this.getReferral(r.telecomAccountId))!, created: false };
  }
  async getReferral(telecomAccountId: string) {
    return first<AffiliateReferralRow>(await this.sql.unsafe(`select ${REF} from affiliate_referrals where telecom_account_id = $1`, [telecomAccountId]));
  }
  async startCommission(telecomAccountId: string, at: Date) {
    return first<AffiliateReferralRow>(
      await this.sql.unsafe(
        `update affiliate_referrals set commission_start_at = coalesce(commission_start_at, $2) where telecom_account_id = $1 returning ${REF}`,
        [telecomAccountId, at],
      ),
    );
  }
  async countReferrals(affiliateId: string) {
    const [row] = await this.sql<{ signups: number; paying: number }[]>`
      select count(*)::int as signups, count(commission_start_at)::int as paying from affiliate_referrals where affiliate_id = ${affiliateId}`;
    return { signups: row?.signups ?? 0, paying: row?.paying ?? 0 };
  }
  async addHoldTouch(numberHoldId: string, affiliateId: string, touchedAt: Date) {
    await this.sql`
      insert into affiliate_hold_touches (number_hold_id, affiliate_id, touched_at) values (${numberHoldId}, ${affiliateId}, ${touchedAt})
      on conflict (number_hold_id) do nothing`;
  }
  async getHoldTouch(numberHoldId: string) {
    return first<{ affiliateId: string; touchedAt: Date }>(
      await this.sql`select affiliate_id, touched_at from affiliate_hold_touches where number_hold_id = ${numberHoldId}`,
    );
  }

  async addCommission(c: NewAffiliateCommission) {
    return first<AffiliateCommissionRow>(
      await this.sql.unsafe(
        `insert into affiliate_commissions (affiliate_id, telecom_account_id, kind, source_ref, stripe_invoice_id, net_revenue_cents, commission_bps,
                                            commission_cents, status, earned_at, payable_at)
         values ($1, $2, 'invoice', $3, $4, $5, $6, $7, 'pending', $8, $9)
         on conflict do nothing returning ${COM}`,
        [c.affiliateId, c.telecomAccountId, `invoice:${c.stripeInvoiceId}`, c.stripeInvoiceId, c.netRevenueCents, c.commissionBps, c.commissionCents, c.earnedAt, c.payableAt],
      ),
    );
  }

  async getInvoiceCommission(stripeInvoiceId: string) {
    return first<AffiliateCommissionRow>(
      await this.sql.unsafe(`select ${COM} from affiliate_commissions where stripe_invoice_id = $1 and kind = 'invoice'`, [stripeInvoiceId]),
    );
  }

  async applyReversal(stripeInvoiceId: string, targetReversedCents: number, reason: "refund" | "chargeback" | "fraud", at: Date) {
    return this.sql.begin(async (tx) => {
      const row = first<AffiliateCommissionRow>(
        await tx.unsafe(`select ${COM} from affiliate_commissions where stripe_invoice_id = $1 and kind = 'invoice' for update`, [stripeInvoiceId]),
      );
      if (!row) return null;
      const target = Math.min(Math.max(0, Math.floor(targetReversedCents)), row.commissionCents);
      if (target <= row.reversedCents || row.status === "reversed") return null;
      const delta = target - row.reversedCents;
      const status = row.status !== "paid" && target >= row.commissionCents ? "reversed" : row.status;
      const updated = first<AffiliateCommissionRow>(
        await tx.unsafe(`update affiliate_commissions set reversed_cents = $2, reversal_reason = $3, status = $4 where id = $1 returning ${COM}`, [
          row.id,
          target,
          reason,
          status,
        ]),
      )!;
      let clawback: AffiliateCommissionRow | null = null;
      if (row.status === "paid") {
        clawback = first<AffiliateCommissionRow>(
          await tx.unsafe(
            `insert into affiliate_commissions (affiliate_id, telecom_account_id, kind, source_ref, stripe_invoice_id, net_revenue_cents, commission_bps,
                                                commission_cents, status, reversal_reason, earned_at, payable_at)
             values ($1, $2, 'clawback', $3, $4, 0, $5, $6, 'payable', $7, $8, $8)
             on conflict do nothing returning ${COM}`,
            [row.affiliateId, row.telecomAccountId, `clawback:${stripeInvoiceId}:${target}`, stripeInvoiceId, row.commissionBps, -delta, reason, at],
          ),
        );
      }
      return { commission: updated, clawback };
    }) as Promise<{ commission: AffiliateCommissionRow; clawback: AffiliateCommissionRow | null } | null>;
  }

  async releaseDue(now: Date) {
    const rows = await this.sql`update affiliate_commissions set status = 'payable' where status = 'pending' and payable_at <= ${now} returning id`;
    return rows.length;
  }
  async listCommissions(affiliateId: string) {
    return (await this.sql.unsafe(`select ${COM} from affiliate_commissions where affiliate_id = $1 order by earned_at, created_at`, [
      affiliateId,
    ])) as unknown as AffiliateCommissionRow[];
  }
  async listPayable() {
    return (await this.sql.unsafe(`select ${COM} from affiliate_commissions where status = 'payable' order by earned_at, created_at`)) as unknown as AffiliateCommissionRow[];
  }
  async markPaid(affiliateId: string, input: { ids?: string[]; payoutRef: string; at: Date }) {
    return (await this.sql.unsafe(
      `update affiliate_commissions set status = 'paid', paid_at = $2, payout_ref = $3
       where affiliate_id = $1 and status = 'payable' and ($4::uuid[] is null or id = any($4::uuid[])) returning ${COM}`,
      [affiliateId, input.at, input.payoutRef, (input.ids ?? null) as unknown as string],
    )) as unknown as AffiliateCommissionRow[];
  }
}
