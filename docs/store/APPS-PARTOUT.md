# MIMT partout : téléphones, ordinateurs, télés

Demande du propriétaire, 18 novembre 2026 : MIMT au même standard « apps partout » que BesoinAvocat (portail installable + paquets pour les magasins), avec les images, les fiches et les liens. Ce fichier est la page d'entrée; les détails par magasin sont dans `google-play.md`, `android-build.md`, `app-store.md` et `ios-build.md`.

English summary at the end.

## Principe

MIMT a **deux apps**, et chacune sert là où elle est la meilleure :

| App | Code | Où | Pourquoi |
|---|---|---|---|
| **MIMT** (app native) | `apps/mobile` (Expo / React Native), `ca.mimt.app` | téléphones Android et iPhone | Un téléphone doit **sonner** quand l'app est fermée : notifications VoIP (PushKit + CallKit sur iPhone, FCM sur Android), achats intégrés Apple et Google. Une app Web ne peut pas faire ça de façon fiable. |
| **MIMT Web** (app installable, PWA) | `apps/webphone`, https://app.mimt.ca | ordinateurs Windows, Mac, Linux, Chromebook; aussi tablettes et téléphones par le navigateur | Appels (Twilio Voice JS), textos, messagerie vocale, portail Affaires, réunions. Une seule version du code : chaque mise à jour de app.mimt.ca est aussitôt dans l'app installée et dans le paquet Microsoft Store. |

Règle : ce qui est fait dans une version est fait dans l'autre quand c'est possible. **Le 9-1-1 n'est jamais bloqué**, dans aucune des deux.

## Ce qui est prêt dans le code

- **App native :** workflows `Mobile Android (Google Play)` et `Mobile iOS (App Store)` (fichier `.aab` signé, build EAS + TestFlight), fiches et déclarations rédigées (`google-play.md`, `app-store.md`), icône 512 et image de présentation 1024 × 500 (`apps/mobile/assets/brand/`).
- **App installable (PWA) :** `apps/webphone/public/manifest.webmanifest` (nom, icônes 192/512 + « maskable », raccourcis Messages, Appels, Messagerie vocale, `display_override` pour la barre de titre Windows), service worker qui ne garde que la coquille de l'app (jamais les appels à l'API, la connexion ou les messages), et **captures d'écran** pour les fiches :
  - téléphone (780 × 1688) : `screenshots/narrow-accueil.png`, `narrow-messages.png`, `narrow-appels.png`;
  - ordinateur (1440 × 900) : `screenshots/wide-accueil.png`, `wide-messages.png`.

  Ces captures viennent du **mode démo** (`VITE_MOCK_API=1`) : données fictives (Camille Tremblay, numéros 555), aucun vrai client. Le test `apps/webphone/src/manifest.test.ts` vérifie que chaque icône et chaque capture existe à la taille annoncée.
- **Les captures de l'app Web ne remplacent pas celles de l'app native** dans Google Play et l'App Store (voir `google-play.md` § Visuels) : celles-là se prennent sur un vrai téléphone une fois le build en test interne.

## Toutes les plateformes

| # | Plateforme | Appareils | App et paquet | Inscription (entreprise) | Dépôt de l'app | Coût | Faisabilité |
|---|---|---|---|---|---|---|---|
| 1 | Google Play | téléphones Android | app native `.aab` (workflow Mobile Android) | https://play.google.com/console/signup | https://play.google.com/console | 25 $ US une fois | **Oui**, prêt. Reste : compte, secrets de signature, captures du vrai téléphone. |
| 2 | Apple App Store | iPhone | app native (EAS Build + Submit) | https://developer.apple.com/programs/enroll/ | https://appstoreconnect.apple.com | 99 $ US par an | **Oui**, prêt. Reste : compte, clé API App Store Connect, captures. |
| 3 | Mac | Mac Apple Silicon | la même app iPhone, cochée « disponible sur Mac » dans App Store Connect; ou MIMT Web installé depuis Safari/Chrome (« Ajouter au Dock ») | même compte Apple | App Store Connect › Tarifs et disponibilité | inclus | **Oui** par le navigateur dès aujourd'hui; l'app iPhone sur Mac est à tester (micro et CallKit). |
| 4 | Microsoft Store | PC Windows 10 et 11 | MIMT Web emballé en `.msix` par PWABuilder | https://storedeveloper.microsoft.com | https://partner.microsoft.com/dashboard | gratuit | **Oui.** Voir « Windows » plus bas. |
| 5 | Linux, Chromebook | tout PC | MIMT Web, bouton « Installer » du navigateur (déjà actif) | — | — | gratuit | **Oui**, déjà possible. |
| 6 | Tablettes Android et iPad | tablettes | MIMT Web dans le navigateur (l'app native est en format téléphone : `supportsTablet: false`) | — | — | gratuit | **Oui** par le navigateur. Une app tablette native serait un chantier à part. |
| 7 | Samsung Galaxy Store | téléphones Samsung | même app native (`.apk`) | https://seller.samsungapps.com | https://seller.samsungapps.com | gratuit | **Plus tard.** Les appels entrants marchent (FCM existe sur Samsung), mais les achats intégrés passent par Google Play Billing : il faut un build en mode `companion` (rien n'est vendu dans l'app) ou Samsung IAP. |
| 8 | Amazon Appstore | tablettes Fire | même app native | https://developer.amazon.com/apps-and-games/console | même lien | gratuit | **Non pour l'instant.** Fire OS n'a pas les services Google : pas de FCM, donc l'app ne sonnerait pas à l'arrivée d'un appel, et pas de Google Play Billing. MIMT Web dans le navigateur Silk reste possible. |
| 9 | Huawei AppGallery | téléphones Huawei récents | même app native | https://developer.huawei.com/consumer/en/appgallery | AppGallery Connect | gratuit | **Non pour l'instant**, même raison que la ligne 8 (pas de services Google). |
| 10 | Télés (Google TV, Fire TV, Samsung, LG), Apple TV, Roku | télés | — | — | — | — | **Non.** Une télé n'a ni micro ni clavier pour appeler ou texter; ce n'est pas un usage de téléphonie. |
| 11 | Consoles (Xbox, PlayStation) | consoles | — | — | — | — | **Non**, même raison; Sony ne publie pas ce type d'app. |

### Ordre recommandé

1. **Numéro D-U-N-S** (gratuit, Dun & Bradstreet, demandé depuis la page d'Apple) : Google et Apple l'exigent pour un compte d'entreprise. Le demander en premier.
2. **Inscriptions de l'entreprise** (GROUPE TAKATAK) : Google Play, Apple, Microsoft. Le propriétaire saisit lui-même mots de passe, codes et paiements; Claude ne les tape jamais.
3. **Paquets :** Android et iPhone par les workflows existants; Windows par PWABuilder.
4. **Plus tard :** Samsung (mode `companion`), puis une app tablette si la demande existe.

## Windows (Microsoft Store) : étapes

1. Partner Center › **Apps and games** › **New product** › **MSIX or PWA app** › réserver le nom **« MIMT »** (ou « MIMT Web » s'il est pris).
2. Partner Center › le produit › **Product identity** : noter `Package/Identity/Name`, `Package/Identity/Publisher` et `Package/Properties/PublisherDisplayName`. Ce ne sont pas des secrets.
3. https://www.pwabuilder.com › entrer `https://app.mimt.ca` › le score doit être sans erreur (manifeste, service worker, HTTPS). Si app.mimt.ca sert encore un ancien build, redéployer `main` d'abord (les captures et `display_override` arrivent avec cette PR).
4. **Package for stores** › **Windows** › coller les trois valeurs de l'étape 2 › télécharger le `.msixbundle`.
5. Partner Center › **Packages** › téléverser; **Store listing** avec les textes ci-dessous et les captures `wide-*.png` (1440 × 900 respecte le minimum de 1366 × 768).
6. **Age ratings** (questionnaire IARC), **Pricing** gratuit, **Privacy policy** `https://mimt.ca/confidentialite/`.

Paiements : MIMT Web vend les forfaits par Stripe. Le Microsoft Store permet à une app qui n'est pas un jeu d'utiliser son propre système de paiement (politique 10.8.7); à confirmer au moment de l'envoi.

Microphone : Windows demande la permission du micro au premier appel, comme le navigateur. Aucune déclaration spéciale.

### Textes de la fiche Microsoft Store

**Nom :** MIMT

**Description courte (FR) :** « Votre numéro canadien sur votre ordinateur : appels, textos et messagerie vocale. »
**Short description (EN):** "Your Canadian phone number on your computer: calls, texts and voicemail."

**Description (FR) :**

```
MIMT met votre numéro de téléphone canadien sur votre ordinateur. Appelez, textez et écoutez vos messages vocaux sans décrocher votre cellulaire.

• Appels et textos au Canada et aux États-Unis, selon votre forfait.
• Messagerie vocale, avec transcription en français sur certains forfaits.
• MIMT Affaires : postes, groupes d'appel, accueil téléphonique et réceptionniste IA.
• Réunions vidéo.
• Fonctions d'IA facultatives (résumés, suggestions de réponse), seulement si vous les activez.
• Le même compte que l'app MIMT sur votre téléphone.

9-1-1 : MIMT n'est pas un service téléphonique traditionnel. Les appels au 9-1-1 ont des limites (panne d'Internet ou de courant, adresse à tenir à jour). Gardez un autre moyen d'appeler les secours.

Fait au Québec par GROUPE TAKATAK.
Confidentialité : https://mimt.ca/confidentialite/
```

**Description (EN):**

```
MIMT puts your Canadian phone number on your computer. Call, text and listen to your voicemail without picking up your cell phone.

• Calls and texts in Canada and the US, depending on your plan.
• Voicemail, with French transcription on some plans.
• MIMT Business: extensions, ring groups, phone greeting menu and AI receptionist.
• Video meetings.
• Optional AI features (summaries, reply suggestions), only if you turn them on.
• The same account as the MIMT app on your phone.

9-1-1: MIMT is not a traditional phone service. 9-1-1 calls have limits (Internet or power outage, address to keep up to date). Keep another way to reach emergency services.

Made in Québec by GROUPE TAKATAK.
Privacy: https://mimt.ca/en/privacy/
```

**Catégorie :** Communication (secondaire : Productivité). **Site :** https://mimt.ca. **Soutien :** https://mimt.ca/aide/ et info@mimt.ca.

À vérifier avant l'envoi : chaque fonction citée est active sur app.mimt.ca. Retirer une ligne plutôt que promettre.

## Refaire les captures de MIMT Web

```sh
pnpm --filter @mimt/shared build
VITE_MOCK_API=1 pnpm --filter @mimt/webphone exec vite build --outDir /tmp/mimt-demo
```

Servir `/tmp/mimt-demo` (avec retour à `index.html`), ouvrir `/connexion`, cliquer « Continuer avec TAKATAK » (le mode démo accepte), masquer le bandeau « Mode démo », puis capturer `/accueil`, `/messages` et `/appels` à 390 × 844 (échelle 2) et à 1440 × 900. Mettre à jour `sizes` dans le manifeste si la taille change; le test le vérifie.

## English summary

MIMT ships two apps: the native app (`apps/mobile`, Expo) for Android phones and iPhone, because a phone app must ring when closed (VoIP push) and sell through store billing; and MIMT Web (`apps/webphone`, app.mimt.ca), an installable PWA for Windows, Mac, Linux, Chromebook and tablets. This change adds `display_override` and five demo-mode screenshots (phone and desktop) to the PWA manifest, a test that every manifest image exists at its declared size, the full platform table (Play, App Store, Mac, Microsoft Store, Linux, Samsung, Amazon, Huawei, TVs, consoles) with sign-up and submission links, the Windows packaging steps through PWABuilder and the Microsoft Store listing texts. TVs and consoles are out of scope: no microphone or keyboard for calling and texting. Amazon and Huawei wait: no Google services, so no FCM ring and no Play Billing.
