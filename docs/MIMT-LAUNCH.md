# MIMT : liste de lancement (propriétaire)

Une seule liste pour mettre MIMT en ligne. Chaque case est une action **du propriétaire** (comptes, secrets, contrats) : le code est prêt. Les secrets se mettent dans Coolify ou GitHub, jamais dans le code, un courriel ou le clavardage.

État au 2026-10-11 : mimt.ca et app.mimt.ca sont en ligne avec le contenu MIMT ; api.mimt.ca répond à `/healthz`, mais `/readyz` échoue tant que la base de données n'est pas démarrée.

Documents détaillés (ne pas recopier ici) :
- [PRODUCTION-RECOVERY-2026-10-10.md](PRODUCTION-RECOVERY-2026-10-10.md) : cPanel, DNS, Coolify, vérifications.
- [MIMT-SELFHOSTED-POSTGRES-RECOVERY.md](MIMT-SELFHOSTED-POSTGRES-RECOVERY.md) : base PostgreSQL privée et migrations.
- [MIMT-AI.md](MIMT-AI.md), [MIMT-RESALE.md](MIMT-RESALE.md), [MIMT-REGULATORY.md](MIMT-REGULATORY.md).

## 1. Base de données (bloquant)

- [ ] Coolify → MIMT → `mimt-prod-postgres` : vérifier ~1 Go de mémoire libre, ~20 Go de disque, un volume persistant, pas de port public, puis démarrer.
- [ ] Mettre `DATABASE_URL` (URL interne de cette ressource) et, si TLS, `DATABASE_SSL_CA_PEM` dans l'app API.
- [ ] Appliquer les migrations une seule fois (migrateur `migrateStandalone`, ordre 0001 → 0009). Le guide est dans MIMT-SELFHOSTED-POSTGRES-RECOVERY.md.
- [ ] Vérifier `https://api.mimt.ca/readyz` → `ok: true`, `db: "up"`.
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
| Internet et mobile | `PROVISIONING_PROVIDER`, `VIDEOTRON_*`, `CATALOG_ADMIN_USER_IDS` |
| Cuba | `CUBA_CARRIER`, `CUBA_SIP_HOST` |
| Surveillance | `SENTRY_DSN`, `BETTER_STACK_HEARTBEAT_URL`, `DAILY_SPEND_ALERT_CAD` |

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
- [ ] Publication : GitHub → Actions → **Deploy** → Run workflow (portée `website`, `webphone`, `api` ou `all`). Les secrets `MOCHAHOST_FTP_*`, `MOCHAHOST_APP_FTP_*` et `COOLIFY_*` sont en place.
- [ ] Remplacer chaque `[À confirmer par MIMT]` du site (responsable des renseignements personnels, raison sociale, durées de conservation, centre 9-1-1, dates de mise à jour). Les chercher dans `apps/web`.
- [ ] Faire relire par un avocat les pages 9-1-1, confidentialité, conditions et plaintes (marquées « à valider par l'avocat »), ainsi que les constantes du Code sur les services sans fil et du Code sur l'Internet.
- [ ] Entente écrite pour le transfert de données IA hors Québec (Loi 25) avant d'activer l'IA : le site s'y engage.

## 6. Applications mobiles

- [ ] Comptes Apple Developer et Google Play, fiches en français d'abord, build de développement sur un vrai téléphone, premier vrai appel et premier 9-1-1 test (selon la procédure du partenaire).

## 7. Revente Internet et mobile (plus tard)

- [ ] Entente Vidéotron, documentation de l'API revendeur, accès de test, puis remplir l'adaptateur. La liste des questions est dans MIMT-RESALE.md.

## 8. Avant d'ouvrir au public

- [ ] Ne pas ouvrir la voix et les textos aux abonnés avant l'approbation séparée du 9-1-1, de la conformité (CRTC, Loi 25) et des paiements.
