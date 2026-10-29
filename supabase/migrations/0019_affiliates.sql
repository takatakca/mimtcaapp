-- MIMT: « Programme d'agents affiliés » (docs/MIMT-AFFILIATES.md). Independent agents who apply on mimt.ca/affilies/,
-- sign an affiliate agreement (DocuSign or manual), then earn a percentage of the net revenue of every customer they
-- bring, for a set number of months per customer. API: apps/api/src/services/affiliates.ts, routes/affiliates.ts.
--
-- Law 25 (minimal data): the application keeps only what the contract and tax slips need. The personal fields
-- (legal name, business name, email, phone, GST/QST numbers) are ONE AES-256-GCM blob (pii_enc, MessageCipher);
-- email_hash and phone_hash are keyed HMACs (dedupe, dashboard binding to a signed-in phone, no self-referral).
-- No IP address is stored (per-IP limits live in memory only).
--
-- Status flow: applied → approved → contract_sent → active → suspended ⇄ active → terminated; applied/approved → rejected.
-- Commission ledger: one row per paid Stripe invoice of a referred customer (unique source_ref 'invoice:<id>'),
-- pending → payable after a 30-day hold → paid. Refunds and chargebacks reduce the row (reversed_cents) or, when it
-- was already paid, add a negative 'clawback' row taken from the next payout.

create table affiliates (
  id                       uuid primary key default gen_random_uuid(),
  status                   text not null default 'applied'
                             check (status in ('applied', 'approved', 'rejected', 'contract_sent', 'active', 'suspended', 'terminated')),
  -- Code shown in the link (https://app.mimt.ca/?aff=CODE). Set at approval.
  code                     text unique check (code ~ '^[A-Z0-9]{6,12}$'),
  pii_enc                  text not null check (char_length(pii_enc) between 10 and 8000),
  email_hash               text not null check (char_length(email_hash) between 16 and 128),
  phone_hash               text not null check (char_length(phone_hash) between 16 and 128),
  province                 text not null check (province in ('QC', 'ON', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'YT', 'NT', 'NU')),
  channels                 text[] not null default '{}',
  audience_size            text not null check (audience_size in ('lt_1k', '1k_10k', '10k_50k', 'gt_50k')),
  locale                   text not null default 'fr-CA' check (locale in ('fr-CA', 'en-CA')),
  -- Consents (Law 25 notice read, 18+ attested; CASL marketing contact is separate and optional).
  privacy_notice_version   text not null check (char_length(privacy_notice_version) between 1 and 40),
  casl_consent             boolean not null default false,
  adult_attested           boolean not null check (adult_attested),
  -- Terms (per affiliate). Basis points of net revenue (2000 = 20 %).
  commission_bps           integer not null default 2000 check (commission_bps between 100 and 5000),
  duration_months          integer not null default 12 check (duration_months between 1 and 36),
  payout_threshold_cents   integer not null default 5000 check (payout_threshold_cents between 0 and 100000),
  -- Bound on the affiliate's first visit to the dashboard (verified phone matches phone_hash).
  user_id                  uuid unique references users(id) on delete set null,
  contract_mode            text check (contract_mode in ('docusign', 'manual')),
  envelope_id              text unique check (char_length(envelope_id) between 1 and 100),
  contract_sent_at         timestamptz,
  signed_at                timestamptz,
  decided_at               timestamptz,
  status_reason            text check (char_length(status_reason) <= 300),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (status in ('applied', 'rejected') or code is not null),
  check (status not in ('active', 'suspended', 'terminated') or signed_at is not null)
);
-- One open application per email (a rejected one may apply again).
create unique index affiliates_email_open_uidx on affiliates(email_hash) where status <> 'rejected';
create index affiliates_status_idx on affiliates(status, created_at desc);
create index affiliates_phone_idx on affiliates(phone_hash);

-- Who brought a customer: first touch wins (one row per referred account, never overwritten).
create table affiliate_referrals (
  telecom_account_id   uuid primary key references telecom_accounts(id) on delete cascade,
  affiliate_id         uuid not null references affiliates(id) on delete cascade,
  -- signup = code/link at sign-up (POST /v1/affiliates/attribution), checkout = code sent with Stripe Checkout,
  -- hold = code captured on mimt.ca when the number was held in the live picker.
  source               text not null check (source in ('signup', 'checkout', 'hold')),
  touched_at           timestamptz not null,
  -- touched_at + 60 days: the first paid invoice must come before this.
  expires_at           timestamptz not null,
  -- First commissionable invoice; commissions then run for duration_months from here.
  commission_start_at  timestamptz,
  created_at           timestamptz not null default now(),
  check (expires_at > touched_at)
);
create index affiliate_referrals_affiliate_idx on affiliate_referrals(affiliate_id, created_at desc);

-- Code captured on mimt.ca with a live-picker hold, used when that hold is paid for.
create table affiliate_hold_touches (
  number_hold_id  uuid primary key references number_holds(id) on delete cascade,
  affiliate_id    uuid not null references affiliates(id) on delete cascade,
  touched_at      timestamptz not null,
  created_at      timestamptz not null default now()
);

create table affiliate_commissions (
  id                   uuid primary key default gen_random_uuid(),
  affiliate_id         uuid not null references affiliates(id) on delete restrict,
  -- Kept when the customer deletes their account (financial record).
  telecom_account_id   uuid references telecom_accounts(id) on delete set null,
  kind                 text not null default 'invoice' check (kind in ('invoice', 'clawback')),
  -- 'invoice:<Stripe invoice id>' or 'clawback:<invoice id>:<cumulative reversed cents>': webhook retries write once.
  source_ref           text not null unique check (char_length(source_ref) between 3 and 200),
  stripe_invoice_id    text not null check (char_length(stripe_invoice_id) between 3 and 100),
  net_revenue_cents    integer not null check (net_revenue_cents >= 0),
  commission_bps       integer not null check (commission_bps between 0 and 5000),
  -- Negative for a clawback.
  commission_cents     integer not null,
  reversed_cents       integer not null default 0 check (reversed_cents >= 0),
  status               text not null default 'pending' check (status in ('pending', 'payable', 'paid', 'reversed')),
  reversal_reason      text check (reversal_reason in ('refund', 'chargeback', 'fraud')),
  earned_at            timestamptz not null,
  payable_at           timestamptz not null,
  paid_at              timestamptz,
  payout_ref           text check (char_length(payout_ref) between 1 and 100),
  created_at           timestamptz not null default now(),
  check ((kind = 'invoice') = (commission_cents >= 0)),
  check (reversed_cents <= greatest(commission_cents, 0)),
  check ((status = 'paid') = (paid_at is not null))
);
create unique index affiliate_commissions_invoice_uidx on affiliate_commissions(stripe_invoice_id) where kind = 'invoice';
create index affiliate_commissions_affiliate_idx on affiliate_commissions(affiliate_id, status, earned_at);
create index affiliate_commissions_pending_idx on affiliate_commissions(payable_at) where status = 'pending';

create trigger affiliates_updated_at before update on affiliates for each row execute function set_updated_at();

alter table affiliates enable row level security;
alter table affiliate_referrals enable row level security;
alter table affiliate_hold_touches enable row level security;
alter table affiliate_commissions enable row level security;
-- API only (service role): applications hold encrypted personal data, the ledger is financial.
revoke all on affiliates, affiliate_referrals, affiliate_hold_touches, affiliate_commissions from anon, authenticated;
