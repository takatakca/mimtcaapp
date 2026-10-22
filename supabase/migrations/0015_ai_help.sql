-- MIMT: in-app help assistant (POST /v1/ai/help) is metered like every AI feature.
alter table ai_usage drop constraint if exists ai_usage_feature_check;
alter table ai_usage add constraint ai_usage_feature_check
  check (feature in ('voicemail_summary', 'sms_suggestions', 'spam_classification', 'receptionist', 'help_assistant'));
