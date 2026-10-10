-- MIMT Affaires: business PBX (phase 2, docs/MIMT-MVP.md §5 and §8; recording notice: MIMT-REGULATORY.md §6).
-- Built on Twilio Programmable Voice. A business owns a telecom_accounts row (kind = 'business') that holds
-- its plan (business / business_pro), Stripe subscription, numbers and usage ledger.
-- Routing targets are stored as jsonb (shape: packages/shared/src/business.ts RouteTarget) and validated by the API.

create table businesses (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(name) between 1 and 120),
  takatak_business_id   text,
  telecom_account_id    uuid not null unique references telecom_accounts(id) on delete restrict,
  main_number           text check (main_number is null or main_number ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  locale                text not null default 'fr-CA' check (locale in ('fr-CA', 'en-CA')),
  recording_mode        text not null default 'off' check (recording_mode in ('off', 'all', 'on_demand')),
  recording_consent_fr  text not null default 'Cet appel peut être enregistré à des fins de qualité et de formation.',
  recording_consent_en  text not null default 'This call may be recorded for quality and training purposes.',
  recording_retention_days integer not null default 90 check (recording_retention_days between 1 and 2555),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index businesses_takatak_idx on businesses(takatak_business_id) where takatak_business_id is not null;

create table business_members (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  user_id      uuid references users(id) on delete cascade,
  email        text check (email is null or char_length(email) <= 320),
  role         text not null check (role in ('owner', 'admin', 'member')),
  status       text not null default 'invited' check (status in ('invited', 'active')),
  invited_by   uuid references users(id) on delete set null,
  claimed_at   timestamptz,
  created_at   timestamptz not null default now(),
  check (user_id is not null or email is not null)
);
create unique index business_members_user_idx on business_members(business_id, user_id) where user_id is not null;
create unique index business_members_email_idx on business_members(business_id, lower(email)) where email is not null;
create index business_members_user_lookup_idx on business_members(user_id) where user_id is not null;
create index business_members_pending_email_idx on business_members(lower(email)) where status = 'invited';

create table extensions (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references businesses(id) on delete cascade,
  number              text not null check (number ~ '^[1-9][0-9]{2,3}$'),
  user_id             uuid references users(id) on delete set null,
  display_name        text not null check (char_length(display_name) between 1 and 80),
  voicemail_enabled   boolean not null default true,
  voicemail_greeting_fr text,
  voicemail_greeting_en text,
  forward_to_mobile   text check (forward_to_mobile is null or forward_to_mobile ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  did                 text check (did is null or did ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  ring_timeout_s      integer not null default 20 check (ring_timeout_s between 5 and 120),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, number)
);
create index extensions_user_idx on extensions(user_id) where user_id is not null;

create table ring_groups (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  number       text check (number is null or number ~ '^[1-9][0-9]{2,3}$'),
  strategy     text not null check (strategy in ('simultaneous', 'sequential')),
  timeout_s    integer not null default 20 check (timeout_s between 5 and 120),
  overflow     jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index ring_groups_number_idx on ring_groups(business_id, number) where number is not null;

create table ring_group_members (
  ring_group_id  uuid not null references ring_groups(id) on delete cascade,
  extension_id   uuid not null references extensions(id) on delete cascade,
  position       integer not null,
  primary key (ring_group_id, extension_id)
);
create index ring_group_members_extension_idx on ring_group_members(extension_id);

create table ivr_menus (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references businesses(id) on delete cascade,
  name                    text not null check (char_length(name) between 1 and 80),
  greeting_fr             text not null,
  greeting_en             text not null,
  greeting_recording_url  text check (greeting_recording_url is null or greeting_recording_url ~ '^https://'),
  timeout_s               integer not null default 6 check (timeout_s between 2 and 30),
  max_retries             integer not null default 2 check (max_retries between 0 and 5),
  timeout_target          jsonb,
  invalid_target          jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table ivr_options (
  ivr_menu_id  uuid not null references ivr_menus(id) on delete cascade,
  digit        text not null check (digit ~ '^[0-9*#]$'),
  target       jsonb not null,
  primary key (ivr_menu_id, digit)
);

-- One row per business. weekly: {"mon":[{"open":"09:00","close":"17:00"}], ...} in America/Montreal.
create table business_hours (
  business_id      uuid primary key references businesses(id) on delete cascade,
  timezone         text not null default 'America/Montreal' check (timezone = 'America/Montreal'),
  weekly           jsonb not null,
  quebec_holidays  boolean not null default true,
  open_target      jsonb not null,
  closed_target    jsonb not null,
  updated_at       timestamptz not null default now()
);

-- Custom closures (Quebec statutory holidays are computed by the API when business_hours.quebec_holidays).
create table holidays (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  date         date not null,
  name         text not null check (char_length(name) between 1 and 80),
  unique (business_id, date)
);

create table did_routes (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  phone_number_id  uuid not null unique references phone_numbers(id) on delete cascade,
  e164             text not null unique,
  target           jsonb not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index did_routes_business_idx on did_routes(business_id);

-- Call recordings (Affaires Pro). Audio stays at Twilio until copied to private storage; deleted after retention.
create table recordings (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  call_sid        text not null,
  recording_sid   text not null unique,
  recording_url   text,
  extension_id    uuid references extensions(id) on delete set null,
  user_id         uuid references users(id) on delete set null,
  source          text not null check (source in ('all', 'on_demand')),
  from_number     text,
  to_number       text,
  duration_s      integer,
  retention_days  integer not null check (retention_days between 1 and 2555),
  delete_after    timestamptz not null,
  created_at      timestamptz not null default now()
);
create index recordings_business_idx on recordings(business_id, created_at desc);
create index recordings_delete_after_idx on recordings(delete_after);

-- Per-line billing: the seat count mirrors the Stripe subscription quantity.
create table business_seats (
  business_id             uuid primary key references businesses(id) on delete cascade,
  seats                   integer not null default 1 check (seats between 1 and 500),
  stripe_subscription_id  text,
  updated_at              timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['businesses', 'extensions', 'ring_groups', 'ivr_menus', 'business_hours', 'did_routes', 'business_seats'] loop
    execute format('create trigger %I_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- Row level security: same model as 0001. RLS on everywhere, nothing for anon; authenticated users may only
-- read rows of businesses they are an active member of. All writes go through the API (service role).
create or replace function mimt_business_member(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from business_members m
    where m.business_id = bid and m.user_id = mimt_current_user_id() and m.status = 'active'
  )
$$;

create or replace function mimt_business_admin(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from business_members m
    where m.business_id = bid and m.user_id = mimt_current_user_id() and m.status = 'active' and m.role in ('owner', 'admin')
  )
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'businesses', 'business_members', 'extensions', 'ring_groups', 'ring_group_members', 'ivr_menus', 'ivr_options',
    'business_hours', 'holidays', 'did_routes', 'recordings', 'business_seats'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

create policy businesses_member_read on businesses for select to authenticated using (mimt_business_member(id));
create policy business_members_member_read on business_members for select to authenticated
  using (mimt_business_member(business_id) or user_id = mimt_current_user_id());
create policy extensions_member_read on extensions for select to authenticated using (mimt_business_member(business_id));
create policy ring_groups_member_read on ring_groups for select to authenticated using (mimt_business_member(business_id));
create policy ring_group_members_member_read on ring_group_members for select to authenticated
  using (exists (select 1 from ring_groups g where g.id = ring_group_id and mimt_business_member(g.business_id)));
create policy ivr_menus_member_read on ivr_menus for select to authenticated using (mimt_business_member(business_id));
create policy ivr_options_member_read on ivr_options for select to authenticated
  using (exists (select 1 from ivr_menus m where m.id = ivr_menu_id and mimt_business_member(m.business_id)));
create policy business_hours_member_read on business_hours for select to authenticated using (mimt_business_member(business_id));
create policy holidays_member_read on holidays for select to authenticated using (mimt_business_member(business_id));
create policy did_routes_member_read on did_routes for select to authenticated using (mimt_business_member(business_id));
-- Recordings: owners/admins see all; a member sees the ones of their own calls.
create policy recordings_read on recordings for select to authenticated
  using (mimt_business_admin(business_id) or (user_id = mimt_current_user_id() and mimt_business_member(business_id)));
create policy business_seats_admin_read on business_seats for select to authenticated using (mimt_business_admin(business_id));

revoke execute on function mimt_business_member(uuid) from public, anon;
revoke execute on function mimt_business_admin(uuid) from public, anon;
grant execute on function mimt_business_member(uuid) to authenticated;
grant execute on function mimt_business_admin(uuid) to authenticated;
