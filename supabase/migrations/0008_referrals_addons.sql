-- Parity P1 (docs/MIMT-PARITY.md §3): referral program, payment fingerprints for its anti-fraud checks,
-- and the standalone "Sans pub" add-on.
--
-- Add-ons reuse subscriptions (kind = 'addon', code = 'no_ads') and entitlements (source 'addon').
-- Referral rewards are subscriptions rows with source 'manual', code 'premium', a stripe_subscription_id
-- of the form 'referral:<referral id>:<referrer|referee>' and a current_period_end one month later; the API
-- ignores manual rows past their period end.
--
-- RLS is on everywhere. Writes go through the API (service role). Users may read their own code and the
-- referrals where they are the referrer or the referee; payment fingerprints are never readable by clients.

-- No new subscriptions columns are needed: the monthly/yearly interval lives at Stripe / the store, and
-- the API only needs kind, code, status and current_period_end. Index for the add-on lookups on /v1/me:
create index if not exists subscriptions_account_addon_idx on subscriptions(telecom_account_id) where kind = 'addon';

create table referral_codes (
  code        text primary key check (code ~ '^[A-Z0-9]{6,12}$'),
  user_id     uuid not null unique references users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table referrals (
  id                           uuid primary key default gen_random_uuid(),
  code                         text not null references referral_codes(code) on delete cascade,
  referrer_user_id             uuid not null references users(id) on delete cascade,
  referee_user_id              uuid not null unique references users(id) on delete cascade,
  status                       text not null default 'pending' check (status in ('pending', 'rewarded', 'rejected')),
  reject_reason                text check (reject_reason in ('same_device', 'same_payment')),
  -- sha256 hex of the device key the referee redeemed from; never the raw key.
  device_key_hash              text check (device_key_hash ~ '^[0-9a-f]{64}$'),
  referee_payment_fingerprint  text,
  rewarded_at                  timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  check (referrer_user_id <> referee_user_id),
  check ((status = 'rejected') = (reject_reason is not null)),
  check ((status = 'rewarded') = (rewarded_at is not null))
);
create index referrals_referrer_idx on referrals(referrer_user_id, created_at desc);
create index referrals_device_idx on referrals(device_key_hash) where device_key_hash is not null;

-- Stripe card fingerprints seen on paid invoices/payments (the same card on two accounts = no referral reward).
create table payment_fingerprints (
  telecom_account_id  uuid not null references telecom_accounts(id) on delete cascade,
  fingerprint         text not null check (char_length(fingerprint) between 4 and 128),
  first_seen_at       timestamptz not null default now(),
  primary key (telecom_account_id, fingerprint)
);
create index payment_fingerprints_fp_idx on payment_fingerprints(fingerprint);

create trigger referrals_updated_at before update on referrals for each row execute function set_updated_at();

alter table referral_codes enable row level security;
alter table referrals enable row level security;
alter table payment_fingerprints enable row level security;
revoke all on referral_codes, referrals, payment_fingerprints from anon;
revoke insert, update, delete on referral_codes, referrals from authenticated;
revoke all on payment_fingerprints from authenticated;

create policy referral_codes_self_read on referral_codes for select to authenticated using (user_id = mimt_current_user_id());
create policy referrals_party_read on referrals for select to authenticated
  using (referrer_user_id = mimt_current_user_id() or referee_user_id = mimt_current_user_id());
