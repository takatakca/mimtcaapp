-- MIMT: « MIMT Connect » partner platform (docs/MIMT-CONNECT.md). A partner is an existing MIMT business account
-- (businesses) that a client's own system drives through API keys, and that receives signed webhooks. besoinavocat.ca
-- is the first partner. API: apps/api/src/routes/partners.ts, apps/api/src/services/partners.ts,
-- apps/api/src/repo/partnersPostgres.ts. Kill switch PARTNERS=on|off (default off).
--
-- Money-grade rules, enforced HERE (same pattern as 0018_points.sql):
--  - every credit movement is a partner_credit_ledger row; rows are never updated or deleted (trigger below);
--  - a movement happens at most once: partner_credit_ledger.idempotency_key is UNIQUE ("call:<CallSid>", "topup:<key>");
--  - the balance is partners.credit_balance, changed in the same transaction as the ledger row after a row lock
--    (select … for update); CHECK (credit_balance >= 0) and CHECK (balance_after >= 0): never below zero.
-- With no credits left, calls still ring: they are recorded as « unbilled » (we never drop a caller).

create table partners (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null unique references businesses(id) on delete cascade,
  name                      text not null check (char_length(name) between 1 and 120),
  status                    text not null default 'active' check (status in ('active', 'suspended')),
  -- Credits per started minute answered by a member; null = PARTNER_CREDIT_PER_MINUTE.
  credit_per_minute         integer check (credit_per_minute is null or credit_per_minute between 0 and 10000),
  credit_balance            integer not null default 0 check (credit_balance >= 0),
  webhook_url               text check (webhook_url is null or (webhook_url ~ '^https://' and char_length(webhook_url) <= 500)),
  -- HMAC signing secret, encrypted with MESSAGE_ENCRYPTION_KEY (shown once to the partner).
  webhook_secret_encrypted  text,
  -- Set when the balance hit zero and the alert went out; cleared by a top-up (one alert per empty balance).
  credits_exhausted_at      timestamptz,
  created_by                uuid references users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- API keys: only the SHA-256 of the key and its first characters are stored. The key is shown once.
create table partner_api_keys (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references partners(id) on delete cascade,
  prefix        text not null check (char_length(prefix) between 8 and 32),
  key_sha256    text not null unique check (key_sha256 ~ '^[0-9a-f]{64}$'),
  label         text check (char_length(label) <= 80),
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index partner_api_keys_partner_idx on partner_api_keys(partner_id, created_at desc);

-- Members (lawyers, agents…) keyed by the partner's own id; each maps to one extension of the business PBX.
create table partner_members (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references partners(id) on delete cascade,
  external_id   text not null check (external_id ~ '^[A-Za-z0-9._:@-]{1,100}$'),
  name          text not null check (char_length(name) between 1 and 80),
  email         text check (char_length(email) <= 254),
  phone         text check (phone is null or phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  handle        text check (char_length(handle) <= 40),
  language      text not null default 'fr' check (language in ('fr', 'en')),
  active        boolean not null default true,
  extension_id  uuid references extensions(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (partner_id, external_id)
);
create index partner_members_extension_idx on partner_members(extension_id) where extension_id is not null;

-- Hunt groups keyed by the partner; each maps to one ring group of the business PBX.
create table partner_hunt_groups (
  id             uuid primary key default gen_random_uuid(),
  partner_id     uuid not null references partners(id) on delete cascade,
  key            text not null check (key ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  ring_group_id  uuid not null unique references ring_groups(id) on delete cascade,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (partner_id, key)
);

create table partner_credit_ledger (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity unique,
  partner_id       uuid not null references partners(id) on delete cascade,
  -- topup > 0; call <= 0 (0 = unbilled call, kept so the same call is never debited later); adjustment either way.
  delta            integer not null,
  reason           text not null check (reason in ('topup', 'call', 'adjustment')),
  reference        text not null check (char_length(reference) between 1 and 200),
  idempotency_key  text not null unique check (char_length(idempotency_key) between 3 and 300),
  balance_after    integer not null check (balance_after >= 0),
  meta             jsonb not null default '{}',
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  check (reason <> 'topup' or delta > 0),
  check (reason <> 'call' or delta <= 0)
);
create index partner_credit_ledger_partner_idx on partner_credit_ledger(partner_id, created_at desc, seq desc);

-- One row per call to a partner business number (the parent Twilio call).
create table partner_calls (
  id                    uuid primary key default gen_random_uuid(),
  partner_id            uuid not null references partners(id) on delete cascade,
  call_sid              text not null unique,
  direction             text not null check (direction in ('inbound', 'outbound')),
  from_number           text not null,
  to_number             text not null,
  hunt_group_key        text,
  member_id             uuid references partner_members(id) on delete set null,
  external_id           text,
  answered_leg_sid      text,
  started_at            timestamptz not null,
  answered_at           timestamptz,
  ended_at              timestamptz,
  talk_s                integer check (talk_s is null or talk_s >= 0),
  credits_charged       integer not null default 0 check (credits_charged >= 0),
  billing               text not null default 'pending' check (billing in ('pending', 'billed', 'partial', 'unbilled', 'free')),
  recording_id          uuid references recordings(id) on delete set null,
  -- Set once by the call's end (debit + call.completed happen exactly once).
  finalized_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index partner_calls_partner_idx on partner_calls(partner_id, started_at);
create index partner_calls_member_idx on partner_calls(partner_id, external_id, started_at);

-- Webhook outbox: delivered by the API's timer, exponential backoff (30 s → 4 h), dead after 10 attempts.
create table partner_webhook_events (
  id               uuid primary key default gen_random_uuid(),
  partner_id       uuid not null references partners(id) on delete cascade,
  event_type       text not null check (event_type in ('call.ringing', 'call.answered', 'call.completed', 'recording.ready')),
  payload          jsonb not null,
  attempts         integer not null default 0,
  next_attempt_at  timestamptz,
  delivered_at     timestamptz,
  last_error       text check (char_length(last_error) <= 300),
  created_at       timestamptz not null default now()
);
create index partner_webhook_events_due_idx on partner_webhook_events(next_attempt_at) where delivered_at is null and next_attempt_at is not null;

-- Append-only ledger: no UPDATE, no DELETE.
create or replace function partner_credit_ledger_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'partner_credit_ledger is append-only';
end $$;
create trigger partner_credit_ledger_no_update before update or delete on partner_credit_ledger
  for each row execute function partner_credit_ledger_append_only();

create trigger partners_updated_at before update on partners for each row execute function set_updated_at();
create trigger partner_members_updated_at before update on partner_members for each row execute function set_updated_at();
create trigger partner_hunt_groups_updated_at before update on partner_hunt_groups for each row execute function set_updated_at();
create trigger partner_calls_updated_at before update on partner_calls for each row execute function set_updated_at();

-- Writes and reads go through the API (service role) only.
alter table partners enable row level security;
alter table partner_api_keys enable row level security;
alter table partner_members enable row level security;
alter table partner_hunt_groups enable row level security;
alter table partner_credit_ledger enable row level security;
alter table partner_calls enable row level security;
alter table partner_webhook_events enable row level security;
revoke all on partners, partner_api_keys, partner_members, partner_hunt_groups, partner_credit_ledger, partner_calls,
  partner_webhook_events from anon, authenticated;
