-- AI features (Claude): voicemail intelligence, spam scores, smart-reply usage, AI receptionist.
-- Spec: docs/MIMT-AI.md. Law 25: AI processing of a user's voicemail/SMS needs the separate consent
-- "ai_processing"; the receptionist needs the business owner's acceptance (accepted_at below).
-- Same security model as 0001: RLS on, nothing for anon, writes through the API (service role).

-- consent kind ---------------------------------------------------------------------------------
alter table consents drop constraint if exists consents_kind_check;
alter table consents add constraint consents_kind_check
  check (kind in ('casl_marketing', 'ads_personalised', 'call_recording_notice', 'privacy_policy', 'terms', 'ai_processing'));

-- voicemail intelligence -----------------------------------------------------------------------
alter table voicemails
  add column ai_summary            text,
  add column ai_locale             text check (ai_locale is null or ai_locale in ('fr-CA', 'en-CA')),
  add column ai_caller_intent      text,
  add column ai_urgency            text check (ai_urgency is null or ai_urgency in ('low', 'normal', 'high')),
  add column ai_callback_suggested boolean,
  add column ai_spam_likelihood    numeric(3, 2) check (ai_spam_likelihood is null or ai_spam_likelihood between 0 and 1),
  add column ai_model              text,
  add column ai_processed_at       timestamptz;

-- spam / fraud labels (calls by Twilio call SID, messages by id) ---------------------------------
create table spam_scores (
  id                  uuid primary key default gen_random_uuid(),
  telecom_account_id  uuid not null references telecom_accounts(id) on delete cascade,
  target_type         text not null check (target_type in ('call', 'message')),
  target_ref          text not null,
  verdict             text not null check (verdict in ('spam', 'scam', 'ok')),
  score               numeric(3, 2) not null check (score between 0 and 1),
  reason              text not null,
  source              text not null check (source in ('heuristic', 'ai')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (target_type, target_ref)
);
create index spam_scores_account_idx on spam_scores(telecom_account_id, created_at desc);

-- AI usage and cost (monthly budget per plan: AI_MONTHLY_BUDGET_CAD_CENTS in packages/shared/src/ai.ts) -----
create table ai_usage (
  telecom_account_id  uuid not null references telecom_accounts(id) on delete cascade,
  period              text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  feature             text not null check (feature in ('voicemail_summary', 'sms_suggestions', 'spam_classification', 'receptionist')),
  model               text not null,
  requests            integer not null default 0,
  input_tokens        bigint not null default 0,
  output_tokens       bigint not null default 0,
  cache_read_tokens   bigint not null default 0,
  cache_write_tokens  bigint not null default 0,
  -- Estimated cost in millionths of a CAD dollar.
  cost_micro_cad      bigint not null default 0,
  updated_at          timestamptz not null default now(),
  primary key (telecom_account_id, period, feature, model)
);

-- AI receptionist (business) -------------------------------------------------------------------
create table ai_receptionist_configs (
  business_id          uuid primary key references businesses(id) on delete cascade,
  telecom_account_id   uuid not null references telecom_accounts(id) on delete cascade,
  enabled              boolean not null default false,
  business_name        text not null check (char_length(business_name) between 1 and 120),
  greeting             text check (greeting is null or char_length(greeting) <= 500),
  faq_markdown         text not null default '' check (char_length(faq_markdown) <= 20000),
  hours_text           text not null default '' check (char_length(hours_text) <= 2000),
  address              text check (address is null or char_length(address) <= 300),
  languages            text[] not null default array['fr-CA'],
  -- [{key, label, number?, extension?}]
  transfer_targets     jsonb not null default '[]'::jsonb,
  -- Owner's acceptance of the AI receptionist terms (AI disclosure, transcripts sent to the AI provider).
  accepted_at          timestamptz,
  accepted_by_user_id  uuid references users(id) on delete set null,
  accepted_version     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger ai_receptionist_configs_updated_at before update on ai_receptionist_configs for each row execute function set_updated_at();

-- Messages taken by the AI receptionist (voicemail-like records).
create table ai_receptionist_messages (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references businesses(id) on delete cascade,
  telecom_account_id  uuid not null references telecom_accounts(id) on delete cascade,
  call_sid            text,
  caller_number       text,
  name                text not null,
  callback_number     text not null,
  reason              text not null,
  created_at          timestamptz not null default now()
);
create index ai_receptionist_messages_business_idx on ai_receptionist_messages(business_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['spam_scores', 'ai_usage', 'ai_receptionist_configs', 'ai_receptionist_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

create policy spam_scores_owner_read on spam_scores for select to authenticated using (mimt_owns_account(telecom_account_id));
create policy ai_usage_owner_read on ai_usage for select to authenticated using (mimt_owns_account(telecom_account_id));
create policy ai_receptionist_configs_owner_read on ai_receptionist_configs for select to authenticated using (mimt_owns_account(telecom_account_id));
create policy ai_receptionist_messages_owner_read on ai_receptionist_messages for select to authenticated using (mimt_owns_account(telecom_account_id));
