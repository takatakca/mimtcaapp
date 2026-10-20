-- MIMT: launch pricing (docs/MIMT-UNIT-ECONOMICS.md). Plans now cap messages in BOTH directions (Twilio bills
-- receiving), outbound MMS, and app-to-app minutes on the free plan. Counters only; nothing else changes.
alter table usage_ledger
  add column sms_in          integer not null default 0,
  add column mms_out         integer not null default 0,
  add column minutes_on_net  integer not null default 0;
