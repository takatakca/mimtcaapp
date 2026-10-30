-- MIMT: Google sign-in (signup = email or Google, free, no passkey at signup).
-- API: apps/api/src/auth/google.ts, route POST /v1/auth/google/exchange.
-- Additive only: two nullable columns, one partial unique index. No existing data touched.
-- google_sub is unique: one Google account links to at most one MIMT user.
-- The email index is on lower(email) and partial (where not null): account linking by verified
-- email is case-insensitive, and users without an email are unaffected.

alter table users add column if not exists google_sub text unique;
alter table users add column if not exists email_verified_at timestamptz;
create unique index if not exists users_email_lower_unique_idx on users(lower(email)) where email is not null;
