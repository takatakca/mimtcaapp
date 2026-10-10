# Supabase (MIMT)

**FR —** Schéma Postgres de l'API MIMT, dans un projet Supabase **séparé de TAKATAK** (région `ca-central-1`, Loi 25).

- `migrations/0001_init.sql` : toutes les tables (utilisateurs, comptes télécom, abonnements, droits, numéros, adresses et avis 9-1-1, appels, messages chiffrés, messagerie vocale, consentements, registre d'utilisation, fraude, handoff TAKATAK, outbox, audit).
- `migrations/0002_push_tokens.sql` : jetons de notification des appareils (APNs/FCM) par utilisateur et plateforme, RLS lecture de ses propres lignes.
- `migrations/0003_devices_rewards.sql` : appareils attestés et récompenses publicitaires. Aucune politique de lecture (rôle service seulement).
- Bucket Storage privé `voicemail` (à créer dans le projet Supabase, pas public). L'API y copie les messages vocaux quand `SUPABASE_URL` et la clé service sont dans l'environnement.
- RLS est activé sur **toutes** les tables. Le rôle `anon` n'a aucun accès. Les utilisateurs `authenticated` peuvent seulement **lire** leurs propres lignes (via `users.auth_user_id = auth.uid()`). Les tables sensibles (jetons, handoff, fraude, outbox, audit, désabonnements) n'ont aucune politique : refus total sauf pour le rôle service.
- L'API se connecte avec la chaîne de connexion directe / service role (`DATABASE_URL`) et contourne RLS ; elle applique elle-même les règles d'accès.
- Les corps de messages sont chiffrés par l'API (AES-256-GCM) avant l'insertion ; la base ne voit jamais le texte en clair.

Appliquer : `supabase db push` (CLI liée au projet) ou `psql "$DATABASE_URL" -f migrations/0001_init.sql -f migrations/0002_push_tokens.sql -f migrations/0003_devices_rewards.sql` (dans l'ordre).

**EN —** Postgres schema for the MIMT API, in a Supabase project **separate from TAKATAK** (`ca-central-1`).

- RLS is enabled on every table; `anon` gets nothing; `authenticated` can only read its own rows (mapped by `users.auth_user_id = auth.uid()`); sensitive tables have no policy (deny-all except service role).
- The API connects with the service-role/direct connection string and enforces access itself.
- Apply with `supabase db push` or `psql "$DATABASE_URL" -f migrations/0001_init.sql`.
- Local check without Supabase: create roles `anon`, `authenticated`, `service_role` and a stub `auth.uid()` function first (see `apps/api/README.md`, "Tests against Postgres").
