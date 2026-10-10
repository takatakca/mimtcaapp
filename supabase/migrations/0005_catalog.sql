-- Internet / mobile resale: catalogue, service orders, services, devices (SIM/eSIM), install
-- appointments, number port-in and usage snapshots. Spec: docs/MIMT-RESALE.md.
-- Columns match apps/api/src/repo/catalogPostgres.ts (postgres.camel transform: camelCase ↔ snake_case).
-- Same security model as 0001: RLS on, nothing for anon, writes through the API (service role).
-- Integers (not bigint) on purpose: postgres.js returns bigint as strings.

-- consent kinds: keep 0004's list (ai_processing) and add the order flow kinds -----------------
-- (ORDER_CONSENT_KINDS in packages/shared/src/api.ts)
alter table consents drop constraint if exists consents_kind_check;
alter table consents add constraint consents_kind_check
  check (kind in (
    'casl_marketing', 'ads_personalised', 'call_recording_notice', 'privacy_policy', 'terms', 'ai_processing',
    'contract_summary', 'wireless_code', 'internet_code', 'credit_check'
  ));

-- catalogue ------------------------------------------------------------------------------------
create table offers (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique check (code ~ '^[a-z0-9][a-z0-9_.-]{1,63}$'),
  product_line           text not null check (product_line in
                           ('voip_consumer', 'voip_business', 'internet_residential', 'internet_business', 'mobile', 'home_phone', 'tv')),
  provider               text not null check (provider in ('videotron', 'twilio', 'sandbox')),
  provider_product_code  text,
  name                   jsonb not null,
  description            jsonb not null,
  monthly_price_cents    integer not null check (monthly_price_cents >= 0),
  setup_fee_cents        integer not null default 0 check (setup_fee_cents >= 0),
  -- Wireless Code: no commitment longer than 24 months.
  term_months            integer not null default 0 check (term_months between 0 and 24),
  discount_cents         integer not null default 0 check (discount_cents >= 0),
  attributes             jsonb not null default '{}',
  -- Postal-code prefixes ("H", "H2X"); null = no restriction in the catalogue.
  available_fsas         text[],
  status                 text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  stripe_price_id        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index offers_status_idx on offers(status, product_line, monthly_price_cents);

-- orders ---------------------------------------------------------------------------------------
create table service_orders (
  id                        uuid primary key default gen_random_uuid(),
  telecom_account_id        uuid not null references telecom_accounts(id) on delete cascade,
  user_id                   uuid not null references users(id) on delete cascade,
  offer_id                  uuid not null references offers(id),
  offer_code                text not null,
  product_line              text not null,
  provider                  text not null check (provider in ('videotron', 'twilio', 'sandbox')),
  state                     text not null default 'draft' check (state in
                              ('draft', 'submitted', 'credit_check', 'pending_provider', 'scheduled', 'active',
                               'suspended', 'cancel_requested', 'cancelled', 'failed')),
  service_address           jsonb,
  -- Price and term frozen at order time (the contract).
  monthly_price_cents       integer not null check (monthly_price_cents >= 0),
  setup_fee_cents           integer not null default 0 check (setup_fee_cents >= 0),
  term_months               integer not null default 0 check (term_months between 0 and 24),
  discount_cents            integer not null default 0 check (discount_cents >= 0),
  sim_kind                  text check (sim_kind is null or sim_kind in ('sim', 'esim')),
  contract_summary_version  text,
  contract_accepted_at      timestamptz,
  provider_order_id         text,
  failure_reason            text,
  submitted_at              timestamptz,
  activated_at              timestamptz,
  cancelled_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- No order leaves draft without an accepted contract summary.
  check (state in ('draft', 'cancelled', 'failed') or (contract_summary_version is not null and contract_accepted_at is not null))
);
create index service_orders_account_idx on service_orders(telecom_account_id, created_at desc);
create index service_orders_state_idx on service_orders(state, updated_at);
create unique index service_orders_provider_ref_idx on service_orders(provider, provider_order_id) where provider_order_id is not null;

-- Append-only audit trail of the state machine.
create table order_events (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references service_orders(id) on delete cascade,
  event          text not null,
  from_state     text,
  to_state       text,
  actor          text not null check (actor in ('customer', 'admin', 'system', 'provider')),
  actor_user_id  uuid references users(id) on delete set null,
  details        jsonb not null default '{}',
  at             timestamptz not null default now()
);
create index order_events_order_idx on order_events(order_id, at);

-- live services --------------------------------------------------------------------------------
create table service_instances (
  id                           uuid primary key default gen_random_uuid(),
  telecom_account_id           uuid not null references telecom_accounts(id) on delete cascade,
  order_id                     uuid not null unique references service_orders(id),
  offer_id                     uuid not null references offers(id),
  offer_code                   text not null,
  product_line                 text not null,
  provider                     text not null check (provider in ('videotron', 'twilio', 'sandbox')),
  provider_service_id          text,
  status                       text not null default 'active' check (status in ('active', 'suspended', 'cancelled')),
  phone_e164                   text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  service_address              jsonb,
  monthly_price_cents          integer not null check (monthly_price_cents >= 0),
  term_months                  integer not null default 0 check (term_months between 0 and 24),
  discount_cents               integer not null default 0 check (discount_cents >= 0),
  activated_at                 timestamptz not null,
  term_ends_at                 timestamptz,
  cancelled_at                 timestamptz,
  -- Wireless Code bill shock: amounts the account holder agreed to go above the default caps.
  overage_cap_consent_cents    integer check (overage_cap_consent_cents is null or overage_cap_consent_cents >= 0),
  roaming_cap_consent_cents    integer check (roaming_cap_consent_cents is null or roaming_cap_consent_cents >= 0),
  usage_notified               jsonb not null default '{"period": "", "thresholds": []}',
  stripe_subscription_id       text,
  stripe_subscription_item_id  text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);
create index service_instances_account_idx on service_instances(telecom_account_id, created_at desc);
create index service_instances_status_idx on service_instances(status, updated_at);
create unique index service_instances_provider_ref_idx on service_instances(provider, provider_service_id) where provider_service_id is not null;

-- devices: modem, router, SIM, eSIM, phone ------------------------------------------------------
create table devices (
  id                         uuid primary key default gen_random_uuid(),
  telecom_account_id         uuid not null references telecom_accounts(id) on delete cascade,
  order_id                   uuid references service_orders(id) on delete set null,
  service_id                 uuid references service_instances(id) on delete set null,
  kind                       text not null check (kind in ('modem', 'router', 'sim', 'esim', 'phone', 'set_top_box')),
  serial                     text,
  iccid                      text check (iccid is null or iccid ~ '^[0-9]{19,20}$'),
  imei                       text check (imei is null or imei ~ '^[0-9]{15}$'),
  eid                        text check (eid is null or eid ~ '^[0-9]{32}$'),
  mac                        text,
  status                     text not null default 'pending' check (status in ('pending', 'shipped', 'active', 'returned', 'inactive')),
  financed_balance_cents     integer not null default 0 check (financed_balance_cents >= 0),
  -- eSIM LPA activation code, AES-256-GCM (apps/api/src/lib/crypto.ts). Never in clear.
  activation_code_encrypted  text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create index devices_order_idx on devices(order_id, created_at);
create index devices_account_idx on devices(telecom_account_id);

-- technician appointments (internet) -------------------------------------------------------------
create table appointments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references service_orders(id) on delete cascade,
  provider_ref  text,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        text not null default 'booked' check (status in ('booked', 'completed', 'cancelled', 'missed')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index appointments_order_idx on appointments(order_id, starts_at);

-- mobile number port-in --------------------------------------------------------------------------
create table porting_requests (
  id                        uuid primary key default gen_random_uuid(),
  order_id                  uuid not null unique references service_orders(id) on delete cascade,
  telecom_account_id        uuid not null references telecom_accounts(id) on delete cascade,
  phone_e164                text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  losing_carrier            text not null,
  authorized_name           text not null,
  status                    text not null default 'pending' check (status in ('pending', 'submitted', 'confirmed', 'completed', 'rejected', 'cancelled')),
  provider_ref              text,
  reject_reason             text,
  due_at                    timestamptz,
  completed_at              timestamptz,
  -- Losing-carrier authorisation, AES-256-GCM at the application level. Never in clear.
  account_number_encrypted  text not null,
  pin_encrypted             text,
  imei_encrypted            text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index porting_requests_status_idx on porting_requests(status, updated_at);
create index porting_requests_provider_ref_idx on porting_requests(provider_ref) where provider_ref is not null;

-- usage (bill shock, Internet Code notices) -----------------------------------------------------
create table usage_snapshots (
  id               uuid primary key default gen_random_uuid(),
  service_id       uuid not null references service_instances(id) on delete cascade,
  period           text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  data_mb          integer not null default 0 check (data_mb >= 0),
  roaming_data_mb  integer not null default 0 check (roaming_data_mb >= 0),
  voice_minutes    integer not null default 0 check (voice_minutes >= 0),
  sms              integer not null default 0 check (sms >= 0),
  overage_cents    integer not null default 0 check (overage_cents >= 0),
  roaming_cents    integer not null default 0 check (roaming_cents >= 0),
  captured_at      timestamptz not null default now()
);
create index usage_snapshots_service_idx on usage_snapshots(service_id, captured_at desc);

-- updated_at triggers (set_updated_at from 0001) ---------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['offers', 'service_orders', 'service_instances', 'devices', 'appointments', 'porting_requests'] loop
    execute format('create trigger %I_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- Row level security --------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'offers', 'service_orders', 'order_events', 'service_instances', 'devices', 'appointments', 'porting_requests', 'usage_snapshots'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

-- Read-only own-row policies. order_events, devices (eSIM codes) and porting_requests (carrier PIN)
-- have no policy: deny-all for anon and authenticated, served only through the API.
create policy offers_active_read on offers for select to authenticated using (status = 'active');
create policy service_orders_owner_read on service_orders for select to authenticated using (mimt_owns_account(telecom_account_id));
create policy service_instances_owner_read on service_instances for select to authenticated using (mimt_owns_account(telecom_account_id));
create policy appointments_owner_read on appointments for select to authenticated
  using (exists (select 1 from service_orders o where o.id = order_id and mimt_owns_account(o.telecom_account_id)));
create policy usage_snapshots_owner_read on usage_snapshots for select to authenticated
  using (exists (select 1 from service_instances s where s.id = service_id and mimt_owns_account(s.telecom_account_id)));
