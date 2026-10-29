-- MIMT: « Google Agenda » connector (docs/MIMT-CALENDAR.md). Calls, missed calls, voicemails and AI call summaries
-- become events in the user's Google Calendar. API: apps/api/src/routes/calendar.ts, apps/api/src/services/calendar.ts,
-- apps/api/src/repo/calendarPostgres.ts. Kill switch CALENDAR=on|off (default off).
--
-- Law 25 / security rules, enforced here and in the API:
--  - the Google refresh token is stored ENCRYPTED (AES-256-GCM, MESSAGE_ENCRYPTION_KEY, same helper as the affiliate
--    PII); no access token is stored; tokens are never logged;
--  - the outbox holds references only (source type + id), never call content: the worker reads the call, voicemail
--    or summary when it sends, and puts content in Google only with the user's opt-in (include_content);
--  - one job per (user, source type, source id): an event is queued at most once, and its Google event id is derived
--    from the same triple, so a retry never creates a second event.

create table calendar_connections (
  user_id                   uuid primary key references users(id) on delete cascade,
  provider                  text not null default 'google' check (provider = 'google'),
  -- Google account shown in the app (openid email scope).
  google_email              text check (char_length(google_email) <= 254),
  refresh_token_encrypted   text not null,
  scope                     text not null check (char_length(scope) <= 1000),
  -- Only the primary calendar: creating a dedicated calendar needs the broader « calendar » scope.
  calendar_id               text not null default 'primary' check (calendar_id = 'primary'),
  status                    text not null default 'active' check (status in ('active', 'needs_reconnect')),
  sync_calls                boolean not null default true,
  sync_missed_calls         boolean not null default true,
  sync_voicemails           boolean not null default true,
  sync_summaries            boolean not null default true,
  -- Opt-in (default off): AI summary or transcript excerpt in the event description.
  include_content           boolean not null default false,
  -- « Reconnectez Google Agenda » sent once per broken connection; cleared on reconnect.
  reconnect_notified_at     timestamptz,
  last_sync_at              timestamptz,
  connected_at              timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table calendar_sync_jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  source_type      text not null check (source_type in ('call', 'voicemail', 'call_summary')),
  -- call: Twilio CallSid; voicemail: voicemails.id; call_summary: recordings.id (Affaires Pro call recording).
  source_id        text not null check (char_length(source_id) between 1 and 100),
  status           text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts         integer not null default 0 check (attempts >= 0),
  next_attempt_at  timestamptz,
  google_event_id  text check (google_event_id ~ '^[a-v0-9]{5,}$' and char_length(google_event_id) <= 1024),
  last_error       text check (char_length(last_error) <= 300),
  created_at       timestamptz not null default now(),
  done_at          timestamptz,
  unique (user_id, source_type, source_id)
);
create index calendar_sync_jobs_due_idx on calendar_sync_jobs(next_attempt_at) where status = 'pending';
create index calendar_sync_jobs_done_idx on calendar_sync_jobs(done_at) where status <> 'pending';

create trigger calendar_connections_updated_at before update on calendar_connections for each row execute function set_updated_at();

-- Writes and reads go through the API (service role) only.
alter table calendar_connections enable row level security;
alter table calendar_sync_jobs enable row level security;
revoke all on calendar_connections, calendar_sync_jobs from anon, authenticated;
