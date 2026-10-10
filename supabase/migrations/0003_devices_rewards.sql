-- Devices attested with App Attest / Play Integrity, and AdMob rewards waiting to be claimed.
-- The API uses the service role. No policy for anon or authenticated: these rows are not readable from the client.

create table attested_devices (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null check (platform in ('ios', 'android')),
  device_key   text not null check (char_length(device_key) between 8 and 256),
  user_id      uuid not null references users(id) on delete cascade,
  verified_at  timestamptz not null,
  unique (platform, device_key)
);
create index attested_devices_user_idx on attested_devices(user_id);
alter table attested_devices enable row level security;
revoke all on attested_devices from anon, authenticated;

create table ad_rewards (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  transaction_id  text not null unique,
  minutes         integer not null check (minutes > 0 and minutes <= 60),
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz
);
create index ad_rewards_user_idx on ad_rewards(user_id) where claimed_at is null;
alter table ad_rewards enable row level security;
revoke all on ad_rewards from anon, authenticated;
