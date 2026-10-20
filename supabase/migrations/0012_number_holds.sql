-- MIMT: live number picker holds (mimt.ca hero, app, Affaires). API: apps/api/src/routes/numberPicker.ts.
-- Contract: packages/shared/src/numberSearch.ts.
--
-- A visitor picks a real number from the carrier search; MIMT reserves it for 10 minutes (30 once Stripe Checkout
-- is open) so no other MIMT customer can take it. The hold token is a capability: only its SHA-256 is stored, and
-- the visitor's IP only as a salted hash (abuse limits). RLS on, nothing for anon or authenticated: API only.

create table number_holds (
  id                   uuid primary key default gen_random_uuid(),
  e164                 text not null check (e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  token_hash           text not null check (char_length(token_hash) = 64),
  ip_hash              text not null,
  status               text not null default 'held'
                         check (status in ('held', 'checkout', 'converted', 'expired', 'released', 'failed')),
  telecom_account_id   uuid references telecom_accounts(id) on delete set null,
  checkout_session_id  text,
  expires_at           timestamptz not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- One live hold per number. Rows past expires_at are expired by the API before a new hold is taken.
create unique index number_holds_live_e164 on number_holds(e164) where status in ('held', 'checkout');
create index number_holds_ip_idx on number_holds(ip_hash, created_at desc);
create index number_holds_session_idx on number_holds(checkout_session_id) where checkout_session_id is not null;

alter table number_holds enable row level security;
