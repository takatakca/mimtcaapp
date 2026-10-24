# MIMT Android : fichier .aab signé pour Google Play

Le workflow **Mobile Android (Google Play)** (`.github/workflows/mobile-android.yml`) fabrique l'App Bundle signé de `apps/mobile` sur un serveur GitHub (Ubuntu, SDK Android déjà installé). **Aucun compte Expo n'est nécessaire.** Il peut aussi l'envoyer tout seul au **test interne** de Google Play.

English summary at the end.

## Ce que fait le workflow

1. Refuse de démarrer s'il manque un des quatre secrets de signature, avec un message qui les nomme. Il ne produit jamais de fichier non signé.
2. `pnpm install`, build de `@mimt/shared`, typecheck et tests de l'app mobile.
3. `versionCode` = numéro du run du workflow (+ `ANDROID_VERSION_CODE_OFFSET` si défini). Il augmente à chaque run, comme Google l'exige. `versionName` = `version` de `apps/mobile/package.json`.
4. `npx expo prebuild --platform android --clean`, puis `./gradlew :app:bundleRelease`.
5. Vérifie que le bundle est signé avec **la clé de téléversement** (et pas la clé de débogage) et affiche son empreinte SHA-256.
6. Dépose `mimt-<version>-<versionCode>.aab` comme artefact du run (30 jours).
7. Si le secret `PLAY_SERVICE_ACCOUNT_JSON` existe : envoi au test interne (`internal`), statut `draft` par défaut.

La signature est branchée par le plugin `apps/mobile/plugins/withAndroidReleaseSigning.js` : Gradle lit le chemin du keystore et les mots de passe dans des variables d'environnement du run. Rien n'est écrit dans le dépôt.

## Lancer un build

- GitHub › **Actions** › **Mobile Android (Google Play)** › **Run workflow** (branche `main`).
- Ou pousser une étiquette : `git tag mobile-v0.1.0 && git push origin mobile-v0.1.0` (lance Android et iOS).
- Le fichier : page du run › **Artifacts** › `mimt-android-aab-<n>` (un .zip qui contient le .aab).

## Secrets et variables à ajouter (propriétaire)

GitHub › dépôt `takatakca/mimtcaapp` › **Settings › Secrets and variables › Actions**.

| Nom | Type | Obligatoire | Comment l'obtenir |
| --- | --- | --- | --- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | secret | oui | `bash apps/mobile/scripts/android/create-upload-keystore.sh` (voir plus bas), contenu du fichier `.base64` |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | secret | oui | le mot de passe tapé pendant le script |
| `ANDROID_UPLOAD_KEY_ALIAS` | secret | oui | `mimt-upload` |
| `ANDROID_UPLOAD_KEY_PASSWORD` | secret | oui | le même mot de passe (un keystore PKCS12 n'a qu'un mot de passe) |
| `GOOGLE_SERVICES_JSON_BASE64` | secret | fortement conseillé | Firebase console › projet › app Android `ca.mimt.app` › télécharger `google-services.json`, puis `base64 -w0 google-services.json` (macOS : `base64 -i google-services.json`). Sans lui, l'app se construit mais **les appels entrants et les notifications ne sonnent pas** (FCM). |
| `PLAY_SERVICE_ACCOUNT_JSON` | secret | non (envoi auto) | voir « Compte de service Play » |
| `TAKATAK_ISSUER`, `TAKATAK_MOBILE_CLIENT_ID` | variables | conseillé | connexion TAKATAK dans l'app (client public PKCE, redirection `mimt://oauthredirect`) |
| `ADMOB_ANDROID_APP_ID`, `ADMOB_ANDROID_BANNER_UNIT_ID`, `ADMOB_ANDROID_REWARDED_UNIT_ID` | variables | avant la production | AdMob › Applications. Sans elles : identifiants de test de Google, zéro revenu. |
| `MOBILE_API_URL` | variable | non | `https://api.mimt.ca` par défaut |
| `EAS_PROJECT_ID` | variable | non pour Android | jetons de notification Expo (partagée avec iOS) |
| `ANDROID_VERSION_CODE_OFFSET` | variable | non | à régler seulement si un .aab a déjà été envoyé avec un versionCode plus grand |

## Créer la clé de téléversement (une fois)

Sur votre ordinateur (JDK 17+ requis pour `keytool`) :

```bash
bash apps/mobile/scripts/android/create-upload-keystore.sh          # écrit ~/mimt-keys/mimt-upload.jks
```

Le script refuse d'écrire dans le dépôt, demande un mot de passe, crée une clé RSA 4096 valide 30 ans, et produit `mimt-upload.jks.base64` à coller dans `ANDROID_UPLOAD_KEYSTORE_BASE64`. Supprimez le `.base64` après, gardez une copie de sauvegarde du `.jks` et le mot de passe dans un gestionnaire de mots de passe.

### Play App Signing (signature par Google)

- Google garde la **clé de signature de l'app** (celle que voient les téléphones). Vous ne l'avez jamais : rien à perdre.
- Votre clé ne sert qu'à **téléverser** : elle prouve à Google que le fichier vient de vous.
- Clé perdue ou volée : Play Console › **Tester et publier › Intégrité de l'application › Clé de téléversement › Demander une réinitialisation**, puis recréez une clé avec le script et remplacez les secrets. L'app et ses utilisateurs ne sont pas touchés.
- Le premier .aab téléversé enregistre la clé de téléversement : Play Console affiche son empreinte SHA-256, la même que celle imprimée par le workflow.

## Compte de service Play (envoi automatique, facultatif)

1. Google Cloud console (même compte Google que Play) › créer un projet `mimt-play` › **IAM › Comptes de service › Créer**, nom `github-play-upload`, sans rôle Cloud.
2. Sur ce compte : **Clés › Ajouter une clé › JSON** (fichier téléchargé). Activer l'API **Google Play Android Developer API** dans ce projet.
3. Play Console › **Utilisateurs et autorisations › Inviter un utilisateur** : l'adresse du compte de service, accès à l'app MIMT avec **Publier sur les canaux de test** (et « Afficher les informations sur l'app »).
4. Coller tout le contenu du JSON dans le secret `PLAY_SERVICE_ACCOUNT_JSON`, puis supprimer le fichier local.

Limite de Google : **le tout premier .aab doit être téléversé à la main** dans Play Console (l'API ne peut pas créer la première version). Tant que l'app n'a jamais été publiée, l'API n'accepte que le statut `draft` (défaut du workflow) : vous cliquez ensuite « Vérifier et déployer ».

## Premier envoi dans Play Console (test interne)

1. play.google.com/console › **Créer une application** : nom « MIMT », langue par défaut Français (Canada) `fr-CA`, Application, Gratuite, accepter les déclarations.
2. Ajouter les secrets de signature, lancer **Actions › Mobile Android (Google Play) › Run workflow**, télécharger l'artefact, dézipper : `mimt-0.1.0-<n>.aab`.
3. Play Console › MIMT › **Tester et publier › Tests › Tests internes › Créer une version**. À la première fois, accepter **Play App Signing** (signature gérée par Google).
4. Glisser le `.aab`, nom de version `0.1.0 (<n>)`, notes de version (FR puis EN), **Suivant › Enregistrer › Vérifier la version**.
5. Onglet **Testeurs** : créer une liste de courriels (vous et vos testeurs), copier le lien d'inscription.
6. **Déployer en test interne**. Les testeurs ouvrent le lien, acceptent, puis installent depuis Play (quelques minutes).
7. Avant la production, remplir toutes les sections de **Contenu de l'application** (`docs/store/google-play.md`).

## Essai local (sans secrets)

```bash
export ANDROID_HOME=~/Android/Sdk                      # SDK: platform 36, build-tools 36, NDK 27.1
cd apps/mobile && npx expo prebuild --platform android --clean --no-install
cd android && ./gradlew :app:bundleRelease
```

Sans les variables `ORG_GRADLE_PROJECT_MIMT_UPLOAD_*`, le bundle est signé avec **la clé de débogage** : c'est un test, Google Play le refuse. Ne jamais le téléverser.

## English summary

`.github/workflows/mobile-android.yml` builds a signed `.aab` without an Expo account (prebuild + Gradle `bundleRelease` on ubuntu-latest), fails with a clear message if any of `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD` is missing, uses the run number as `versionCode`, verifies the upload-key signature, publishes the bundle as an artifact and, when `PLAY_SERVICE_ACCOUNT_JSON` exists, uploads it to the Play internal testing track as a draft. Create the upload key with `apps/mobile/scripts/android/create-upload-keystore.sh`. Google keeps the app signing key (Play App Signing); a lost upload key can be reset in Play Console. The first bundle must be uploaded by hand.
