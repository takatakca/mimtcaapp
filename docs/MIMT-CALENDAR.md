# MIMT — Connecteur « Google Agenda »

Décision du propriétaire (2026-10-29) : chaque appel (répondu ou manqué), message vocal et résumé d'appel IA devient
un événement dans le Google Agenda de l'utilisateur. **Inclus** dans Affaires et Affaires Pro; **option payante à
3,95 $/mois** (43,45 $/an = 11 × le mois, même règle que les forfaits) pour Essentiel et Premium, avec **essai gratuit
de 14 jours**. Une **synthèse en anglais** se trouve à la fin.

> État : livré derrière l'interrupteur `CALENDAR=off` (défaut). Sans identifiants OAuth Google, la carte affiche
> « Non configuré ». Le site mimt.ca l'annonce « bientôt » jusqu'à la vérification de Google.

## 1. Ce qui est construit

| Partie | Où |
| --- | --- |
| Catalogue (option `google_calendar`, prix, essai 14 jours, fonction `calendar_sync` dans Affaires/Pro) | `packages/shared/src/addons.ts`, `plans.ts`, `calendar.ts` |
| Migration `0024_calendar.sql` (`calendar_connections`, `calendar_sync_jobs`) | `supabase/migrations/`, `MIGRATION_ORDER` |
| OAuth, droit d'accès, file d'attente, envoi à Google | `apps/api/src/services/calendar.ts` |
| Routes | `apps/api/src/routes/calendar.ts` |
| Paiement (Stripe Checkout, `trial_period_days: 14` au premier achat de l'option) | `apps/api/src/routes/billing.ts` |
| Compte › Intégrations (`/compte/integrations`), FR/EN, mode démo | `apps/webphone/src/pages/Integrations.tsx` |
| Site : options de /forfaits, page /affaires, llms.txt | `apps/web` |

### Points d'accès (tous en 404 si `CALENDAR=off`)

* `GET /v1/integrations/google-calendar` — état : configuré, droit (forfait / option / entreprise), essai offert,
  connecté, courriel Google, agenda, réglages, dernier envoi.
* `GET /v1/integrations/google-calendar/connect` — URL d'autorisation Google. **Authentification récente exigée**
  (`requireRecentAuth`, 10 min). `403 calendar_not_entitled` sans droit, `503 not_configured` sans identifiants.
* `GET /v1/integrations/google-calendar/callback` — Google y renvoie le navigateur; échange du code puis redirection
  vers `https://app.mimt.ca/compte/integrations?gc=ok` ou `?gc=error&reason=…` (`state`, `denied`, `scope`,
  `exchange`, `not_entitled`, `no_refresh_token`…).
* `PUT /v1/integrations/google-calendar` — réglages : `syncCalls`, `syncMissedCalls`, `syncVoicemails`,
  `syncSummaries`, `includeContent`, `calendar: "primary"`.
* `DELETE /v1/integrations/google-calendar` — déconnexion **et révocation du jeton chez Google**. Authentification
  récente exigée. La suppression du compte (`DELETE /v1/me`) révoque aussi le jeton.

### Sécurité OAuth

* Portées : `https://www.googleapis.com/auth/calendar.events` (moindre privilège pour créer des événements; portée
  **sensible** : vérification Google requise, **pas** d'évaluation CASA) + `openid email` (afficher le compte relié).
* **Agenda dédié « MIMT » : non.** Créer un agenda (`calendars.insert`) exige la portée plus large
  `…/auth/calendar` (ou `calendar.app.created`, à évaluer plus tard). Les événements vont donc dans l'agenda
  **principal** seulement; la base de données l'impose (`calendar_id = 'primary'`).
* `state` signé (EdDSA, 5 minutes), lié à l'utilisateur, **à usage unique** (`used_once_keys`).
* **PKCE S256** : le `code_verifier` est dérivé de la clé de chiffrement et du nonce du `state` (rien n'est stocké).
* `access_type=offline` + `prompt=consent` : un jeton de renouvellement à chaque connexion (une reconnexion remplace
  un jeton révoqué). Consentement granulaire : si l'utilisateur décoche la permission de l'agenda, rien n'est
  enregistré et le jeton est révoqué.
* Le **jeton de renouvellement est chiffré** (AES-256-GCM, `MessageCipher`, même clé `MESSAGE_ENCRYPTION_KEY` que les
  données personnelles des affiliés). Les jetons d'accès vivent en mémoire seulement. **Aucun jeton n'est journalisé**
  ni renvoyé par l'API.

## 2. Flux de données

1. Un appel se termine (`/webhooks/twilio/voice/status`), un message vocal est enregistré (`/voice/recording`,
   `/pbx/voicemail-recorded`) ou un résumé IA d'appel est sauvegardé (`ai/callSummary.ts`).
2. Si `CALENDAR=on` et que l'utilisateur a relié Google Agenda, une ligne `calendar_sync_jobs` est ajoutée :
   **une seule par (utilisateur, type, identifiant)** (contrainte unique). Elle ne contient **que des références**
   (CallSid, id du message vocal, id de l'enregistrement), jamais le contenu. Délais : appel 2 min (pour savoir si un
   message vocal a été laissé), message vocal 3 min (transcription et résumé IA).
   Destinataire : le membre qui a pris l'appel d'entreprise, sinon le propriétaire du compte. Les appels 9-1-1 ne
   vont jamais dans un agenda.
3. Le travailleur (`runCalendarSync`, chaque minute, `apps/api/src/server.ts`) relit la source, vérifie le droit et
   le réglage, puis appelle `events.insert` sur l'agenda principal avec un **identifiant d'événement déterministe**
   (base32hex de SHA-256 de l'utilisateur, du type et de l'identifiant) : une reprise ne crée jamais de doublon
   (Google répond 409, compté comme envoyé).
4. Événement : titre « Appel de (514) 555-0123 — 3 min », « Appel manqué de … », « Message vocal de … — 42 s »,
   « Résumé IA — appel avec … »; début et fin de l'appel; « disponible » (n'occupe pas l'agenda); aucun rappel;
   lien vers l'élément dans app.mimt.ca.
5. Erreurs : 429/5xx → reprise 1 min × 2ⁿ (au plus 6 h), 8 essais puis `failed`. 401 (deux fois, avec un jeton
   neuf), 403 sans quota, ou `invalid_grant` au renouvellement → connexion `needs_reconnect`, **un seul avis**
   (« Google Agenda est déconnecté », poussée Web vers /compte/integrations), les tâches attendent la reconnexion
   (7 jours au plus). Les tâches terminées sont supprimées après 30 jours.

Les noms des appelants ne sont pas connus côté serveur (les contacts restent sur l'appareil) : le titre affiche le
numéro.

## 3. Loi 25

* **Minimisation** : par défaut, la description contient seulement le type, la durée, le numéro et un lien MIMT.
* Le résumé IA ou un extrait de transcription (280 caractères) n'y est mis **que si** l'utilisateur coche
  « Inclure le résumé IA ou un extrait de la transcription » **et** a donné son consentement aux fonctions IA
  (`ai_processing`). Les deux sont désactivés par défaut.
* Google devient destinataire des données que l'utilisateur choisit d'y envoyer : à mentionner dans la politique de
  confidentialité (mimt.ca/confidentialite) avant d'activer `CALENDAR=on`. Les événements déjà créés restent dans
  Google Agenda après une déconnexion (ils appartiennent à l'utilisateur); la carte le dit.
* Journal d'audit : `calendar.connect_started`, `calendar.connected`, `calendar.connect_denied`,
  `calendar.settings_updated`, `calendar.disconnected`, `calendar.needs_reconnect`, avec identifiants internes
  seulement (jamais le courriel Google ni les jetons).
* Suppression du compte : jeton révoqué immédiatement, connexion et tâches effacées par la purge.

## 4. Mise en place par le propriétaire

### 4.1 Projet Google Cloud

1. console.cloud.google.com → nouveau projet **MIMT** (organisation TAKATAK si disponible).
2. API et services → Bibliothèque → activer **Google Calendar API**.
3. **Écran de consentement OAuth** (Google Auth Platform) :
   * type **Externe**; nom de l'application **MIMT**; courriel d'assistance; logo MIMT (BRAND.md, bleu électrique
     sur marine);
   * domaine de l'application : page d'accueil `https://mimt.ca/`, politique de confidentialité
     **`https://mimt.ca/confidentialite/`**, conditions `https://mimt.ca/conditions/`;
   * domaines autorisés : `mimt.ca`;
   * portées (Accès aux données) : `openid`, `…/auth/userinfo.email`, **`…/auth/calendar.events`**.
4. **Identifiants** → Créer un ID client OAuth → **Application Web** :
   * origine JavaScript : aucune n'est nécessaire;
   * URI de redirection autorisé : **`https://api.mimt.ca/v1/integrations/google-calendar/callback`**.
5. Pendant les essais (statut « Test »), ajouter les comptes testeurs (100 au plus).

### 4.2 Variables dans Coolify (service API)

| Variable | Valeur |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | ID client (…apps.googleusercontent.com) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | code secret du client (secret : jamais dans le dépôt ni le clavardage) |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://api.mimt.ca/v1/integrations/google-calendar/callback` (https obligatoire en production) |
| `CALENDAR` | `off` jusqu'à la vérification, puis `on` |

Appliquer la migration 0024 avec le déploiement de l'API (automatique au démarrage), puis redéployer l'API et
l'app Web.

### 4.3 Produit Stripe

Aucun produit à créer : le prix est envoyé dans la session Checkout (comme « Sans pub »), métadonnées
`kind=addon`, `code=google_calendar`, `trial_period_days: 14` au premier achat de l'option sur le compte (carte
exigée). App Store / Google Play : **aucun SKU** (l'option se relie et s'achète dans l'app Web seulement). Si
l'app native la vend un jour : `ca.mimt.app.gcal.monthly` et `ca.mimt.app.gcal.yearly`.

### 4.4 Liste de vérification pour la soumission à Google

* [ ] Domaine `mimt.ca` vérifié dans Google Search Console avec le même compte Google.
* [ ] Politique de confidentialité publique qui dit : quelles données Google (créer des événements, courriel),
      pourquoi, conservation, suppression, et la **divulgation d'utilisation limitée** (« L'utilisation et le
      transfert par MIMT des informations reçues des API Google respectent les Google API Services User Data
      Policy, y compris les exigences d'utilisation limitée »).
* [ ] Page d'accueil qui décrit MIMT et l'intégration, lien vers la politique.
* [ ] Justification de la portée : « `calendar.events` sert uniquement à créer, dans l'agenda principal de
      l'utilisateur, un événement par appel, appel manqué, message vocal ou résumé d'appel, à sa demande. MIMT ne
      lit pas les autres événements. Une portée plus étroite ne permet pas de créer des événements. »
* [ ] Vidéo de démonstration (YouTube non répertoriée), en anglais, voir le script ci-dessous.
* [ ] Statut de publication « En production », puis « Soumettre pour vérification ». Délai typique : quelques jours
      à quelques semaines. Pas de CASA (portée sensible, pas restreinte).

**Script de la vidéo (2–3 min)**

1. Barre d'adresse visible : `https://app.mimt.ca`, connexion à un compte de démonstration.
2. Compte › Intégrations › carte Google Agenda : montrer le texte « MIMT demande seulement la permission de créer
   des événements… ».
3. Cliquer **Connecter** → écran de consentement Google : montrer le **nom MIMT**, l'**ID client** dans l'URL et la
   portée « Afficher et modifier les événements de tous vos agendas » ; accepter.
4. Retour sur `/compte/integrations?gc=ok` : courriel du compte Google affiché.
5. Passer un appel de test vers le numéro MIMT, ne pas répondre, laisser un message vocal.
6. Ouvrir Google Agenda : montrer les événements « Appel manqué de … » et « Message vocal de … », la description
   (métadonnées et lien MIMT seulement).
7. Montrer les réglages (cases à cocher, contenu désactivé par défaut) puis **Déconnecter** : expliquer que le jeton
   est révoqué chez Google (myaccount.google.com › Sécurité › Applications tierces : MIMT n'y est plus).

## 5. Phase 2 (non construite) : rendez-vous par le réceptionniste IA

Le réceptionniste IA (Affaires) proposera des plages libres et créera le rendez-vous dans l'agenda.

* Lecture des disponibilités : portée supplémentaire **`calendar.freebusy`** (disponibilités seulement, préférable)
  ou `calendar.events.readonly`; nouvelle vérification Google (ajout de portée → reconsentement des utilisateurs).
* Outil du réceptionniste : `freebusy.query` sur les heures d'ouverture (déjà dans `business_hours`), proposer 2–3
  plages, confirmer de vive voix, puis `events.insert` avec l'appelant comme titre et son numéro (consentement de
  l'appelant annoncé par l'IA).
* Garde-fous : jamais de double réservation (relire `freebusy` juste avant l'insertion), délai minimal, durée par
  type de rendez-vous, annulation par texto.

---

## English summary

* **What**: a Google Calendar connector. Calls (answered/missed), voicemails and AI call summaries become events in
  the user's primary Google Calendar. Included in Affaires / Affaires Pro; CAD 3.95/month add-on (43.45/year,
  11 × monthly) on Essentiel and Premium with a 14-day Stripe trial (first time only). No App Store / Play SKU.
* **Switches**: `CALENDAR=off|on` (default off → every route 404). Without `GOOGLE_OAUTH_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` the card says "Not configured".
* **OAuth**: scopes `calendar.events` + `openid email` (sensitive scope: Google verification, no CASA). Creating a
  dedicated calendar needs the broader `calendar` scope, so primary only. Signed single-use 5-minute state bound to
  the user, PKCE S256 (verifier derived, not stored), connect and disconnect need step-up (`requireRecentAuth`).
  Refresh token encrypted with the affiliate PII helper (`MessageCipher`); tokens never logged; revoked at Google
  on disconnect and on account deletion.
* **Sync**: `calendar_sync_jobs` outbox, unique per (user, source type, source id), references only; worker every
  minute; deterministic event id (base32hex of SHA-256) so retries never duplicate; backoff on 429/5xx (8 attempts);
  401/invalid_grant → `needs_reconnect` + a single push notice.
* **Law 25**: metadata only by default; AI summary / transcript excerpt only with the user's opt-in **and** AI
  consent. Update the privacy policy to name Google as a recipient before turning it on.
* **Owner steps**: Google Cloud project + OAuth consent screen (app name MIMT, privacy policy
  https://mimt.ca/confidentialite/), web client with redirect URI
  `https://api.mimt.ca/v1/integrations/google-calendar/callback`, Coolify env vars, verification submission with
  the demo video (§4.4), then `CALENDAR=on`; switch the site's « bientôt » off (`SOON_FEATURES`, BusinessPage
  status, PlansPage card title).
* **Phase 2**: AI receptionist booking with free/busy (`calendar.freebusy` or `calendar.events.readonly`), not built.
