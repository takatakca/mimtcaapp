# MIMT — Mobile Innovation Modern Telecommunications

**Votre numéro canadien, partout.** Appels, textos, messagerie vocale et téléphonie d'affaires par Internet (VoIP), au Québec et au Canada.
Un membre de l'écosystème **GROUPE TAKATAK** ([takatak.ca](https://takatak.ca)).

> Statut au 14 octobre 2026 : **pré-lancement**. Le site vitrine `https://mimt.ca` est public et l'API PostgreSQL avait été déclarée prête le 11 octobre ; le lancement des services télécom n'est **pas** autorisé. Le portail Web et les intégrations Twilio, 9-1-1, paiements, sauvegardes et conformité doivent être validés séparément. Voir `docs/MIMT-LAUNCH.md` et l'issue #5.

## Contenu du dépôt

| Dossier | Quoi |
| --- | --- |
| `apps/api` | API MIMT (Node.js 22, Fastify, TypeScript) : comptes, numéros, voix et SMS Twilio, 9-1-1, anti-fraude, Stripe, lien TAKATAK |
| `apps/mobile` | App iOS/Android (React Native + Expo, SDK Twilio Voice officiel) |
| `apps/web` | Site public mimt.ca (Next.js, export statique, français d'abord) |
| `packages/shared` | Forfaits, plafonds, cycle de vie des numéros, types de l'API (une seule source de vérité) |
| `supabase/migrations` | SQL versionné pour PostgreSQL **privé MIMT sur Coolify** (nom du répertoire conservé pour compatibilité; voir le runbook) |
| `docs/` | Recherche réglementaire, coûts, architecture et plan MVP, charte TAKATAK |

## Partage des rôles

- **TAKATAK** : identité maîtresse, registre des entreprises, espaces de travail, vérification, activation.
- **MIMT** : comptes télécom, numéros, voix, SMS/MMS, messagerie vocale, facturation télécom, Twilio.

Le lien entre les deux est **signé côté serveur** : OAuth avec PKCE et JWT signés. **Jamais de mot de passe ni de jeton dans une URL.**

## Démarrer

```bash
pnpm install
pnpm build        # shared d'abord, puis les apps
pnpm test
pnpm --filter @mimt/api dev
pnpm --filter @mimt/web dev
pnpm --filter @mimt/mobile start   # nécessite un build de développement (voir apps/mobile/README.md)
```

## Secrets

Aucun secret dans le code, le chat ou les URL. Les clés Twilio, Stripe, stockage médias (Supabase Storage si employé), PostgreSQL MIMT et TAKATAK vont dans les secrets de l'environnement (Coolify ou cloud). Voir chaque `.env.example`.

## Règles non négociables

1. **9-1-1 n'est jamais bloqué** : ni par un plafond, ni par le crédit, ni par le forfait, ni par une suspension.
2. Pas d'appel sortant vers le réseau public (RTPC) avant que l'adresse 9-1-1 soit enregistrée et que l'avis de limites soit accepté.
3. Français d'abord : interface, conditions, messages vocaux et soutien.
4. Interdit de copier un concurrent : ni texte, ni nom, ni prix.


## Mise en ligne

Liste du propriétaire pour le lancement : [docs/MIMT-LAUNCH.md](docs/MIMT-LAUNCH.md). La base API de production est la PostgreSQL MIMT privée sur Coolify, **pas** le Supabase central TAKATAK; les migrations doivent suivre le [runbook autonome](docs/MIMT-SELFHOSTED-POSTGRES-RECOVERY.md).

**Relève permanente :** [état](docs/PROJECT_STATUS.md) · [tâches](docs/TASK_QUEUE.md) · [transfert d'agent](docs/AGENT_HANDOFF.md) · [déploiement](docs/DEPLOYMENT.md) · [décisions](docs/DECISIONS.md).

- **Site vitrine** : chaque CI réussie sur `main` déclenche `.github/workflows/auto-deploy-website.yml` (FTPS vers la racine du compte dédié à mimt.ca), puis une vérification HTTP publique. Les secrets GitHub `MOCHAHOST_FTP_SERVER`, `MOCHAHOST_FTP_USERNAME` et `MOCHAHOST_FTP_PASSWORD` doivent correspondre à ce compte. Un transfert est **réussi** uniquement si l'action et la vérification en direct passent.
- **Portail Web et API** : publication manuelle `Actions → Deploy → Run workflow`, portée `webphone` ou `api`. Le portail utilise un compte FTPS séparé ; un hôte inexistant retourne une erreur DNS explicite. Le workflow vérifie aussi les liens profonds SPA après publication.
- **Sécurité** : la publication du site n'active pas l'inscription télécom, l'appel RTPC, le 9-1-1 ni la facturation. Les autorisations et tests opérationnels restent obligatoires avant ouverture.

---

## English

MIMT is a Canadian VoIP and SMS app with a business phone service, part of the GROUPE TAKATAK ecosystem.

The repository is a pnpm monorepo:
- `apps/api` (Fastify);
- `apps/mobile` (Expo with the Twilio Voice SDK);
- `apps/web` (Next.js static site);
- `packages/shared`.

Also `apps/webphone` (app.mimt.ca, web softphone and business portal) and `e2e/` (Playwright). Owner go-live checklist: [docs/MIMT-LAUNCH.md](docs/MIMT-LAUNCH.md).
