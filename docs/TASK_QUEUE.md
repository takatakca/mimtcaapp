# MIMT — File des tâches exécutables

Date de tri : 2026-10-14. Trier par dépendances; statut `done`, `next`, `blocked` ou `pending`. Ne pas assimiler présence de code et disponibilité du service.

| ID | Priorité | Statut | Tâche et critère d'acceptation |
| --- | --- | --- | --- |
| DEP-01 | P0 | done (code) | Ignorer l'ancien commit lors d'une publication auto; comparer SHA CI à `main` avant FTP. Voir `.github/workflows/auto-deploy-website.yml`. |
| DEP-02 | P0 | done (code) | Ajouter `mimt-release.json` et exiger que le SHA téléchargé soit égal au commit publié, en auto et manuel. Constater ensuite CI et déploiement réels. |
| DEP-03 | P0 | done (code) | Isoler les prérequis de secrets des portées `website` / `webphone` / `api` dans `deploy.yml`. |
| DEP-04 | P0 | blocked: GitHub secret | Corriger `MOCHAHOST_APP_FTP_SERVER` (DNS `ENOTFOUND`), vérifier le document root du compte FTPS dédié, relancer le déploiement `webphone`, puis vérifier accueil, JS/CSS, `/connexion`, `/messages` et HTTPS. |
| DB-01 | P0 | code prêt; blocked: infrastructure/validation | `scripts/db/backup-mimt.sh` chiffre le dump age en flux et le copie hors hôte S3 avec validation de taille; `scripts/db/test-backup-mimt.sh` teste les gardes sans données. **Reste** : CI du commit, destination S3 approuvée, outil pg_dump/age/AWS sur réseau privé, cadence et alertes, rétention puis **restauration isolée réellement testée**. Ne pas toucher TAKATAK. |
| API-01 | P0 | pending | Revalider `/healthz` et `/readyz`, journaux Coolify, versions des migrations et connectivité. Une réponse `db:up` seule ne confirme pas Twilio. |
| AUTH-01 | P0 | pending | Vérifier end-to-end l'OIDC TAKATAK (PKCE, JWKS, consentement et entitlements), la sécurité multi-locataires et la révocation. |
| TEL-01 | P0 | blocked: fournisseur/réglementaire | Vérifier sous-compte Twilio, numéros canadiens, routage appels/SMS, géopermissions, antiraude, partenaire 9-1-1, adresses et avis; tests d'urgence selon protocole approuvé. |
| BILL-01 | P0 | blocked: comptes et validation | Stripe webhook signé `invoice.paid`, taxes, références de produits, vérification des reçus App Store/Play, remboursement et limites. |
| LEG-01 | P0 | blocked: propriétaire/juriste | Raison sociale, responsable de la confidentialité, rétention, centre 9-1-1, pages contractuelles et conformité CRTC/Loi 25. Remplacer les marqueurs `[À confirmer par MIMT]` après validation. |
| MOB-01 | P1 | blocked: équipements et comptes | Dev builds Expo iOS/Android sur appareils réels, notifications VoIP, premier appel contrôlé et publication officielle après TEL-01. |
| MED-01 | P1 | pending | Intégration réelle fichiers MMS/accueil téléphonique (stockage privé), accès, expirations, scans, email voix; aucune démo comme preuve de production. |
| PBX-01 | P1 | pending | Vérifier sièges PBX vs quantités Stripe, rôles par entreprise, redirections, IVR et WebSocket en conditions réelles. |
| RES-01 | P2 | blocked: accord revendeur | Vidéotron/équivalent : contrat, documentation API et environnement sandbox; ne pas activer l'adaptateur fictif. |
| QA-02 | P1 | code terminé, CI à confirmer | Les adaptateurs de notification sans fournisseur ne doivent plus écrire transcriptions, destinataires ou numéros d'appelants en logs. Vérifier `apps/api/test/notification-privacy.test.ts`, puis l'activation d'un vrai fournisseur push/email avant de présenter la notification comme livrée. |
| QA-01 | P1 | pending | Élargir les e2e aux risques réels (auth déconnectée, erreur réseau, changement de locataire, gestion SMS, secours 9-1-1). |

## Règle d'exécution

Prendre la première tâche `next` ou `pending` réalisable sans secret supplémentaire. Pour une tâche `blocked`, préserver les preuves et poursuivre la suivante. Commiter les progrès, mettre à jour `WORKLOG.md` et `AGENT_HANDOFF.md`, et suivre le run CI jusqu'à résultat avant d'annoncer le succès.
