-- MIMT: « MIMT Connect » lot A (issue #97, docs/MIMT-CONNECT.md « Liaison de compte »): a partner member is tied to a
-- real MIMT user only with that user's proof and consent, the member's « ligne » is one of that user's own numbers,
-- and the partner can place click-to-call for the member. API: apps/api/src/services/partnerLinks.ts,
-- apps/api/src/routes/partners.ts. Kill switch PARTNERS=on|off (default off), as in 0023.
--
-- Rules enforced HERE:
--  - a link code is stored hashed (SHA-256), never in clear; it is single use (used_at), expires (expires_at) and dies
--    after 5 wrong attempts on its request (invalidated_at);
--  - one MIMT user is linked to at most one member per partner, and one member to at most one user (partial unique
--    indexes on the active links);
--  - links are revoked, never deleted (revoked_at, revoked_by), so the audit trail stays readable.

-- Short name used in links sent to the partner's members (https://app.mimt.ca/numero?partner=<slug>).
alter table partners add column slug text check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{0,39}$');
create unique index partners_slug_key on partners(slug) where slug is not null;

create table partner_link_requests (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references partners(id) on delete cascade,
  member_id       uuid not null references partner_members(id) on delete cascade,
  code_sha256     text not null unique check (code_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at      timestamptz not null,
  attempts        integer not null default 0 check (attempts >= 0),
  used_at         timestamptz,
  -- A newer request for the same member, or 5 wrong attempts.
  invalidated_at  timestamptz,
  created_at      timestamptz not null default now()
);
create index partner_link_requests_member_idx on partner_link_requests(member_id, created_at desc);

create table partner_member_links (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references partners(id) on delete cascade,
  member_id   uuid not null references partner_members(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  -- The member's line: one of the linked user's own numbers (checked by the API when attached and at each call).
  number_id   uuid references phone_numbers(id) on delete set null,
  request_id  uuid references partner_link_requests(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  text check (revoked_by in ('user', 'partner', 'system')),
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index partner_member_links_member_active on partner_member_links(member_id) where revoked_at is null;
create unique index partner_member_links_user_active on partner_member_links(partner_id, user_id) where revoked_at is null;
create index partner_member_links_user_idx on partner_member_links(user_id) where revoked_at is null;
create trigger partner_member_links_updated_at before update on partner_member_links for each row execute function set_updated_at();

-- Click-to-call: the partner's own reference, and the member is known from the start (outbound calls).
alter table partner_calls add column reference text check (reference is null or char_length(reference) <= 100);
create index partner_calls_open_member_idx on partner_calls(member_id, started_at) where finalized_at is null;

alter table partner_webhook_events drop constraint partner_webhook_events_event_type_check;
alter table partner_webhook_events add constraint partner_webhook_events_event_type_check check (event_type in (
  'call.ringing', 'call.answered', 'call.completed', 'recording.ready', 'member.linked', 'member.unlinked', 'member.number_changed'
));

alter table partner_link_requests enable row level security;
alter table partner_member_links enable row level security;
revoke all on partner_link_requests, partner_member_links from anon, authenticated;
