-- MIMT: « MIMT Points » clawback (docs/MIMT-POINTS.md, « Remboursements et rétrofacturations »). Points earned from a
-- payment that is later refunded (Stripe charge.refunded, App Store REFUND, Google Play voided purchase) or charged
-- back (Stripe charge.dispute.created) are taken back by a ledger debit with reason 'clawback'.
--
-- The balance still never goes negative (CHECK balance >= 0 is unchanged). When the balance is lower than the points
-- to take back, the balance is debited to 0 and the rest is recorded in points_accounts.owed; the next points earned
-- repay it first (another 'clawback' debit, in the same transaction as the credit), and redemptions are refused while
-- anything is owed. API: apps/api/src/repo/pointsPostgres.ts (clawback, earn, redeem).

alter table points_accounts add column if not exists owed integer not null default 0 check (owed >= 0);

-- Reasons: add 'clawback'. Its delta is <= 0: 0 when the balance was empty and everything went to `owed` (the row is
-- kept so the same refund never takes points twice, through its idempotency key).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'points_ledger'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%''redeem''%')
  loop
    execute format('alter table points_ledger drop constraint %I', c.conname);
  end loop;
end $$;

alter table points_ledger add constraint points_ledger_reason_check
  check (reason in ('mission', 'referral', 'purchase', 'campaign', 'refund', 'redeem', 'expiry', 'clawback'));
alter table points_ledger add constraint points_ledger_delta_sign_check
  check (case when reason in ('redeem', 'expiry') then delta < 0 when reason = 'clawback' then delta <= 0 else delta >= 0 end);

-- Clawbacks of one payment are summed by their source (meta->>'source', e.g. "invoice:in_…") so a second partial
-- refund only takes the difference.
create index if not exists points_ledger_clawback_source_idx on points_ledger((meta->>'source')) where reason = 'clawback';
