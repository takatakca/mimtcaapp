-- MIMT: « MIMT Connect » lot B (issue #97, docs/MIMT-CONNECT.md « Statut du membre »): the linked person's
-- subscription and number-transfer status for the partner (read from existing tables, nothing copied here), and the
-- member's availability for the partner's hunt groups. API: apps/api/src/services/partnerMembers.ts,
-- apps/api/src/routes/partners.ts. Kill switch PARTNERS=on|off (default off), as in 0023.
--
-- Rules enforced HERE:
--  - one availability row per member; the partner's status and the linked person's own status are separate columns
--    (the person's wins; the rule is in the API and the doc);
--  - weekly windows use the business-hours shape ({"mon":[{"open":"09:00","close":"17:00"}],…}), America/Montreal;
--  - member.subscription_changed is sent only when the minimal view changes: the last view sent is kept per link.

create table partner_member_availability (
  member_id    uuid primary key references partner_members(id) on delete cascade,
  partner_id   uuid not null references partners(id) on delete cascade,
  status       text not null default 'available' check (status in ('available', 'busy', 'offline')),
  weekly       jsonb check (weekly is null or jsonb_typeof(weekly) = 'object'),
  until        timestamptz,
  -- The linked MIMT user's own status (webphone Compte › Intégrations › Partenaires); null = the partner decides.
  user_status  text check (user_status is null or user_status in ('available', 'busy', 'offline')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index partner_member_availability_partner_idx on partner_member_availability(partner_id);
create trigger partner_member_availability_updated_at before update on partner_member_availability for each row execute function set_updated_at();

-- Last subscription view sent to the partner for this link (plan|status|period end|can call): dedupes the webhook.
alter table partner_member_links add column subscription_state text check (subscription_state is null or char_length(subscription_state) <= 200);

alter table partner_webhook_events drop constraint partner_webhook_events_event_type_check;
alter table partner_webhook_events add constraint partner_webhook_events_event_type_check check (event_type in (
  'call.ringing', 'call.answered', 'call.completed', 'recording.ready', 'member.linked', 'member.unlinked', 'member.number_changed',
  'member.subscription_changed', 'member.port_in_updated', 'member.availability_changed'
));

alter table partner_member_availability enable row level security;
revoke all on partner_member_availability from anon, authenticated;
