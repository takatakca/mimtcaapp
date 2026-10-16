# MIMT — application mobile (iOS / Android)

*English follows below.*

Application MIMT par GROUPE TAKATAK : un numéro canadien dans une application (appels, textos, messagerie vocale), plus MIMT Affaires. Expo SDK 57, expo-router, TypeScript, Twilio Voice React Native SDK 1.8. Français (fr-CA) par défaut, anglais en deuxième.

## Démarrer

L'appel (Twilio Voice) est du code natif : **Expo Go ne suffit pas**. Il faut une *version de développement* (development build).

```sh
# À la racine du monorepo
pnpm install
pnpm --filter @mimt/shared build      # @mimt/mobile utilise dist/ du paquet partagé

cd apps/mobile
cp .env.example .env                  # puis remplir les valeurs (aucun secret)

# Option 1 : build local (Xcode / Android Studio requis)
npx expo prebuild                     # génère ios/ et android/ (non versionnés)
npx expo run:ios --device             # iPhone physique : CallKit/PushKit ne marchent pas dans le simulateur
npx expo run:android

# Option 2 : EAS (dans le nuage)
npx eas login && npx eas init         # une fois ; mettre EAS_PROJECT_ID dans .env / EAS
npx eas build --profile development --platform ios
npx eas build --profile development --platform android

pnpm start                            # serveur Metro pour la version de développement
```

Vérifications : `pnpm --filter @mimt/mobile typecheck`, `pnpm --filter @mimt/mobile test`, `npx expo-doctor`.

Profils EAS (`eas.json`) : `development` (dev client, APNs sandbox), `development-simulator`, `preview` (distribution interne, APNs production), `production` (magasins).

## Variables d'environnement

| Variable | Où | Rôle |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | app (publique) | URL de l'API MIMT, ex. `https://api.mimt.ca` |
| `EXPO_PUBLIC_TAKATAK_ISSUER` | app (publique) | Émetteur OpenID Connect de TAKATAK (découverte `/.well-known/openid-configuration`) |
| `EXPO_PUBLIC_TAKATAK_CLIENT_ID` | app (publique) | Identifiant client public (PKCE, **sans secret**) |
| `GOOGLE_SERVICES_JSON` | build | Chemin du `google-services.json` Firebase (FCM : appels entrants Android + notifications). Sur EAS : variable de type fichier. |
| `APS_ENVIRONMENT` | build | `development` ou `production` (environnement APNs du jeton VoIP). Les profils EAS le fixent. |
| `EAS_PROJECT_ID` | build | Projet EAS |
| `ADMOB_ANDROID_APP_ID`, `ADMOB_IOS_APP_ID` | build | Par défaut : identifiants **de test** publics de Google |

Les variables `EXPO_PUBLIC_*` sont intégrées à l'application : jamais de secret. L'URI de redirection OAuth à inscrire chez TAKATAK est `mimt://oauthredirect`.

## Identifiants de notification push Twilio (appels entrants)

1. **iOS — certificat VoIP APNs** : developer.apple.com › Certificates › *VoIP Services Certificate* pour `ca.mimt.app`. Exporter en `.p12`, puis convertir (`openssl pkcs12 -in voip.p12 -nocerts -out key.pem -nodes` et `-clcerts -nokeys -out cert.pem`). Console Twilio › Voice › Credentials › *Push Credentials* › type **APN**, cocher *Sandbox* pour les versions de développement. Créer une deuxième credential (production) pour TestFlight / App Store.
2. **Android — FCM** : projet Firebase avec l'app `ca.mimt.app`, télécharger `google-services.json` (pour `GOOGLE_SERVICES_JSON`) et créer une clé de compte de service (FCM HTTP v1). Console Twilio › Push Credentials › type **FCM** avec ce JSON.
3. Le SID de chaque Push Credential va **côté API** (jeton d'accès Voice, `pushCredentialSid`), jamais dans l'application.
4. L'application TwiML de Twilio pointe vers l'API, qui reçoit le paramètre `To` (et `Emergency=true` pour le 9-1-1).

## Contrat d'API attendu

Le client typé est dans `src/api/client.ts` (jetons dans `expo-secure-store`, rafraîchissement automatique, erreurs traduites). Les types partagés viennent de `@mimt/shared` ; ceux propres à l'app sont dans `src/api/types.ts` et devraient migrer vers `@mimt/shared` quand l'API les implémente.

`POST /v1/auth/takatak/exchange` · `POST /v1/auth/otp/start|verify` · `POST /v1/auth/refresh` · `POST /v1/auth/logout` (body: refresh token) · `GET|PATCH|DELETE /v1/me` · `GET /v1/me/export` · `POST /v1/consents` · `GET|PUT /v1/e911/address` · `GET /v1/e911/notice?locale=` · `POST /v1/e911/acknowledge` · `GET /v1/numbers/available?areaCode=` · `POST /v1/numbers/claim` · `GET /v1/voice/token?platform=` · `GET /v1/calls?cursor=` · `GET /v1/conversations` · `GET /v1/conversations/:peer/messages?cursor=` · `POST /v1/messages` · `GET /v1/voicemails` · `DELETE /v1/voicemails/:id` · `POST /v1/billing/checkout` · `POST /v1/rewards/claim` (501 for now) · `POST /v1/push/register`. Request/response types come from `@mimt/shared` (`packages/shared/src/api.ts`), shared with `apps/api`.

Codes d'erreur reconnus (`{ error, message }`) : `cap_reached`, `e911_required`, `invalid_code`, `number_unavailable`, `feature_required`, `validation_error`, `rate_limited` (voir `src/api/errors.ts`).

## Règles intégrées

- **9-1-1** : toujours composable, jamais bloqué par le forfait, le crédit ou l'accueil (`canPlaceCall`, testé). Bannière « Appel d'urgence — donnez votre adresse à la téléphoniste ». Les autres appels exigent l'adresse 9-1-1 et l'acceptation de l'avis (contrôle aussi côté serveur).
- **Accueil** : bienvenue (limites du 9-1-1 annoncées avant l'inscription) → connexion → adresse civique (code postal A1A 1A1 validé et cohérent avec la province) → avis 9-1-1 versionné de l'API avec case « J'ai lu et j'accepte » → choix du numéro (indicatifs du Québec) → terminé.
- **Langue** : français par défaut ; anglais seulement si la première langue de l'appareil est l'anglais, ou par choix dans Compte.
- **Publicité** (forfaits sans `no_ads`) : consentement UMP de Google, ATT sur iOS, annonces **non personnalisées par défaut** (Loi 25) ; identifiants de test seulement.

## À faire (TODO)

- **Achats intégrés** : les forfaits grand public achetés dans l'app doivent passer par Apple/Google (MIMT-MVP §6). Pour l'instant, `POST /v1/billing/checkout` ouvre un paiement Web.
- **Récompense publicitaire** : l'API doit créditer les 10 minutes seulement après la vérification côté serveur (SSV) d'AdMob.
- **MMS** : téléversement d'image (`POST /v1/messages/media`) pas encore défini ; le bouton est en place (Premium seulement).
- **Android, double FirebaseMessagingService** (Twilio + expo-notifications) : vérifier sur appareil que les deux reçoivent leurs messages ; sinon suivre le guide Twilio « out-of-band Firebase Messaging Service » et relayer avec `voice.handleFirebaseMessage()`.
- Vrais identifiants AdMob, icône, écran de démarrage et icône CallKit avec les fichiers officiels de `knowledgeAI/brand/` (ne jamais redessiner le logo).
- Pagination des listes et mises à jour en temps réel des textos. La lecture des consentements existants (`GET /v1/consents`) est maintenant implémentée et liée à la page Confidentialité.
- Tests sur appareils réels : appels entrants app fermée (PushKit/FCM), CallKit, haut-parleur/Bluetooth, DTMF, mise en attente.

---

# MIMT — mobile app (iOS / Android)

MIMT by GROUPE TAKATAK: a Canadian number in an app (calls, texts, voicemail), plus MIMT Affaires. Expo SDK 57, expo-router, TypeScript, Twilio Voice React Native SDK 1.8. French (fr-CA) by default, English second.

## Run it

Calling (Twilio Voice) is native code: **Expo Go is not enough**. You need a *development build*.

```sh
pnpm install && pnpm --filter @mimt/shared build
cd apps/mobile && cp .env.example .env
npx expo prebuild && npx expo run:ios --device   # or: npx expo run:android
# or in the cloud:
npx eas build --profile development --platform ios|android
pnpm start
```

Checks: `pnpm --filter @mimt/mobile typecheck`, `pnpm --filter @mimt/mobile test`, `npx expo-doctor`.

## Environment

See the table above: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_TAKATAK_ISSUER`, `EXPO_PUBLIC_TAKATAK_CLIENT_ID` (bundled, never secrets); `GOOGLE_SERVICES_JSON`, `APS_ENVIRONMENT`, `EAS_PROJECT_ID`, `ADMOB_*_APP_ID` (build time). Register `mimt://oauthredirect` as the redirect URI with TAKATAK.

## Twilio push credentials (incoming calls)

1. **iOS — APNs VoIP certificate** for `ca.mimt.app`, exported as `.p12` and converted to PEM key + cert, added in the Twilio console under Voice › Credentials › Push Credentials (type APN; tick *Sandbox* for development builds; a second one for production).
2. **Android — FCM**: Firebase project with `ca.mimt.app`; `google-services.json` for the build and a service-account key (FCM HTTP v1) as a Twilio FCM Push Credential.
3. The Push Credential SIDs live **in the API** (Voice access token `pushCredentialSid`), never in the app.

## TODO

In-app purchases for consumer plans (web checkout for now) · AdMob SSV before crediting rewarded minutes · MMS upload endpoint · verify the two Android FirebaseMessagingServices on a device · real AdMob ids and official brand assets · read existing consents · real-device tests of incoming calls, CallKit, audio routes, DTMF and hold.
