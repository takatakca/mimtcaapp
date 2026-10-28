-- « Pilote MIMT » (AI command bar, docs/MIMT-PILOTE.md): its Claude usage is counted in ai_usage like every AI
-- feature, under its own name so costs stay visible per feature. Plans themselves are short-lived (2 min) and kept
-- in the API's memory; executed actions are recorded in audit_log (action "ai.pilot_executed", no message content).

alter table ai_usage drop constraint if exists ai_usage_feature_check;
alter table ai_usage add constraint ai_usage_feature_check
  check (feature in ('voicemail_summary', 'sms_suggestions', 'spam_classification', 'receptionist', 'help_assistant', 'call_summary', 'pilot_command'));
