-- MMS media, custom voicemail greetings and voicemail to email (docs/MIMT-PARITY.md P0-4, P1-4).
-- Same security model as 0001: RLS on, nothing for anon, writes through the API (service role).
-- Files live in the private Storage bucket "media" (SUPABASE_MEDIA_BUCKET); rows here only point to them.

-- media objects ----------------------------------------------------------------------------------
create table media_objects (
  id                  uuid primary key default gen_random_uuid(),
  telecom_account_id  uuid not null references telecom_accounts(id) on delete cascade,
  kind                text not null check (kind in ('mms_out', 'mms_in', 'greeting')),
  status              text not null check (status in ('pending', 'ready')),
  -- Object path in the bucket ("mms/<account>/<id>.jpg", "greetings/<account>/<id>.mp3").
  path                text check (path is null or path ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]{0,180}$'),
  -- Twilio media URL, only while the copy to our bucket has not happened.
  twilio_url          text check (twilio_url is null or twilio_url like 'https://api.twilio.com/%'),
  content_type        text not null,
  size_bytes          integer check (size_bytes is null or size_bytes >= 0),
  -- The message is purged with the number; the file then waits for expires_at (retention job).
  message_id          uuid references messages(id) on delete set null,
  -- Retention: MMS 180 days, unused uploads 24 h, active greetings never (null).
  expires_at          timestamptz,
  created_at          timestamptz not null default now()
);
create index media_objects_message_idx on media_objects(message_id) where message_id is not null;
create index media_objects_expiry_idx on media_objects(expires_at) where expires_at is not null;
create index media_objects_account_idx on media_objects(telecom_account_id, created_at desc);

-- voicemail settings (one row per telecom account) ----------------------------------------------
create table voicemail_settings (
  telecom_account_id  uuid primary key references telecom_accounts(id) on delete cascade,
  greeting_media_id   uuid references media_objects(id) on delete set null,
  email_enabled       boolean not null default false,
  updated_at          timestamptz not null default now()
);

-- email outbox (voicemail to email). Rendered at send time; no body or link is stored. ----------
create table email_outbox (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  template         text not null check (template in ('voicemail_received')),
  payload          jsonb not null default '{}'::jsonb,
  attempts         integer not null default 0,
  next_attempt_at  timestamptz,
  sent_at          timestamptz,
  last_error       text,
  created_at       timestamptz not null default now()
);
create index email_outbox_due_idx on email_outbox(next_attempt_at) where sent_at is null and next_attempt_at is not null;

alter table media_objects enable row level security;
alter table voicemail_settings enable row level security;
alter table email_outbox enable row level security;
revoke all on media_objects from anon;
revoke all on voicemail_settings from anon;
revoke all on email_outbox from anon;

-- Read-only own rows. email_outbox has no policy (deny-all for clients).
create policy media_objects_owner_read on media_objects for select to authenticated using (mimt_owns_account(telecom_account_id));
create policy voicemail_settings_owner_read on voicemail_settings for select to authenticated using (mimt_owns_account(telecom_account_id));

-- Private bucket with a server-side size cap, so a signed upload URL cannot be used for a huge file.
-- No MIME allowlist: inbound MMS can be any type Twilio relays; the API checks size and magic bytes of
-- every upload before use and deletes what fails. Skipped outside Supabase (no storage schema).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('media', 'media', false, 10485760)
    on conflict (id) do nothing;
  end if;
end $$;
