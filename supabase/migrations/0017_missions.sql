-- MIMT: « Missions MIMT » (docs/MIMT-MISSIONS.md). One-time rewards granted by the API when IT sees the event
-- (SMS sign-in, handle saved, web push saved, device attested, paid number, referral, yearly plan). Never on the
-- client's word. API: apps/api/src/services/missions.ts, packages/shared/src/missions.ts.
--
-- Anti-abuse, enforced by the database (a concurrent second grant fails on a unique index, it is not credited):
--  - once per account and mission                      UNIQUE (telecom_account_id, mission_id)
--  - once per owner identity and mission (phone number for SMS accounts, TAKATAK id otherwise): deleting the account
--    and signing up again with the same phone earns nothing again             UNIQUE (mission_id, owner_hash)
--  - install_app once per attested device                                       UNIQUE (mission_id, device_hash)
-- owner_hash and device_hash are keyed HMACs (server key, MessageCipher.subjectHash): no phone number, TAKATAK id
-- or device key is stored, and they cannot be reversed by trying every phone number.
-- Kept when an account is deleted (like fraud_events and audit_log): without it, delete + sign up would re-grant.

create table mission_rewards (
  id                  uuid primary key default gen_random_uuid(),
  telecom_account_id  uuid not null references telecom_accounts(id) on delete cascade,
  mission_id          text not null check (mission_id in ('verify_phone', 'choose_handle', 'enable_push', 'install_app',
                                                          'first_number', 'invite_friend', 'go_yearly')),
  -- Total of all missions is 150 minutes (MISSION_MINUTES_CAP); one mission never gives more than 60.
  minutes             integer not null check (minutes between 0 and 60),
  -- outbound = paid plans' bonus_minutes_out; on_net = the free plan's app-to-app pool; null = no minutes.
  bucket              text check (bucket in ('outbound', 'on_net')),
  -- granted = minutes added to `period`; pending = free-tier budget reached, added on a later month.
  status              text not null default 'granted' check (status in ('granted', 'pending')),
  period              text check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  owner_hash          text check (char_length(owner_hash) between 16 and 128),
  device_hash         text check (char_length(device_hash) between 16 and 128),
  -- What triggered it, without personal data (e.g. "otp", "handle", "stripe:sub_…", "referral:<uuid>").
  source_ref          text not null check (char_length(source_ref) between 1 and 200),
  granted_at          timestamptz not null default now(),
  credited_at         timestamptz,
  unique (telecom_account_id, mission_id),
  check ((minutes = 0) = (bucket is null)),
  check (status = 'pending' or minutes = 0 or period is not null)
);
create unique index mission_rewards_owner_uidx on mission_rewards(mission_id, owner_hash) where owner_hash is not null;
create unique index mission_rewards_device_uidx on mission_rewards(mission_id, device_hash) where device_hash is not null;
create index mission_rewards_pending_idx on mission_rewards(telecom_account_id) where status = 'pending';

-- Bonus app-to-app (on-net) minutes: the free plan's useful minutes (it has no phone-network number).
alter table usage_ledger add column bonus_minutes_on_net integer not null default 0;

alter table mission_rewards enable row level security;
