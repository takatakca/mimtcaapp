-- MIMT security hardening (docs/MIMT-SECURITY.md): session inventory, passkeys (WebAuthn), business strong-auth policy.
-- API: apps/api/src/routes/security.ts, apps/api/src/auth/sessions.ts. RLS on everywhere, API only.
--
-- Law 25 minimisation: a session keeps a COARSE device label (browser and OS family, e.g. "Chrome · Windows") and a
-- COARSE network (/24 for IPv4, /48 for IPv6). Never the full user agent, never the full IP address. Revoked or idle
-- sessions are deleted after 90 days (jobs/sessionRetention.ts) and on account purge.

-- One row per sign-in. id = the refresh-token family id, and the "sid" claim of every access token of that family.
create table auth_sessions (
  id              uuid primary key,
  user_id         uuid not null references users(id) on delete cascade,
  method          text not null check (method in ('takatak', 'sms', 'passkey', 'legacy')),
  user_agent      text check (user_agent is null or char_length(user_agent) <= 64),
  ip_prefix       text check (ip_prefix is null or char_length(ip_prefix) <= 64),
  created_at      timestamptz not null default now(),
  -- Written at most every 5 minutes.
  last_seen_at    timestamptz not null default now(),
  -- Last passkey or SMS-code authentication in this session (step-up for sensitive actions, 10 minutes).
  recent_auth_at  timestamptz,
  -- Last passkey authentication in this session (business require_strong_auth).
  strong_auth_at  timestamptz,
  revoked_at      timestamptz
);
create index auth_sessions_user_idx on auth_sessions(user_id, last_seen_at desc);
create index auth_sessions_retention_idx on auth_sessions(last_seen_at);

-- WebAuthn credentials. The public key is not a secret; the private key never leaves the user's device.
create table passkeys (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  credential_id  text not null unique check (char_length(credential_id) between 16 and 1024),
  public_key     text not null check (char_length(public_key) <= 4096),
  counter        bigint not null default 0 check (counter >= 0),
  transports     text[] not null default '{}',
  device_type    text not null default 'singleDevice' check (device_type in ('singleDevice', 'multiDevice')),
  backed_up      boolean not null default false,
  name           text not null check (char_length(name) between 1 and 60),
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz
);
create index passkeys_user_idx on passkeys(user_id);

-- Business-account policy. require_strong_auth: owners and admins need a passkey step-up in the session before the
-- business admin routes answer. Default off.
create table business_security_policies (
  business_id          uuid primary key references businesses(id) on delete cascade,
  require_strong_auth  boolean not null default false,
  updated_by           uuid references users(id) on delete set null,
  updated_at           timestamptz not null default now()
);

alter table auth_sessions enable row level security;
alter table passkeys enable row level security;
alter table business_security_policies enable row level security;
