-- MIMT: number port-in (landline / VoIP number moved INTO MIMT on Twilio).
-- Not the mobile port to a SIM of the resale flow (porting_requests, 0005_catalog.sql).
-- API: apps/api/src/routes/portIns.ts. Contract: packages/shared/src/portIn.ts.
--
-- Loi 25: the losing carrier's account number and PIN are encrypted by the API (AES-256-GCM,
-- MessageCipher) before insert. Both tables have RLS on and no policy: deny-all for anon and
-- authenticated; every read and write goes through the API (service role).

create table port_in_requests (
  id                        uuid primary key default gen_random_uuid(),
  telecom_account_id        uuid not null references telecom_accounts(id) on delete cascade,
  user_id                   uuid not null references users(id) on delete cascade,
  business_id               uuid references businesses(id) on delete set null,
  kind                      text not null check (kind in ('consumer', 'business')),
  status                    text not null default 'pending_signature' check (status in (
                              'pending_signature', 'signed', 'submitted', 'action_required',
                              'foc_scheduled', 'completed', 'rejected', 'canceled')),
  current_carrier           text not null check (length(current_carrier) between 2 and 100),
  customer_type             text not null check (customer_type in ('individual', 'business')),
  customer_name             text not null,
  authorized_name           text not null,
  authorized_email          text not null,
  service_address           jsonb not null,
  account_number_encrypted  text not null,
  pin_encrypted             text,
  temporary_number          text check (temporary_number ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  keep_temporary_number     boolean not null default false,
  desired_date              text check (desired_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  fee_cents                 integer not null default 0 check (fee_cents >= 0),
  -- Electronic signature of the letter of authorization (typed name + time + IP + document hash).
  loa_version               text,
  loa_signed_name           text,
  loa_signed_at             timestamptz,
  loa_signed_ip             text,
  loa_user_agent            text,
  loa_sha256                text check (loa_sha256 ~ '^[0-9a-f]{64}$'),
  -- Twilio Porting API port-in request SID (KW…).
  carrier_ref               text unique,
  status_reason             text,
  completed_at              timestamptz,
  canceled_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check ((loa_signed_at is null) = (loa_signed_name is null))
);
create index port_in_requests_account_idx on port_in_requests(telecom_account_id, created_at desc);
create index port_in_requests_business_idx on port_in_requests(business_id, created_at desc) where business_id is not null;
create index port_in_requests_status_idx on port_in_requests(status, updated_at);

create table port_in_numbers (
  id                uuid primary key default gen_random_uuid(),
  port_in_id        uuid not null references port_in_requests(id) on delete cascade,
  e164              text not null check (e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  status            text not null default 'pending' check (status in (
                      'pending', 'submitted', 'action_required', 'foc_scheduled', 'completed', 'rejected', 'canceled')),
  foc_date          text check (foc_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  rejection_reason  text,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (port_in_id, e164)
);
-- One open port per number across all requests.
create unique index port_in_numbers_open_e164_idx on port_in_numbers(e164)
  where status in ('pending', 'submitted', 'action_required', 'foc_scheduled');
create index port_in_numbers_request_idx on port_in_numbers(port_in_id);

create trigger port_in_requests_updated_at before update on port_in_requests for each row execute function set_updated_at();
create trigger port_in_numbers_updated_at before update on port_in_numbers for each row execute function set_updated_at();

alter table port_in_requests enable row level security;
alter table port_in_numbers enable row level security;
revoke all on port_in_requests from anon;
revoke all on port_in_numbers from anon;
-- No policy on purpose (carrier account number and PIN): served only through the API.
