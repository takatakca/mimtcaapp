# MIMT — Déploiement et preuve de publication

Vérifié au 2026-10-14. Repository `takatakca/mimtcaapp`, branche `main`. Node 22, pnpm 10.28.0. **Ne pas lancer de builds Node directement sur MochaHost** : GitHub Actions compile les artefacts statiques.

## Environnements

| Nom | Origine | Destination | Procédure |
| --- | --- | --- | --- |
| `mimt.ca` | `apps/web/out/` (Next.js statique) | compte FTPS MochaHost propre au site, répertoire de connexion `./` | automatique après **CI complète réussie** sur `main`; également manuel |
| `app.mimt.ca` | `apps/webphone/dist/` (Vite) | compte FTPS distinct pointant vers le véritable document root `app.mimt.ca`, `./` | manuel; dernier FTP `ENOTFOUND` |
| `api.mimt.ca` | `apps/api/Dockerfile` | application MIMT sur Coolify, proxy HTTPS vers 8080 | manuel (télécom, conformité et paiements restent des portes de lancement) |
| PostgreSQL | `mimt-prod-postgres` | PostgreSQL privée sur Coolify | migration explicite, sauvegardes/restore séparés |

## Secrets GitHub (noms seulement)

- Site : `MOCHAHOST_FTP_SERVER`, `MOCHAHOST_FTP_USERNAME`, `MOCHAHOST_FTP_PASSWORD`.
- Portail : `MOCHAHOST_APP_FTP_SERVER`, `MOCHAHOST_APP_FTP_USERNAME`, `MOCHAHOST_APP_FTP_PASSWORD`.
- API : `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_API_UUID`.
- Variables non secrètes : `FTP_PROTOCOL` (par défaut `ftps`), `API_URL`, `TAKATAK_ISSUER`, `TAKATAK_CLIENT_ID`, `FORMS_ENDPOINT`.

Ne jamais inclure des valeurs dans un commit, une URL, un journal ou une réponse publique.

## Contrôles de livraison

1. Une modification sur `main` déclenche `CI` : installation figée, compilation du paquet partagé, TypeScript, tests unitaires, sites statiques, e2e Playwright et vérifications de sécurité du webphone.
2. Lorsque la CI d'un **push de la branche main** réussit, `Auto deploy MIMT website` commence par le job `release-candidate` (comparaison du SHA CI à `main`). Un ancien commit est **ignoré avant les installations/builds**. Si le SHA est encore courant, `deploy-website` construit ce commit et refait la comparaison dans `release-gate` juste avant FTP. **Un workflow vert dont le job d'envoi est `skipped` ne prouve aucune nouvelle publication.** Vérifier les étapes `Upload` et `Confirm` comme `success` pour annoncer une livraison.
3. Le site publié doit contenir `/mimt-release.json`, par exemple `{"commit":"<sha de 40 caractères>"}`. Le contrôle HTTP compare l'identifiant servi au SHA de la CI, et vérifie la présence de la marque française MIMT et l'absence des anciennes références Fongo. Un transfert seul n'est pas une preuve de succès.
4. Pour publication manuelle : GitHub → Actions → **Deploy** → Run workflow → portée `website`, `webphone`, `api` ou `all`; laisser les chemins FTPS `./` pour les comptes dédiés. Les secrets sont contrôlés uniquement pour la portée choisie.
5. Le portail vérifie le titre `MIMT Web`, le montage `root`, `/connexion`, `/messages` et l'absence d'erreur FTPS. Le serveur Apache doit conserver `apps/webphone/public/.htaccess` pour les URL SPA. Vérifier les assets et TLS indépendamment.
6. L'API nécessite `GET https://api.mimt.ca/healthz` -> `ok:true` et `GET /readyz` -> `ok:true, db:up`. Cela **ne valide pas** appels, SMS, 9-1-1, billing ou conformité.
7. Pour un échec : ouvrir l'étape exacte dans GitHub Actions, classifier DNS/TLS/auth/transfert/docroot/schéma/health, corriger la cause, et éviter de relancer la même erreur sans modification.

**État confirmé le 14 octobre :** [CI 38622709087](https://github.com/takatakca/mimtcaapp/actions/runs/38622709087) et [publication 38622899829](https://github.com/takatakca/mimtcaapp/actions/runs/38622899829) ont réussi au SHA `024dc80ce6de9a8cee5d9bb1ea90ec08ded4ea59`. Une révision ultérieure doit être vérifiée séparément; les envois FTPS `skipped` ne changent pas la production. Les adaptateurs `LogNotifier` et `LogEmailSender` n'envoient pas de messages et ne doivent jamais écrire de contenus clients dans les logs.

## Preuves récentes — 16 octobre 2026

La CI du consentement par utilisateur ([38949670716](https://github.com/takatakca/mimtcaapp/actions/runs/38949670716)), les tests PostgreSQL ([38949670692](https://github.com/takatakca/mimtcaapp/actions/runs/38949670692)) et la publication **du site vitrine seulement** ([38949802395](https://github.com/takatakca/mimtcaapp/actions/runs/38949802395)) ont réussi au SHA `e71fefe21d81fe82aabf95a8f8ec1aa3cc0367d6`. La route API `GET /v1/consents` reste dans le code jusqu'au **déploiement manuel et contrôle de l'API**; ne pas la déclarer disponible depuis la seule réussite du site vitrine. Le commit suivant `b4b0c873...` (effacement local de personnalisation à la déconnexion mobile) nécessite sa propre CI.

## Débogage reproductible

```bash
pnpm install --frozen-lockfile
pnpm --filter @mimt/shared build
pnpm typecheck
pnpm test
pnpm --filter @mimt/web build
pnpm --filter @mimt/webphone build
curl -fsS https://mimt.ca/mimt-release.json
curl -fsS https://api.mimt.ca/healthz
curl -fsS https://api.mimt.ca/readyz
```

Les requêtes sont **en lecture seule** et échouent si DNS/TLS n'est pas disponible. Pour l'app : vérifier dans un navigateur sans cache `https://app.mimt.ca/connexion` et `https://app.mimt.ca/messages`.

**Attention** : `MOCHAHOST_APP_FTP_SERVER` était invalide à la dernière publication manuelle examinée (run 38116824409). Il faut un véritable **nom DNS FTP**, sans `ftp://`, numéro de port ni répertoire. Ne pas réutiliser l'identifiant FTPS du site vitrine sur la racine du portail.

## Sauvegarde chiffrée PostgreSQL privée (outil prêt, production non configurée)

`bash scripts/db/backup-mimt.sh` est un utilitaire **manuel / cron Coolify séparé**; il ne migre rien, ne restaure rien et n'exécute aucune transaction d'écriture. Il fait un `pg_dump --format=custom` **sans archive en clair sur disque**, chiffre le flux avec une **clé publique age** et envoie l'objet chiffré en S3 avec chiffrement côté stockage (`--sse AES256`). Il contrôle les octets de l'objet distant. La script refuse toute base autre que `mimt_production`, le rôle inattendu ou un hôte Supabase. Le test CI `bash scripts/db/test-backup-mimt.sh` simule les fournisseurs sans accès ni secret réel.

Conditions à mettre dans un environnement de sauvegarde privé (noms seulement, ne pas coller de valeurs dans GitHub) :

- Accès PostgreSQL privé : `PGHOST`, `PGPORT`, `PGUSER=mimt_owner`, `PGDATABASE=mimt_production`, `PGPASSWORD`, **`PGSSLMODE=verify-full`** et CA TLS authentique correspondant au nom de l'hôte; le mot de passe n'apparaît pas dans les arguments de commande. La sauvegarde refuse le mode TLS permissif; configurer le certificat avant le premier lancement.
- Chiffrement : `MIMT_BACKUP_AGE_RECIPIENT` (**clé publique** age uniquement). Conserver la clé de déchiffrement séparément, avec procédure de récupération.
- Stockage hors hôte : `MIMT_BACKUP_S3_BUCKET`, facultatif `MIMT_BACKUP_S3_PREFIX`, identifiants AWS/compatible provenant d'un gestionnaire de secrets. Privilégier un coffre avec versioning, règles de rétention et suppression bloquée.
- Exécutables disponibles dans l'environnement de sauvegarde : `pg_dump` (version compatible PostgreSQL 17), `age`, `aws`, Bash. Planifier une cadence quotidienne *après* validation humaine du stockage et des coûts. Alerter si un job échoue ou aucun objet récent n'existe.

**Restauration de preuve obligatoire :** créer une base **jetable**, hors production et distincte de `mimt_production`, avec des autorisations minimales; télécharger un objet chiffré, puis `age --decrypt -i /chemin/protégé/identité.age` en flux vers `pg_restore --no-owner --no-acl` sur cette base jetable. Contrôler les tables, le contenu attendu de façon non sensible et les migrations, puis détruire l'environnement d'essai. Ne jamais diriger cette commande vers la production ou la base TAKATAK. Le contrôle de taille S3 du script **ne prouve pas** qu'une restauration fonctionne.

Documents complémentaires : [MIMT-LAUNCH.md](MIMT-LAUNCH.md), [MIMT-SELFHOSTED-POSTGRES-RECOVERY.md](MIMT-SELFHOSTED-POSTGRES-RECOVERY.md), [issue #5](https://github.com/takatakca/mimtcaapp/issues/5).
