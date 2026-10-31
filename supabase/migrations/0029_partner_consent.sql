-- MIMT: « MIMT Connect » two-sided granular consent (owner's order 2026-10-31, docs/MIMT-CONNECT.md « Consentement »).
-- Law 25 (Québec) and PIPEDA: consent is manifest, free, informed, given for specific purposes, asked for each purpose
-- separately, recorded, revocable and symmetrical (the partner commits too). API: apps/api/src/services/partnerConsent.ts,
-- apps/api/src/services/partnerLinks.ts, apps/api/src/routes/partners.ts. Kill switch PARTNERS=on|off, as in 0023.
--
-- Rules enforced HERE:
--  - a partner's acceptance of the MIMT Connect partner terms and DPA is a row that is never updated (trigger), with
--    the signer, the legal name, the privacy contact and a declared purpose per scope;
--  - a link carries the scopes the person granted (only known scope names), the consent text and scope set versions;
--  - every consent step (grant, upgrade, one scope removed, unlink, this migration) leaves a receipt that is never
--    updated (trigger); it keeps a coarse device label and a network class (a.b.c.0/24 or /48), never the full IP;
--  - the partner API access log keeps no request or response body; the API deletes rows after 90 days (daily job);
--  - links approved before this migration keep ONLY the lot A scopes their screen showed (calls.read, calls.place,
--    line.manage); the lot B scopes (subscription.read, porting.read, availability.manage) and recordings.read are
--    not granted until the person approves them (owner: « always ask »).

create table partner_terms_acceptances (
  id                     uuid primary key default gen_random_uuid(),
  partner_id             uuid not null references partners(id) on delete cascade,
  terms_version          text not null check (char_length(terms_version) between 1 and 40),
  accepted_at            timestamptz not null,
  signer_name            text not null check (char_length(signer_name) between 1 and 120),
  signer_title           text not null check (char_length(signer_title) between 1 and 120),
  legal_name             text not null check (char_length(legal_name) between 1 and 200),
  privacy_contact_email  text not null check (char_length(privacy_contact_email) between 3 and 254),
  -- {"calls.read": "purpose…", …}: the only scopes the partner may ask its members for.
  purposes               jsonb not null check (jsonb_typeof(purposes) = 'object'),
  recorded_by            uuid references users(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index partner_terms_acceptances_partner_idx on partner_terms_acceptances(partner_id, created_at desc);

create or replace function partner_consent_no_update() returns trigger language plpgsql as $$
begin
  raise exception '% rows are never updated', tg_table_name;
end $$;
create trigger partner_terms_acceptances_no_update before update on partner_terms_acceptances
  for each row execute function partner_consent_no_update();

-- The grant on the link itself (what is enforced on every request).
alter table partner_member_links
  add column scopes            text[] not null default '{}'
    check (scopes <@ array['calls.read', 'calls.place', 'line.manage', 'subscription.read', 'porting.read', 'availability.manage', 'recordings.read']::text[]),
  add column required_scopes   text[] not null default '{}'
    check (required_scopes <@ array['calls.read', 'calls.place', 'line.manage', 'subscription.read', 'porting.read', 'availability.manage', 'recordings.read']::text[]),
  add column purposes          jsonb not null default '{}'::jsonb check (jsonb_typeof(purposes) = 'object'),
  add column consent_version   text check (consent_version is null or char_length(consent_version) <= 40),
  add column scope_set_version integer check (scope_set_version is null or scope_set_version >= 0),
  add column consented_at      timestamptz;

-- A request asks for named scopes with a purpose each; an « upgrade » request changes the scopes of an existing link.
alter table partner_link_requests
  add column kind    text not null default 'link' check (kind in ('link', 'upgrade')),
  add column link_id uuid references partner_member_links(id) on delete cascade,
  add column scopes  jsonb not null default '[]'::jsonb check (jsonb_typeof(scopes) = 'array'),
  add constraint partner_link_requests_upgrade_link check ((kind = 'upgrade') = (link_id is not null));

create table partner_consent_receipts (
  id                 uuid primary key default gen_random_uuid(),
  link_id            uuid not null references partner_member_links(id) on delete cascade,
  partner_id         uuid not null references partners(id) on delete cascade,
  member_id          uuid not null references partner_members(id) on delete cascade,
  user_id            uuid not null references users(id) on delete cascade,
  action             text not null check (action in ('granted', 'upgraded', 'scope_revoked', 'revoked', 'migrated')),
  actor              text not null check (actor in ('user', 'partner', 'system')),
  scopes             text[] not null,
  changed            text[] not null default '{}',
  required_scopes    text[] not null default '{}',
  purposes           jsonb not null default '{}'::jsonb check (jsonb_typeof(purposes) = 'object'),
  consent_version    text not null check (char_length(consent_version) <= 40),
  scope_set_version  integer not null check (scope_set_version >= 0),
  terms_version      text check (terms_version is null or char_length(terms_version) <= 40),
  -- Coarse only (apps/api/src/lib/clientInfo.ts): « Chrome · Windows » and « 203.0.113.0/24 ». Never a full IP.
  device             text check (device is null or char_length(device) <= 60),
  network            text check (network is null or (char_length(network) <= 50 and network ~ '/(24|48)$')),
  created_at         timestamptz not null default now()
);
create index partner_consent_receipts_link_idx on partner_consent_receipts(link_id, created_at desc);
create trigger partner_consent_receipts_no_update before update on partner_consent_receipts
  for each row execute function partner_consent_no_update();

-- « Journal d'accès »: which scope, when, which route. Never a body, a query string or an IP address.
create table partner_access_log (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references partners(id) on delete cascade,
  link_id     uuid not null references partner_member_links(id) on delete cascade,
  scope       text not null check (scope in ('calls.read', 'calls.place', 'line.manage', 'subscription.read', 'porting.read', 'availability.manage', 'recordings.read')),
  route       text not null check (char_length(route) <= 120 and route !~ '[?]'),
  outcome     text not null check (outcome in ('allowed', 'denied')),
  at          timestamptz not null default now()
);
create index partner_access_log_link_idx on partner_access_log(link_id, at desc);
create index partner_access_log_at_idx on partner_access_log(at);

-- Calls and webhook events remember the link they were made under, so scopes are checked against that consent.
alter table partner_calls add column link_id uuid references partner_member_links(id) on delete set null;
alter table partner_webhook_events add column link_id uuid references partner_member_links(id) on delete set null;

alter table partner_webhook_events drop constraint partner_webhook_events_event_type_check;
alter table partner_webhook_events add constraint partner_webhook_events_event_type_check check (event_type in (
  'call.ringing', 'call.answered', 'call.completed', 'recording.ready', 'member.linked', 'member.unlinked', 'member.number_changed',
  'member.subscription_changed', 'member.port_in_updated', 'member.availability_changed', 'member.consent_updated'
));

-- ---------------------------------------------------------------------- links approved before this migration
-- Lot A's screen listed: the calls routed to the person, calls on their behalf, the number chosen as line. Nothing else.
update partner_member_links
   set scopes = array['calls.read', 'calls.place', 'line.manage']::text[],
       consent_version = 'lot-a-2026-10-30',
       scope_set_version = 0,
       consented_at = created_at;

insert into partner_consent_receipts (link_id, partner_id, member_id, user_id, action, actor, scopes, changed, consent_version, scope_set_version, created_at)
select id, partner_id, member_id, user_id, 'migrated', 'system', scopes, scopes, consent_version, scope_set_version, now()
  from partner_member_links where revoked_at is null;

alter table partner_member_links
  alter column consent_version set not null,
  alter column scope_set_version set not null,
  alter column consented_at set not null;

-- Pending codes were issued without named scopes: they can no longer be approved (the partner asks again).
update partner_link_requests set invalidated_at = now() where used_at is null and invalidated_at is null;

-- Calls answered or placed under a link: remember which one.
update partner_calls c set link_id = l.id
  from partner_member_links l
 where c.member_id = l.member_id and c.started_at >= l.created_at and (l.revoked_at is null or c.started_at < l.revoked_at);

alter table partner_terms_acceptances enable row level security;
alter table partner_consent_receipts enable row level security;
alter table partner_access_log enable row level security;
revoke all on partner_terms_acceptances, partner_consent_receipts, partner_access_log from anon, authenticated;
