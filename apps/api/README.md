# MIMT API (`@mimt/api`)

Fastify 5 · TypeScript (ESM) · Node 22 · PostgreSQL privé MIMT (Coolify; Supabase historique seulement) · Twilio · Stripe.

> **Production (octobre 2026)** : la base active déclarée est `mimt-prod-postgres` sur Coolify, isolée du Supabase central TAKATAK. Le nom `supabase/migrations` est historique. Suivre [le runbook PostgreSQL autonome](../../docs/MIMT-SELFHOSTED-POSTGRES-RECOVERY.md); ne jamais lancer de migration directement sur le tableau de bord TAKATAK.
Architecture et règles : [`docs/MIMT-MVP.md`](../../docs/MIMT-MVP.md), [`docs/MIMT-REGULATORY.md`](../../docs/MIMT-REGULATORY.md).

---

## Français

### Démarrer en local

```bash
pnpm install                       # à la racine du monorepo
pnpm --filter @mimt/shared build
cp apps/api/.env.example apps/api/.env   # facultatif : tout peut rester vide en dev
pnpm --filter @mimt/api dev        # http://localhost:8080/healthz
pnpm --filter @mimt/api test
pnpm --filter @mimt/api typecheck
```

Sans configuration, l'API démarre quand même : stockage en mémoire (sans `DATABASE_URL`), clés de session et de chiffrement éphémères, et les fonctions Twilio / Stripe répondent `503 not_configured`. En `NODE_ENV=production`, les variables marquées « oui » ci-dessous sont obligatoires et le démarrage échoue sinon.

`tsx` lit les variables du shell. Pour un fichier `.env` : `node --env-file=apps/api/.env --import tsx apps/api/src/server.ts`.

### Variables d'environnement

| Variable | Prod | Rôle |
| --- | --- | --- |
| `PORT`, `HOST` | | Écoute (défaut `8080`, `0.0.0.0`) |
| `PUBLIC_BASE_URL` | https | URL publique (`https://api.mimt.ca`). Sert à valider `X-Twilio-Signature` et à construire les URL de webhooks |
| `APP_BASE_URL` | | Retour après paiement Stripe (défaut `https://app.mimt.ca`) |
| `CORS_ORIGINS` | | Liste séparée par virgules (défaut `mimt.ca`, `app.mimt.ca`, `takatak.ca`) |
| `DATABASE_URL` | oui | URL PostgreSQL **privée MIMT** (Coolify : `mimt_production`). Si un déploiement utilise un vrai projet Supabase dédié MIMT, il doit respecter la garde du projet et les validations TLS. **Jamais** le projet central TAKATAK. |
| `MIMT_DATABASE_PROJECT_REF` | oui (Supabase en production) | Référence du projet Supabase **exclusif à MIMT**. L'API vérifie que l'URL PostgreSQL (pooler ou directe) cible précisément ce projet. Jamais le projet TAKATAK central ou un autre client. |
| `DATABASE_SSL_CA_PEM` | si certificat privé | Certificat d'autorité CA au format PEM pour **vérifier** le certificat TLS PostgreSQL. Dans Coolify, ajouter la CA authentique de la base, pas un certificat inventé. Les retours à la ligne réels ou `\\n` sont acceptés. Ne jamais définir `NODE_TLS_REJECT_UNAUTHORIZED=0` ni `rejectUnauthorized: false`. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | oui | Appels REST Twilio (clé API, pas le jeton maître) |
| `TWILIO_AUTH_TOKEN` | oui | **Uniquement** pour valider les signatures des webhooks |
| `TWILIO_TWIML_APP_SID` | oui | TwiML App des appels sortants de l'application |
| `TWILIO_PUSH_CREDENTIAL_SID_IOS` / `_ANDROID` | | Identifiants push VoIP (PushKit / FCM) |
| `TWILIO_MESSAGING_SERVICE_SID` | | Réservé (Advanced Opt-Out) |
| `TWILIO_VERIFY_SERVICE_SID` | | Connexion de secours par code SMS |
| `EMERGENCY_FALLBACK_CALLER_ID` | | Numéro de l'entreprise avec adresse 9-1-1, utilisé si l'utilisateur n'a pas encore de numéro |
| `TWILIO_PORTING_ENABLED` | | `true` : les transferts de numéro (`/v1/port-ins`) sont envoyés à l'API Porting de Twilio après la signature de la LOA. Sinon ils restent « signés » pour un envoi manuel |
| `PORT_IN_FEE_CENTS` | | Frais de transfert en cents, **0 par défaut** (aucun frais approuvé) |
| `PORT_IN_NOTIFICATION_EMAIL` | | Courriel des opérations en copie des avis de transfert Twilio |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | | Réunions vidéo (LiveKit, `docs/MIMT-VIDEO.md`). `LIVEKIT_URL` en `wss://` en production. Sans les trois, `/v1/meetings*` répond 503. Le secret n'est jamais renvoyé ni journalisé |
| `TAKATAK_ISSUER`, `TAKATAK_CLIENT_ID` | oui | OIDC TAKATAK (découverte via `/.well-known/openid-configuration`) |
| `TAKATAK_JWKS_URL`, `TAKATAK_CLIENT_SECRET`, `TAKATAK_REDIRECT_URIS` | | Facultatifs (JWKS explicite, client confidentiel, liste blanche des redirections) |
| `TAKATAK_WEBHOOK_URL`, `TAKATAK_WEBHOOK_SECRET` | oui | Webhooks signés vers TAKATAK (`X-MIMT-Signature: t=…,v1=…`) |
| `MIMT_API_KEY` ou `MIMT_API_KEY_SHA256` | oui (un des deux) | Clé du serveur TAKATAK pour `/v1/takatak/overview` |
| `MIMT_SESSION_SIGNING_KEY` | oui | Clé privée Ed25519 (JWK ou PEM PKCS#8) des jetons de session |
| `MESSAGE_ENCRYPTION_KEY` | oui | 32 octets en base64 (`openssl rand -base64 32`) — chiffrement AES-256-GCM des messages |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | oui | Facturation |
| `E911_NOTICE_VERSION` | | Version de l'avis 9-1-1 à accepter (changer à chaque modification du texte) |
| `DAILY_SPEND_ALERT_CAD` | | Seuil quotidien de dépenses qui suspend les appels/SMS sortants (défaut 25) |
| `USD_TO_CAD`, `INTL_ASSUMED_RATE_CENTS_PER_MIN` | | Conversion des prix Twilio ; tarif prudent pour limiter la durée des appels internationaux |

Les secrets vont dans les secrets de Coolify, jamais dans le code ni dans le clavardage.

### PostgreSQL TLS on Coolify

- Keep `DATABASE_URL` pointed to the MIMT database, with `sslmode=verify-full` when the database certificate hostname matches the connection hostname. Do not turn certificate validation off.
- `DATABASE_SSL_CA_PEM` must contain a **real, complete, valid X.509 CA certificate** from the database provider. Quoted/escaped newlines are accepted, but placeholders and truncated certificates are rejected without weakening verification.
- For a Coolify PostgreSQL CA, first obtain the genuine public CA certificate from **Coolify → Server advanced CA certificates** or the verified host file `/data/coolify/ssl/coolify-ca.crt`; never use the database private key. Coolify documents a read-only mount to `/etc/ssl/certs/coolify-ca.crt` for client containers.
- Postgres.js **does not** load the libpq `sslrootcert` URL query parameter as a trusted CA; the MIMT adapter removes it before connecting. If it references a readable absolute file path mounted inside the API container, the adapter can load the CA from that path as a fallback.
- When a supplied CA cannot be parsed, MIMT logs `category=database_ca_invalid` without logging certificate contents. `GET /readyz` must return `ok:true,db:"up"` before the system is considered database-ready.
- Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized:false` to hide certificate problems. Do not publish `DATABASE_URL` or private keys in GitHub, logs or chat.

### Configuration de la console Twilio

1. **Compte** : compte payant (pas d'essai), un sous-compte par environnement (staging, production).
2. **Clé API** : *Account › API keys* → créer une clé *Standard* → `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET`.
3. **TwiML App** (*Voice › TwiML Apps*) :
   - Voice Request URL : `POST https://api.mimt.ca/webhooks/twilio/voice/outbound`
   - Status Callback URL : `POST https://api.mimt.ca/webhooks/twilio/voice/status`
   - SID → `TWILIO_TWIML_APP_SID`.
4. **Numéros** : achetés par l'API (`/v1/numbers/claim`), qui règle elle-même :
   voix `POST /webhooks/twilio/voice/inbound`, SMS `POST /webhooks/twilio/sms/inbound`, statut `POST /webhooks/twilio/voice/status`, et l'adresse d'urgence. Pour un numéro acheté à la main, mettre ces mêmes URL.
5. **Push VoIP** (*Voice › Credentials*) : un identifiant APNs VoIP (iOS) et un FCM (Android) → `TWILIO_PUSH_CREDENTIAL_SID_IOS` / `_ANDROID`.
6. **Permissions géographiques** : *Voice › Settings › Geo permissions* : **Canada et États-Unis seulement** ; ne jamais activer les numéros surtaxés ni les pays à haut risque. *Messaging › Geo permissions* : Canada et États-Unis.
7. **9-1-1** : vérifier que les adresses d'urgence (Emergency Calling) sont activées pour le Canada. Tester avec le numéro de test **933**, jamais 911.
8. **Déclencheurs d'utilisation** (*Usage › Triggers*) : alerte quotidienne sur le coût total (ex. 25 $) avec rappel vers l'équipe, et une limite par sous-compte.
9. **Verify** (facultatif) : service Verify pour la connexion de secours → `TWILIO_VERIFY_SERVICE_SID`, avec Fraud Guard activé.
10. **Transfert de numéro** (facultatif) : activer l'API Porting sur le compte, confirmer qu'elle accepte les numéros canadiens, enregistrer le webhook `https://api.mimt.ca/webhooks/twilio/porting` (`POST /v1/Porting/Configuration/Webhook`, champ `port_in_target_url`), puis `TWILIO_PORTING_ENABLED=true`. La facture récente exigée par Twilio se téléverse encore dans la console (TODO dans `src/gateways/twilioPorting.ts`).

### Déploiement Coolify

1. Nouvelle ressource *Dockerfile* sur le dépôt, contexte = racine, Dockerfile = `apps/api/Dockerfile`.
2. Port 8080, domaine `api.mimt.ca` (HTTPS obligatoire pour les webhooks).
3. Ajouter les variables ci-dessus dans *Environment Variables* (marquées secrètes).
4. Health check : `GET /healthz` (vivant) et `GET /readyz` (base de données).
5. Appliquer la migration Supabase (`supabase/README.md`) avant le premier déploiement.
6. Tâche planifiée quotidienne (Coolify *Scheduled Tasks*) : `node dist/jobs/numberLifecycle.js` (avertissements à 20 et 27 jours, période de grâce, quarantaine de 90 jours, libération).

Image : `docker build -f apps/api/Dockerfile -t mimt-api .` (depuis la racine). Multi-étapes, `node:22-alpine`, utilisateur non root, `pnpm deploy` du paquet.

---

## English

Run: `pnpm install && pnpm --filter @mimt/shared build && pnpm --filter @mimt/api dev`. Tests: `pnpm --filter @mimt/api test`. With nothing configured the API boots (in-memory store, ephemeral keys, Twilio/Stripe features answer `503 not_configured`); in production the variables marked "oui" above are required. Twilio console steps: TwiML App voice + status URLs, number webhooks (set automatically on purchase), VoIP push credentials, geo permissions CA/US only, usage triggers, emergency addresses (test with 933). Coolify: Dockerfile build from repo root with `apps/api/Dockerfile`, port 8080, HTTPS domain, secrets as env vars, `/healthz` + `/readyz`, daily scheduled task `node dist/jobs/numberLifecycle.js`.

### Endpoints

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/healthz`, `/readyz`, `/.well-known/jwks.json` | — |
| POST | `/v1/auth/takatak/exchange` · `/v1/auth/refresh` · `/v1/auth/logout` | — |
| POST | `/v1/auth/otp/start` · `/v1/auth/otp/verify` | — (503 without Twilio Verify) |
| POST | `/v1/handoff/activations` | TAKATAK-signed JWT (aud `mimt`, ≤ 60 s, single-use `jti`, `sub` = `global_user_id`) |
| POST | `/v1/handoff/claim` | MIMT bearer |
| GET | `/v1/takatak/overview?global_user_id=` | `X-MIMT-Api-Key` |
| GET | `/v1/e911/notice?locale=` | — |
| GET/PUT | `/v1/e911/address` (GET: 404 when none) · POST `/v1/e911/acknowledge` | bearer |
| GET | `/v1/numbers/available?areaCode=` · POST `/v1/numbers/claim` | bearer |
| GET | `/v1/voice/token?platform=ios\|android\|web` · `/v1/calls?cursor=&limit=` (recents, own account) | bearer |
| POST | `/v1/messages` · GET `/v1/conversations` · GET `/v1/conversations/:peer/messages?cursor=&limit=` | bearer |
| GET | `/v1/voicemails` (each with a 15-min signed `audioUrl`) · DELETE `/v1/voicemails/:id` | bearer |
| GET | `/v1/voicemails/:id/audio` | signed `?token=` from the list, or owner bearer. Proxied server-side from Twilio; Twilio credentials never reach the client |
| POST | `/v1/push/register` (APNs/FCM token per user/platform) | bearer |
| POST | `/v1/rewards/claim` (501 `not_implemented` until AdMob SSV) | bearer |
| POST | `/v1/billing/checkout` · GET `/v1/billing/portal` · POST `/v1/billing/iap/verify` (501) | bearer |
| GET/PATCH/DELETE | `/v1/me` (PATCH also takes `forwarding`, `dnd`, `blockedCallAction`) · GET `/v1/me/export` · POST `/v1/consents` | bearer |
| GET/POST | `/v1/blocks` · DELETE `/v1/blocks/:id` · DELETE `/v1/blocks?number=` (inbound calls rejected or sent to voicemail, texts dropped; 9-1-1 cannot be blocked) | bearer |
| POST | `/webhooks/twilio/voice/{outbound,inbound,dial-result,hangup,status,recording,transcription}` | `X-Twilio-Signature` |
| POST | `/webhooks/twilio/sms/{inbound,status}` | `X-Twilio-Signature` |
| POST | `/webhooks/stripe` | `Stripe-Signature` (raw body) |
| GET/POST | `/v1/meetings` · GET/PATCH `/v1/meetings/:id` · POST `/v1/meetings/:id/{invites,token,admit,end}` (Réunions MIMT, LiveKit; 503 without `LIVEKIT_*`) | bearer (host, business members, invitees; manage = host or business owner/admin) |
| POST | `/v1/meetings/join/guest` · `/v1/meetings/join/guest/info` (guest token in the body, 10/min per IP) | — |
| POST | `/webhooks/livekit` | LiveKit `Authorization` JWT + body SHA-256 (raw body) |

### Design notes

- **9-1-1 first**: the outbound voice webhook checks for 9-1-1 before anything else and dials it with no caps, credit, plan, acknowledgement or account-status check; lookups are best-effort so a database failure still dials. Covered by tests.
- **Fraud** (`src/fraud`): pure caps/destination checks, token-bucket rate limiter behind an interface (swap for Redis when running more than one instance), 14-day new-account halving, daily spend guard that sets the account to `OUTBOUND_SUSPENDED` and logs `fraud_events`.
- **Twilio** sits behind `TwilioGateway` (`src/gateways/twilio.ts`); tests use a mock. Stripe sits behind `BillingGateway`.
- **Repository**: `Repository` interface with `PostgresRepository` and `MemoryRepository`; `test/repo.contract.test.ts` runs the same assertions against both.
- **Call controls** (`src/services/callControls.ts`, migration `0006`): blocks, do not disturb (quiet hours in America/Montreal) and forwarding run on the inbound path only. Forwarding needs the `call_forwarding` plan feature, Canada/US targets that pass `fraud/destinations.ts` (no MIMT numbers, no 9-1-1), and remaining outbound minutes; the forwarded leg is counted as outbound minutes, the inbound leg as inbound minutes.
- **Logs**: pino with redaction of auth headers, signatures, tokens and message bodies; request logs keep only the path.
- **MIMT Affaires lines (PBX-01)**: Stripe is the source of truth. `POST /v1/business/:id/seats` (owner/admin) sets the quantity of the business plan item (`proration_behavior: create_prorations`, idempotency key `seats:<business>:<subscription>:<from>-<to>:<Idempotency-Key header or uuid>`) and resizes the TPS/TVQ/9-1-1 items; with no live subscription it returns a Stripe Checkout URL with quantity = lines. Never below the number of extensions (409 `seats_below_members`, French message). `customer.subscription.updated/deleted` mirrors the quantity into `business_seats` (pooled caps = per-line cap × synced seats, never above the paid quantity); `past_due` = payment attention (`billingStatus` on `GET /v1/business/:id`, calls continue), `canceled`/`unpaid` = business outbound PSTN calls refused, inbound calls and 9-1-1 unchanged. Real Stripe verification (test mode) is still owner-side.

- **Réunions MIMT** (`src/routes/meetings.ts`, `src/video/gateway.ts`, migration `0010`, `docs/MIMT-VIDEO.md`): LiveKit sits behind `VideoGateway` (tests use a fake; token signing and webhook verification are also tested with the real SDK). Plan gating (`video_meetings`: Premium 4, Affaires 25, Affaires Pro 100 participants), cap checked with `listParticipants` at token issuance, 4-hour limit, 1-hour tokens, random room names, guest links valid 7 days for one meeting (SHA-256 stored), waiting room (no publish/subscribe/data until the host admits). Nothing is recorded. Env: `LIVEKIT_URL` (wss:// in production), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (never returned or logged).

### Tests against Postgres

The Postgres repository contract tests are skipped unless `TEST_DATABASE_URL` is set. CI runs them in
`.github/workflows/verify-standalone-postgres.yml` (job `repo-contract-tests`). Locally, against a
**throwaway** PostgreSQL (tables are truncated) whose database is `mimt_production` owned by `mimt_owner`
(the names the one-shot migrator accepts):

```bash
TEST_DATABASE_URL=postgresql://mimt_owner:pw@127.0.0.1:5432/mimt_production scripts/db/test-postgres.sh
```

The script applies `bootstrap.sql` and every migration with `dist/jobs/migrateStandalone.js`, runs the whole
API suite one file at a time, and fails if any test was skipped.

### TODO

- iOS App Attest CBOR verification (the route exists; production iOS fails closed until `APPLE_TEAM_ID` and the attestation check are finished). Android Play Integrity runs when the Play service-account secret is set.
- French voicemail transcription. Paid plans already request Twilio's English transcription.
- Copy MMS media to private storage. Voicemail audio is copied when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
- Push notifications (APNs/FCM) and email (`LogNotifier` still logs only).
- Twilio Lookup line-type check at signup.
- Hard-delete job after the 30-day deletion delay; cancel Stripe subscriptions on account deletion.
- Twilio subaccount per environment / business customer; per-business ring groups (phase 2).
- Usage periods are UTC calendar months; align with the billing period when paid plans start.
- Redis rate limiter and a separate outbox worker when scaling past one instance.
- Run `pnpm --filter @mimt/api job:twilio-guardrails` once the Twilio API key is in the environment (Canada/US voice permissions, daily spend trigger). It does not buy numbers.
