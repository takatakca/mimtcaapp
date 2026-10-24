# MIMT iOS : build App Store (.ipa) et envoi à TestFlight

Le workflow **Mobile iOS (App Store)** (`.github/workflows/mobile-ios.yml`) lance **EAS Build** (macOS et Xcode dans le nuage d'Expo) puis **EAS Submit** vers App Store Connect. Le build apparaît dans TestFlight après le traitement d'Apple.

English summary at the end.

## Pourquoi EAS plutôt qu'un Mac GitHub + fastlane

- **Certificats et profils automatiques** : avec la clé API App Store Connect, EAS crée et renouvelle le certificat de distribution et le profil App Store, et active les capacités (notifications push). Avec fastlane il faut `match`, un dépôt privé de certificats et sa clé de chiffrement.
- **Xcode à jour pour Expo SDK 57** : l'image EAS suit Expo; un runner `macos-latest` change d'Xcode à son rythme.
- **Coût** : une minute de runner macOS GitHub compte 10 minutes; un build RN complet prend 20 à 40 minutes. EAS a un forfait gratuit (petit nombre de builds iOS par mois, file d'attente plus lente) et des forfaits payants.
- Les étapes de config (`app.config.ts`, plugins) sont les mêmes; passer à fastlane plus tard reste possible.

## Ce que fait le workflow

1. Refuse de démarrer s'il manque un accès, avec la liste des noms.
2. Installe, build `@mimt/shared`, typecheck et tests mobiles.
3. Écrit la clé `.p8` dans le dossier temporaire du runner (supprimée à la fin) et la donne à EAS (`EXPO_ASC_*`) : aucune question interactive.
4. Ajoute au profil `production` d'`eas.json`, pour ce run seulement, les valeurs publiques (URL de l'API, émetteur TAKATAK, identifiants AdMob, `EAS_PROJECT_ID`) : EAS réévalue `app.config.ts` sur ses serveurs.
5. `eas build --platform ios --profile production` : numéro de build incrémenté par EAS (`autoIncrement`, version « remote »).
6. `eas submit --platform ios` vers l'app App Store Connect `ASC_APP_ID` (si l'option « submit » est cochée).

## Accès à ajouter (propriétaire)

GitHub › `takatakca/mimtcaapp` › **Settings › Secrets and variables › Actions**.

| Nom | Type | Comment l'obtenir |
| --- | --- | --- |
| `EXPO_TOKEN` | secret | expo.dev (compte gratuit) › **Account settings › Access tokens › Create** |
| `EAS_PROJECT_ID` | variable | expo.dev › **Create project** nommé `mimt` (slug `mimt`) › identifiant du projet. Ou, dans `apps/mobile` : `npx eas-cli login && npx eas-cli init` |
| `APPLE_TEAM_ID` | variable | developer.apple.com › **Account › Membership details › Team ID** |
| `APPLE_TEAM_TYPE` | variable (facultatif) | `COMPANY_OR_ORGANIZATION` (défaut) ou `INDIVIDUAL` selon votre compte Apple |
| `ASC_API_KEY_ID` | secret | App Store Connect › **Utilisateurs et accès › Intégrations › API App Store Connect › Clés d'équipe › +**, accès **Admin** (nécessaire pour créer certificats et profils) |
| `ASC_API_ISSUER_ID` | secret | même page, « Issuer ID » au-dessus de la liste |
| `ASC_API_KEY_P8` | secret | le fichier `AuthKey_XXXX.p8` (téléchargeable **une seule fois**) : coller tout son contenu, lignes BEGIN/END comprises |
| `ASC_APP_ID` | variable | App Store Connect › **Apps › + › Nouvelle app** : iOS, nom « MIMT », langue principale Français (Canada), identifiant de paquet `ca.mimt.app`, SKU `mimt-ios`. Puis **Informations sur l'app › Identifiant Apple** (chiffres) |
| `TAKATAK_ISSUER`, `TAKATAK_MOBILE_CLIENT_ID`, `ADMOB_IOS_*`, `MOBILE_API_URL` | variables | mêmes valeurs publiques que pour Android (`docs/store/android-build.md`) |

Si l'identifiant `ca.mimt.app` n'existe pas encore dans **Certificates, Identifiers & Profiles**, EAS le crée au premier build avec la clé API.

## Lancer

GitHub › **Actions › Mobile iOS (App Store) › Run workflow**, ou une étiquette `mobile-v*`. Le fichier `.ipa` se télécharge sur expo.dev › projet mimt › **Builds**; TestFlight le montre 5 à 30 minutes après l'envoi.

## Hors de ce workflow (autre chantier)

Achats intégrés (StoreKit), conformité Apple (confidentialité, `ios` de `app.config.ts`) et clé APNs VoIP pour Twilio relèvent de l'agent « mobile-iap ».

## English summary

iOS builds run on EAS Build and go to App Store Connect with EAS Submit (`.github/workflows/mobile-ios.yml`). Secrets: `EXPO_TOKEN`, `ASC_API_KEY_ID`, `ASC_API_ISSUER_ID`, `ASC_API_KEY_P8`; variables: `EAS_PROJECT_ID`, `APPLE_TEAM_ID`, `ASC_APP_ID` (optional `APPLE_TEAM_TYPE`). EAS manages certificates and provisioning profiles through the App Store Connect API key, so no macOS runner, fastlane match repo or interactive Apple login is needed.
