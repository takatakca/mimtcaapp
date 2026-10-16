-- MIMT: Réunions MIMT (video meetings on LiveKit). API: apps/api/src/routes/meetings.ts.
-- Contract: packages/shared/src/meetings.ts. Docs: docs/MIMT-VIDEO.md.
--
-- Nothing of the audio/video is stored: LiveKit relays the media, MIMT keeps the meeting, the
-- invitations and an append-only event log. Guest links are capabilities: only the SHA-256 of
-- the token is stored. RLS on everywhere, nothing for anon; authenticated users may read their
-- own meetings and those of businesses they belong to. Every write goes through the API.

create table meetings (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid references businesses(id) on delete cascade,
  host_user_id     uuid not null references users(id) on delete cascade,
  title            text not null check (char_length(title) between 1 and 120),
  -- Random, unguessable LiveKit room name (never derived from the title or ids).
  room_name        text not null unique check (room_name ~ '^mimt-[a-z0-9-]{16,64}$'),
  scheduled_start  timestamptz,
  scheduled_end    timestamptz,
  status           text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended')),
  lobby_enabled    boolean not null default true,
  started_at       timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start)
);
create index meetings_host_idx on meetings(host_user_id, created_at desc);
create index meetings_business_idx on meetings(business_id, created_at desc) where business_id is not null;

create table meeting_invites (
  id                uuid primary key default gen_random_uuid(),
  meeting_id        uuid not null references meetings(id) on delete cascade,
  email             text check (email is null or char_length(email) <= 320),
  user_id           uuid references users(id) on delete cascade,
  role              text not null default 'guest' check (role in ('host', 'participant', 'guest')),
  -- SHA-256 hex of the guest token in the link. The token itself is never stored.
  guest_token_hash  text unique check (guest_token_hash is null or guest_token_hash ~ '^[0-9a-f]{64}$'),
  expires_at        timestamptz not null,
  used_at           timestamptz,
  created_at        timestamptz not null default now()
);
create index meeting_invites_meeting_idx on meeting_invites(meeting_id, created_at);
create index meeting_invites_user_idx on meeting_invites(user_id) where user_id is not null;

-- Append-only: the API only inserts. No update/delete trigger needed since nothing else writes.
create table meeting_events (
  id          bigint generated always as identity primary key,
  meeting_id  uuid not null references meetings(id) on delete cascade,
  type        text not null check (type in ('started', 'joined', 'left', 'ended', 'admitted')),
  -- LiveKit participant identity (user id, or guest-…).
  identity    text check (identity is null or char_length(identity) <= 128),
  user_id     uuid references users(id) on delete set null,
  at          timestamptz not null default now()
);
create index meeting_events_meeting_idx on meeting_events(meeting_id, id);

create trigger meetings_updated_at before update on meetings for each row execute function set_updated_at();

create or replace function mimt_meeting_visible(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from meetings m
    where m.id = mid
      and (m.host_user_id = mimt_current_user_id()
        or (m.business_id is not null and mimt_business_member(m.business_id))
        or exists (select 1 from meeting_invites i where i.meeting_id = m.id and i.user_id = mimt_current_user_id()))
  )
$$;

alter table meetings enable row level security;
alter table meeting_invites enable row level security;
alter table meeting_events enable row level security;
revoke all on meetings, meeting_invites, meeting_events from anon;
revoke insert, update, delete on meetings, meeting_invites, meeting_events from authenticated;

create policy meetings_member_read on meetings for select to authenticated using (mimt_meeting_visible(id));
-- Invitations carry emails: only the host (or a business admin) reads them; guest token hashes stay server-side.
create policy meeting_invites_host_read on meeting_invites for select to authenticated using (
  exists (select 1 from meetings m where m.id = meeting_id
    and (m.host_user_id = mimt_current_user_id() or (m.business_id is not null and mimt_business_admin(m.business_id))))
);
create policy meeting_events_member_read on meeting_events for select to authenticated using (mimt_meeting_visible(meeting_id));

revoke execute on function mimt_meeting_visible(uuid) from public, anon;
grant execute on function mimt_meeting_visible(uuid) to authenticated;
