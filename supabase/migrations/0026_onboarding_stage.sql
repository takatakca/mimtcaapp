-- MIMT: purchase-time auth flow (onboarding_stage).
-- Decided flow: signup = email/Google only (no passkey at signup); at phone-number purchase the
-- owner verifies their phone once by SMS, then creates a passkey on their device, which unlocks the
-- full dashboard. Later logins use the passkey only (one SMS per customer lifetime).
-- API: apps/api/src/repo/types.ts (User.onboardingStage), routes/auth.ts (OTP verify advances the
-- stage), routes/security.ts (passkey registration advances the stage),
-- services/numberProvisioning.ts (purchase gate defers provisioning until the phone is verified).
-- Additive only: one column with a default; no existing data touched, no existing code changed
-- except the purchase-completion hook (old behavior preserved when the owner is already verified).

alter table users add column if not exists onboarding_stage text not null default 'signed_up';
