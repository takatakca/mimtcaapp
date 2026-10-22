-- MIMT Affaires: AI summary of each recorded business call (transcript by Twilio Conversation Intelligence,
-- summary by Claude). Stored ENCRYPTED (MessageCipher); deleted with the recording. RLS on, API only.

create table call_summaries (
  recording_id       uuid primary key references recordings(id) on delete cascade,
  summary_encrypted  text not null,
  locale             text not null check (locale in ('fr-CA', 'en-CA')),
  model              text,
  created_at         timestamptz not null default now()
);

alter table call_summaries enable row level security;

alter table ai_usage drop constraint if exists ai_usage_feature_check;
alter table ai_usage add constraint ai_usage_feature_check
  check (feature in ('voicemail_summary', 'sms_suggestions', 'spam_classification', 'receptionist', 'help_assistant', 'call_summary'));
