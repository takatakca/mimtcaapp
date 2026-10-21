-- MIMT: handles (@nom) so users without a phone number can text each other. Contract: packages/shared/src/handles.ts.
-- Handle-to-handle texts live in `messages` with our_number = sender handle and peer = other handle; they never
-- reach the carrier. One handle per user, chosen once. RLS on, API only.

create table user_handles (
  handle              text primary key check (handle ~ '^@[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$'),
  user_id             uuid not null unique references users(id) on delete cascade,
  telecom_account_id  uuid not null references telecom_accounts(id) on delete cascade,
  created_at          timestamptz not null default now()
);
create index user_handles_account_idx on user_handles(telecom_account_id);

alter table user_handles enable row level security;
