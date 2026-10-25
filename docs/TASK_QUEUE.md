# MIMT — File des tâches exécutables

## Avancement opérationnel — 25 octobre 2026

| ID | État actuel | Prochaine preuve requise |
| --- | --- | --- |
| ACT-BACKUP / DB-01 | **Local quotidien + vraie restauration locale vérifiés**; hors hôte bloqué | R2 privé, stockage S3 validé, conservation distante 14, restauration depuis R2; détails dans MIMT-BACKUPS.md |
| ACT-ALERT | Seuil absence de backup = 2 jours; **aucun canal** | Canal approuvé, notification de test reçue |
| ACT-AI | Coolify connecté; **clé Anthropic absente** | Entrée privée de la clé, redéploiement API, réponse IA réelle |
| ACT-DEPLOY | Site 9605bee publié; app encore 612284e | Accès GitHub pour Deploy scope webphone et concordance du manifeste |

Les blocages magasins/mesure/juriste/téléphone de la liste précédente restent ouverts. Ne pas refaire les sauvegardes locales simplement parce que R2 n'est pas encore accessible.


## Activation propriétaire — 24 octobre 2026

| ID | État constaté | Prochaine action / preuve |
| --- | --- | --- |
| ACT-AI | blocked: accès Coolify/Anthropic; démo indisponible | Clé serveur, redéploiement, vraie réponse IA en français; consentements/forfaits pour fonctions privées |
| ACT-PHONE | blocked: code refusé | Reprendre connexion sécurisée; achat au prix accepté; appel et texto reçus dans les deux sens |
| ACT-STORE | blocked: comptes/secrets; Android run 40080169700 | Quatre secrets de signature + comptes Apple/Expo/Play, produits et tests réels; inventaire dans MIMT-ACTIVATION.md |
| ACT-CRTC | prepared; blocked: faits privés/juriste | Compléter MIMT-CRTC-DRAFT.md, avis approuvés et pièces fournisseur, dépôt puis reçu privé |
| ACT-ADS | blocked: identifiants des comptes | GA4/Ads absents du HTML servi; renseigner les IDs, publier et valider avec consentement |
| ACT-BACKUP | tests hermétiques pass; blocked: R2/Coolify | Sauvegarde planifiée + premier objet + restauration isolée réelle |

Ne pas réinterpréter ces blocages d'accès comme des erreurs de code. Préserver les travaux parallèles et consigner les preuves réelles.


Date de tri : 2026-10-14. Trier par dépendances; statut `done`, `next`, `blocked` ou `pending`. Ne pas assimiler présence de code et disponibilité du service.

| ID | Priorité | Statut | Tâche et critère d'acceptation |
| --- | --- | --- | --- |
| WEB-02 | P1 | merged 804956d; site après CI de main | Accueil mimt.ca (fr+en) : sans numéro, textos gratuits avec @nom et appels entre applications limités à `PLANS.free.caps.onNetMinutes` (120). Ne pas écrire que ces appels sont illimités. Critère : `apps/web/lib/hero.ts` branché dans le héros, test `site.test.ts`. |
| PUSH-02 | P1 | merged 804956d; Deploy portée all | Web Push quand l'app sonne vraiment (par @nom, vers un numéro MIMT, ou depuis le réseau). Titre « Appel entrant » / « Incoming call », écran verrouillé = @nom ou E.164 seulement, ouvre `/appels`, expire en 60 s. Pas de notification sur refus, blocage, renvoi ou messagerie. Critère : `apps/api/test/incomingCallPush.test.ts`. |
| DEP-01 | P0 | done (code) | Ignorer l'ancien commit lors d'une publication auto; comparer SHA CI à `main` avant FTP. Voir `.github/workflows/auto-deploy-website.yml`. |
| DEP-02 | P0 | done (code) | Ajouter `mimt-release.json` et exiger que le SHA téléchargé soit égal au commit publié, en auto et manuel. Constater ensuite CI et déploiement réels. |
| DEP-03 | P0 | done (code) | Isoler les prérequis de secrets des portées `website` / `webphone` / `api` dans `deploy.yml`. |
| DEP-04 | P0 | blocked: GitHub secret | Corriger `MOCHAHOST_APP_FTP_SERVER` (DNS `ENOTFOUND`), vérifier le document root du compte FTPS dédié, relancer le déploiement `webphone`, puis vérifier accueil, JS/CSS, `/connexion`, `/messages` et HTTPS. |
| DB-01 | P0 | code prêt; blocked: infrastructure/validation | `scripts/db/backup-mimt.sh` chiffre le dump age en flux et le copie hors hôte S3 avec validation de taille; `scripts/db/test-backup-mimt.sh` teste les gardes sans données. **Reste** : CI du commit, destination S3 approuvée, outil pg_dump/age/AWS sur réseau privé, cadence et alertes, rétention puis **restauration isolée réellement testée**. Ne pas toucher TAKATAK. |
| API-01 | P0 | pending | Revalider `/healthz` et `/readyz`, journaux Coolify, versions des migrations et connectivité. Une réponse `db:up` seule ne confirme pas Twilio. |
| PRIV-01 | P1 | code terminé; API non publiée | Lire les consentements existants après reconnexion via `GET /v1/consents` côté API/mobile/webphone; test d'isolation utilisateurs, retrait et absence d'IP vérifié dans CI 38949670716. Vérifier la publication API contrôlée et les applications sur appareils réels avant de déclarer l'expérience de bout en bout lancée. |
| PRIV-02 | P1 | code + CI terminés; déploiement mobile requis | Désactiver immédiatement les publicités personnalisées à la déconnexion mobile, même quand SecureStore échoue. Test `apps/mobile/src/services/ads.test.ts` et CI [38950202953](https://github.com/takatakca/mimtcaapp/actions/runs/38950202953) réussis. Tester sur appareils réels lors de la publication mobile. |
| AUTH-01 | P0 | pending | Vérifier end-to-end l'OIDC TAKATAK (PKCE, JWKS, consentement et entitlements), la sécurité multi-locataires et la révocation. |
| TEL-01 | P0 | blocked: fournisseur/réglementaire | Vérifier sous-compte Twilio, numéros canadiens, routage appels/SMS, géopermissions, antiraude, partenaire 9-1-1, adresses et avis; tests d'urgence selon protocole approuvé. |
| BILL-01 | P0 | blocked: comptes et validation | Stripe webhook signé `invoice.paid`, taxes, références de produits, vérification des reçus App Store/Play, remboursement et limites. |
| LEG-01 | P0 | blocked: propriétaire/juriste | Raison sociale, responsable de la confidentialité, rétention, centre 9-1-1, pages contractuelles et conformité CRTC/Loi 25. Remplacer les marqueurs `[À confirmer par MIMT]` après validation. |
| MOB-01 | P1 | blocked: équipements et comptes | Dev builds Expo iOS/Android sur appareils réels, notifications VoIP, premier appel contrôlé et publication officielle après TEL-01. |
| MED-01 | P1 | pending | Intégration réelle fichiers MMS/accueil téléphonique (stockage privé), accès, expirations, scans, email voix; aucune démo comme preuve de production. |
| PBX-01 | P1 | en cours : code sièges ↔ Stripe terminé (2026-10-16), vérification Stripe réelle côté propriétaire | Vérifier sièges PBX vs quantités Stripe, rôles par entreprise, redirections, IVR et WebSocket en conditions réelles. **Fait (code + tests `business.seats.test.ts`)** : lignes → quantité Stripe au prorata avec clé d'idempotence, Checkout si aucun abonnement, minimum = postes en usage (409), webhook `customer.subscription.updated/deleted` = source de vérité (sièges, `past_due` = paiement à régulariser, `canceled` = appels sortants d'entreprise bloqués, entrants et 9-1-1 maintenus). **Reste (propriétaire)** : essai en mode test Stripe (ajout/retrait de lignes, factures au prorata, lignes TPS/TVQ/9-1-1), événements `customer.subscription.*` activés sur le webhook, puis redirections, IVR et WebSocket en conditions réelles. |
| RES-01 | P2 | blocked: accord revendeur | Vidéotron/équivalent : contrat, documentation API et environnement sandbox; ne pas activer l'adaptateur fictif. |
| QA-02 | P1 | code terminé, CI à confirmer | Les adaptateurs de notification sans fournisseur ne doivent plus écrire transcriptions, destinataires ou numéros d'appelants en logs. Vérifier `apps/api/test/notification-privacy.test.ts`, puis l'activation d'un vrai fournisseur push/email avant de présenter la notification comme livrée. |
| VID-01 | P1 | code prêt; blocked: infrastructure | Réunions MIMT (LiveKit) : API `/v1/meetings` + `/webhooks/livekit`, migration `0010_meetings.sql`, pages `app.mimt.ca/reunions` et `/reunion/<jeton>`, liste mobile. **Reste** (propriétaire) : migration 0010, serveur LiveKit `rtc.mimt.ca` sur Coolify (ou LiveKit Cloud + EFVP), variables `LIVEKIT_*`, webhook, tests réels multi-appareils, politique de confidentialité. Guide : `docs/MIMT-VIDEO.md`. |
| ADS-01 | P0 | code prêt (branche `claude/cost-guard-ads`); blocked: comptes AdSense/AdMob | Garde-fou de coûts du forfait gratuit (API : `FREE_NEW_NUMBERS_PER_DAY`, `FREE_ACTIVE_NUMBERS_MAX`, `FREE_TIER_MONTHLY_BUDGET_CAD`, `FREE_OUTBOUND_PSTN_ENABLED`, `FREE_SIGNUPS_ENABLED`, `GET /v1/admin/costs`; 9-1-1 et appels entre apps jamais bloqués; tests `freeTier.test.ts` + contrat Postgres) et publicités AdSense du forfait gratuit dans app.mimt.ca (`apps/webphone/src/ads/`, CSP, consentement « Publicités personnalisées », ads.txt sur mimt.ca). **Reste (propriétaire)** : `docs/MIMT-LAUNCH.md` « Publicités et coûts » — compte et approbation AdSense, variables GitHub `ADSENSE_CLIENT`/`ADSENSE_SLOT_BANNER`/`ADSENSE_SLOT_SIDEBAR`, `TWILIO_VERIFY_SERVICE_SID` dans Coolify, valeurs du garde-fou; AdMob mobile : vrais identifiants de blocs encore à brancher. |
| QA-01 | P1 | pending | Élargir les e2e aux risques réels (auth déconnectée, erreur réseau, changement de locataire, gestion SMS, secours 9-1-1). |

## Règle d'exécution

Prendre la première tâche `next` ou `pending` réalisable sans secret supplémentaire. Pour une tâche `blocked`, préserver les preuves et poursuivre la suivante. Commiter les progrès, mettre à jour `WORKLOG.md` et `AGENT_HANDOFF.md`, et suivre le run CI jusqu'à résultat avant d'annoncer le succès.
