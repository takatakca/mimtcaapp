# MIMT API (`@mimt/api`)

Fastify 5 · TypeScript (ESM) · Node 22 · Postgres (Supabase) · Twilio · Stripe.
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
| `DATABASE_URL` | oui | Postgres Supabase (connexion directe / service role) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | oui | Appels REST Twilio (clé API, pas le jeton maître) |
| `TWILIO_AUTH_TOKEN` | oui | **Uniquement** pour valider les signatures des webhooks |
| `TWILIO_TWIML_APP_SID` | oui | TwiML App des appels sortants de l'application |
| `TWILIO_PUSH_CREDENTIAL_SID_IOS` / `_ANDROID` | | Identifiants push VoIP (PushKit / FCM) |
| `TWILIO_MESSAGING_SERVICE_SID` | | Réservé (Advanced Opt-Out) |
| `TWILIO_VERIFY_SERVICE_SID` | | Connexion de secours par code SMS |
| `EMERGENCY_FALLBACK_CALLER_ID` | | Numéro de l'entreprise avec adresse 9-1-1, utilisé si l'utilisateur n'a pas encore de numéro |
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
| GET/PATCH/DELETE | `/v1/me` · GET `/v1/me/export` · POST `/v1/consents` | bearer |
| POST | `/webhooks/twilio/voice/{outbound,inbound,dial-result,hangup,status,recording,transcription}` | `X-Twilio-Signature` |
| POST | `/webhooks/twilio/sms/{inbound,status}` | `X-Twilio-Signature` |
| POST | `/webhooks/stripe` | `Stripe-Signature` (raw body) |

### Design notes

- **9-1-1 first**: the outbound voice webhook checks for 9-1-1 before anything else and dials it with no caps, credit, plan, acknowledgement or account-status check; lookups are best-effort so a database failure still dials. Covered by tests.
- **Fraud** (`src/fraud`): pure caps/destination checks, token-bucket rate limiter behind an interface (swap for Redis when running more than one instance), 14-day new-account halving, daily spend guard that sets the account to `OUTBOUND_SUSPENDED` and logs `fraud_events`.
- **Twilio** sits behind `TwilioGateway` (`src/gateways/twilio.ts`); tests use a mock. Stripe sits behind `BillingGateway`.
- **Repository**: `Repository` interface with `PostgresRepository` and `MemoryRepository`; `test/repo.contract.test.ts` runs the same assertions against both.
- **Logs**: pino with redaction of auth headers, signatures, tokens and message bodies; request logs keep only the path.

### Tests against Postgres

```bash
createdb mimt_test
psql mimt_test -c "create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
  create function auth.uid() returns uuid language sql stable as 'select null::uuid';"
psql mimt_test -f supabase/migrations/0001_init.sql
psql mimt_test -f supabase/migrations/0002_push_tokens.sql
psql mimt_test -f supabase/migrations/0003_devices_rewards.sql
TEST_DATABASE_URL=postgres://localhost/mimt_test pnpm --filter @mimt/api test
```

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
