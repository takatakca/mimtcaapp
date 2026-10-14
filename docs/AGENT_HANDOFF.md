# MIMT — Relève du développeur principal

**Mise à jour : 2026-10-14.** Repository `takatakca/mimtcaapp`, branche de publication `main`. À la reprise, **lire `AGENTS.md`, ce fichier, `WORKLOG.md`, vérifier HEAD GitHub et les Actions avant toute modification**. Un document de relève ne remplace jamais une vérification de `main`.

## Relève — troisième cycle du 14 octobre 2026

- **Repository et branche :** `takatakca/mimtcaapp`, `main`.
- **Dernière tâche validée :** correction de la CI de déploiement dans `.github/workflows/ci.yml` : le contrôle utilisait `release-gate:` à tort et doit chercher `id: release-gate`. **CI entièrement réussie** au commit `024dc80ce6de9a8cee5d9bb1ea90ec08ded4ea59`, run [38622709087](https://github.com/takatakca/mimtcaapp/actions/runs/38622709087) (tests unitaires, tests de sauvegarde, builds et e2e). **Publication du site vitrine confirmée** au même commit par le run [38622899829](https://github.com/takatakca/mimtcaapp/actions/runs/38622899829), avec étapes FTPS et contrôle HTTP de `mimt-release.json` toutes deux `success`.
- **Travail ensuite poussé sur `main` (révision en cours de validation) :** `apps/api/src/services/notifier.ts`, `apps/api/src/services/email.ts`, `apps/api/test/notification-privacy.test.ts`. L'ancien adaptateur de notification sans prestataire exposait des transcriptions IA, téléphones et informations d'utilisateur aux logs; le fallback email écrivait dans le log le sujet contenant potentiellement un numéro d'appelant. Les deux conservent maintenant uniquement des métadonnées de non-livraison; les tests vérifient l'absence de données sensibles.
- **Dernier SHA de code poussé avant le présent commit documentaire :** `58f0d90fefe042d32b4eb90990a90aaf5e792742`. Le SHA exact de cette mise à jour de relève est un descendant direct, à lire dans GitHub `main`.
- **Tests de la correction de confidentialité :** run `38623299278` (CI) et `38623299361` (PostgreSQL) encore `pending` au moment de cette rédaction. Ne pas annoncer de réussite tant que les nouveaux jobs ne sont pas `completed/success`.
- **État du déploiement :** `mimt.ca` vérifié au SHA `024dc80ce...`; **la dernière révision GitHub postérieure à ce SHA n'était pas encore publiée**. `app.mimt.ca` reste bloqué par le secret `MOCHAHOST_APP_FTP_SERVER` qui avait produit `ENOTFOUND` lors du dernier envoi manuel. `api.mimt.ca` et PostgreSQL étaient prêts dans l'audit du 11 octobre, pas re-certifiés en direct lors de cette session. Voix/SMS/9-1-1/paiements/mobiles non ouverts commercialement.
- **Vérifications réalisées :** lecture de `AGENTS.md`, de cette relève, des 4 autres documents de suivi et des issues/PR, inspection GitHub Actions des jobs et logs de l'échec `38615280960`; correctif GitHub poussé, CI entière relancée et réussie, déploiement public vérifié; inspection de code des adaptateurs, tests de non-divulgation poussés. Les URL directes `https://mimt.ca/mimt-release.json`, `https://api.mimt.ca/readyz`, `https://app.mimt.ca/` n'étaient pas résolues par l'environnement externe : utiliser en priorité la vérification HTTP effectuée dans GitHub Actions. Aucun appel réel 9-1-1, migration, achat ni modification de secrets n'a eu lieu.
- **Accès externes encore nécessaires (noms uniquement) :** GitHub secret `MOCHAHOST_APP_FTP_SERVER` corrigé; accès Coolify/private MIMT PostgreSQL, secrets sauvegarde chiffrée âge/S3, contrat Twilio et centre 9-1-1, comptes Stripe/Apple/Google et révision réglementaire. Ne jamais exposer de valeurs.
- **Prochaine action exacte :** lire le résultat du run `38623299278` sur `58f0d90fe` puis celui du dernier `main` après ce commit de suivi; réparer toute défaillance des tests `notification-privacy`. Vérifier le dernier `Auto deploy MIMT website` : le job de transfert FTP et le contrôle du SHA public doivent être `success` et non `skipped`. Puis résoudre `DEP-04`, effectuer un backup hors hôte réellement chiffré avec restauration isolée, puis tests opérationnels et conformité télécom.

## Complément de relève — deuxième cycle de développement

- **Dernier commit poussé vérifié avant cet ajout** : `1335708113a1758bf524cee11334d2960865e7c9` (`WORKLOG.md`); la branche `main` a évolué ensuite, lire son HEAD au prochain agent. Le présent commit de relève ne peut contenir son propre SHA.
- **Nouveaux fichiers** : `scripts/db/backup-mimt.sh` et `scripts/db/test-backup-mimt.sh`. Le premier prépare une sauvegarde PostgreSQL MIMT dédiée, chiffrée par clé publique age, vers S3 hors serveur, vérifiée par taille distante, sans dump clair sur disque. Il refuse une autre base, un rôle inattendu, Supabase, un SSL non vérifié et un endpoint S3 HTTP. Le second utilise des faux outils, **sans DB ni S3 réels**.
- **Autres modifications** : `.github/workflows/ci.yml` exécute les tests backup et annule les anciens CI concurrents; `.github/workflows/verify-standalone-postgres.yml` annule les anciens tests de push sans annuler les audits manuels. `supabase/README.md`, `apps/api/README.md`, `docs/MIMT-SELFHOSTED-POSTGRES-RECOVERY.md`, `docs/MIMT-MVP.md`, `README.md`, `docs/PROJECT_STATUS.md`, `docs/TASK_QUEUE.md`, `docs/DEPLOYMENT.md` ont été corrigés pour la base MIMT privée et l'état du backup.
- **Résultats confirmés** : plusieurs anciens runs CI réussis (`38613148388`, `38613403340`, etc.), test PostgreSQL jetable `38614216456` réussi; run auto `38613261711` `success` mais FTP **skipped** (révision dépassée, comportement attendu). **Aucune preuve encore de sauvegarde/restauration réelle ni de publication du dernier SHA.**
- **Statut CI au dernier contrôle** : `38615064246` sur `16c8ce04` en cours, `38615119983` sur `13357081` en attente. Toutes les CI du commit actuel doivent être relues; les annulations d'anciens commits après ajout de `concurrency` sont intentionnelles. La compilation locale n'a pas été exécutée; les vérifications proviennent de GitHub Actions et des revues de code.
- **Accès requis sans divulguer de valeurs** : en plus des secrets de publication antérieurs, `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, `PGSSLMODE=verify-full` et CA, `MIMT_BACKUP_AGE_RECIPIENT` (clé publique), `MIMT_BACKUP_S3_BUCKET`, authentification AWS/S3 pour coffre hors hôte. L'identité age privée de déchiffrement doit être conservée en lieu distinct.
- **Prochaine action exacte** : ouvrir le dernier run CI de la branche `main` et vérifier l'étape `Check MIMT off-host backup safeguards with hermetic fakes`. Corriger le test si rouge, sinon lire le nouveau run `Auto deploy MIMT website` : les étapes FTP et HTTP du commit courant doivent être `success` et `https://mimt.ca/mimt-release.json` doit contenir exactement ce SHA. Si la CI et le transfert sont en attente, ne pas annoncer de succès. Puis configurer la sauvegarde réelle et une restauration **isolée**, corriger le secret FTP du portail `MOCHAHOST_APP_FTP_SERVER` (ancien `ENOTFOUND`), et valider séparément les contrats Twilio/9-1-1/Stripe.
- **Sécurité** : pas de nouvelle base Supabase payante, aucune migration dans TAKATAK, aucune activation publique de la téléphonie, aucune donnée/secrets divulgués.

## Dernière tâche terminée

1. Empêcher un ancien `workflow_run` CI de publier une version obsolète par FTPS : `.github/workflows/auto-deploy-website.yml` compare le SHA approuvé à la tête distante de `main` juste avant le transfert, et saute la publication si une version plus récente existe (commit `400e88a69084fdf27ad0ec8c9bed642362f9ca65`).
2. Découpler les secrets requis par cible `website` / `webphone` / `api` dans `.github/workflows/deploy.yml` (commit `3213d0b434fdc4397fe8b44a9d916f29f7dccd96`).
3. Générer et contrôler `mimt-release.json` pour obtenir la **preuve du SHA servi en production**, dans la publication automatique et manuelle (commits `bfcc01707a9975138e1b6f0ee81112763b4d6019`, `233ff06ce57acdda9605fd10fa5d670bf4afd2b2`).
4. Créer les documents obligatoires `PROJECT_STATUS.md`, `TASK_QUEUE.md`, `DEPLOYMENT.md`, `DECISIONS.md` et le présent `AGENT_HANDOFF.md`. Décrire l'état sans qualifier les services télécom de lancés.

## Tâche en cours

**Contrôler les résultats de la CI et de l'auto-publication depuis les changements du 2026-10-14**, puis corriger tout échec constaté. La file d'actions CI a été temporairement chargée à cause de plusieurs commits successifs. Le nouveau workflow possède deux portes : `release-candidate` AVANT compilation et `release-gate` juste avant FTPS. Un run `success` dont les étapes de transfert/vérification sont `skipped` ne prouve pas une publication; c'est un abandon sain d'un ancien commit. N'annoncer la publication comme « confirmée » qu'après la réussite réelle de ces étapes **et** concordance du SHA dans `https://mimt.ca/mimt-release.json`.

**Premier travail indépendant suivant :** contrôler la CI comprenant le nouveau test de sauvegarde, remédier aux éventuelles erreurs, puis obtenir une publication de la vitrine au SHA final. Le backup de production exige encore un environnement sécurisé, une cadence, des alertes et une restauration isolée éprouvée. Pour la priorité `DEP-04`, le blocage est externe : corriger la valeur de `MOCHAHOST_APP_FTP_SERVER` dans les secrets Actions; ne pas inventer le nom du serveur.

## Fichiers modifiés/créés pendant la reprise

- `.github/workflows/auto-deploy-website.yml` — validation HEAD en deux étapes (avant build et avant FTPS) et empreinte de release.
- `.github/workflows/deploy.yml` — secrets par portée, release SHA pour le site manuel; contrôle DNS préalable du webphone issu de la session précédente.
- `WORKLOG.md` — déclaration de travail et statut.
- `docs/PROJECT_STATUS.md` — preuve/stade par composant.
- `docs/TASK_QUEUE.md` — tâches indépendantes et dépendances.
- `docs/DEPLOYMENT.md` — procédures et contrôles.
- `docs/DECISIONS.md` — décisions approuvées.
- `docs/AGENT_HANDOFF.md` — relève.
- `AGENTS.md`, `.github/workflows/ci.yml` — lecture obligatoire de la relève et vérification en CI de la présence des cinq documents et des protections de déploiement.

## SHA Git

- **Dernier SHA de code de déploiement avant les nouveaux documents :** `233ff06ce57acdda9605fd10fa5d670bf4afd2b2`.
- **Dernier commit de documentation confirmé avant création de ce fichier :** `65a7750d4d5a898173a466e809923f8d36cb5418` (`docs/DECISIONS.md`).
- **Dernier commit de cette reprise vérifié avant la mise à jour finale de la relève :** `6bdcb607a8f1ae804a050c7535cb02cb08b0c863` (`WORKLOG.md`); optimisation pré-build : `9baf035918d72ccea15a1e93319abd89f1004432`; garde de contrat CI : `0b2dcbd4e2375da28c8309872cc7e1b5e3ca3c15`.
- **SHA courant de publication** : lire `refs/heads/main` dans GitHub; il doit être postérieur aux SHA ci-dessus. Le présent commit de relève et tout commit ultérieur ne peuvent pas s'auto-citer par SHA.

## Commandes / vérifications effectivement exécutées

- Lecture via le connecteur GitHub de `AGENTS.md`, `WORKLOG.md`, `docs/MIMT-LAUNCH.md` et des workflows `CI`, `Deploy`, `Auto deploy MIMT website`.
- Consultation GitHub du HEAD, des commits récents, de l'arborescence complète, des PR ouvertes (aucune à l'inspection), de l'issue #5 et des GitHub Actions.
- Dernière CI **antérieure à la reprise** : `38610373813`, succès à `3fdcc6768ef848ab53d45ac209213f5d60c6f33a`.
- Déploiement du site **antérieur à la reprise** : `38610692280`, succès au même SHA (ancienne validation du contenu du site; pas encore un contrôle de `mimt-release.json`).
- Les CI de cette nouvelle série ont commencé : `38612947004`, `38612979336`, `38613017799`, `38613110281`, `38613148388` et `38613403340` réussies à la dernière vérification. Les suivantes, incluant les changements de docs et la protection à deux étapes, étaient encore en file. **Ne pas déclarer le dernier SHA validé avant son statut GitHub `completed/success`.**
- Le run auto [38613261711](https://github.com/takatakca/mimtcaapp/actions/runs/38613261711) a terminé `success` mais a **omis FTP et contrôle HTTP** parce que sa révision n'était plus la tête de `main` : protection anti-retour arrière effectivement constatée. Il ne prouve PAS une nouvelle publication.
- L'outil Web n'a pas pu ouvrir directement `api.mimt.ca/readyz`, `api.mimt.ca/healthz` ou `app.mimt.ca` dans cette session; **indisponible depuis l'outil n'est pas synonyme d'une panne réelle**.
- Aucune commande télécom, aucun changement de secret Coolify/Twilio/Stripe, aucun appel réel 9-1-1 et aucune migration de base n'ont été exécutés dans cette reprise.

## Erreurs connues et état réel du déploiement

| Cible | Dernière preuve certaine | Condition restante |
| --- | --- | --- |
| `mimt.ca` | site vitrine auto-publié le 2026-10-14 sur l'ancien SHA `3fdcc676`; CI réussie | démontrer désormais le manifeste du **nouveau** SHA après le dernier cycle |
| `app.mimt.ca` | ancien site HTML et assets consultés par actions historiques; dernière mise à jour FTP `38116824409` échoue (`ENOTFOUND`) | valeur FTPS valide + racine dédiée + relance et vérification de liens profonds |
| `api.mimt.ca` | `/readyz` avec `db:up` au 2026-10-11 (issue #5) | vérification externe actuelle et flux Twilio/Stripe/9-1-1 |
| PostgreSQL MIMT | privée Coolify rétablie et migration testée | sauvegarde hors hôte et restauration contrôlée |
| iOS/Android | code Expo et tests CI | appareils réels, notifications, approbations stores et télécom |

Le lancement public de voix, SMS, numéro, paiement et 9-1-1 n'est pas approuvé. Les services purement marketing peuvent être publiés de façon séparée.

## Accès nécessaires (noms uniquement)

`MOCHAHOST_FTP_SERVER`, `MOCHAHOST_FTP_USERNAME`, `MOCHAHOST_FTP_PASSWORD`; `MOCHAHOST_APP_FTP_SERVER`, `MOCHAHOST_APP_FTP_USERNAME`, `MOCHAHOST_APP_FTP_PASSWORD`; `COOLIFY_URL`, `COOLIFY_TOKEN`, `COOLIFY_API_UUID`. Accès opérateur Twilio/9-1-1, Stripe, comptes Apple/Google, revue légale et sauvegarde PostgreSQL pour les tâches correspondantes. **Ne pas publier leurs valeurs.**

## Prochaines actions exactes

1. GitHub → Actions : ouvrir la dernière CI de `main` et le run `Auto deploy MIMT website` déclenché par cette CI; lire le résultat `Verify release commit still matches remote main`, le transfert FTPS et la vérification du manifeste.
2. Lire le contenu public `https://mimt.ca/mimt-release.json` et confirmer que `commit` correspond au SHA de publication attendu; ne pas se fier seulement à un titre HTML.
3. Si tout passe, mettre à jour `WORKLOG.md` et ce fichier avec les IDs de runs et le résultat. En cas d'échec, corriger la cause technique et recompiler sans désactiver les tests.
4. Pour le portail : une fois `MOCHAHOST_APP_FTP_SERVER` rectifié, lancer `Deploy` portée `webphone`, chemin `./`; vérifier `/connexion` et `/messages`.
5. Poursuivre `docs/TASK_QUEUE.md` (sauvegardes/restore, intégrations réelles, conformité), en conservant la séparation TAKATAK et le 9-1-1 non bloquable.

**Règle de fin :** ne jamais conclure « MIMT lancé à 100 % » avant tests réels, conformité, preuve de déploiement et restauration de secours.
