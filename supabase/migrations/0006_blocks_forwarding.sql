-- Consumer call controls (docs/MIMT-PARITY.md P0 items 2-3, P1 item 7):
--   blocked_numbers: calls rejected (or sent to voicemail), texts dropped without notification.
--   call_settings:   call forwarding (always / no answer), do not disturb with quiet hours.
-- 9-1-1 is never affected: these rows are only read on the inbound path.

create table blocked_numbers (
  id                  uuid primary key default gen_random_uuid(),
  telecom_account_id  uuid not null references telecom_accounts(id) on delete cascade,
  e164                text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  label               text check (label is null or char_length(label) <= 80),
  created_at          timestamptz not null default now(),
  unique (telecom_account_id, e164)
);

create table call_settings (
  telecom_account_id     uuid primary key references telecom_accounts(id) on delete cascade,
  forwarding_mode        text not null default 'off' check (forwarding_mode in ('off', 'always', 'no_answer')),
  forwarding_target      text check (forwarding_target is null or forwarding_target ~ '^\+1[2-9][0-9]{9}$'),
  forwarding_timeout_s   integer not null default 20 check (forwarding_timeout_s between 5 and 60),
  dnd_enabled            boolean not null default false,
  -- WeeklySchedule (packages/shared business.ts) of quiet hours; null = on all the time when enabled.
  dnd_schedule           jsonb,
  blocked_call_action    text not null default 'reject' check (blocked_call_action in ('reject', 'voicemail')),
  updated_at             timestamptz not null default now(),
  check (forwarding_mode = 'off' or forwarding_target is not null)
);

create trigger call_settings_updated_at before update on call_settings for each row execute function set_updated_at();

-- Same model as 0001: RLS on, nothing for anon, owners may only read their own rows.
-- Writes go through the API (service role).
alter table blocked_numbers enable row level security;
alter table call_settings enable row level security;
revoke all on blocked_numbers from anon;
revoke all on call_settings from anon;
create policy blocked_numbers_owner_read on blocked_numbers for select to authenticated using (mimt_owns_account(telecom_account_id));
create policy call_settings_owner_read on call_settings for select to authenticated using (mimt_owns_account(telecom_account_id));
