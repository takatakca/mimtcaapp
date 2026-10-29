# MIMT — Déploiement et preuve de publication

## Vérification reprise du 29 octobre 2026

Actions #40846814733 : vérification réussie du manifeste public `mimt-release.json` au SHA `93d303d0e3128652e5a0230edc2d61c77acd34c9` après plusieurs lectures anciennes; ce contrôle valide **la vitrine seulement**. Actions #40846623390 : déploiement API demandé à Coolify, `healthz` et `readyz` passés, sans API commit/version certifié dans les journaux. Surveillance #40935863819 : trois services UP. L'ancien workflow manuel `deploy.yml` garde encore des portées FTP obsolètes; la PR #77 les retire, ne pas utiliser ces portées. L'issue #69 reste le suivi des preuves. La correction MON-ALERT-01 (sur branche, non publiée) ajoute des erreurs de notification visibles et la vérification `schema=current` dans la surveillance, sans toucher aux déploiements ou aux données clients.

## Reprise vérifiée — 26 octobre 2026, Codex

PR #63–#68 fusionnées, main vérifié c308dd8; CI 40420964736 réussie. Publication 40421110321 échouée : manifeste 8d38458 pendant 60 essais. Surveillance 40438511037 : trois services UP, sans comparaison de SHA. Les crédits ont bloqué la revue automatique Claude, pas la sauvegarde des modifications.
**État : vérification documentaire terminée; finalisation production bloquée par accès Coolify/réseau et tests réels.**
La démo IA a une preuve d'activation le 25 octobre; sa disponibilité actuelle contredit le journal du 26 et reste à contrôler avant de demander une clé.
Voir [la vérification finale](FINAL_AUDIT_2026-10-26.md) et [l'action #69](https://github.com/takatakca/mimtcaapp/issues/69) : preuves, limites et prochaines étapes exactes. Les sections datées plus anciennes ci-dessous sont historiques.


## API publiée — 25 octobre 2026, activation Anthropic

- Révision déployée : `c27010bd83d37a4e9d681f6005df58641839f101`, CI `40174104925` réussie avant publication.
- Coolify : déploiement manuel `linln0s30zq4vib8j514clio`, début 14:01:35 UTC, conteneur sain à 14:05:10, mise à jour roulante terminée à 14:05:15 UTC. La clé a été saisie par le propriétaire; aucune valeur lue ou enregistrée par l'agent.
- Contrôles après publication : HTTP 200 `/healthz`, `/readyz` (`db:up`, `schema:current`), `/v1/public/ai-demo/status` (`available:true`). Trois réponses fournisseur réelles en français via POST `/v1/public/ai-demo` (restaurant, soutien, rendez-vous); parcours restaurant dans mimt.ca terminé avec confirmation et ticket fictifs.
- Aucun SMS réel, rendez-vous réel ou commande réelle créé. Aucun déploiement webphone/mobile effectué; aucune certification télécom ou des fonctions IA privées depuis ces seuls essais.

## Reprise du 25 octobre 2026 — sauvegardes

Base revue `9605bee5417c5a5e7cefef74028d17f796cc1dd8` : CI `40083012517`, PostgreSQL `40083012511`, publication vitrine `40083110006` réussis; manifeste vitrine correspondant. App encore `612284efba406d3bf708f2a4e0c574000fde5fed`; aucun nouveau déploiement webphone/API dans cette reprise. Sauvegardes Coolify quotidiennes locales et première restauration réelle isolée terminées : preuve actuelle dans `MIMT-BACKUPS.md`. Le calendrier fonctionne; R2, restauration distante et livraison d'alertes restent à configurer. Absence de clé Anthropic confirmée dans l'API MIMT.


## Contrôle direct du 24 octobre 2026 (Codex)

Baseline examinée : `25a0520db3568397c5d50e3950f9aac6cd4e9424`. Au dernier contrôle HTTP, le manifeste de la vitrine sert ce SHA; celui d'app.mimt.ca sert encore `612284efba406d3bf708f2a4e0c574000fde5fed`. L'app répond sur `/connexion/texto`. API : health/readiness HTTP 200, `db:up`, `schema:current`; démo IA `available:false`. Aucun redéploiement, secret changé, numéro acheté ou backup de production effectué par Codex dans cette intervention. Avant toute action, relire HEAD et les publications car d'autres agents publient aussi. Les variables IA serveur sont désormais listées dans `.env.example`; le plan d'activation et ses accès sont dans `MIMT-ACTIVATION.md`.


Vérifié au 2026-10-14. Repository `takatakca/mimtcaapp`, branche `main`. Node 22, pnpm 10.28.0. **Ne pas lancer de builds Node directement sur MochaHost** : GitHub Actions compile les artefacts statiques.

## Environnements

| Nom | Origine | Destination | Procédure |
| --- | --- | --- | --- |
| `mimt.ca` | `apps/web/out/` (Next.js statique) | Coolify vps1, application `mimt-web` (nginx), depuis le 26 octobre 2026 | Coolify construit `main` à chaque poussée (la construction exécute `verify-out.mjs`); `auto-deploy-website.yml` confirme ensuite, après CI, que `mimt-release.json` sert le SHA testé. Plus de FTP. |
| `app.mimt.ca` | `apps/webphone/dist/` (Vite) | Coolify vps1, application `mimt-app` (nginx), depuis le 26 octobre 2026 | Coolify construit `main` à chaque poussée; `mimt-release.json` vient de `SOURCE_COMMIT`. Les portées FTP de `deploy.yml` visent MochaHost, qui ne sert plus ces domaines. |
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

La CI du consentement par utilisateur ([38949670716](https://github.com/takatakca/mimtcaapp/actions/runs/38949670716)), les tests PostgreSQL ([38949670692](https://github.com/takatakca/mimtcaapp/actions/runs/38949670692)) et la publication **du site vitrine seulement** ([38949802395](https://github.com/takatakca/mimtcaapp/actions/runs/38949802395)) ont réussi au SHA `e71fefe21d81fe82aabf95a8f8ec1aa3cc0367d6`. La route API `GET /v1/consents` reste dans le code jusqu'au **déploiement manuel et contrôle de l'API**; ne pas la déclarer disponible depuis la seule réussite du site vitrine. Le commit mobile `b4b0c873...` (effacement local de personnalisation à la déconnexion mobile) et son test `4b3a6d50...` ont passé la CI [38950202953](https://github.com/takatakca/mimtcaapp/actions/runs/38950202953). Les modules API et mobile nécessitent toujours leur publication manuelle autorisée.

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
