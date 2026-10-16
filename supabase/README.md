# MIMT — Migrations SQL PostgreSQL (répertoire historique `supabase/`)

**État depuis le 11 octobre 2026 : MIMT utilise une base PostgreSQL 17 PRIVÉE et autonome dans Coolify (`mimt-prod-postgres`, base `mimt_production`).** Le nom historique du répertoire ne signifie **pas** que l'API MIMT peut utiliser le projet Supabase central TAKATAK.

**Danger : ne jamais exécuter `supabase db push`, `psql ... -f` ou une migration de ce répertoire sur `TAKATAK User Official Dashboard V1`, même si une ancienne variable `DATABASE_URL` y pointe encore.**

## Source du schéma

Les fichiers `migrations/*.sql` restent la source versionnée pour le PostgreSQL MIMT. Ils incluent :

- `0001_init.sql` : comptes, données télécom, 9-1-1, messages chiffrés, consentements et audit.
- `0002_push_tokens.sql` : notifications des appareils.
- Les deux migrations `0003_*.sql` : PBX et appareils/récompenses, dans l'ordre déterministe du migrateur.
- `0004_ai.sql`, `0005_catalog.sql`, `0006_blocks_forwarding.sql`, `0007_media_greetings.sql`, `0008_referrals_addons.sql`, `0009_port_in.sql`, `0010_meetings.sql` (réunions vidéo).

Les migrations initialement écrites pour Supabase peuvent employer des rôles, helpers et politiques RLS. L'instance autonome charge un bootstrap de compatibilité, **pas un faux service Supabase Auth/Storage**. La connexion API est un compte PostgreSQL restreint à la base MIMT; l'API applique les règles d'accès par utilisateur et par entreprise.

## Méthode de migration en production

Lire **[MIMT-SELFHOSTED-POSTGRES-RECOVERY.md](../docs/MIMT-SELFHOSTED-POSTGRES-RECOVERY.md)** avant d'agir. Le conteneur API regroupe le SQL avec `deploy/coolify/mimt-postgres-bootstrap.sql` et le job `apps/api/src/jobs/migrateStandalone.ts`. Le migrateur refuse les cibles Supabase ou non reconnues, nécessite une confirmation explicite et suit les checksums dans `mimt_schema_migrations`.

Seulement dans le **conteneur API MIMT sur Coolify**, après preuve que `DATABASE_URL` cible `mimt_production` sur la ressource **privée** MIMT et avec une fenêtre de changement approuvée :

```bash
MIMT_STANDALONE_MIGRATE_CONFIRM=YES_MY_PRIVATE_MIMT_DATABASE node dist/jobs/migrateStandalone.js
```

Cette commande ne doit pas être relancée pour contourner une erreur de connexion ou TLS. Voir l'issue #5 et le runbook avant tout changement de schéma. Vérifier les migrations réellement appliquées et `GET /readyz` avant d'annoncer une base prête.

## Autres services de stockage

La base PostgreSQL Coolify **ne fournit pas** le Storage Supabase. Les fonctionnalités MMS, enregistrements et messages d'accueil utilisant `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` doivent avoir un stockage privé distinct configuré et validé. Ne pas déduire leur fonctionnement du statut `db:up`.

## English

The `supabase/` path is legacy nomenclature for **MIMT-owned SQL migrations**. Production uses MIMT's isolated, private Coolify PostgreSQL 17 database; it must **never** apply migrations to TAKATAK's master Supabase project. Use the explicitly confirmed standalone migrator from the runbook; never run an unscoped `supabase db push`. Backups and tested restoration are required before telecom public launch.
