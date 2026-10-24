# MIMT sur Google Play : fiche, déclarations et formulaires

Application : **MIMT**, paquet `ca.mimt.app`, éditeur GROUPE TAKATAK (Québec). Ce document donne les réponses à saisir dans Play Console, tirées de ce que le code fait vraiment (`apps/mobile`, `apps/api`). À relire par le propriétaire (et un conseiller juridique pour la confidentialité et le 9-1-1) avant l'envoi en production. Build et signature : `docs/store/android-build.md`.

> Règle : rien dans la fiche ne promet plus que l'app. Pas de nom de concurrent. Français d'abord.

## 1. Fiche du Play Store

Langue par défaut : **Français (Canada) – fr-CA**. Traduction ajoutée : **English (Canada) – en-CA**.

### Français (fr-CA)

- **Titre (≤ 30)** : `MIMT : numéro canadien` (22 caractères)
- **Description courte (≤ 80)** : `Un numéro canadien dans une app : appels, textos et messagerie vocale.` (70)
- **Description complète (≤ 4000)** :

```
MIMT met un numéro de téléphone canadien dans votre téléphone. Vous appelez et textez par Wi-Fi ou données cellulaires, sans changer de forfait mobile.

• Un numéro canadien, choisi par indicatif régional (forfaits payants).
• Appels et textos au Canada et aux États-Unis, selon votre forfait.
• Messagerie vocale, avec transcription en français sur certains forfaits.
• Sans numéro : textez gratuitement les autres utilisateurs MIMT avec leur @nom, et appelez-les d'application à application, avec un nombre de minutes par mois sur le forfait Gratuit.
• Transfert de votre numéro existant vers MIMT.
• Blocage de numéros, ne pas déranger, renvoi d'appel.
• Réunions vidéo, et outils pour les entreprises (postes, groupes, accueil téléphonique).
• Fonctions d'IA facultatives (résumés de messages vocaux, suggestions de réponse), seulement si vous les activez.

9-1-1 : MIMT n'est pas un service téléphonique traditionnel. Les appels au 9-1-1 ont des limites (panne d'Internet ou de courant, adresse à tenir à jour). Vous les lisez et les acceptez dans l'app avant votre premier appel. Gardez un autre moyen d'appeler les secours.

Le forfait Gratuit affiche des publicités. Les forfaits payants s'achètent dans l'app par Google Play.

Fait au Québec par GROUPE TAKATAK.
Confidentialité : https://mimt.ca/confidentialite/
```

### English (en-CA)

- **Title (≤ 30)**: `MIMT: Canadian phone number` (27)
- **Short description (≤ 80)**: `A Canadian phone number in an app: calls, texts and voicemail.` (63)
- **Full description**:

```
MIMT puts a Canadian phone number on your phone. Call and text over Wi-Fi or mobile data, without changing your mobile plan.

• A Canadian number, picked by area code (paid plans).
• Calls and texts in Canada and the US, depending on your plan.
• Voicemail, with French transcription on some plans.
• Without a number: text other MIMT users for free with their @name, and call them app to app, with a monthly number of minutes on the Free plan.
• Bring your existing number to MIMT.
• Number blocking, do not disturb, call forwarding.
• Video meetings, and tools for businesses (extensions, ring groups, phone greeting menu).
• Optional AI features (voicemail summaries, reply suggestions), only if you turn them on.

9-1-1: MIMT is not a traditional phone service. 9-1-1 calls have limits (Internet or power outage, address to keep up to date). You read and accept them in the app before your first call. Keep another way to reach emergency services.

The Free plan shows ads. Paid plans are bought in the app through Google Play.

Made in Québec by GROUPE TAKATAK.
Privacy: https://mimt.ca/en/privacy/
```

À vérifier avant l'envoi : que chaque fonction citée est active dans le build envoyé (transcription, réunions, outils Affaires, IA). Retirer une ligne plutôt que promettre.

### Catégorie et coordonnées

- Type : **Application**. Catégorie : **Communication**. Étiquettes : Appels, Messagerie, VoIP.
- Courriel : `info@mimt.ca`. Site Web : `https://mimt.ca`. Téléphone : facultatif.
- Politique de confidentialité : **`https://mimt.ca/confidentialite/`** (route réelle : `apps/web/app/(fr)/confidentialite`; anglais `https://mimt.ca/en/privacy/`).

### Visuels (Fiche principale)

| Élément | Exigence Google | Fichier |
| --- | --- | --- |
| Icône | 512 × 512 PNG, ≤ 1 Mo | `apps/mobile/assets/brand/play-icon-512.png` (généré) |
| Image de présentation | 1024 × 500 PNG/JPEG sans transparence | `apps/mobile/assets/brand/play-feature-graphic.png` (généré, « Votre numéro canadien dans une app ») |
| Captures téléphone | 2 à 8, PNG/JPEG, 9:16 conseillé (ex. 1080 × 1920), côtés entre 320 et 3840 px, ratio ≤ 2:1. 4 captures de 1080 px ou plus pour être mis en avant | **à faire** (voir ci-dessous) |
| Tablette 7" et 10" | facultatif (l'app est en portrait téléphone) | — |

Captures : elles doivent montrer **l'app Android réelle**. Ce conteneur n'a pas d'émulateur (pas de KVM) et les captures de l'app Web (`apps/web/public/screens`) ne sont pas l'app Android : ne pas les utiliser. Une fois le build en test interne installé sur un téléphone, avec un compte de démonstration : `adb exec-out screencap -p > 01-appels.png` (ou boutons volume bas + marche). Écrans proposés, dans l'ordre : 1 Appels (clavier), 2 Messages (conversation), 3 Messagerie vocale avec transcription, 4 Choix du numéro, 5 Contacts, 6 Compte et forfaits. Pas de vrai numéro de client ni de vraie conversation sur les captures.

## 2. Paiements

- **Dans l'app Android** : les forfaits et options numériques (Essentiel, Premium, Affaires, « Sans pub », crédits) passent par **Google Play Billing** (chantier de l'agent « mobile-iap »). Déclaration Play Console › Monétiser : produits d'abonnement `ca.mimt.app.*`.
- **Sur mimt.ca et app.mimt.ca (Web)** : le paiement Stripe du site reste tel quel. Ce n'est pas l'app Play.
- **Bloquant à lever avant la production** : aujourd'hui l'onglet Compte de l'app (`apps/mobile/app/(tabs)/account.tsx`) ouvre encore le paiement Stripe dans le navigateur (`api.checkout`, `checkoutAddOn`, `checkoutIntlCredit`, avec des `TODO(store-billing)`). Le build Play ne doit **ni ouvrir ni lier** une page de paiement Stripe pour des biens numériques (politique Paiements de Google Play). C'est le code d'achat de l'agent « mobile-iap »; ce PR n'y touche pas. Le test interne peut servir pendant ce temps; la production non.

## 3. Contenu de l'application (Play Console › Règles et programmes › Contenu de l'application)

### Politique de confidentialité
`https://mimt.ca/confidentialite/`

### Publicités
**Oui, l'app contient des annonces** : AdMob (`react-native-google-mobile-ads`) sur le forfait Gratuit, après le consentement (UMP, Loi 25; publicités non personnalisées sans consentement). Les forfaits payants et l'option « Sans pub » n'en ont pas.

### Accès à l'application (instructions pour l'examen)
L'app exige une connexion. Fournir à Google un compte d'examen : numéro de téléphone de test et code de vérification fixe (ou compte TAKATAK de test), adresse 9-1-1 fictive déjà acceptée. Écrire : « Connexion par texto au numéro X, code 123456. Ne pas appeler le 9-1-1. » **À créer par le propriétaire** (aucun compte de test n'existe dans le dépôt).

### Classification du contenu (questionnaire IARC)
- Catégorie : **Utilitaires, productivité, communication ou autre**.
- Violence, peur, sexualité, langage grossier, substances, jeux d'argent : **Non** partout.
- Les utilisateurs peuvent-ils interagir ou échanger du contenu ? **Oui** (textos, appels, MMS, réunions).
- Partage de la position de l'utilisateur avec d'autres utilisateurs : **Non** (l'adresse 9-1-1 sert seulement au routage des urgences, pas affichée aux autres).
- Achats numériques : **Oui** (abonnements Google Play).
- Navigation Web non restreinte : **Non**.
Résultat attendu : tout public avec mention « Interactions entre utilisateurs » et « Achats intégrés ».

### Public cible et contenu
- Tranches d'âge : **18 ans et plus** seulement (contrat de service téléphonique, paiement, 9-1-1). **Pas destinée aux enfants**; ne pas cocher les tranches de moins de 13 ans, donc pas de programme Familles.
- L'app n'attire pas involontairement les enfants : **Non**.

### Applis d'actualités : **Non**. Applis de santé : **Non**. Prêts : **Non**. Applis gouvernementales : **Non**.

### Suppression du compte
- **Dans l'app** : Compte › « Supprimer mon compte » (`DELETE /v1/me`).
- **Sans l'app** (lien exigé par Google) : `https://app.mimt.ca/compte` (connexion, puis « Supprimer mon compte »), ou un courriel à `info@mimt.ca` (« Vos droits », politique de confidentialité). Mieux : une page publique qui explique ces étapes sur mimt.ca (à créer, ex. `/supprimer-mon-compte`), donnée comme URL à Google.
- Ce qui se passe (code actuel, `apps/api/src/routes/me.ts`) : compte fermé tout de suite, connexions et jetons de notification révoqués, numéros mis en quarantaine, suppression prévue après **30 jours**. Registres d'appels et de facturation gardés selon la loi.
- **Bloquant à lever** : la tâche qui supprime vraiment les données après 30 jours n'existe pas encore (`TODO` dans `me.ts`, avec l'annulation de l'abonnement). Il faut la livrer avant de déclarer à Google que les données sont supprimées.

### Sécurité des données (Data safety)

Réponses générales :
- L'app recueille ou partage-t-elle des types de données requis ? **Oui**.
- Toutes les données sont-elles chiffrées en transit ? **Oui** (HTTPS/TLS vers `api.mimt.ca`, Twilio, Google).
- Moyen de demander la suppression des données ? **Oui** (voir plus haut; après livraison de la suppression réelle).
- Fournisseurs qui traitent pour MIMT (Twilio pour la voix et les textos, Anthropic pour l'IA, Stripe/Google pour les paiements) = **collecte**, pas « partage » au sens de Google. Le **partage** déclaré concerne Google AdMob (publicité).

| Type de données (Google) | Collecté | Partagé | Facultatif ? | Finalités | Source dans le code |
| --- | --- | --- | --- | --- | --- |
| Renseignements personnels › **Nom** | Oui | Non | Requis | Fonctionnalité, gestion du compte | profil `/v1/me` |
| › **Adresse courriel** | Oui | Non | Requis | Gestion du compte, communications | profil, connexion TAKATAK |
| › **Numéro de téléphone** | Oui | Non | Requis | Fonctionnalité (connexion par texto, numéros MIMT), sécurité | `/v1/auth/sms`, numéros |
| › **Adresse** | Oui | Non | Requis pour appeler | Fonctionnalité (adresse 9-1-1 exigée par la loi) | `settings/address`, onboarding |
| Infos financières › **Historique d'achats** | Oui | Non | Facultatif | Fonctionnalité, gestion du compte | forfaits, Play Billing / Stripe |
| Messages › **SMS ou MMS** | Oui | Non | Requis | Fonctionnalité (envoi, réception, historique) | `/v1/messages` |
| › **Autres messages dans l'app** | Oui | Non | Facultatif | Fonctionnalité (textos @nom, chat de réunion) | handles, réunions |
| Photos et vidéos › **Photos** | Oui | Non | Facultatif | Fonctionnalité (pièces jointes MMS choisies par l'utilisateur) | `thread/[id].tsx`, `upload.ts` |
| Fichiers audio › **Enregistrements vocaux ou sonores** | Oui | Non | Requis pour la messagerie | Fonctionnalité (messages vocaux, transcription; enregistrement d'appels Affaires si activé) | messagerie, Affaires |
| Activité dans l'app › **Autres actions** (historique d'appels : numéros, date, durée) | Oui | Non | Requis | Fonctionnalité, facturation, sécurité/fraude | registres d'appels |
| › **Autre contenu généré** (réponses d'IA, résumés) | Oui | Non | Facultatif (consentement « traitement par l'IA ») | Fonctionnalité | `src/api/ai.ts` |
| Infos et performances de l'app › **Diagnostics** | Oui | Oui (Google AdMob) | Facultatif | Publicité, prévention de la fraude | SDK AdMob |
| Appareil ou autres ID › **ID d'appareil ou autres** | Oui | Oui (Google AdMob, ID publicitaire) | Facultatif (consentement) | Publicité; jetons de notification pour la fonctionnalité | `ads.ts`, `push.ts` |
| Position › **Position approximative** | Oui | Oui (Google AdMob, via l'adresse IP) | Facultatif | Publicité | SDK AdMob |
| Activité dans l'app › **Interactions avec l'app** | Oui | Oui (Google AdMob) | Facultatif | Publicité, analyse publicitaire | SDK AdMob |

**Non recueilli** : **Contacts** (lus sur l'appareil pour afficher et appeler, jamais envoyés au serveur : `app/(tabs)/contacts.tsx`), position précise, agenda, santé, fichiers, historique Web, applis installées, journaux de plantage (aucun outil de suivi des plantages dans l'app).

Données traitées hors du Canada : IA (Anthropic) avec consentement distinct; publicité (Google). Le dire aussi dans la politique (déjà le cas pour l'IA).

## 4. Autorisations et déclarations

Manifeste fusionné du build (vérifié localement, voir PR) : seulement ce qu'une app d'appels utilise.

| Autorisation | Pourquoi | Déclaration Play Console |
| --- | --- | --- |
| `RECORD_AUDIO` | micro pendant les appels (Twilio Voice) | aucune (autorisation d'exécution, texte « MIMT utilise le micro pour vos appels ») |
| `READ_CONTACTS` | afficher et appeler vos contacts, sur l'appareil seulement | aucune; demandée seulement quand vous ouvrez Contacts |
| `POST_NOTIFICATIONS` | appels entrants, textos, messagerie vocale | aucune |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE` | garder l'appel actif quand l'écran est éteint ou l'app en arrière-plan (service `VoiceService` de Twilio, type `microphone`) | **Oui** : Contenu de l'application › **Autorisations des services de premier plan** › Microphone › cas « Appel VoIP en cours ». Vidéo exigée : un appel, puis passer à l'écran d'accueil, l'appel continue (lien YouTube non répertorié) |
| `USE_FULL_SCREEN_INTENT` | écran d'appel entrant par-dessus l'écran verrouillé | **Oui** : **Autorisation d'intent plein écran** › « Passer et recevoir des appels » (fonction principale de l'app) |
| `WAKE_LOCK`, `DISABLE_KEYGUARD` | réveiller l'écran pour un appel entrant | aucune |
| `BLUETOOTH_CONNECT` (`BLUETOOTH` ≤ Android 11) | audio des appels dans un casque Bluetooth | aucune |
| `MODIFY_AUDIO_SETTINGS` | haut-parleur, écouteur | aucune |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `VIBRATE`, `RECEIVE_BOOT_COMPLETED`, `c2dm.RECEIVE` (FCM), pastilles de lanceurs | réseau, sonnerie, notifications push | aucune |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | ajoutées par `expo-secure-store` (coffre des jetons de connexion) | aucune |
| `ACCESS_ADSERVICES_*`, `BIND_GET_INSTALL_REFERRER_SERVICE` | ajoutées par le SDK Google Mobile Ads | couvertes par la déclaration ID publicitaire |
| `com.google.android.gms.permission.AD_ID` | ID publicitaire (AdMob, forfait Gratuit) | **Oui** : **ID publicitaire** › « Oui, l'app utilise un ID publicitaire » › Publicité |

Retirées exprès (`android.blockedPermissions` dans `app.config.ts`) : caméra, lecture/écriture du stockage, médias (photos par le sélecteur système, sans autorisation), écriture des contacts, superposition (`SYSTEM_ALERT_WINDOW`), service de lecture média en arrière-plan. Aucune autorisation SMS ni journal d'appels du téléphone (`READ_SMS`, `READ_CALL_LOG`) : MIMT n'utilise pas le téléphone comme appli SMS ou Téléphone par défaut, donc pas de formulaire « Autorisations SMS et journal d'appels ».

Correction faite dans ce PR : l'option `microphonePermission: false` du sélecteur d'images **bloquait `RECORD_AUDIO`** dans tout le manifeste Android (`tools:node="remove"`), donc le micro des appels. Un test (`src/build/storeBuild.test.ts`) empêche le retour de cette erreur.

### Niveau d'API cible
Google Play exige depuis le 31 août 2026 que les nouvelles apps et les mises à jour ciblent **Android 16 (API 36)** ou plus (support.google.com/googleplay/android-developer/answer/11926878). React Native 0.86 / Expo SDK 57 : `targetSdkVersion 36`, `compileSdk 36`, `minSdk 24` (vérifié dans le build). Rien à forcer.

## 5. 9-1-1 (à dire partout)
- Avant tout appel, l'app exige l'adresse civique et l'acceptation de l'avis 9-1-1 versionné; un appel ou texto bloqué renvoie vers l'avis. **Le 9-1-1 lui-même n'est jamais bloqué** (règle du dépôt, tests dans `apps/api`).
- Fiche : le paragraphe 9-1-1 ci-dessus. Notes de version de la première version : rappeler les limites.
- Ne jamais écrire « remplace votre ligne fixe » ou « 9-1-1 comme un téléphone ordinaire ».

## 6. Avant la production (liste)
1. Paiement in-app Google Play à la place des liens Stripe dans l'app (mobile-iap).
2. Suppression réelle des données après 30 jours (API) et page publique de suppression du compte.
3. Compte d'examen pour Google.
4. Captures depuis l'app Android réelle.
5. Identifiants AdMob réels, `google-services.json` (Firebase) et TAKATAK (variables GitHub).
6. Test fermé de 14 jours avec au moins 12 testeurs si le compte développeur est **personnel** et créé après novembre 2023 (règle Google). Un compte **organisation** (GROUPE TAKATAK, numéro D-U-N-S) n'a pas cette exigence.
7. Relecture juridique : politique de confidentialité (durées de conservation encore « à confirmer »), avis 9-1-1, Data safety.
