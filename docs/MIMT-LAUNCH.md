# MIMT : liste de lancement (propriétaire)

Une seule liste pour mettre MIMT en ligne. Chaque case est une action **du propriétaire** (comptes, secrets, contrats) : le code est prêt. Les secrets se mettent dans Coolify ou GitHub, jamais dans le code, un courriel ou le clavardage.

État vérifié dans GitHub au 2026-10-14 : le site vitrine `mimt.ca` est public et sa première publication **automatique** après CI (run 38609788525) a réussi, avec transfert FTPS et contrôle HTTP. La dernière tentative de publier `app.mimt.ca` (run 38116824409) a échoué sur `MOCHAHOST_APP_FTP_SERVER` : erreur DNS `ENOTFOUND`. La disponibilité externe de `app.mimt.ca` et de `api.mimt.ca` n'est pas re-certifiée par ces contrôles. La base PostgreSQL privée avait passé le test `/readyz` le 11 octobre.

Documents détaillés (ne pas recopier ici) :
- [PRODUCTION-RECOVERY-2026-10-10.md](PRODUCTION-RECOVERY-2026-10-10.md) : cPanel, DNS, Coolify, vérifications.
- [MIMT-SELFHOSTED-POSTGRES-RECOVERY.md](MIMT-SELFHOSTED-POSTGRES-RECOVERY.md) : base PostgreSQL privée et migrations.
- [MIMT-AI.md](MIMT-AI.md), [MIMT-RESALE.md](MIMT-RESALE.md), [MIMT-REGULATORY.md](MIMT-REGULATORY.md).

## 1. Base de données (bloquant)

- [ ] Coolify → MIMT → `mimt-prod-postgres` : vérifier ~1 Go de mémoire libre, ~20 Go de disque, un volume persistant, pas de port public, puis démarrer.
- [ ] Mettre `DATABASE_URL` (URL interne de cette ressource) et, si TLS, `DATABASE_SSL_CA_PEM` dans l'app API.
- [ ] Appliquer les migrations une seule fois (migrateur `migrateStandalone`, ordre 0001 → 0010). Le guide est dans MIMT-SELFHOSTED-POSTGRES-RECOVERY.md.
- [x] Vérifier `https://api.mimt.ca/readyz` → `ok: true`, `db: "up"` (confirmé le 2026-10-11).
- [ ] Sauvegardes planifiées et une restauration testée.

## 2. API (Coolify) : variables d'environnement

Noms seulement. Les valeurs viennent de chaque fournisseur.

**Obligatoires en production** (l'API refuse de démarrer sans elles) :
`DATABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_AUTH_TOKEN`, `TWILIO_TWIML_APP_SID`, `TAKATAK_ISSUER`, `TAKATAK_CLIENT_ID`, `TAKATAK_WEBHOOK_URL`, `TAKATAK_WEBHOOK_SECRET`, `MIMT_SESSION_SIGNING_KEY`, `MESSAGE_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MIMT_API_KEY` (ou `MIMT_API_KEY_SHA256`), `PUBLIC_BASE_URL=https://api.mimt.ca`.

**Optionnelles** (la fonction reste désactivée ou répond 503 sans elles) :

| Fonction | Variables |
|---|---|
| Vérification par texto | `TWILIO_VERIFY_SERVICE_SID`, `TWILIO_MESSAGING_SERVICE_SID` |
| Notifications d'appel | `TWILIO_PUSH_CREDENTIAL_SID_IOS`, `TWILIO_PUSH_CREDENTIAL_SID_ANDROID` |
| IA (Claude) | `ANTHROPIC_API_KEY`, `AI_RECEPTIONIST_WS_URL` |
| Photos (MMS), message d'accueil | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_MEDIA_BUCKET` |
| Messagerie vocale par courriel | `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, `EMAIL_FROM` |
| Achats intégrés | `APPLE_BUNDLE_ID`, `APPLE_TEAM_ID`, `APPLE_ROOT_CA_PEM`, `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` |
| Transfert de numéro | `TWILIO_PORTING_ENABLED`, `PORT_IN_FEE_CENTS` (0 par défaut), `PORT_IN_NOTIFICATION_EMAIL` |
| Réunions vidéo (LiveKit) | `LIVEKIT_URL` (`wss://rtc.mimt.ca`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Internet et mobile | `PROVISIONING_PROVIDER`, `VIDEOTRON_*`, `CATALOG_ADMIN_USER_IDS` |
| Cuba | `CUBA_CARRIER`, `CUBA_SIP_HOST` |
| Surveillance | `SENTRY_DSN`, `BETTER_STACK_HEARTBEAT_URL`, `DAILY_SPEND_ALERT_CAD` |
| Garde-fou du forfait gratuit (section 7 ter) | `FREE_NEW_NUMBERS_PER_DAY`, `FREE_ACTIVE_NUMBERS_MAX`, `FREE_TIER_MONTHLY_BUDGET_CAD`, `FREE_OUTBOUND_PSTN_ENABLED`, `FREE_SIGNUPS_ENABLED` (valeurs par défaut sûres) |

- [ ] Le proxy Coolify doit laisser passer les WebSocket sur `/ws/ai/receptionist`.

## 3. Twilio

- [ ] Compte payant (pas d'essai), sous-compte MIMT, ensemble réglementaire canadien approuvé, permissions géographiques Voice.
- [ ] Numéros : URL voix `https://api.mimt.ca/webhooks/twilio/voice/inbound` (aussi pour les numéros d'affaires), URL texto `https://api.mimt.ca/webhooks/twilio/sms/inbound`, statut `…/sms/status`.
- [ ] Application TwiML : voix `https://api.mimt.ca/webhooks/twilio/voice/outbound`.
- [ ] Partenaire 9-1-1 configuré et testé (adresse civique, appel test sans réel appel d'urgence, selon le partenaire).
- [ ] ConversationRelay activé (réceptionniste IA), accepter les conditions IA de Twilio si demandé.
- [ ] Porting API : confirmer l'accès pour les numéros canadiens, enregistrer le webhook `https://api.mimt.ca/webhooks/twilio/porting`, puis `TWILIO_PORTING_ENABLED=true`.

## 4. Paiements

- [ ] Stripe : webhook `https://api.mimt.ca/webhooks/stripe` avec l'événement **`invoice.paid`** activé (sinon les récompenses de parrainage ne se règlent jamais).
- [ ] App Store et Google Play : abonnements `ca.mimt.app.noads.monthly` (3,99 $) et `ca.mimt.app.noads.yearly` (29,99 $), dans un groupe séparé des forfaits.
- [ ] AdMob : unités de publicité récompensée avec la vérification côté serveur (SSV) vers l'API.
- [ ] Confirmer les tarifs internationaux de `packages/shared/src/rates.ts` (ce sont des valeurs provisoires), puis mettre `INTL_RATES_ARE_PLACEHOLDERS = false`. Revoir la liste de pays permis au forfait gratuit.

## 5. Sites web

- [ ] DNS : mimt.ca, app.mimt.ca (MochaHost) et api.mimt.ca (serveur Coolify), certificats TLS valides.
- [x] **Site vitrine** : GitHub `main` → CI réussie → `Auto deploy MIMT website` → compilation Next.js → FTP relatif `./` → vérification HTTP. Première publication automatique confirmée [run 38609788525](https://github.com/takatakca/mimtcaapp/actions/runs/38609788525). Le workflow ne touche ni à l'API ni aux comptes télécom.
- [ ] **Portail Web** : corriger dans les secrets GitHub `MOCHAHOST_APP_FTP_SERVER` (un **nom d'hôte DNS existant**, sans `ftp://`, port, espace ni chemin). Le serveur fourni à la dernière exécution n'était pas résolvable. Le compte FTPS doit pointer directement vers la racine de `app.mimt.ca`, distincte de `mimt.ca`. Ensuite GitHub → Actions → **Deploy** → Run workflow → `webphone`, chemin `./`. Le workflow contrôle désormais aussi les routes `/connexion` et `/messages` (règles Apache) et refuse les hôtes FTPS invalides avant de compiler.
- [ ] **API** : garder un déploiement manuel (`Deploy`, portée `api`) jusqu'à la validation séparée des flux Twilio/9-1-1 et des paiements. Surveiller `/healthz` et `/readyz` ; une CI réussie n'est pas une preuve de conformité ou de mise en service.
- [ ] Vérifier que `app.mimt.ca` sert le `index.html`, le `.htaccess`, les fichiers JS/CSS, les liens profonds et des certificats TLS valides après réparation FTPS.
- [ ] Remplacer chaque `[À confirmer par MIMT]` du site (responsable des renseignements personnels, raison sociale, durées de conservation, centre 9-1-1, dates de mise à jour). Les chercher dans `apps/web`.
- [ ] Faire relire par un avocat les pages 9-1-1, confidentialité, conditions et plaintes (marquées « à valider par l'avocat »), ainsi que les constantes du Code sur les services sans fil et du Code sur l'Internet.
- [ ] Entente écrite pour le transfert de données IA hors Québec (Loi 25) avant d'activer l'IA : le site s'y engage.

## 6. Applications mobiles

- [ ] Comptes Apple Developer et Google Play, fiches en français d'abord, build de développement sur un vrai téléphone, premier vrai appel et premier 9-1-1 test (selon la procédure du partenaire).

## 7. Revente Internet et mobile (plus tard)

- [ ] Entente Vidéotron, documentation de l'API revendeur, accès de test, puis remplir l'adaptateur. La liste des questions est dans MIMT-RESALE.md.

## 7 bis. Réunions vidéo (Réunions MIMT)

Guide complet : [MIMT-VIDEO.md](MIMT-VIDEO.md). Sans ces étapes, la page Réunions affiche « pas encore offertes » et l'API répond 503.

- [ ] Appliquer la migration `0010_meetings.sql` (migrateur unique, voir section 1).
- [ ] Choisir l'hébergement : LiveKit sur Coolify (recommandé, données chez MIMT) ou LiveKit Cloud (prix [À VÉRIFIER], EFVP Loi 25 requise).
- [ ] Coolify : générer la clé et le secret (`docker run --rm livekit/livekit-server generate-keys`), DNS `rtc.mimt.ca` → serveur, ressource `livekit/livekit-server` en réseau hôte, domaine `https://rtc.mimt.ca` → port 7880 avec TLS, pare-feu ouvert pour `7881/tcp` et `50000-60000/udp` (TURN/TLS au besoin).
- [ ] Webhook LiveKit vers `https://api.mimt.ca/webhooks/livekit` (même clé que l'API).
- [ ] API Coolify : `LIVEKIT_URL=wss://rtc.mimt.ca`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (secret), puis redéployer. Facultatif : fournisseur de courriel pour envoyer les invitations.
- [ ] Tests réels : Premium à 2, Affaires avec un invité en salle d'attente, partage d'écran, cellulaire en LTE, réseau d'entreprise sans UDP.
- [ ] Politique de confidentialité : aucun enregistrement, données conservées (titre, invitations, journal d'arrivées) et leur durée [À confirmer par MIMT].

## 7 ter. Publicités et coûts

Un utilisateur gratuit coûte environ 6 $ par mois chez Twilio (numéro 1,60 $, 9-1-1 1,04 $, minutes et textos; `docs/MIMT-STACK.md` §2). Les publicités rapportent environ 1 à 3 $ par utilisateur actif. Deux protections évitent de payer de sa poche : les **publicités** (Web : AdSense; mobile : AdMob) et le **garde-fou de coûts** de l'API.

### Garde-fou de coûts (API, Coolify)

Toutes facultatives; sans elles, les valeurs par défaut s'appliquent dès le déploiement de l'API.

| Variable | Défaut | Recommandé au lancement | Effet |
|---|---|---|---|
| `FREE_NEW_NUMBERS_PER_DAY` | 5 | 5 | Nouveaux numéros gratuits par jour UTC. Au-delà : « Les numéros gratuits du jour sont tous attribués… » (409). `0` = aucun. |
| `FREE_ACTIVE_NUMBERS_MAX` | 50 | 50 | Total des numéros gratuits détenus (actifs, verrouillés ou en période de grâce). Atteint : même refus (409). 50 numéros ≈ 132 $ par mois de frais fixes. `0` = aucun nouveau numéro gratuit. |
| `FREE_TIER_MONTHLY_BUDGET_CAD` | 150 | 150 | Dépense Twilio estimée de tous les comptes gratuits ce mois-ci (appels facturés + 0,023 $ par texto sortant). Atteinte : appels et textos sortants vers le réseau refusés pour le forfait gratuit jusqu'au 1er du mois. |
| `FREE_OUTBOUND_PSTN_ENABLED` | `true` | `true` | `false` coupe tout de suite les appels et textos sortants du forfait gratuit. |
| `FREE_SIGNUPS_ENABLED` | `true` | `true` | `false` arrête toute attribution de numéro gratuit (les forfaits payants continuent). |

- Jamais touchés : le **9-1-1**, les appels et textos entre applications MIMT, les appels et textos entrants, les forfaits payants (Verrouillage, Premium, Affaires).
- Le budget mensuel ne compte pas la location des numéros (1,60 $ + 9-1-1 1,04 $ = 2,64 $ par numéro et par mois). Elle est plafonnée par `FREE_ACTIVE_NUMBERS_MAX` (total détenu) et `FREE_NEW_NUMBERS_PER_DAY` (rythme). Avec les valeurs par défaut, au plus 50 numéros gratuits, soit environ 132 $ par mois de frais fixes, plus le budget d'usage de 150 $. Monter ces plafonds quand les revenus publicitaires sont mesurés. Les numéros inactifs 30 jours sont repris et libèrent une place.
- Suivi : `GET https://api.mimt.ca/v1/admin/costs` (jeton d'un utilisateur listé dans `CATALOG_ADMIN_USER_IDS`) → `month`, `freeSpendCad`, `budgetCad`, `freeNumbersToday`, `capToday`, `activeFreeNumbers`, `activeFreeMax`, `estimatedFixedMonthlyCad`.
- Urgence (facture qui s'emballe) : `FREE_SIGNUPS_ENABLED=false` et `FREE_OUTBOUND_PSTN_ENABLED=false` dans Coolify, puis redéployer l'API. Le 9-1-1 reste permis.

### Connexion par texto (Twilio Verify)

- [ ] Console Twilio → Verify → Services → créer « MIMT » (canal SMS, langue française), copier le SID `VA…`.
- [ ] Coolify (API) : `TWILIO_VERIFY_SERVICE_SID` = ce SID, puis redéployer. Sans lui, `app.mimt.ca/connexion/texto` et la connexion par texto de l'app répondent « non configuré » (503).

### Publicités Web (Google AdSense, app.mimt.ca)

Le code est prêt : les annonces ne s'affichent qu'au forfait gratuit et à Verrouillage du numéro (sans module « Sans pub »), en bas des listes Messages, Appels et Messagerie vocale et dans la barre latérale sur ordinateur. Jamais pendant un appel, ni sur Compte (9-1-1, facturation), Services (paiement), Réunions, Affaires ou la connexion. Non personnalisées par défaut (Loi 25) : personnalisées seulement si l'utilisateur active « Publicités personnalisées » dans Compte › Confidentialité. Chaque annonce porte « Publicité » et un lien « Enlever les publicités » vers le module Sans pub (3,99 $/mois). Sans identifiants AdSense, aucune annonce et aucun script Google.

- [ ] Créer le compte AdSense avec le compte Google de MIMT (bénéficiaire = raison sociale, paiement en CAD, renseignements fiscaux).
- [ ] AdSense → Sites → ajouter **mimt.ca** (le domaine racine; app.mimt.ca est couvert comme sous-domaine). Méthode de validation : **ads.txt**.
- [ ] GitHub → Settings → Secrets and variables → Actions → **Variables** : `ADSENSE_CLIENT` = `ca-pub-…` (16 chiffres). Le prochain déploiement du site publie automatiquement `https://mimt.ca/ads.txt` (`google.com, pub-…, DIRECT, f08c47fec0942fa0`). Aucun ads.txt n'est publié sans cette variable, et aucun n'est mis sur app.mimt.ca : AdSense lit celui du domaine racine. (`ADSENSE_PUBLISHER_ID` peut remplacer `ADSENSE_CLIENT` pour ads.txt si besoin.)
- [ ] Attendre l'approbation du site (quelques jours à quelques semaines). Risque à connaître : app.mimt.ca est derrière une connexion et marqué `noindex`; si AdSense refuse (« contenu insuffisant » ou « écran sans contenu d'éditeur »), configurer l'accès du robot d'exploration aux pages connectées (AdSense → Compte → Accès et autorisation → Accès du robot d'exploration) ou passer à Google Ad Manager.
- [ ] AdSense → Annonces → Par bloc d'annonces → Annonces display : créer « MIMT Web bannière » (horizontal, adaptatif) et « MIMT Web barre latérale » (carré, adaptatif). Copier les `data-ad-slot`.
- [ ] Variables GitHub : `ADSENSE_SLOT_BANNER` (obligatoire pour afficher des annonces) et `ADSENSE_SLOT_SIDEBAR` (facultative). Puis Actions → **Deploy** → `webphone` (et `website` si ads.txt n'est pas encore publié).
- [ ] AdSense → Confidentialité et messages : activer le message pour l'EEE, le Royaume-Uni et la Suisse (CMP certifiée Google) ou y restreindre les annonces; garder les annonces non personnalisées par défaut au Québec.
- [ ] Mettre à jour la politique de confidentialité (Google comme fournisseur publicitaire hors Québec, témoins, retrait) et l'EFVP Loi 25 pour Google.
- [ ] Vérifier en direct avec un compte gratuit : `https://app.mimt.ca/messages` affiche « Publicité », aucune erreur CSP dans la console, rien sur `/compte` ni pendant un appel; un compte Premium n'en voit aucune.

### Publicités mobiles (AdMob)

- [ ] AdMob : créer les applications iOS et Android, une bannière et une unité **récompensée** (« Gagnez 10 minutes ») avec la vérification côté serveur vers `https://api.mimt.ca/webhooks/admob/ssv`.
- [ ] EAS : `ADMOB_ANDROID_APP_ID`, `ADMOB_IOS_APP_ID`. **À faire dans le code avant la publication** : l'app utilise encore les identifiants de test de Google pour les blocs d'annonces (`apps/mobile/src/services/ads.ts`, `testUnitIds`); brancher les vrais identifiants de blocs (variables EAS) au moment de publier les applications.

## 8. Avant d'ouvrir au public

- [ ] Ne pas ouvrir la voix et les textos aux abonnés avant l'approbation séparée du 9-1-1, de la conformité (CRTC, Loi 25) et des paiements.
