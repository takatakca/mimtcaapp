# MIMT : sauvegardes PostgreSQL et exercice de restauration

## État réel vérifié — 25 octobre 2026

- Accès Coolify MIMT rétabli via la session du propriétaire. Ressource privée `mimt-prod-postgres`, base ciblée **`mimt_production`** uniquement.
- **Planification activée :** `0 7 * * *`, fuseau **UTC**, conservation **3** sauvegardes locales. Les valeurs ont été relues après rechargement de la page, pas seulement saisies dans le formulaire.
- **Première exécution manuelle réussie :** 2026-10-25 06:52:30–06:52:34 UTC, **231046 octets** (225,63 KB dans Coolify).
- **Première exécution planifiée réussie :** 2026-10-25 07:00:12–07:00:15 UTC, 225,63 KB. Les deux archives apparaissent `Success` / `Local` dans les exécutions.
- **Restauration réelle réussie :** l'archive manuelle a été montée en lecture seule dans un conteneur jetable `postgres:17-alpine` déjà présent sur l'hôte, avec `--network none`, aucune publication de port, données PostgreSQL en tmpfs, limite mémoire 256 MB / CPU 0,5. `pg_restore --no-owner --no-acl --exit-on-error` a réussi; **17 migrations** sont enregistrées et les quatre tables `users`, `telecom_accounts`, `phone_numbers`, `messages` sont lisibles. Résultat terminal : `RESTORE_DRILL_OK`. Le conteneur a terminé et s'est supprimé (`--rm`). Aucune restauration dans la base de production.
- Le dossier dédié MIMT a été restreint au propriétaire (`0700`), ainsi que l'archive manuelle restaurée (`0600`); modes vérifiés par `stat`. Aucun dump ni donnée client téléchargé ou ajouté à GitHub.
- **Alertes :** seuil « Missing backup alert after » réglé à **2 jours** et relu après navigation. **Aucun canal de notification Coolify n'est configuré** : la livraison d'alerte reste à activer et à tester.
- **Hors hôte encore bloqué :** Coolify contient **0 destination S3**; la connexion Cloudflare nécessaire n'a pas été complétée. Aucun bucket R2, aucune clé S3, aucune rétention distante ni restauration depuis R2 ne sont configurés/prouvés. La conservation S3 affiche encore 0 tant qu'aucune destination n'est validée. La copie locale ne protège pas contre la perte de l'hôte.
- Prochaine étape : accès Cloudflare, bucket privé MIMT, stockage S3 validé dans Coolify, rétention distante **14**, nouvelle sauvegarde puis restauration depuis l'objet R2 et canal d'alerte vérifié. Le workflow hebdomadaire GitHub nécessite toujours ses accès lecture seule.


But : chaque jour une copie de la base MIMT (`mimt_production`) hors du serveur Coolify, gardée 14 jours, et la
preuve chaque semaine qu'on sait la restaurer. Une sauvegarde jamais restaurée n'est pas une sauvegarde.

## Ce qui est automatisé (dans le dépôt)

| Quoi | Où | Quand |
| --- | --- | --- |
| Exercice de restauration | `.github/workflows/backup-restore-drill.yml` + `scripts/db/restore-drill.sh` | chaque lundi 7 h 17 UTC, et à la main (Actions › Backup restore drill › Run workflow) |
| Autotest de l'exercice (fausse sauvegarde avec toutes les migrations) | `scripts/db/drill-fixture.sh` | à chaque exécution, et sur chaque PR qui touche les migrations |
| Alerte si la dernière sauvegarde a plus de 2 jours | même workflow | chaque lundi |

L'exercice restaure dans une base **jetable** (Postgres 17 dans GitHub Actions), vérifie que toutes les migrations
sont présentes (`mimt_schema_migrations`) et que les tables `users`, `telecom_accounts`, `phone_numbers` et
`messages` se lisent. Il ne touche jamais la production. Sans accès aux sauvegardes, il fait seulement l'autotest
et affiche un avertissement.

## À faire une fois par le propriétaire (environ 15 minutes)

### 1. Créer le stockage hors serveur (Cloudflare R2, le plus simple)

1. Cloudflare › R2 › **Create bucket** : nom `mimt-backups`, emplacement Amérique du Nord.
2. R2 › **Manage R2 API Tokens** › Create API token :
   - token « coolify-mimt-backups » : permission **Object Read & Write**, limité au bucket `mimt-backups`;
   - token « github-restore-drill » : permission **Object Read only**, limité au bucket `mimt-backups`.
3. Noter l'**endpoint S3** affiché (`https://<id-de-compte>.r2.cloudflarestorage.com`).

(Backblaze B2 fonctionne pareil : bucket privé + deux clés d'application, une lecture/écriture et une lecture seule.)

### 2. Activer les sauvegardes planifiées dans Coolify

1. Coolify › **Settings › S3 Storages › + Add** : nom `R2 MIMT`, endpoint ci-dessus, bucket `mimt-backups`,
   région `auto`, clé et secret du token « coolify-mimt-backups ». Cliquer **Validate Connection**.
2. Coolify › la ressource **MIMT Postgres** › onglet **Backups** › **+ Add** (Scheduled Backup) :
   - Frequency : `0 7 * * *` (tous les jours à 3 h, heure de Montréal);
   - Number of backups to keep locally : `3`;
   - **Save to S3** : activé, stockage `R2 MIMT`; garder **14** sauvegardes sur S3;
   - base : `mimt_production`.
3. Cliquer **Backup Now** une fois et vérifier qu'un fichier apparaît dans le bucket R2.

### 3. Brancher l'exercice hebdomadaire (secrets GitHub, jamais dans le chat)

GitHub › `takatakca/mimtcaapp` › Settings › Secrets and variables › Actions › **New repository secret** :

| Secret | Valeur |
| --- | --- |
| `MIMT_BACKUP_S3_ENDPOINT` | l'endpoint S3 R2 (`https://…r2.cloudflarestorage.com`) |
| `MIMT_BACKUP_S3_BUCKET` | `mimt-backups` |
| `MIMT_BACKUP_S3_PREFIX` | le dossier où Coolify dépose les fichiers (visible dans R2 après « Backup Now »), sinon laisser vide |
| `MIMT_BACKUP_S3_READONLY_KEY_ID` | clé du token **lecture seule** « github-restore-drill » |
| `MIMT_BACKUP_S3_READONLY_SECRET` | secret du même token |

Puis Actions › **Backup restore drill** › Run workflow. Résultat attendu : « restore drill OK » et le nombre de
lignes par table. Si les sauvegardes sont chiffrées avec `scripts/db/backup-mimt.sh` (age), ajouter aussi
`MIMT_BACKUP_AGE_IDENTITY` (la clé privée age). Option de dépannage : `MIMT_BACKUP_URL`, un lien HTTPS direct vers
un fichier de sauvegarde (expire en 7 jours au plus).

## Restaurer pour de vrai (incident)

1. **Ne jamais restaurer par-dessus la base en service.** Créer une nouvelle ressource Postgres dans Coolify
   (même version ou plus récente), base `mimt_production`, rôle `mimt_owner`.
2. Coolify › MIMT Postgres › Backups › choisir la sauvegarde › **Restore** vers la nouvelle ressource, ou en ligne
   de commande sur le serveur :
   `pg_restore --no-owner --no-acl --exit-on-error -d "postgresql://mimt_owner:…@<nouvelle-base>:5432/mimt_production" sauvegarde.dmp`
   (créer d'abord les rôles `anon` et `authenticated` NOLOGIN, voir `deploy/coolify/mimt-postgres-bootstrap.sql`).
3. Vérifier avec le même contrôle que l'exercice :
   `DRILL_DATABASE_URL=… scripts/db/restore-drill.sh sauvegarde.dmp` sur un serveur de test.
4. Pointer `DATABASE_URL` de l'API vers la nouvelle base, redéployer l'API, lancer `scripts/smoke/prod.sh`.
5. Noter l'incident dans `WORKLOG.md`.

Objectifs : perte de données maximale 24 h (sauvegarde quotidienne), remise en service en moins d'une heure.
