# MIMT — Contrôles de sécurité

Document de référence pour un examen gouvernemental ou un client d'affaires. Il décrit les contrôles en place dans
le code de ce dépôt (API `apps/api`, application Web `apps/webphone`), ce que le propriétaire doit configurer, et
comment nous appliquons la minimisation des données de la Loi 25 (Québec). Une **synthèse en anglais** se trouve
à la fin.

> Portée : ce document décrit le code. Il ne remplace ni un test d'intrusion, ni une évaluation des facteurs relatifs
> à la vie privée (EFVP), ni la preuve d'une configuration de production. Les éléments « à configurer » sont signalés.

## 1. Contrôles existants (avant ce chantier)

| Domaine | Contrôle | Où |
| --- | --- | --- |
| En-têtes HTTP | `@fastify/helmet` sur toute l'API (HSTS, `X-Content-Type-Options`, `frame-ancestors`, etc.) | `apps/api/src/app.ts` |
| En-têtes de l'app Web | CSP stricte (`object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`), `Permissions-Policy` | `apps/webphone/public/.htaccess` |
| CORS | Liste blanche d'origines (`CORS_ORIGINS`, par défaut mimt.ca, app.mimt.ca, takatak.ca), sans témoins | `apps/api/src/app.ts`, `config.ts` |
| Limitation de débit | 300 requêtes/min par IP sur l'API; 20/min sur la connexion; codes texto 3 par 10 min et 5 essais par numéro | `app.ts`, `routes/auth.ts`, `fraud/rateLimiter.ts` |
| Webhooks Twilio | Signature `X-Twilio-Signature` validée sur chaque webhook (URL publique + paramètres) | `gateways/twilio.ts`, `routes/twilioWebhooks.ts` |
| Webhooks Stripe, DocuSign | Signature Stripe sur le corps brut; HMAC DocuSign Connect | `gateways/billing.ts`, `routes/affiliates.ts` |
| Jetons de session | Jetons d'accès Ed25519 de 15 min (`MIMT_SESSION_SIGNING_KEY`), jetons de renouvellement de 30 jours, rotation à chaque usage; réutilisation d'un jeton déjà tourné = révocation de toute la famille (signal de vol) | `auth/sessions.ts` |
| Connexion | TAKATAK (OIDC + PKCE) ou code par texto (Twilio Verify). Aucun mot de passe stocké | `routes/auth.ts`, `auth/takatak.ts` |
| Chiffrement au repos | AES-256-GCM (`MessageCipher`) pour le contenu des textos, les données personnelles des affiliés, les NIP de transfert, les clés VAPID et d'autres secrets applicatifs | `lib/crypto.ts`, `services/affiliates.ts`, `routes/portIns.ts` |
| Journal d'audit | Table `audit_log` (acteur, action, cible, méta), conservée lors de la suppression d'un compte | `repo/*`, migration 0001 |
| Journaux applicatifs | Masquage (`redact`) des en-têtes d'autorisation, jetons et contenus; aucune donnée de message dans les journaux | `apps/api/src/logger.ts` |
| Suppression de compte | Fermeture immédiate, purge des données personnelles 30 jours plus tard (Loi 25, portabilité via `/v1/me/export`) | `routes/me.ts`, `jobs/accountDeletion.ts` |
| Sauvegardes | Sauvegarde PostgreSQL quotidienne (Coolify), exercice de restauration hebdomadaire automatisé | `docs/MIMT-BACKUPS.md`, `scripts/db/restore-drill.sh` |
| Base de données | RLS activée sur toutes les tables (l'API seule y accède), TLS vérifié vers PostgreSQL | migrations, `repo/postgresTls.ts` |
| 9-1-1 | Jamais bloqué, protégé par des tests | `apps/api/test/e911.test.ts` et autres |

## 2. Nouveaux contrôles (ce chantier)

### 2.1 Inventaire des sessions

* Chaque connexion (TAKATAK, code texto, clé d'accès) crée une ligne `auth_sessions` : identifiant, utilisateur,
  méthode, date de création, `last_seen_at` (mis à jour **au plus toutes les 5 minutes**), appareil **approximatif**,
  réseau **approximatif**, `revoked_at`.
* L'identifiant de session est la famille du jeton de renouvellement et la revendication `sid` de chaque jeton
  d'accès. **Chaque requête** vérifie que la session n'est pas révoquée, avec un petit cache mémoire de 30 secondes :
  une déconnexion prend effet immédiatement sur l'instance qui la reçoit, en 30 secondes au plus ailleurs, et le
  jeton de renouvellement est révoqué tout de suite.
* Points d'accès :
  * `GET /v1/me/sessions` — appareils connectés (la session courante est marquée);
  * `DELETE /v1/me/sessions/:id` — « Déconnecter » un appareil;
  * `POST /v1/me/sessions/revoke-others` — « Déconnecter partout ailleurs » (toutes les sessions sauf la courante,
    y compris les familles de jetons antérieures à l'inventaire).
* `POST /v1/auth/logout` révoque aussi la session. La suppression du compte révoque toutes les sessions.
* Compatibilité : les jetons émis avant la mise en production n'ont pas de `sid`; ils expirent en 15 minutes et leur
  premier renouvellement crée une session (méthode « connexion antérieure »). Aucune déconnexion forcée au déploiement.

### 2.2 Clés d'accès (passkeys, WebAuthn)

* Bibliothèques : `@simplewebauthn/server` **13.3.3** (API) et `@simplewebauthn/browser` **13.3.0** (Web), versions
  exactes (compatibles Node ≥ 20; l'API tourne sous Node 22).
* Usages : **connexion sans mot de passe** (identifiant découvrable, vérification de l'utilisateur obligatoire) et
  **deuxième facteur / confirmation** (step-up).
* Points d'accès : `POST /v1/me/passkeys/register/options` et `/verify`, `GET /v1/me/passkeys`,
  `DELETE /v1/me/passkeys/:id`, `POST /v1/auth/passkeys/options` et `/verify` (connexion),
  `POST /v1/auth/step-up/passkey/options` et `/verify` (confirmation).
* Défis : générés par la bibliothèque, **signés** (EdDSA, 5 minutes), liés à un usage et à un utilisateur, et
  **à usage unique** (`used_once_keys`). Le compteur de signature est mis à jour à chaque usage.
* Seule la clé publique est stockée (`passkeys.public_key`); la clé privée ne quitte jamais l'appareil.
* Ajouter ou supprimer une clé exige une authentification récente (voir 2.4). Au plus 10 clés par compte.
* Configuration : `WEBAUTHN_RP_ID` (défaut `mimt.ca`, valable pour app.mimt.ca), `WEBAUTHN_ORIGINS` (défaut
  `https://app.mimt.ca`, liste séparée par des virgules; chaque origine doit être en https sur le domaine RP, sinon
  l'API refuse de démarrer), `WEBAUTHN_RP_NAME` (défaut `MIMT`), `PASSKEYS=on|off` (défaut `on`).

### 2.3 Politique d'entreprise « require_strong_auth »

* Table `business_security_policies`, **désactivée par défaut**.
* Activée, les **propriétaires et administrateurs** d'une entreprise MIMT Affaires doivent avoir une clé d'accès :
  après une connexion par texto, la session doit être confirmée par une clé d'accès avant que les routes
  d'administration de l'entreprise (`/v1/business/:id/*`, et les routes IA d'entreprise) répondent. Réponses :
  `403 strong_auth_setup_required` (aucune clé) ou `403 strong_auth_required` (clé à confirmer). La fiche
  `GET /v1/business/:id` et `GET /v1/business/:id/security` répondent toujours, pour que l'app explique quoi faire.
  Les simples membres ne sont pas touchés.
* Modification : `PUT /v1/business/:id/security` `{ "requireStrongAuth": true }`, **propriétaire seulement**, avec
  une authentification récente **et** une session confirmée par clé d'accès (le propriétaire ne peut pas se bloquer
  lui-même). Dans l'app : MIMT Affaires › Membres › « Sécurité de l'entreprise ».
* Tant que la politique est active, un administrateur ne peut pas supprimer sa **dernière** clé d'accès
  (`409 passkey_required_by_business`).

### 2.4 Confirmation pour les actions sensibles (step-up)

Une authentification **de moins de 10 minutes** dans la session courante (clé d'accès, ou code texto **frais**
envoyé au cellulaire vérifié du compte) est exigée pour :

| Action | Route | État |
| --- | --- | --- |
| Renvoi d'appels vers un **nouveau** numéro externe | `PATCH /v1/me` (`forwarding.target`) | en place |
| Renvoi d'un poste d'entreprise vers un nouveau cellulaire externe, ou toute cible `external` nouvelle (groupes, accueil vocal, heures, numéros) | `/v1/business/:id/extensions`, `ring-groups`, `ivr`, `hours`, `dids` | en place |
| Suppression du compte | `DELETE /v1/me` | en place |
| Ajout ou suppression d'une clé d'accès | `/v1/me/passkeys/*` | en place |
| Politique de sécurité d'entreprise | `PUT /v1/business/:id/security` | en place |
| Transfert sortant (port-out) | — | **n'existe pas encore** : à brancher sur `requireRecentAuth` |
| Création, rotation de clés partenaires et adresse des avis (MIMT Connect) | `POST /v1/business/:id/partner/keys`, `…/rotate`, `PUT …/partner/webhook` | ✅ `requireRecentAuth` |
| Connexion et déconnexion de Google Agenda (docs/MIMT-CALENDAR.md) | `GET /v1/integrations/google-calendar/connect`, `DELETE /v1/integrations/google-calendar` | ✅ `requireRecentAuth` |

* Réponse sans confirmation : `403 step_up_required`. L'app affiche « Confirmez votre identité » (clé d'accès ou
  code texto), puis relance l'action.
* Confirmation : `POST /v1/auth/step-up/sms/start` puis `/verify` (3 codes et 5 essais par 10 minutes), ou
  `POST /v1/auth/step-up/passkey/options` puis `/verify`. Un échec répond `403 step_up_failed` et est audité.
* La connexion par texto ou par clé d'accès compte comme une authentification récente (10 minutes). La connexion
  TAKATAK non : l'utilisateur confirme par texto ou clé d'accès au moment voulu.
* Le Pilote MIMT exécute les actions avec le jeton de l'utilisateur : il est soumis aux mêmes confirmations.
* Pour brancher une nouvelle route : `await requireRecentAuth(deps, req)` (`apps/api/src/auth/stepUp.ts`).

### 2.5 Événements de sécurité

Écrits dans `audit_log`, avec **identifiants internes seulement** (aucun numéro de téléphone, courriel ni adresse IP
complète; le champ `ip` reçoit le réseau approximatif) :

| Action | Quand |
| --- | --- |
| `auth.sign_in` | chaque connexion (méta : méthode, nouvel appareil) |
| `auth.new_device` | connexion depuis un type d'appareil jamais vu sur ce compte |
| `passkey.added`, `passkey.removed`, `passkey.add_failed` | gestion des clés d'accès |
| `auth.passkey_failed` | connexion par clé d'accès refusée |
| `session.revoked` | « Déconnecter » ou « Déconnecter partout ailleurs » |
| `auth.step_up`, `auth.step_up_failed` | confirmation réussie ou refusée (méta : méthode) |
| `business.security_policy_updated` | changement de la politique d'entreprise |

**Avis « Nouvelle connexion à votre compte MIMT »** : sur `auth.new_device`, une notification Web Push (si
l'utilisateur l'a activée) et un courriel (si `EMAIL_PROVIDER=resend` est configuré et que le compte a un courriel).
Le message contient seulement le type d'appareil (« Safari · iOS ») et un lien vers Paramètres › Sécurité.
`SECURITY_SIGNIN_NOTICE=off` le désactive (défaut `on`). Rien n'est envoyé si aucun service n'est configuré.

### 2.6 Interface (app.mimt.ca › Compte › « Sécurité et appareils », `/compte/securite`)

* Liste des appareils connectés (celui-ci marqué « Cet appareil »), « Déconnecter » par appareil, « Déconnecter
  partout ailleurs »;
* Clés d'accès : ajout, liste (« Synchronisée » pour les clés iCloud/Google), suppression, avec textes français
  d'abord, anglais disponible;
* « Confirmer mon identité » et fenêtre de confirmation automatique sur les actions sensibles;
* Connexion : bouton « Se connecter avec une clé d'accès » sur la page de connexion.

## 3. Loi 25 : minimisation des données

| Donnée | Ce que nous gardons | Ce que nous ne gardons **jamais** | Durée |
| --- | --- | --- | --- |
| Appareil d'une session | Famille de navigateur et de système (« Chrome · Windows », « App MIMT · Android ») | La chaîne User-Agent complète | Durée de la session + 90 jours |
| Réseau d'une session | Préfixe /24 (IPv4) ou /48 (IPv6) | L'adresse IP complète | Durée de la session + 90 jours |
| Clé d'accès | Identifiant et clé **publique**, compteur, nom choisi, dates | Biométrie, clé privée (elles restent sur l'appareil) | Jusqu'à suppression par l'utilisateur ou purge du compte |
| Événements de sécurité | Identifiants internes, méthode, réseau approximatif | Numéro, courriel, IP complète, contenu | Comme le journal d'audit |
| Identifiant WebAuthn de l'utilisateur | L'identifiant interne aléatoire (UUID) | Courriel ou téléphone comme identifiant | — |

* Les sessions révoquées ou inactives depuis **90 jours** sont supprimées chaque jour (`jobs/sessionRetention.ts`).
* La purge d'un compte supprime ses sessions et ses clés d'accès.
* Limite connue : d'autres événements d'audit plus anciens (`user.created`, etc.) enregistrent encore l'adresse IP
  complète. Recommandation : appliquer le même préfixe à tout le journal d'audit et fixer une durée de conservation
  du journal — décision du propriétaire (preuve en cas de fraude vs minimisation).
* Le nom affiché dans le gestionnaire de clés d'accès de l'appareil est l'@identifiant MIMT, sinon le numéro de
  cellulaire du compte : il reste sur l'appareil de l'utilisateur.

## 4. Configuration (propriétaire)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `WEBAUTHN_RP_ID` | `mimt.ca` | Domaine des clés d'accès (couvre app.mimt.ca). Ne plus le changer une fois des clés créées. |
| `WEBAUTHN_ORIGINS` | `https://app.mimt.ca` | Origines autorisées, séparées par des virgules (ex. ajouter un domaine de préproduction sous mimt.ca). |
| `WEBAUTHN_RP_NAME` | `MIMT` | Nom affiché par le navigateur. |
| `PASSKEYS` | `on` | `off` masque les clés d'accès (les sessions et la confirmation par texto restent actives). |
| `SECURITY_SIGNIN_NOTICE` | `on` | Avis de nouvelle connexion (Web Push, courriel si configuré). |

Migration : `supabase/migrations/0022_security_sessions.sql` (tables `auth_sessions`, `passkeys`,
`business_security_policies`), enregistrée dans `MIGRATION_ORDER`. `/readyz` signale « outdated » tant qu'elle n'est
pas appliquée.

## 5. Ce qui reste à faire

* Transfert sortant et clés partenaires/API : appeler `requireRecentAuth` quand ces routes existeront.
* Application mobile (`apps/mobile`) : écran « Sécurité » et clés d'accès natives (non inclus ici; l'API est prête).
* Jeton de renouvellement dans un témoin `httpOnly` (BFF) au lieu de `sessionStorage` (voir `apps/webphone/src/api/tokens.ts`).
* Préfixe IP et durée de conservation pour tout le journal d'audit (voir §3).

---

## English summary

**Existing controls:** Helmet security headers, strict CSP on the web app, CORS allow-list, rate limiting (300/min per
IP, 20/min on sign-in, SMS code caps), Twilio webhook signature validation (plus Stripe and DocuSign signatures),
15-minute Ed25519 access tokens with rotating refresh tokens and reuse detection, AES-256-GCM encryption at rest for
message bodies, affiliate PII and other secrets, an audit log, log redaction, Law 25 export and 30-day deletion,
daily database backups with a weekly automated restore drill, RLS on every table.

**New in this change:**
1. **Session inventory** — every sign-in is an `auth_sessions` row (coarse device, /24 or /48 network, last seen at
   most every 5 min). Access tokens carry a `sid` claim checked on every request (30 s in-memory cache).
   `GET /v1/me/sessions`, `DELETE /v1/me/sessions/:id`, `POST /v1/me/sessions/revoke-others`.
2. **Passkeys (WebAuthn)** — `@simplewebauthn/server` 13.3.3 / `@simplewebauthn/browser` 13.3.0, pinned. Passwordless
   sign-in and step-up; signed single-use challenges. `WEBAUTHN_RP_ID` (default `mimt.ca`), `WEBAUTHN_ORIGINS`
   (default `https://app.mimt.ca`).
3. **Business `require_strong_auth`** (default off) — owners/admins need a passkey confirmation in the session before
   business admin routes answer; only the owner can change it, with a recent passkey confirmation.
4. **Step-up** — call forwarding to a new external number (consumer and business), account deletion, passkey
   add/remove and the business policy need an authentication within 10 minutes (passkey or fresh SMS code); answer
   `403 step_up_required`. Partner key creation/rotation and the partner webhook are protected; port-out does not exist yet and must call `requireRecentAuth`.
5. **Security events** in the audit log with internal ids only; optional « Nouvelle connexion à votre compte MIMT »
   web push / email on a new device.
6. **Web UI** — Account › « Sécurité et appareils » (`/compte/securite`), French first.

**Law 25 minimisation:** browser/OS family and a /24 or /48 network only, never the full user agent or IP; revoked or
idle sessions deleted after 90 days; sessions and passkeys deleted on account purge; only the passkey public key is
stored.
