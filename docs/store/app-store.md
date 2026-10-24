# MIMT — App Store (iOS)

Fiche App Store Connect, achats intégrés, confidentialité et notes pour l'examen d'Apple. Application : `apps/mobile`
(Expo SDK 57, React Native 0.86, Twilio Voice React Native SDK 1.8.0), identifiant `ca.mimt.app`.
Google Play : les produits d'abonnement et les notifications sont à la fin de ce document (section 9); la fiche Play,
les icônes et la chaîne de compilation sont décrites par le chantier « mobile-build ».

## 1. Deux canaux de paiement, un seul compte

| Canal | Où | Moyen de paiement |
| --- | --- | --- |
| Web | mimt.ca, app.mimt.ca (PWA), API `POST /v1/billing/checkout` | **Stripe** (canal du propriétaire, inchangé) |
| Applications iOS / Android des magasins | `apps/mobile` | **Achat intégré Apple (StoreKit 2) / Google Play Billing seulement** |

- Les deux canaux écrivent dans la même table `subscriptions` du même compte : un forfait payé sur le Web est actif dans
  l'application, et l'inverse. L'API accepte les deux sources (`stripe`, `iap_apple`, `iap_google`).
- `GET /v1/me` dit d'où vient le forfait (`account.planSource` : `web`, `app_store`, `google_play`, `other`).
  L'application n'offre **aucun** achat quand le forfait est payé ailleurs (pas de double facturation), et le bouton
  « Gérer l'abonnement » n'ouvre la page du magasin que pour un abonnement que ce magasin facture.
- Dans l'application, il n'y a jamais de lien Stripe, de prix Web, ni de texte qui renvoie au site pour acheter
  (règles 3.1.1 et 3.1.3 d'Apple, politique Paiements de Google Play). Un test (`apps/mobile/src/lib/purchases.test.ts`)
  échoue si du code Stripe ou un texte d'incitation au Web revient dans l'application.
- Le **crédit international** n'est pas vendu dans l'application (un crédit d'appels consommé dans l'application
  serait un achat intégré « consommable » : non retenu pour le lancement). Le solde s'affiche et sert aux appels.

### Mode de compilation `STORE_PURCHASES`

| Valeur | Effet |
| --- | --- |
| `iap` (**défaut**, lancement) | Forfaits Essentiel, Premium et « Sans pub » vendus par achat intégré, prix du magasin. |
| `companion` (repli) | Rien n'est vendu dans l'application : ni prix, ni bouton, ni mention du site. Un forfait payé sur mimt.ca s'affiche « Forfait Essentiel actif ». Le choix du numéro fonctionne pour un compte payant. |

Ligne à ajouter au profil `production` de `apps/mobile/eas.json` (fichier du chantier mobile-build) pour l'écrire
explicitement : `"env": { "APS_ENVIRONMENT": "production", "STORE_PURCHASES": "iap" }`. Sans elle, le défaut est déjà `iap`.

## 2. Fiche App Store Connect

Langue principale : **français (Canada)**. Deuxième langue : anglais (Canada). Disponibilité : Canada (ajouter
d'autres pays plus tard). **Exclure la Chine continentale** : l'application utilise CallKit, refusé dans ce pays.

### Français (Canada)

- **Nom** (30 max) : `MIMT – Numéro canadien`
- **Sous-titre** (30 max) : `Appels et textos au Canada`
- **Texte promotionnel** (170 max) : `Un vrai numéro canadien dans votre poche. Appelez et textez au Canada et aux États-Unis par Wi-Fi ou données. Messagerie vocale incluse.`
- **Description** :

  > MIMT vous donne un numéro de téléphone canadien dans une application, par GROUPE TAKATAK (Montréal).
  >
  > • Appels et textos au Canada et aux États-Unis, par Wi-Fi ou données cellulaires.
  > • Textos gratuits et appels entre utilisateurs MIMT avec votre @nom, même sans numéro.
  > • Messagerie vocale, message d'accueil personnalisé et messages vocaux par courriel.
  > • Choisissez votre numéro parmi les indicatifs du Québec (514, 438, 450, 418, 819 et plus).
  > • Blocage d'appels, ne pas déranger, renvoi d'appel (Premium).
  > • Assistant IA facultatif (Premium) : résumés et aide, seulement avec votre accord.
  >
  > Forfaits : Gratuit (avec annonces), Essentiel et Premium, en abonnement mensuel ou annuel renouvelé
  > automatiquement par l'App Store. Gérez ou annulez votre abonnement dans les réglages de votre compte Apple.
  >
  > 9-1-1 : MIMT n'est pas un service téléphonique traditionnel. Les appels au 9-1-1 ont des limites (adresse à
  > enregistrer, connexion Internet et électricité requises). Vous lisez et acceptez l'avis 9-1-1 avant votre premier
  > appel. Le 9-1-1 n'est jamais bloqué, même si votre forfait a atteint sa limite.
  >
  > Conditions d'utilisation : https://mimt.ca/conditions/ — Confidentialité : https://mimt.ca/confidentialite/

- **Mots-clés** (100 max, sans nom de concurrent, 91 caractères) :
  `numéro,téléphone,deuxième numéro,appels,textos,virtuel,VoIP,Québec,Canada,messagerie vocale`
- **URL d'assistance** : `https://mimt.ca/aide/`
- **URL marketing** : `https://mimt.ca/`
- **URL de la politique de confidentialité** : `https://mimt.ca/confidentialite/` (vérifiée : 200)
- **Contrat de licence (EULA)** : la page `https://mimt.ca/conditions/` contient encore des sections « à confirmer »
  (raison sociale, annulation et remboursement, responsabilité). Les compléter avant l'envoi, ou garder le contrat
  standard d'Apple (Licensed Application EULA) et le mentionner dans la description.
- **Catégorie** : principale **Utilitaires**, secondaire **Réseaux sociaux**.
- **Copyright** : `2026 GROUPE TAKATAK` (ou la raison sociale exacte).

### English (Canada)

- **Name**: `MIMT – Canadian Number`
- **Subtitle**: `Calls and texts in Canada`
- **Promotional text**: `A real Canadian phone number in your pocket. Call and text in Canada and the US over Wi-Fi or data. Voicemail included.`
- **Description**:

  > MIMT gives you a Canadian phone number in an app, by GROUPE TAKATAK (Montréal).
  >
  > • Calls and texts in Canada and the US, over Wi-Fi or mobile data.
  > • Free texts and calls between MIMT users with your @name, even without a number.
  > • Voicemail, custom greeting and voicemail by email.
  > • Pick your number from Quebec area codes (514, 438, 450, 418, 819 and more).
  > • Call blocking, do not disturb, call forwarding (Premium).
  > • Optional AI assistant (Premium): summaries and help, only with your consent.
  >
  > Plans: Free (with ads), Essential and Premium, as monthly or yearly subscriptions renewed automatically by the
  > App Store. Manage or cancel your subscription in your Apple Account settings.
  >
  > 9-1-1: MIMT is not a traditional phone service. 9-1-1 calls have limits (registered address, Internet connection
  > and power needed). You read and accept the 9-1-1 notice before your first call. 9-1-1 is never blocked, even when
  > your plan has reached its limit.
  >
  > Terms of use: https://mimt.ca/en/terms/ — Privacy: https://mimt.ca/en/privacy/

- **Keywords** (88 characters): `phone number,second number,calls,texting,virtual number,VoIP,Canada,Quebec,voicemail,SMS`
- **Support URL**: `https://mimt.ca/en/help/` · **Marketing URL**: `https://mimt.ca/en/` · **Privacy policy URL**: `https://mimt.ca/en/privacy/`

### Classement par âge (questionnaire)

Réponses tirées du code : pas de violence, sexe, jeux de hasard, drogues ni contenu médical. **Oui** à « messagerie /
communication sans restriction entre utilisateurs » (textos, appels, @nom) et à « contenu généré par les
utilisateurs » (messages). Assistant IA : oui, fonction facultative avec consentement. Pas de navigateur Web libre
(seules des pages mimt.ca / app.mimt.ca précises s'ouvrent). Classement attendu : **13+** (à confirmer par le
questionnaire). Blocage des numéros : présent (Réglages › Numéros bloqués).

## 3. Confidentialité de l'app (étiquette « App Privacy »)

Tirée de ce que le code collecte vraiment. Manifeste iOS : `ios.privacyManifests` dans `apps/mobile/app.config.ts`
(mêmes types).

**Données liées à l'utilisateur — fonctionnement de l'app seulement (aucune utilisée pour le suivi)** :

| Catégorie Apple | Donnée MIMT |
| --- | --- |
| Coordonnées : nom | nom d'affichage, nom pour l'adresse 9-1-1 |
| Coordonnées : adresse courriel | compte TAKATAK, messages vocaux par courriel |
| Coordonnées : numéro de téléphone | numéro vérifié par texto, numéro MIMT, numéros appelés et textés |
| Coordonnées : adresse physique | adresse civique 9-1-1 (obligatoire, transmise au centre d'urgence) |
| Contenu : courriels ou textos | textos (chiffrés au repos) |
| Contenu : photos ou vidéos | pièces jointes MMS choisies par l'utilisateur |
| Contenu : données audio | messages vocaux, message d'accueil; enregistrement d'appels (Affaires Pro seulement) |
| Contenu : autre contenu | transcriptions, demandes à l'assistant IA |
| Identifiants : identifiant d'utilisateur | identifiant de compte MIMT |
| Identifiants : identifiant d'appareil | jetons de notification (APNs/VoIP), attestation de l'appareil |
| Achats : historique d'achats | abonnements (App Store, Google Play, Web) |
| Autres données | journal des appels (numéros, durée, heure) |

- **Contacts** : lus **sur l'appareil seulement** (choix d'un contact, liste), jamais envoyés à MIMT : **non collectés**.
- **IA (Anthropic, modèle Claude)** : textes de messages, transcriptions de messages vocaux et demandes sont traités par
  Anthropic **seulement si l'utilisateur active l'IA** (consentement dans Confidentialité). Déclarer dans « Contenu »
  ci-dessus, fin : fonctionnement de l'app; le nommer dans la politique de confidentialité (déjà fait).
- **Diagnostics** : MIMT n'a aucun outil de plantage ou d'analytique dans l'application.
- **Publicité (Google AdMob, forfait Gratuit)** : selon la divulgation iOS de Google
  (<https://developers.google.com/admob/ios/privacy/data-disclosure>, à revérifier à chaque version majeure du SDK) :
  - **Données utilisées pour le suivi** (seulement si l'utilisateur accepte les annonces personnalisées dans MIMT
    **et** l'invite de transparence d'Apple) : identifiant d'appareil (IDFA), données publicitaires, interactions
    avec le produit, localisation approximative (adresse IP).
  - **Données non liées** : données de plantage et de performance du SDK.
- L'invite de suivi (ATT) ne s'affiche **que** quand l'utilisateur active « annonces personnalisées » dans
  Confidentialité (`apps/mobile/src/services/ads.ts`); sans elle, annonces non personnalisées. Aucune annonce sur
  Essentiel/Premium avec Sans pub, ni Premium.

## 4. Achats intégrés (App Store Connect)

Identifiants **exacts** (`STORE_PRODUCTS` dans `packages/shared/src/plans.ts`, `ADDON_STORE_PRODUCTS` dans
`packages/shared/src/addons.ts`). Tous sont des **abonnements à renouvellement automatique**.

**Groupe 1 : `Forfaits MIMT`** (un client n'a qu'un forfait à la fois; Apple gère la mise à niveau et le prorata).
Niveaux : Premium = niveau 1 (le plus haut), Essentiel = niveau 2.

| Identifiant produit | Nom de référence | Durée | Prix suggéré (CAD) | Niveau |
| --- | --- | --- | --- | --- |
| `ca.mimt.app.premium.monthly` | Premium mensuel | 1 mois | 29,99 $ | 1 |
| `ca.mimt.app.premium.yearly` | Premium annuel | 1 an | 299,99 $ | 1 |
| `ca.mimt.app.lock.monthly` | Essentiel mensuel | 1 mois | 12,99 $ | 2 |
| `ca.mimt.app.lock.yearly` | Essentiel annuel | 1 an | 129,99 $ | 2 |

**Groupe 2 : `Sans pub`** (se cumule avec Gratuit ou Essentiel; Premium est déjà sans pub et l'application ne l'offre
pas à un client Premium).

| Identifiant produit | Nom de référence | Durée | Prix suggéré (CAD) |
| --- | --- | --- | --- |
| `ca.mimt.app.noads.monthly` | Sans pub mensuel | 1 mois | 3,99 $ |
| `ca.mimt.app.noads.yearly` | Sans pub annuel | 1 an | 29,99 $ |

- Prix mensuels = prix Web de `PLANS` / `SUBSCRIPTION_ADD_ONS` (12,99 $, 29,99 $, 3,99 $, 29,99 $/an). Les forfaits
  annuels n'existent pas encore sur le Web : 10 × le mensuel est une suggestion. Pas d'offre d'essai au lancement.
- **Commission** : s'inscrire au **App Store Small Business Program** (15 % au lieu de 30 %) et noter que Google
  prend 15 % sur tous les abonnements. `docs/MIMT-UNIT-ECONOMICS.md` montre qu'à 15 %, Essentiel à 12,99 $ dépasse la
  règle des 70 % de coût (environ 74 %) : garder 12,99 $ par cohérence avec le Web, ou monter les prix magasin à
  13,99 $ / 32,99 $ (permis : les prix magasin peuvent différer du Web, l'application n'affiche que ceux du magasin).
  Décision du propriétaire.
- Localisation de chaque produit : nom affiché et description en français (Canada) puis anglais, par exemple
  « Essentiel — Numéro canadien, 60 min sortantes, 120 min entrantes, 150 textos par mois ».
- Capture d'écran pour l'examen : l'écran Compte › Forfaits (le bouton d'achat et le texte de renouvellement).

### Ce que fait l'application (StoreKit 2 par `expo-iap` 6.1.1)

1. Lit les produits au magasin et affiche le **prix localisé du magasin**.
2. Achète avec `appAccountToken` = identifiant du compte MIMT (Google : `obfuscatedAccountId`).
3. Envoie le JWS de la transaction à `POST /v1/billing/iap/verify`; l'API vérifie la chaîne de certificats Apple,
   l'identifiant du produit, le `bundleId` et le compte, puis accorde le forfait.
4. **Seulement ensuite** : `finishTransaction` (iOS) / accusé de réception (Android; l'API l'envoie aussi elle-même).
5. Achat en attente (« Demander l'autorisation d'achat », paiement différé) : rien n'est accordé, message
   « Achat en attente d'approbation ». Erreurs en français, annulation sans message.
6. « Restaurer mes achats », « Gérer l'abonnement » (page d'abonnements d'Apple), liens Conditions et Confidentialité,
   texte de renouvellement automatique (règle 3.1.2).
7. Au démarrage : synchronisation silencieuse des transactions non terminées et des renouvellements.
8. Un abonnement Apple ne paie qu'un compte MIMT : le restaurer sur un deuxième compte est refusé
   (« déjà lié à un autre compte »).

### Côté API

- `POST /webhooks/appstore` : **App Store Server Notifications V2** (renouvellement, expiration, remboursement,
  révocation, période de grâce). URL à saisir dans App Store Connect › App › Informations sur l'app, pour Production
  et Sandbox : `https://api.mimt.ca/webhooks/appstore`.
- Variables (Coolify, pas de secret dans le dépôt) : `APPLE_BUNDLE_ID=ca.mimt.app`, `APPLE_ROOT_CA_PEM` = certificat
  public « Apple Root CA - G3 » (<https://www.apple.com/certificateauthority/>, converti en PEM).
- Un abonnement de magasin cesse de compter 2 jours après la fin de sa période si aucun renouvellement n'arrive.

## 5. Conformité iOS (vérifiée dans le code)

- **Info.plist** : textes de permission en français (région `fr`), anglais par `apps/mobile/locales/en.json`
  (micro, contacts, photos, suivi). Vérifié avec `expo prebuild` : `InfoPlist.strings` fr/en générés.
- **`UIBackgroundModes`** : `voip` (PushKit réveille l'app pour un appel entrant, affiché par CallKit) et `audio`
  (le son continue en arrière-plan), exigés par le SDK Twilio Voice (son plugin les ajoute aussi). Pas de
  `remote-notification` : l'app n'envoie aucune notification silencieuse. `aps-environment=production` dans les
  compilations de production (`APS_ENVIRONMENT`).
- **Chiffrement** : `ITSAppUsesNonExemptEncryption = false`. L'application n'utilise que du chiffrement standard :
  HTTPS/TLS d'iOS et DTLS-SRTP (WebRTC) du SDK Twilio pour protéger les appels, sans algorithme propriétaire.
  Réponse au questionnaire d'exportation : « utilise du chiffrement : oui » → « admissible à une exemption
  (catégorie 5, partie 2, protocoles standard / grand public) : oui ». Pas de documents à téléverser. Si Apple demande
  la France : déclaration de fourniture de moyens de cryptologie non requise pour un usage grand public standard;
  à confirmer par le conseiller du propriétaire.
- **Manifeste de confidentialité** (`PrivacyInfo.xcprivacy`) : API à raison requise de React Native et des modules Expo
  (`UserDefaults` CA92.1, horodatage de fichiers C617.1 / 3B52.1, temps depuis le démarrage 35F9.1, espace disque
  E174.1 / 85F4.1), types de données de la section 3, `NSPrivacyTracking = true` (annonces personnalisées après
  ATT). Les domaines de suivi sont déclarés par le manifeste du SDK Google Mobile Ads lui-même (les recopier ici
  bloquerait aussi les annonces non personnalisées quand ATT est refusé). Avant chaque envoi : Xcode › Archive ›
  « Generate Privacy Report » et vérifier que GoogleMobileAds y figure.
- **Suppression du compte (5.1.1(v))** : Compte › « Supprimer mon compte » → confirmation → `DELETE /v1/me` : compte
  fermé tout de suite (plus d'accès à l'API, sessions et jetons de notification révoqués, numéros en quarantaine,
  abonnements Web Stripe annulés) → déconnexion. Si l'abonnement est facturé par le magasin, l'app rappelle de
  l'annuler avec « Gérer l'abonnement » (MIMT ne peut pas annuler un abonnement Apple). **30 jours plus tard**, la
  tâche quotidienne `apps/api/src/jobs/accountDeletion.ts` efface définitivement textos, MMS, messages vocaux
  (stockage et Twilio), adresse 9-1-1, @nom, données d'IA, consentements, appareils, parrainages, réunions, et le
  nom, courriel et numéro de l'utilisateur. Gardés (loi) : abonnements et factures, registres d'appels, acceptations
  de l'avis 9-1-1, journaux d'audit et de fraude. Les numéros retournent au fournisseur par le cycle de vie
  (quarantaine puis libération; jamais les numéros antérieurs à `NUMBER_LIFECYCLE_FROM`). `ACCOUNT_DELETION=off`
  met la tâche en pause.
- **Lien public de suppression (exigé par Google, utile pour Apple)** : `https://mimt.ca/confidentialite/#suppression`
  (anglais : `https://mimt.ca/en/privacy/#delete-account`) : étapes dans l'app, courriel `info@mimt.ca` objet
  « Suppression de compte », délai de 30 jours, ce qui est gardé.
- **Connexion (4.8)** : compte TAKATAK (système de compte de l'entreprise) ou code par texto. Aucune connexion par un
  réseau social dans l'application : « Se connecter avec Apple » n'est pas exigé. **À vérifier** : si la page de
  connexion takatak.ca propose « Continuer avec Google » ou un autre réseau social, Apple exigera aussi une option
  équivalente (Se connecter avec Apple).
- **9-1-1** : l'avis 9-1-1 et l'adresse civique sont des étapes obligatoires avant d'atteindre l'application
  (`app/index.tsx` → `/address`, `/notice`); un appel non urgent est refusé tant qu'ils manquent, le 9-1-1 jamais
  (`app/(tabs)/calls.tsx`, `src/lib/dial.ts`). Bandeau d'urgence pendant l'appel.
- **Invite ATT** : seulement à l'activation des annonces personnalisées, jamais au démarrage.

## 6. Notes pour l'examen (App Review Information)

> **Compte de démonstration.** Connectez-vous avec « Compte TAKATAK » : courriel `<à créer par le propriétaire>`,
> mot de passe `<à créer>`. (La connexion par texto exige un vrai numéro canadien.) Le compte est au forfait Gratuit
> pour que vous puissiez tester l'achat intégré en Sandbox : Compte › Forfaits.
>
> **Appels et textos.** Après connexion, l'app demande l'adresse 9-1-1 (déjà remplie sur le compte de démonstration)
> et l'acceptation de l'avis 9-1-1. Au forfait Gratuit, appelez ou textez l'utilisateur de test `@<nom à créer>` sans
> numéro. Avec Essentiel ou Premium, choisissez un numéro dans Compte › « Choisir mon numéro », puis appelez ou textez
> n'importe quel numéro canadien.
>
> **9-1-1.** Merci de ne pas composer le 9-1-1 : l'appel joint un vrai centre d'urgence. Le 9-1-1 n'est jamais bloqué.
>
> **Achats.** Forfaits et « Sans pub » sont des abonnements à renouvellement automatique par achat intégré. Les clients
> qui ont déjà payé sur notre site voient leur forfait actif sans bouton d'achat (règle 3.1.3(b), services
> multiplateformes). L'app n'affiche aucun lien ni prix externe.

English version of the same notes is fine; keep both short.

**Mode `companion` (si l'achat intégré était retiré)** — remplacer le paragraphe « Achats » par :

> This build sells nothing in the app. MIMT is a free stand-alone companion to our paid VoIP service (App Review
> Guideline **3.1.3(f)**, Free Stand-alone Apps): there is no purchasing inside the app and no call to action to buy
> outside the app. The Free plan works fully; a paid plan the customer already has shows as active.

## 7. App Store Connect — étapes dans l'ordre

1. **Accords, taxes et banque** (Entreprise › Accords) : accepter le *Paid Apps Agreement*, ajouter le compte bancaire
   canadien, remplir les formulaires fiscaux (W-8BEN-E pour une société canadienne, informations TPS/TVQ).
2. **Small Business Program** : s'inscrire (<https://developer.apple.com/app-store/small-business-program/>).
3. **Identifiant** (Certificates, Identifiers & Profiles) : App ID `ca.mimt.app` avec *Push Notifications*
   (In-App Purchase est inclus d'office). EAS crée les certificats de notification (APNs/VoIP) au premier build.
4. **Clé d'API App Store Connect** (Utilisateurs et accès › Intégrations › App Store Connect API › Clés d'équipe ›
   « + », rôle *App Manager*) : télécharger le `.p8` (une seule fois), noter *Issuer ID* et *Key ID*, les donner à EAS
   (`eas credentials` ou `eas submit`), jamais dans le dépôt.
5. **Créer l'app** : nom, langue principale français (Canada), bundle `ca.mimt.app`, SKU `mimt-ios`.
6. **Abonnements** (App › Monétisation › Abonnements) : créer le groupe `Forfaits MIMT` puis les 4 produits du
   groupe 1 avec les identifiants exacts, durées, prix, niveaux; puis le groupe `Sans pub` et ses 2 produits.
   Localiser en français (Canada) et en anglais; ajouter la capture d'examen.
7. **Notifications serveur** : App › Informations sur l'app › App Store Server Notifications, **Version 2**, Production
   et Sandbox : `https://api.mimt.ca/webhooks/appstore`.
8. **Variables de l'API** (Coolify) : `APPLE_BUNDLE_ID`, `APPLE_ROOT_CA_PEM`; redéployer l'API.
9. **Testeurs Sandbox** (Utilisateurs et accès › Sandbox) et TestFlight; acheter, restaurer, annuler, renouveler.
10. **Compte de démonstration** : créer le compte TAKATAK de démonstration, son adresse 9-1-1, un deuxième compte
    `@nom` à appeler; les saisir dans les notes d'examen (section 6).
11. **Confidentialité de l'app** : remplir l'étiquette avec la section 3; classement par âge; chiffrement (section 5);
    disponibilité sans la Chine continentale.
12. Joindre les abonnements à la **première version** envoyée à l'examen (ils sont examinés avec elle).

## 8. Vérifications avant l'envoi

- `pnpm --filter @mimt/mobile typecheck && pnpm --filter @mimt/mobile test` et les tests de l'API (verts dans la CI).
- Sur un appareil réel (TestFlight) : achat Essentiel, mise à niveau Premium, « Sans pub », restauration, achat en
  attente (*Ask to Buy* d'un compte enfant Sandbox), annulation puis expiration (notification `EXPIRED` → Gratuit),
  « Gérer l'abonnement », appel entrant avec l'app fermée (PushKit/CallKit), choix du numéro après l'achat.

## 9. Google Play — produits et notifications

- Créer un **profil de paiement** (Play Console › Configurer › Profil de paiement) et accepter les conditions.
  Google prélève 15 % sur les abonnements.
- Créer **6 abonnements** avec exactement les mêmes identifiants (`ca.mimt.app.lock.monthly`, …,
  `ca.mimt.app.noads.yearly`), chacun avec **un forfait de base** à renouvellement automatique (mensuel ou annuel
  selon l'identifiant), prix CAD de la section 4, sans offre de lancement.
- **Compte de service** (Google Cloud) avec accès à la Play Console (*Afficher les données financières*, *Gérer les
  commandes et les abonnements*) : sa clé JSON va dans `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`; `GOOGLE_PLAY_PACKAGE_NAME=ca.mimt.app`.
- **Notifications en temps réel (RTDN)** : sujet Pub/Sub, rôle *Pub/Sub Publisher* pour
  `google-play-developer-notifications@system.gserviceaccount.com`, abonnement *push* vers
  `https://api.mimt.ca/webhooks/google-play?token=<GOOGLE_PLAY_RTDN_TOKEN>` (jeton aléatoire d'au moins 24 caractères,
  aussi mis dans Coolify); saisir le sujet dans Play Console › Monétisation › Configuration de la monétisation.
- L'API vérifie chaque achat auprès de Google (`subscriptionsv2`) et en accuse réception elle-même; l'app l'accuse
  aussi après la vérification. Les testeurs de licence achètent sans frais.
