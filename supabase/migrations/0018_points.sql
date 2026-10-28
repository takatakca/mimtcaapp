-- MIMT: « MIMT Points » (docs/MIMT-POINTS.md). An append-only points ledger per telecom account, the balance it
-- adds up to (never negative), redemptions of the catalog (packages/shared/src/points.ts) and the owner's marketing
-- campaigns. API: apps/api/src/services/points.ts, apps/api/src/repo/pointsPostgres.ts.
--
-- Money-grade rules, enforced HERE (not only in the API):
--  - every movement is a points_ledger row; rows are never updated or deleted (trigger below);
--  - a movement happens at most once: points_ledger.idempotency_key is UNIQUE (e.g. "invoice:in_…", "mission:<account>:<id>");
--  - the balance is points_accounts.balance, changed in the same transaction as the ledger row, after a row lock
--    (select … for update); CHECK (balance >= 0) and CHECK (balance_after >= 0): a debit larger than the balance fails;
--  - a campaign never spends past its budget: CHECK (spent_points <= budget_points), spent in the same transaction.
-- Kept when an account is deleted (like mission_rewards, fraud_events and audit_log): the record of who earned and
-- spent what is the anti-abuse and accounting trail. No personal data is stored in these tables.

create table points_accounts (
  telecom_account_id  uuid primary key references telecom_accounts(id) on delete cascade,
  balance             integer not null default 0 check (balance >= 0),
  lifetime_earned     bigint not null default 0 check (lifetime_earned >= 0),
  -- Last earn or spend: the inactivity expiry (POINTS_EXPIRY) counts from here.
  last_activity_at    timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index points_accounts_activity_idx on points_accounts(last_activity_at) where balance > 0;

create table points_campaigns (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 2 and 80),
  kind           text not null check (kind in ('multiplier', 'bonus')),
  target         text not null check (target in ('purchase', 'purchase_yearly', 'referral', 'mission', 'mission:verify_phone',
                                                  'mission:choose_handle', 'mission:enable_push', 'mission:install_app',
                                                  'mission:first_number', 'mission:invite_friend', 'mission:go_yearly')),
  -- multiplier: x1.1 to x3 (MAX_CAMPAIGN_MULTIPLIER); bonus: 1 to 2 000 points once per account (MAX_CAMPAIGN_BONUS).
  multiplier     numeric(4, 2) check (multiplier is null or (multiplier > 1 and multiplier <= 3)),
  bonus_points   integer check (bonus_points is null or bonus_points between 1 and 2000),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  budget_points  integer not null check (budget_points > 0),
  spent_points   integer not null default 0 check (spent_points >= 0),
  active         boolean not null default true,
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (ends_at > starts_at),
  check (spent_points <= budget_points),
  check ((kind = 'multiplier') = (multiplier is not null)),
  check ((kind = 'bonus') = (bonus_points is not null))
);
create index points_campaigns_window_idx on points_campaigns(starts_at, ends_at) where active;

create table points_ledger (
  id                  uuid primary key default gen_random_uuid(),
  -- Write order (stable history order when two rows share a timestamp).
  seq                 bigint generated always as identity unique,
  telecom_account_id  uuid not null references telecom_accounts(id) on delete cascade,
  -- Credits are >= 0 (0 = earned over a daily/monthly cap or a spent campaign budget, kept for the record and so a
  -- retry of the same event earns nothing later); debits are < 0.
  delta               integer not null,
  reason              text not null check (reason in ('mission', 'referral', 'purchase', 'campaign', 'refund', 'redeem', 'expiry')),
  -- What it was, without personal data: "mission:choose_handle", "invoice", "store", "referral", "reward:texts_50"…
  reference           text not null check (char_length(reference) between 1 and 200),
  campaign_id         uuid references points_campaigns(id) on delete restrict,
  idempotency_key     text not null unique check (char_length(idempotency_key) between 3 and 300),
  balance_after       integer not null check (balance_after >= 0),
  meta                jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  check ((reason in ('redeem', 'expiry')) = (delta < 0)),
  check (reason <> 'campaign' or campaign_id is not null)
);
create index points_ledger_account_idx on points_ledger(telecom_account_id, created_at desc, seq desc);

create table points_redemptions (
  id                  uuid primary key default gen_random_uuid(),
  telecom_account_id  uuid not null references telecom_accounts(id) on delete cascade,
  reward_id           text not null check (reward_id ~ '^[a-z0-9_]{2,40}$'),
  points              integer not null check (points > 0),
  -- pending: points debited, fulfilment running; fulfilled: delivered; refunded: fulfilment failed, points given back.
  status              text not null default 'pending' check (status in ('pending', 'fulfilled', 'refunded')),
  -- The client's key: the same key on the same account never redeems twice.
  client_key          text not null check (char_length(client_key) between 8 and 100),
  fulfilment_ref      text check (char_length(fulfilment_ref) <= 200),
  error               text check (char_length(error) <= 200),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (telecom_account_id, client_key)
);
create index points_redemptions_month_idx on points_redemptions(telecom_account_id, reward_id, created_at);

-- Append-only ledger: no UPDATE, no DELETE (TRUNCATE in tests and restores is a table-level operation, not affected).
create or replace function points_ledger_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'points_ledger is append-only';
end $$;
create trigger points_ledger_no_update before update or delete on points_ledger for each row execute function points_ledger_append_only();

create trigger points_accounts_updated_at before update on points_accounts for each row execute function set_updated_at();
create trigger points_campaigns_updated_at before update on points_campaigns for each row execute function set_updated_at();
create trigger points_redemptions_updated_at before update on points_redemptions for each row execute function set_updated_at();

-- Missions now reward points (10 points = 1 minute equivalent, 1 500 at most per account). Rewards granted before
-- keep their minutes; a new row has minutes = 0 and its points, credited to points_ledger with the idempotency key
-- "mission:<account>:<mission>" (credited again only if that key is missing: a crash between the two writes heals).
alter table mission_rewards add column if not exists points integer not null default 0 check (points between 0 and 600);

-- Bonus texts bought with points (usage_ledger, like bonus_minutes_out / bonus_minutes_on_net).
alter table usage_ledger add column if not exists bonus_messages integer not null default 0;

-- Writes go through the API (service role) only. Owners may read their own balance and history.
alter table points_accounts enable row level security;
alter table points_ledger enable row level security;
alter table points_redemptions enable row level security;
alter table points_campaigns enable row level security;
revoke all on points_accounts, points_ledger, points_redemptions, points_campaigns from anon;
revoke insert, update, delete on points_accounts, points_ledger, points_redemptions, points_campaigns from authenticated;
revoke all on points_campaigns from authenticated;
create policy points_accounts_owner_read on points_accounts for select to authenticated using (mimt_owns_account(telecom_account_id));
create policy points_ledger_owner_read on points_ledger for select to authenticated using (mimt_owns_account(telecom_account_id));
create policy points_redemptions_owner_read on points_redemptions for select to authenticated using (mimt_owns_account(telecom_account_id));
